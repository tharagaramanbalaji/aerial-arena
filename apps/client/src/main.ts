import * as THREE from 'three';
import { ArenaTheme, GameSnapshot, MATCH_CONFIG, Team, TransformSnapshot } from '@aerial-arena/shared';
import { createArenaMesh, ArenaVisual } from './renderer/arenaMesh.js';
import { createCarMesh, CarVisual } from './renderer/carMesh.js';
import { createBallMesh, BallVisual } from './renderer/ballMesh.js';
import { CameraManager } from './camera/cameraManager.js';
import { SoundSystem } from './audio/soundSystem.js';
import { InputManager } from './input/inputManager.js';
import { NetworkClient } from './net/networkClient.js';
import { FreePlayManager } from './freeplay/freePlayManager.js';
import { UIOverlay } from './ui/uiOverlay.js';

type AppState = 'landing' | 'searching' | 'online_match' | 'free_play';

class GameApp {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private cameraManager!: CameraManager;
  private soundSystem!: SoundSystem;
  private inputManager!: InputManager;
  private networkClient!: NetworkClient;
  private uiOverlay!: UIOverlay;

  private state: AppState = 'landing';
  private currentTheme: ArenaTheme = 'foundry';
  private arenaVisual!: ArenaVisual;
  private ballVisual!: BallVisual;
  private localCarVisual!: CarVisual;
  private remoteCarVisual?: CarVisual;

  private freePlayManager?: FreePlayManager;
  private localTeam: Team = 'blue';

  private lastTime = performance.now();
  private isDestroyed = false;

  constructor() {
    this.initThree();
    this.initSystems();
    this.initUI();
    this.loadArena('foundry');

    window.addEventListener('resize', this.onResize);
    requestAnimationFrame(this.gameLoop);
  }

  private initThree(): void {
    const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c14);
    this.cameraManager = new CameraManager(window.innerWidth / window.innerHeight);
  }

  private initSystems(): void {
    this.soundSystem = new SoundSystem();
    this.inputManager = new InputManager();

    // Determine WebSocket server URL
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const serverUrl = `${wsProtocol}//${window.location.hostname}:3001`;
    this.networkClient = new NetworkClient(serverUrl);

    // Setup network callbacks
    this.networkClient.onQueueWaiting = () => {
      this.state = 'searching';
      this.uiOverlay.showSearching();
    };

    this.networkClient.onQueueMatched = (info) => {
      this.startOnlineMatch(info.team, info.theme);
    };

    this.networkClient.onQueueCancelled = () => {
      this.state = 'landing';
      this.uiOverlay.showLanding();
    };

    this.networkClient.onPhaseChange = (phase, countdown) => {
      if (phase === 'countdown' || phase === 'overtimeCountdown') {
        this.soundSystem.playCountdown(false);
        this.uiOverlay.showCountdown(countdown || 3);
      } else if (phase === 'active' || phase === 'overtime') {
        this.soundSystem.playCountdown(true);
        this.uiOverlay.showCountdown(0);
        setTimeout(() => this.uiOverlay.hideCountdown(), 800);
      }
    };

    this.networkClient.onGoal = (scorer, blue, orange) => {
      this.soundSystem.playGoalExplosion();
      this.uiOverlay.updateScore(blue, orange);
      this.uiOverlay.showGoal(scorer);
      const sign = scorer === 'blue' ? 1 : -1;
      this.arenaVisual.triggerGoalExplosion({ x: 0, y: 3, z: sign * 50 }, scorer);
    };

    this.networkClient.onResult = (winner, blue, orange, reason) => {
      this.uiOverlay.showResult(winner, blue, orange, reason);
    };

    this.networkClient.onOpponentDisconnected = (grace) => {
      this.uiOverlay.showDisconnectBanner(grace);
    };

    this.networkClient.onOpponentReconnected = () => {
      this.uiOverlay.hideDisconnectBanner();
    };

    // Camera toggle shortcut
    this.inputManager.onToggleCamera = () => {
      const mode = this.cameraManager.toggleMode();
      this.uiOverlay.setCameraMode(mode);
    };

    this.inputManager.onTogglePause = () => {
      if (this.state === 'online_match' || this.state === 'free_play') {
        this.uiOverlay.togglePauseMenu();
      }
    };
  }

  private initUI(): void {
    const uiRoot = document.getElementById('ui-root')!;
    this.uiOverlay = new UIOverlay(uiRoot, {
      onPlayQuickMatch: async () => {
        this.soundSystem.enableAudio();
        const ok = await this.networkClient.connect();
        if (ok) {
          this.networkClient.joinQueue('Pilot');
        } else {
          alert('Could not connect to Aerial Arena server. Ensure server is running on port 3001.');
        }
      },
      onPlayFreePlay: async () => {
        this.soundSystem.enableAudio();
        await this.startFreePlay();
      },
      onCancelQueue: () => {
        this.networkClient.cancelQueue();
      },
      onLeaveMatch: () => {
        this.leaveCurrentMode();
      },
      onPlayAgain: () => {
        this.leaveCurrentMode();
        this.networkClient.joinQueue('Pilot');
      },
      onReturnToMenu: () => {
        this.leaveCurrentMode();
      },
      onToggleMute: () => {
        this.soundSystem.toggleMute();
      },
      onVolumeChange: (vol) => {
        this.soundSystem.setVolume(vol);
      },
    });

    // Free Play bindings
    this.inputManager.onResetBall = () => {
      if (this.state === 'free_play') {
        this.freePlayManager?.resetBall();
      }
    };

    this.inputManager.onResetCar = () => {
      if (this.state === 'free_play') {
        this.freePlayManager?.resetCar();
      }
    };

    this.inputManager.onToggleUnlimitedBoost = () => {
      if (this.state === 'free_play') {
        this.freePlayManager?.toggleUnlimitedBoost();
      }
    };

    this.inputManager.onLaunchBall = () => {
      if (this.state === 'free_play') {
        this.freePlayManager?.launchBallUpward();
      }
    };

    this.inputManager.onPracticeShot = () => {
      if (this.state === 'free_play') {
        this.freePlayManager?.practiceShotTowardGoal();
      }
    };
  }

  private loadArena(theme: ArenaTheme): void {
    if (this.arenaVisual) {
      this.scene.remove(this.arenaVisual.root);
      this.arenaVisual.destroy();
    }
    this.currentTheme = theme;
    this.arenaVisual = createArenaMesh(theme);
    this.scene.add(this.arenaVisual.root);

    // Ball visual
    if (!this.ballVisual) {
      this.ballVisual = createBallMesh();
      this.scene.add(this.ballVisual.root);
    }
  }

  private async startFreePlay(): Promise<void> {
    this.state = 'free_play';
    this.localTeam = 'blue';
    this.loadArena('foundry');

    // Create local car
    if (this.localCarVisual) {
      this.scene.remove(this.localCarVisual.root);
      this.localCarVisual.destroy();
    }
    this.localCarVisual = createCarMesh('blue');
    this.scene.add(this.localCarVisual.root);

    if (this.remoteCarVisual) {
      this.scene.remove(this.remoteCarVisual.root);
      this.remoteCarVisual.destroy();
      this.remoteCarVisual = undefined;
    }

    // Initialize local simulation
    this.freePlayManager = new FreePlayManager();
    await this.freePlayManager.initialize();

    this.uiOverlay.showGameHUD(true, 'blue');
  }

  private startOnlineMatch(team: Team, theme: ArenaTheme): void {
    this.state = 'online_match';
    this.localTeam = team;
    this.loadArena(theme);

    // Local car
    if (this.localCarVisual) {
      this.scene.remove(this.localCarVisual.root);
      this.localCarVisual.destroy();
    }
    this.localCarVisual = createCarMesh(team);
    this.scene.add(this.localCarVisual.root);

    // Remote car (opposite team)
    const remoteTeam: Team = team === 'blue' ? 'orange' : 'blue';
    if (this.remoteCarVisual) {
      this.scene.remove(this.remoteCarVisual.root);
      this.remoteCarVisual.destroy();
    }
    this.remoteCarVisual = createCarMesh(remoteTeam);
    this.scene.add(this.remoteCarVisual.root);

    this.uiOverlay.showGameHUD(false, team);
  }

  private leaveCurrentMode(): void {
    if (this.state === 'online_match') {
      this.networkClient.leaveMatch();
      this.networkClient.disconnect();
    } else if (this.state === 'free_play') {
      this.freePlayManager?.destroy();
      this.freePlayManager = undefined;
    }

    if (this.remoteCarVisual) {
      this.scene.remove(this.remoteCarVisual.root);
      this.remoteCarVisual.destroy();
      this.remoteCarVisual = undefined;
    }

    this.state = 'landing';
    this.uiOverlay.showLanding();
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.cameraManager.setAspect(w / h);
  };

  private gameLoop = () => {
    if (this.isDestroyed) return;
    requestAnimationFrame(this.gameLoop);

    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Sample input
    const input = this.inputManager.sampleInput();

    let localCarTransform: TransformSnapshot = {
      x: 0, y: 0.6, z: this.localTeam === 'blue' ? -38 : 38,
      qx: 0, qy: this.localTeam === 'blue' ? 0 : 1, qz: 0, qw: this.localTeam === 'blue' ? 1 : 0,
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
    };

    let ballTransform: TransformSnapshot = {
      x: 0, y: 1.8, z: 0,
      qx: 0, qy: 0, qz: 0, qw: 1,
      vx: 0, vy: 0, vz: 0,
      wx: 0, wy: 0, wz: 0,
    };

    if (this.state === 'free_play' && this.freePlayManager) {
      // Step local Free Play physics
      this.freePlayManager.step(input, dt);

      const localCar = this.freePlayManager.sim.cars.get(this.freePlayManager.playerId);
      if (localCar) {
        localCarTransform = localCar.getTransform();
        this.localCarVisual.update(localCarTransform, localCar.isBoosting(), input.steer);
        this.uiOverlay.updateBoost(localCar.boostUnits);
        this.soundSystem.setBoosting(localCar.isBoosting());

        const speed = Math.hypot(localCarTransform.vx, localCarTransform.vz);
        this.soundSystem.updateEngineSpeed(speed / 30);
      }

      ballTransform = this.freePlayManager.sim.ball.getTransform();
      this.ballVisual.update(ballTransform);
      this.arenaVisual.updatePads(this.freePlayManager.sim.pads.getSnapshots(), dt);
    } else if (this.state === 'online_match') {
      // Online authoritative replication
      this.networkClient.sendInput(input);

      const snap = this.networkClient.lastSnapshot;
      if (snap) {
        // Find our car and opponent car
        for (const [id, player] of Object.entries(snap.players)) {
          if (player.team === this.localTeam) {
            localCarTransform = player.transform;
            this.localCarVisual.update(player.transform, player.isBoosting, input.steer);
            this.uiOverlay.updateBoost(player.boost);
            this.soundSystem.setBoosting(player.isBoosting);

            const speed = Math.hypot(player.transform.vx, player.transform.vz);
            this.soundSystem.updateEngineSpeed(speed / 30);
          } else if (this.remoteCarVisual) {
            this.remoteCarVisual.update(player.transform, player.isBoosting, 0);
          }
        }

        ballTransform = snap.ball.transform;
        this.ballVisual.update(ballTransform);

        this.arenaVisual.updatePads(snap.pads, dt);
        this.uiOverlay.updateScore(snap.blueScore, snap.orangeScore);
        this.uiOverlay.updateTimer(snap.timerRemaining, snap.phase === 'overtime');

        if (snap.phase === 'countdown' || snap.phase === 'overtimeCountdown') {
          this.uiOverlay.showCountdown(snap.countdown);
        } else {
          this.uiOverlay.hideCountdown();
        }
      }
    }

    // Update dual camera rig
    this.cameraManager.update(localCarTransform, ballTransform, dt);

    // Update arena particle systems and rotating pads
    this.arenaVisual.update(dt);

    // Render scene
    this.renderer.render(this.scene, this.cameraManager.camera);
  };
}

// Bootstrap application on window load
window.addEventListener('DOMContentLoaded', () => {
  new GameApp();
});
