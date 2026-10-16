import * as THREE from 'three';
import '@fontsource/russo-one';
import '@fontsource/rajdhani/600.css';
import '@fontsource/rajdhani/700.css';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  ARENA_CONFIG,
  ArenaTheme,
  BALL_CONFIG,
  CAR_CONFIG,
  GameEvent,
  GameSnapshot,
  PlayerInput,
  Team,
  TransformSnapshot,
} from '@aerial-arena/shared';
import { BALL_KEY } from '@aerial-arena/game-core';
import { ArenaVisual, createArenaMesh } from './renderer/arenaMesh.js';
import { CarVisual, TEAM_PAINT, createCarMesh } from './renderer/carMesh.js';
import { BallVisual, createBallMesh } from './renderer/ballMesh.js';
import { EffectsSystem } from './renderer/effects.js';
import { CameraManager } from './camera/cameraManager.js';
import { SoundSystem } from './audio/soundSystem.js';
import { InputManager } from './input/inputManager.js';
import { NetworkClient } from './net/networkClient.js';
import { lerpTransform } from './net/snapshotBuffer.js';
import { FreePlayManager } from './freeplay/freePlayManager.js';
import { BotMatchManager } from './freeplay/botMatch.js';
import type { GameSimulation } from '@aerial-arena/game-core';
import { UIOverlay } from './ui/uiOverlay.js';
import { AccountClient } from './net/account.js';
import { AuthPanel } from './ui/authPanel.js';
import { settings } from './settings/settingsStore.js';
import { CustomCarModel, loadCustomCarModel } from './renderer/customCarModel.js';
import { DEFAULT_LOOK } from './renderer/carLook.js';
import { BallIndicator } from './renderer/ballIndicator.js';

type AppState = 'landing' | 'searching' | 'online_match' | 'free_play' | 'bot_match';

interface CarRenderState {
  transform: TransformSnapshot;
  boosting: boolean;
  supersonic: boolean;
  grounded: boolean;
  demoed: boolean;
  dodging: boolean;
  boost: number;
}

const identityTransform = (x: number, y: number, z: number, yaw = 0): TransformSnapshot => ({
  x, y, z,
  qx: 0, qy: Math.sin(yaw / 2), qz: 0, qw: Math.cos(yaw / 2),
  vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0,
});

class GameApp {
  private renderer!: THREE.WebGLRenderer;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private scene = new THREE.Scene();
  private cameraManager!: CameraManager;
  private effects = new EffectsSystem();
  private sound = new SoundSystem();
  private input = new InputManager();
  private net!: NetworkClient;
  private ui!: UIOverlay;

  private state: AppState = 'landing';
  private theme: ArenaTheme = 'coastal_dome';
  private arena!: ArenaVisual;
  private ball!: BallVisual;
  private cars = new Map<string, CarVisual>();
  private localId = '';
  private localTeam: Team = 'blue';
  private freePlay?: FreePlayManager;
  private botMatch?: BotMatchManager;
  private lastMode: 'online' | 'bot' = 'online';
  private lastTime = performance.now();
  private attractAngle = 0;
  private lastPhase = '';
  private prevDodging = false;
  private prevGrounded = true;
  private lastBallPos = new THREE.Vector3();
  private modalOpen = false;
  private customCar: CustomCarModel | null = null;
  private account!: AccountClient;
  private auth!: AuthPanel;
  private ballIndicator = new BallIndicator();
  private garageOpen = false;
  private showcase?: CarVisual;
  private showcaseTime = 0;

  // scratch vectors
  private readonly v1 = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();

  constructor() {
    this.initRenderer();
    this.initNetwork();
    this.initUI();
    this.initInput();
    this.loadArena(this.theme);
    this.ball = createBallMesh();
    this.scene.add(this.ball.root, this.effects.root, this.ballIndicator.root);
    void loadCustomCarModel().then((m) => (this.customCar = m));
    window.addEventListener('resize', this.onResize);
    this.onResize();
    requestAnimationFrame(this.loop);
  }

  // -------------------------------------------------------------- setup
  private initRenderer(): void {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Procedural studio reflections so metal, chrome rims and clearcoat paint read correctly.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();
    this.cameraManager = new CameraManager(window.innerWidth / window.innerHeight);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.cameraManager.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.45, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  private initNetwork(): void {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const serverUrl = resolveServerUrl(proto);
    this.net = new NetworkClient(serverUrl);
    this.account = new AccountClient(serverUrl);
    this.net.onQueueWaiting = () => {
      this.state = 'searching';
      this.ui.showSearching();
    };
    this.net.onQueueMatched = (info) => this.startOnlineMatch(info.team, info.theme);
    this.net.onQueueCancelled = () => this.toLanding();
    this.net.onRoomCreated = (code) => this.ui.showRoomCode(code);
    this.net.onRoomCancelled = () => undefined;
    this.net.onPhaseChange = (phase) => {
      if (phase === 'countdown' || phase === 'overtimeCountdown') {
        this.sound.playCountdown(false);
        this.cameraManager.snap();
        this.effects.clear();
      } else if (phase === 'active' || phase === 'overtime') {
        this.sound.playCountdown(true);
      }
    };
    this.net.onGoal = (scorer, blue, orange) => this.onGoal(scorer, blue, orange);
    this.net.onResult = (winner, blue, orange, reason) => {
      this.ui.showResult(winner, blue, orange, reason);
      // The server records online results; refresh the profile card afterwards.
      window.setTimeout(() => void this.account.refresh().then(() => this.auth.renderCard()), 400);
    };
    this.net.onOpponentDisconnected = (grace) => this.ui.showDisconnectBanner(grace);
    this.net.onOpponentReconnected = () => this.ui.hideDisconnectBanner();
    this.net.onSnapshot = (snap) => this.handleEvents(snap.events ?? [], snap);
    this.net.onError = (msg) => {
      this.ui.setStatus('bad', msg);
      this.ui.privateError(msg);
    };
  }

  private initUI(): void {
    this.ui = new UIOverlay(document.getElementById('ui-root')!, {
      onPlayQuickMatch: async () => {
        this.sound.enableAudio();
        this.ui.setStatus('unknown', 'Connecting…');
        const ok = await this.net.connect();
        if (ok) {
          this.ui.setStatus('ok', 'Connected to match server');
          this.net.joinQueue('Player');
        } else {
          this.ui.setStatus('bad', `Match server offline (expected on port 3001). Start it with "npm run dev".`);
        }
      },
      onPlayFreePlay: async () => {
        this.sound.enableAudio();
        await this.startFreePlay();
      },
      onCancelQueue: () => this.net.cancelQueue(),
      onLeaveMatch: () => this.leaveCurrentMode(),
      onCreateRoom: async () => {
        this.sound.enableAudio();
        if (await this.ensureConnected()) this.net.createRoom('Player', this.theme);
      },
      onJoinRoom: async (code) => {
        this.sound.enableAudio();
        if (await this.ensureConnected()) this.net.joinRoom(code, 'Player');
      },
      onCancelRoom: () => this.net.cancelRoom(),
      onPlayBot: async () => {
        this.sound.enableAudio();
        await this.startBotMatch();
      },
      onPlayAgain: () => {
        if (this.lastMode === 'bot') {
          void this.startBotMatch();
          return;
        }
        this.leaveCurrentMode();
        void this.net.connect().then((ok) => ok && this.net.joinQueue('Player'));
      },
      onReturnToMenu: () => this.leaveCurrentMode(),
      onToggleMute: () => this.sound.toggleMute(),
      onVolumeChange: (v) => this.sound.setVolume(v),
      onThemeChange: (t) => {
        this.theme = t;
        if (this.state === 'landing') this.loadArena(t);
      },
      onFreePlayUnlimitedBoost: (on) => {
        if (this.freePlay && this.freePlay.unlimitedBoost !== on) this.freePlay.toggleUnlimitedBoost();
      },
      onFreePlayGoalReset: (on) => {
        if (this.freePlay) this.freePlay.goalResetEnabled = on;
      },
      onGarage: (open) => {
        this.garageOpen = open;
        this.auth.showCard(!open);
        this.buildShowcase();
        if (!open) this.onResize(); // restore the gameplay FOV
      },
      captureKey: (cb) => this.input.captureNext(cb),
      onModalChange: (open) => {
        this.modalOpen = open;
        this.input.suspended = open;
        if (open) this.input.clearAll();
      },
    });
    this.ui.setCameraMode(this.cameraManager.mode);
    // Accounts: login screen unless a saved session is still valid.
    this.auth = new AuthPanel(this.account, (profile) => {
      this.net.authToken = profile ? this.account.authToken : null;
      this.auth.showCard(this.state === 'landing');
    });
    document.getElementById('ui-root')!.appendChild(this.auth.el);
    void this.account.restore().then((profile) => {
      this.net.authToken = profile ? this.account.authToken : null;
      if (profile) this.auth.renderCard();
      else this.auth.showLogin(true);
      this.auth.showCard(this.state === 'landing');
    });
    this.sound.setVolume(settings.get().volume);
    settings.subscribe(() => {
      if (this.garageOpen) this.buildShowcase();
    });
  }

  /** Connect if needed; reports a clear error when the match server is unreachable. */
  private async ensureConnected(): Promise<boolean> {
    if (this.net.getConnected()) return true;
    this.ui.setStatus('unknown', 'Connecting…');
    const ok = await this.net.connect();
    if (ok) this.ui.setStatus('ok', 'Connected to match server');
    else {
      const msg = 'Match server offline. Start it with "npm run dev" (or check your deployment).';
      this.ui.setStatus('bad', msg);
      this.ui.privateError(msg);
    }
    return ok;
  }

  private initInput(): void {
    this.input.onToggleCamera = () => {
      if (this.modalOpen) return;
      this.ui.setCameraMode(this.cameraManager.toggleMode());
    };
    this.input.onHoldCamera = (held) => {
      if (this.modalOpen) return;
      this.ui.setCameraMode(this.cameraManager.setMode(held ? 'car_cam' : 'ball_cam'));
    };
    this.input.onTogglePause = () => {
      if (this.state === 'online_match' || this.state === 'free_play' || this.state === 'bot_match') this.ui.togglePauseMenu();
    };
    // Rendering stops while hidden, so push a neutral input right away (the server also
    // treats inputs older than 250 ms as neutral).
    this.input.onFocusLost = () => {
      if (this.state === 'online_match') this.net.sendInput(this.input.sampleInput());
    };
    this.input.onToggleHelp = () => {
      if (this.state === 'online_match' || this.state === 'free_play' || this.state === 'bot_match') this.ui.toggleHelp();
    };
    const fp = (fn: (m: FreePlayManager) => void, msg?: string) => () => {
      if (this.state === 'free_play' && this.freePlay && !this.modalOpen) {
        fn(this.freePlay);
        if (msg) this.ui.toast(msg);
      }
    };
    this.input.onResetBall = fp((m) => m.resetBall(), 'Ball reset');
    this.input.onResetCar = fp((m) => {
      m.resetCar();
      this.cameraManager.snap();
    }, 'Car reset');
    this.input.onToggleUnlimitedBoost = fp((m) => this.ui.toast(m.toggleUnlimitedBoost() ? 'Unlimited boost ON' : 'Unlimited boost OFF'));
    this.input.onLaunchBall = fp((m) => m.launchBallUpward());
    this.input.onPracticeShot = fp((m) => m.practiceShotTowardGoal());
    this.input.onBallOnHood = fp((m) => m.ballOnHood());
  }

  private loadArena(theme: ArenaTheme): void {
    if (this.arena) {
      this.scene.remove(this.arena.root);
      this.arena.destroy();
    }
    this.arena = createArenaMesh(theme);
    this.scene.add(this.arena.root);
    this.scene.fog = new THREE.Fog(this.arena.palette.fog, 160, 650);
    this.renderer.toneMappingExposure = this.arena.palette.exposure;
  }

  // ---------------------------------------------------------- modes
  private clearCars(): void {
    for (const c of this.cars.values()) {
      this.scene.remove(c.root);
      c.destroy();
    }
    this.cars.clear();
  }

  private addCarVisual(id: string, team: Team): CarVisual {
    // The local player's car wears the Garage customisation; others use the default look.
    const local = id === this.localId || (this.state === 'online_match' && team === this.localTeam);
    const v = createCarMesh(team, this.customCar, local ? settings.get().car : DEFAULT_LOOK);
    this.scene.add(v.root);
    this.cars.set(id, v);
    return v;
  }

  private async startFreePlay(): Promise<void> {
    this.ui.showLoading(true);
    this.leaveLocalSessions();
    this.loadArena(this.theme);
    this.clearCars();
    this.freePlay?.destroy();
    this.freePlay = new FreePlayManager();
    await this.freePlay.initialize();
    this.localId = this.freePlay.playerId;
    this.localTeam = 'blue';
    this.addCarVisual(this.localId, 'blue');
    this.effects.clear();
    this.cameraManager.snap();
    this.state = 'free_play';
    this.ui.showLoading(false);
    this.ui.showGameHUD(true, 'blue');
    this.auth.showCard(false);
  }

  private startOnlineMatch(team: Team, theme: ArenaTheme): void {
    this.state = 'online_match';
    this.localTeam = team;
    this.localId = '';
    this.loadArena(theme);
    this.clearCars();
    this.effects.clear();
    this.net.snapshots.clear();
    this.cameraManager.snap();
    this.ui.showGameHUD(false, team);
    this.auth.showCard(false);
  }

  private leaveCurrentMode(): void {
    if (this.state === 'online_match' || this.state === 'searching') {
      this.net.leaveMatch();
      this.net.disconnect();
    }
    this.freePlay?.destroy();
    this.freePlay = undefined;
    this.botMatch?.destroy();
    this.botMatch = undefined;
    this.toLanding();
  }

  private toLanding(): void {
    this.state = 'landing';
    this.clearCars();
    this.effects.clear();
    this.sound.setBoosting(false);
    this.sound.updateEngineSpeed(0);
    if (this.arena.theme !== this.theme) this.loadArena(this.theme);
    this.ui.showLanding();
    this.auth.showCard(true);
  }

  private onGoal(scorer: Team, blue: number, orange: number): void {
    this.sound.playGoalExplosion();
    this.ui.updateScore(blue, orange);
    this.ui.showGoal(scorer);
    const sign = scorer === 'blue' ? 1 : -1; // blue scores in the orange (+Z) goal
    const p = this.lastBallPos.clone();
    if (Math.abs(p.z) < ARENA_CONFIG.halfLength) p.set(0, 2.5, sign * (ARENA_CONFIG.halfLength + 1));
    this.arena.triggerGoalExplosion(p, scorer);
    this.effects.goalExplosion(p, TEAM_PAINT[scorer].glow, -sign);
    this.cameraManager.shake(0.6, 0.8);
  }

  private handleEvents(events: GameEvent[], snap?: GameSnapshot): void {
    for (const e of events) {
      if (e.type === 'ballHit' && e.speed > 1.5) {
        this.sound.playBallHit(Math.min(1, e.speed / 25));
        const b = snap ? snap.ball.transform : (this.freePlay?.sim ?? this.botMatch?.sim)?.ball.getTransform();
        if (b) this.effects.ballHit(this.v1.set(b.x, b.y, b.z), e.speed);
      } else if (e.type === 'demolition') {
        const victim = this.cars.get(e.victimId);
        this.effects.demolition(this.v1.set(e.pos.x, e.pos.y, e.pos.z), victim ? TEAM_PAINT[victim.team].glow : 0xffffff);
        this.sound.playGoalExplosion();
        this.cameraManager.shake(0.25, 0.4);
      } else if (e.type === 'padPickup' && e.carId === this.localId) {
        this.sound.playPadPickup();
      }
    }
  }

  // -------------------------------------------------------------- frame
  private onResize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.cameraManager.setAspect(w / h);
    this.effects.setViewport(h * this.renderer.getPixelRatio(), this.cameraManager.camera.fov);
  };

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const input = this.input.sampleInput();
    this.cameraManager.keyLook = this.input.sampleLook();
    if (this.state === 'landing' || this.state === 'searching') this.ballIndicator.update(null, null, false, dt);

    if (this.state === 'free_play' && this.freePlay) this.frameFreePlay(input, dt);
    else if (this.state === 'bot_match' && this.botMatch) this.frameBotMatch(input, dt);
    else if (this.state === 'online_match') this.frameOnline(input, dt);
    else this.frameAttract(dt);

    this.arena.update(dt);
    this.effects.update(dt);
    // A zero-size viewport (minimized / hidden) would make the bloom targets incomplete.
    if (window.innerWidth > 0 && window.innerHeight > 0) {
      if (this.renderer.domElement.width <= 1) this.onResize();
      this.composer.render(dt);
    }
  };

  /** Garage showcase: the player's car on a turntable at midfield, rebuilt on every change. */
  private buildShowcase(): void {
    if (this.showcase) {
      this.scene.remove(this.showcase.root);
      this.showcase.destroy();
      this.showcase = undefined;
    }
    if (!this.garageOpen) return;
    this.showcase = createCarMesh('blue', this.customCar, settings.get().car);
    this.scene.add(this.showcase.root);
  }

  private frameGarage(dt: number) {
    const vis = this.showcase!;
    this.showcaseTime += dt;
    const yaw = this.showcaseTime * 0.35;
    const t = identityTransform(0, CAR_CONFIG.restHeight, -14, yaw);
    const boosting = this.showcaseTime % 5 > 3; // preview the boost for 2 s every 5 s
    vis.update({ ...t, vz: 0 }, { boosting, supersonic: false, steer: Math.sin(this.showcaseTime * 0.8) * 0.6, demoed: false }, dt);
    vis.root.updateMatrixWorld();
    if (boosting) {
      vis.nozzleWorld(this.v1);
      this.effects.emitBoost(this.v1, this.v2.set(0, 0, 0), this.v3.set(0, 0, -1).applyQuaternion(vis.root.quaternion), vis.boostColors, dt);
    }
    const cam = this.cameraManager.camera;
    cam.up.set(0, 1, 0);
    cam.fov = 38; // portrait lens for the showcase; restored on close
    cam.updateProjectionMatrix();
    cam.position.set(-2.4, 1.2, -14 + 3.4);
    cam.lookAt(0.45, 0.15, -14);
  }

  private frameAttract(dt: number) {
    if (this.garageOpen && this.showcase) return this.frameGarage(dt);
    this.attractAngle += dt * 0.05;
    const cam = this.cameraManager.camera;
    cam.up.set(0, 1, 0);
    cam.position.set(Math.sin(this.attractAngle) * 34, 9, Math.cos(this.attractAngle) * 44);
    cam.lookAt(0, 1.5, 0);
    this.ball.update(identityTransform(0, BALL_CONFIG.restHeight, 0));
  }

  private frameFreePlay(input: PlayerInput, dt: number) {
    const fp = this.freePlay!;
    const result = fp.step(input, dt);
    this.handleEvents(result.events);
    // Free Play has no goal celebration; FreePlayManager just resets the ball.
    this.renderLocal(fp.sim, fp.playerId, input, dt, fp.unlimitedBoost);
  }

  private async startBotMatch(): Promise<void> {
    this.ui.showLoading(true);
    this.leaveLocalSessions();
    this.loadArena(this.theme);
    this.clearCars();
    this.botMatch = new BotMatchManager();
    await this.botMatch.initialize();
    this.localId = this.botMatch.playerId;
    this.localTeam = 'blue';
    this.lastMode = 'bot';
    this.addCarVisual(this.localId, 'blue');
    this.addCarVisual(this.botMatch.botId, 'orange');
    this.effects.clear();
    this.cameraManager.snap();
    this.state = 'bot_match';
    this.ui.showLoading(false);
    this.ui.showGameHUD(false, 'blue');
    this.auth.showCard(false);
  }

  private leaveLocalSessions(): void {
    this.freePlay?.destroy();
    this.freePlay = undefined;
    this.botMatch?.destroy();
    this.botMatch = undefined;
  }

  private frameBotMatch(input: PlayerInput, dt: number) {
    const bm = this.botMatch!;
    const { result, events } = bm.step(input, dt);
    this.handleEvents(result.events);
    for (const e of events) {
      if (e.type === 'score_update' && e.scorer) this.onGoal(e.scorer, e.blueScore, e.orangeScore);
      else if (e.type === 'phase_change' && (e.phase === 'countdown' || e.phase === 'overtimeCountdown')) {
        this.cameraManager.snap();
        this.effects.clear();
        this.sound.playCountdown(false);
      } else if (e.type === 'phase_change' && (e.phase === 'active' || e.phase === 'overtime')) {
        this.sound.playCountdown(true);
        this.ui.showCountdown(0);
        window.setTimeout(() => this.ui.hideCountdown(), 700);
      } else if (e.type === 'match_end' && e.winner) {
        this.ui.showResult(e.winner, e.blueScore, e.orangeScore);
        const won = e.winner === 'blue' || e.winner === 'forfeit_orange';
        void this.account.reportBotResult(won, e.blueScore, e.orangeScore).then(() => this.auth.renderCard()).catch(() => undefined);
      }
    }
    const sm = bm.sm;
    this.ui.updateScore(sm.blueScore, sm.orangeScore);
    this.ui.updateTimer(sm.timerRemaining, sm.phase === 'overtime' || sm.phase === 'overtimeCountdown');
    if (sm.phase === 'countdown' || sm.phase === 'overtimeCountdown') this.ui.showCountdown(Math.max(1, Math.ceil(sm.countdownTimer)));
    this.renderLocal(bm.sim, bm.playerId, input, dt, false);
  }

  /** Render a locally simulated session (Free Play or vs Bot) with tick interpolation. */
  private renderLocal(sim: GameSimulation, playerId: string, input: PlayerInput, dt: number, unlimited: boolean) {
    const alpha = sim.interpolationAlpha;
    const lerpCar = (id: string) => {
      const c = sim.cars.get(id)!;
      const prev = sim.previousTransforms.get(id);
      return prev ? lerpTransform(prev, c.getTransform(), alpha) : c.getTransform();
    };
    for (const [id, other] of sim.cars) {
      if (id === playerId) continue;
      this.renderCar(id, {
        transform: lerpCar(id), boosting: other.isBoosting(), supersonic: other.isSupersonic(), grounded: other.isGrounded(),
        demoed: other.isDemoed, dodging: other.isDodging(), boost: other.boostUnits,
      }, 0, dt, other.wheels.map((w) => w.suspensionLength));
    }
    const car = sim.cars.get(playerId)!;
    const prevCar = sim.previousTransforms.get(playerId);
    const carT = prevCar ? lerpTransform(prevCar, car.getTransform(), alpha) : car.getTransform();
    const prevBall = sim.previousTransforms.get(BALL_KEY);
    const ballT = prevBall ? lerpTransform(prevBall, sim.ball.getTransform(), alpha) : sim.ball.getTransform();

    this.renderCar(this.localId, {
      transform: carT,
      boosting: car.isBoosting(),
      supersonic: car.isSupersonic(),
      grounded: car.isGrounded(),
      demoed: car.isDemoed,
      dodging: car.isDodging(),
      boost: car.boostUnits,
    }, input.steer, dt, car.wheels.map((w) => w.suspensionLength));
    this.ball.update(ballT);
    this.lastBallPos.set(ballT.x, ballT.y, ballT.z);
    this.arena.updatePads(sim.pads.getSnapshots(), dt);
    this.ui.updateBoost(unlimited ? 100 : car.boostUnits, Math.hypot(carT.vx, carT.vy, carT.vz), car.isSupersonic());
    this.localFeedback(input, car.isGrounded(), car.isDodging(), car.isBoosting(), carT);
    this.cameraManager.update({ car: carT, ball: ballT, grounded: car.isGrounded(), dodging: car.isDodging() }, dt);
    this.ballIndicator.update(carT, ballT, this.cameraManager.mode === 'car_cam' && !car.isDemoed, dt);
  }

  private frameOnline(input: PlayerInput, dt: number) {
    this.net.sendInput(input);
    const sample = this.net.snapshots.sample();
    if (!sample) return;
    const snap = sample.base;
    let local: CarRenderState | null = null;
    for (const [id, p] of Object.entries(sample.players)) {
      if (!this.cars.has(id)) this.addCarVisual(id, p.team);
      if (p.team === this.localTeam) this.localId = id;
      const rs: CarRenderState = {
        transform: p.transform,
        boosting: p.isBoosting,
        supersonic: p.isSupersonic,
        grounded: p.isGrounded,
        demoed: p.isDemoed,
        dodging: p.isDodging,
        boost: p.boost,
      };
      this.renderCar(id, rs, p.team === this.localTeam ? input.steer : 0, dt);
      if (p.team === this.localTeam) local = rs;
    }
    this.ball.update(sample.ball);
    this.lastBallPos.set(sample.ball.x, sample.ball.y, sample.ball.z);
    this.arena.updatePads(snap.pads, dt);
    const latest = this.net.snapshots.latest ?? snap;
    this.ui.updateScore(latest.blueScore, latest.orangeScore);
    this.ui.updateTimer(latest.timerRemaining, latest.phase === 'overtime' || latest.phase === 'overtimeCountdown');
    if (latest.phase === 'countdown' || latest.phase === 'overtimeCountdown') {
      this.ui.showCountdown(latest.countdown);
    } else if (latest.phase !== this.lastPhase && (latest.phase === 'active' || latest.phase === 'overtime')) {
      this.ui.showCountdown(0); // "GO!"
      window.setTimeout(() => this.ui.hideCountdown(), 700);
    }
    this.lastPhase = latest.phase;
    if (local) {
      const t = local.transform;
      this.ui.updateBoost(local.boost, Math.hypot(t.vx, t.vy, t.vz), local.supersonic);
      this.localFeedback(input, local.grounded, local.dodging, local.boosting, local.transform);
      this.cameraManager.update({ car: local.transform, ball: sample.ball, grounded: local.grounded, dodging: local.dodging }, dt);
      this.ballIndicator.update(local.transform, sample.ball, this.cameraManager.mode === 'car_cam' && !local.demoed, dt);
    }
  }

  private renderCar(id: string, s: CarRenderState, steer: number, dt: number, wheelLengths?: number[]) {
    const vis = this.cars.get(id);
    if (!vis) return;
    vis.update(s.transform, { boosting: s.boosting, supersonic: s.supersonic, steer, demoed: s.demoed, wheelLengths }, dt);
    if (s.demoed) return;
    vis.root.updateMatrixWorld();
    const vel = this.v2.set(s.transform.vx, s.transform.vy, s.transform.vz);
    if (s.boosting) {
      vis.nozzleWorld(this.v1);
      const back = this.v3.set(0, 0, -1).applyQuaternion(vis.root.quaternion);
      this.effects.emitBoost(this.v1, vel, back, vis.boostColors, dt);
    }
    if (s.supersonic && s.grounded) {
      const l = new THREE.Vector3();
      const r = new THREE.Vector3();
      vis.rearWheelsWorld(l, r);
      this.effects.emitStreak(l, vel, dt);
      this.effects.emitStreak(r, vel, dt);
    }
  }

  /** Local-only audio feedback derived from car state transitions. */
  private localFeedback(input: PlayerInput, grounded: boolean, dodging: boolean, boosting: boolean, t: TransformSnapshot) {
    if (dodging && !this.prevDodging) this.sound.playDodge();
    if (!grounded && this.prevGrounded && input.jumpHeld) this.sound.playJump();
    this.prevDodging = dodging;
    this.prevGrounded = grounded;
    this.sound.setBoosting(boosting);
    this.sound.updateEngineSpeed(Math.hypot(t.vx, t.vy, t.vz) / CAR_CONFIG.maxSpeed);
  }
}

/**
 * Where the match server lives:
 *  - VITE_SERVER_URL (build-time env) wins, e.g. wss://arena.example.com
 *  - Vite dev server (port 3000): the dev match server on :3001 of the same host
 *  - otherwise (deployed single service): the same origin that served the page
 */
function resolveServerUrl(proto: string): string {
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  if (window.location.port === '3000') return `${proto}//${window.location.hostname}:3001`;
  return `${proto}//${window.location.host}`;
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new GameApp();
  // Invite links: ?room=CODE opens Private Match with the code filled in.
  const invite = new URLSearchParams(window.location.search).get('room');
  if (invite) (app as unknown as { ui: { showPrivate(code: string): void } }).ui.showPrivate(invite.toUpperCase().slice(0, 5));
  // Dev-only handle for debugging / automated checks; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { __app: GameApp }).__app = app;
  if (import.meta.env.DEV) {
    (window as unknown as { __cameraBench: () => Promise<unknown> }).__cameraBench = async () =>
      (await import('./debug/cameraBench.js')).runCameraBench(app);
  }
});
