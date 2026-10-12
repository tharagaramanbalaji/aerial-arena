import { CameraMode } from '../camera/cameraManager.js';
import { MatchPhase, Team } from '@aerial-arena/shared';

export interface UIEventHandlers {
  onPlayQuickMatch: () => void;
  onPlayFreePlay: () => void;
  onCancelQueue: () => void;
  onLeaveMatch: () => void;
  onPlayAgain: () => void;
  onReturnToMenu: () => void;
  onToggleMute: () => void;
  onVolumeChange: (vol: number) => void;
  onResetBallFreePlay?: () => void;
  onResetCarFreePlay?: () => void;
  onToggleUnlimitedBoostFreePlay?: () => void;
}

export class UIOverlay {
  private container: HTMLElement;
  private handlers: UIEventHandlers;

  // DOM Elements
  private landingScreen!: HTMLElement;
  private searchingScreen!: HTMLElement;
  private hudScreen!: HTMLElement;
  private countdownBanner!: HTMLElement;
  private goalBanner!: HTMLElement;
  private overtimeBanner!: HTMLElement;
  private resultModal!: HTMLElement;
  private pauseModal!: HTMLElement;
  private settingsModal!: HTMLElement;
  private disconnectBanner!: HTMLElement;

  // HUD Dynamic elements
  private blueScoreEl!: HTMLElement;
  private orangeScoreEl!: HTMLElement;
  private timerEl!: HTMLElement;
  private teamBadgeEl!: HTMLElement;
  private cameraBadgeEl!: HTMLElement;
  private boostValEl!: HTMLElement;
  private boostFillEl!: HTMLElement;
  private freePlayHelpEl!: HTMLElement;
  private searchTimerEl!: HTMLElement;
  private searchStartTime = 0;
  private searchInterval?: NodeJS.Timeout;

  constructor(container: HTMLElement, handlers: UIEventHandlers) {
    this.container = container;
    this.handlers = handlers;
    this.render();
  }

  private render(): void {
    this.container.innerHTML = `
      <!-- 1. LANDING SCREEN -->
      <div id="landing-screen" class="pointer-interactive" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: radial-gradient(circle at center, rgba(15, 23, 42, 0.75) 0%, rgba(8, 12, 20, 0.95) 100%);">
        <div style="text-align: center; margin-bottom: 40px;">
          <h1 style="font-size: 64px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase; background: linear-gradient(135deg, #38bdf8, #fb923c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; text-shadow: 0 4px 30px rgba(56, 189, 248, 0.3);">
            AERIAL ARENA
          </h1>
          <p style="font-size: 18px; color: #94a3b8; letter-spacing: 2px; text-transform: uppercase; margin-top: 8px;">
            Physics-Driven 3D Browser Car-Soccer
          </p>
        </div>

        <div class="glass-panel" style="padding: 36px 44px; display: flex; flex-direction: column; gap: 18px; width: 380px;">
          <button id="btn-quick-match" class="btn" style="width: 100%; font-size: 18px; padding: 15px;">
            Play Quick Match (1v1)
          </button>
          <button id="btn-free-play" class="btn btn-orange" style="width: 100%; font-size: 18px; padding: 15px;">
            Solo Free Play
          </button>
          <button id="btn-settings" class="btn btn-secondary" style="width: 100%;">
            Controls & Settings
          </button>
        </div>

        <div style="margin-top: 36px; display: flex; align-items: center; gap: 10px;">
          <div id="server-status-dot" style="width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e;"></div>
          <span id="server-status-text" style="font-size: 14px; color: #cbd5e1; letter-spacing: 1px;">Server Ready</span>
        </div>
      </div>

      <!-- 2. QUEUE SEARCHING OVERLAY -->
      <div id="searching-screen" class="pointer-interactive hidden" style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(8, 12, 20, 0.85); backdrop-filter: blur(10px);">
        <div class="glass-panel" style="padding: 40px; text-align: center; width: 420px; display: flex; flex-direction: column; align-items: center; gap: 20px;">
          <div style="width: 50px; height: 50px; border: 4px solid rgba(56, 189, 248, 0.2); border-top-color: #38bdf8; border-radius: 50%; animation: spin 1s linear infinite;"></div>
          <h2 style="font-size: 24px; font-weight: 800; letter-spacing: 2px;">Searching for Opponent...</h2>
          <p id="search-timer" style="font-size: 16px; color: #94a3b8; font-variant-numeric: tabular-nums;">Elapsed: 0:00</p>
          <p style="font-size: 13px; color: #64748b;">1v1 Real Human Matchmaking (Zero Bots)</p>
          <button id="btn-cancel-queue" class="btn btn-secondary" style="margin-top: 10px; width: 100%;">
            Cancel Search
          </button>
        </div>
      </div>

      <!-- 3. IN-GAME HUD -->
      <div id="hud-screen" class="hidden" style="position: absolute; inset: 0; pointer-events: none;">
        <!-- Top Scoreboard Bar -->
        <div style="position: absolute; top: 16px; left: 50%; transform: translateX(-50%); display: flex; align-items: center; gap: 4px; pointer-events: auto;">
          <!-- Blue Score -->
          <div style="background: rgba(30, 58, 138, 0.85); border: 2px solid #3b82f6; border-radius: 8px 0 0 8px; padding: 8px 24px; display: flex; align-items: center; gap: 12px; min-width: 110px; justify-content: center;">
            <span style="font-size: 14px; font-weight: 800; color: #93c5fd; letter-spacing: 1px;">BLUE</span>
            <span id="blue-score" style="font-size: 32px; font-weight: 900; color: #fff;">0</span>
          </div>

          <!-- Timer -->
          <div style="background: rgba(15, 23, 42, 0.95); border-top: 2px solid rgba(255,255,255,0.2); border-bottom: 2px solid rgba(255,255,255,0.2); padding: 8px 28px; min-width: 110px; text-align: center;">
            <span id="match-timer" style="font-size: 30px; font-weight: 900; font-variant-numeric: tabular-nums; color: #f8fafc; letter-spacing: 1px;">5:00</span>
          </div>

          <!-- Orange Score -->
          <div style="background: rgba(194, 65, 12, 0.85); border: 2px solid #ea580c; border-radius: 0 8px 8px 0; padding: 8px 24px; display: flex; align-items: center; gap: 12px; min-width: 110px; justify-content: center;">
            <span id="orange-score" style="font-size: 32px; font-weight: 900; color: #fff;">0</span>
            <span style="font-size: 14px; font-weight: 800; color: #fed7aa; letter-spacing: 1px;">ORANGE</span>
          </div>
        </div>

        <!-- Team Badge (Top Left) -->
        <div id="team-badge" style="position: absolute; top: 20px; left: 24px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; padding: 6px 14px; font-size: 13px; font-weight: 800; letter-spacing: 1px;">
          YOU: BLUE
        </div>

        <!-- Camera Badge (Bottom Left) -->
        <div id="camera-badge" style="position: absolute; bottom: 24px; left: 24px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 8px; padding: 10px 18px; font-size: 14px; font-weight: 800; color: #38bdf8; letter-spacing: 1px;">
          BALL CAM [C]
        </div>

        <!-- Free Play Shortcuts (Bottom Left above camera) -->
        <div id="freeplay-help" class="hidden" style="position: absolute; bottom: 70px; left: 24px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 12px 16px; font-size: 12px; color: #cbd5e1; display: flex; flex-direction: column; gap: 4px;">
          <div><b style="color: #f97316;">[R]</b> Reset Ball &nbsp;|&nbsp; <b style="color: #f97316;">[Backspace]</b> Reset Car</div>
          <div><b style="color: #f97316;">[U]</b> Unlimited Boost &nbsp;|&nbsp; <b style="color: #f97316;">[1]</b> Launch &nbsp;|&nbsp; <b style="color: #f97316;">[2]</b> Practice Shot</div>
        </div>

        <!-- Boost Gauge (Bottom Right) -->
        <div style="position: absolute; bottom: 24px; right: 28px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
          <div style="position: relative; width: 110px; height: 110px;">
            <svg viewBox="0 0 100 100" style="width: 100%; height: 100%; transform: rotate(-90deg);">
              <circle cx="50" cy="50" r="42" stroke="rgba(255,255,255,0.15)" stroke-width="8" fill="none" />
              <circle id="boost-fill-circle" cx="50" cy="50" r="42" stroke="#ea580c" stroke-width="8" fill="none" stroke-dasharray="264" stroke-dashoffset="0" stroke-linecap="round" style="transition: stroke-dashoffset 0.05s ease;" />
            </svg>
            <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;">
              <span id="boost-val" style="font-size: 32px; font-weight: 900; color: #fff; line-height: 1;">100</span>
              <span style="font-size: 10px; font-weight: 700; color: #fb923c; letter-spacing: 1px;">BOOST</span>
            </div>
          </div>
        </div>

        <!-- Center Countdown Banner (3, 2, 1, GO!) -->
        <div id="countdown-banner" class="hidden" style="position: absolute; top: 38%; left: 50%; transform: translate(-50%, -50%); font-size: 84px; font-weight: 900; color: #facc15; text-shadow: 0 0 40px rgba(250, 204, 21, 0.6); letter-spacing: 2px;">
          3
        </div>

        <!-- Goal Notification Banner -->
        <div id="goal-banner" class="hidden" style="position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%); background: linear-gradient(135deg, rgba(234, 88, 12, 0.95), rgba(220, 38, 38, 0.95)); border: 3px solid #fff; border-radius: 16px; padding: 24px 64px; text-align: center; box-shadow: 0 0 60px rgba(234, 88, 12, 0.8);">
          <h2 style="font-size: 56px; font-weight: 900; letter-spacing: 4px; text-transform: uppercase;">GOAL!</h2>
          <p id="goal-subtext" style="font-size: 20px; font-weight: 700; margin-top: 4px; letter-spacing: 2px;">ORANGE SCORED</p>
        </div>

        <!-- Overtime Banner -->
        <div id="overtime-banner" class="hidden" style="position: absolute; top: 22%; left: 50%; transform: translateX(-50%); background: rgba(220, 38, 38, 0.9); border: 2px solid #fecaca; border-radius: 8px; padding: 8px 28px; font-size: 18px; font-weight: 900; letter-spacing: 2px;">
          SUDDEN DEATH OVERTIME
        </div>

        <!-- Opponent Disconnected Banner -->
        <div id="disconnect-banner" class="hidden" style="position: absolute; top: 80px; left: 50%; transform: translateX(-50%); background: rgba(185, 28, 28, 0.9); border: 2px solid #ef4444; border-radius: 8px; padding: 10px 24px; font-size: 14px; font-weight: 700;">
          Opponent Disconnected &mdash; Forfeit in <span id="disconnect-countdown">10</span>s
        </div>
      </div>

      <!-- 4. MATCH RESULT MODAL -->
      <div id="result-modal" class="pointer-interactive hidden" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(8, 12, 20, 0.88); backdrop-filter: blur(12px);">
        <div class="glass-panel" style="padding: 44px; text-align: center; width: 440px; display: flex; flex-direction: column; align-items: center; gap: 20px;">
          <h2 id="result-title" style="font-size: 52px; font-weight: 900; letter-spacing: 4px;">VICTORY</h2>
          <p id="result-score-summary" style="font-size: 30px; font-weight: 800; color: #cbd5e1;">3 - 1</p>
          <p id="result-reason" style="font-size: 14px; color: #94a3b8;"></p>
          <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; margin-top: 10px;">
            <button id="btn-play-again" class="btn" style="width: 100%;">Play Again</button>
            <button id="btn-return-menu" class="btn btn-secondary" style="width: 100%;">Return to Menu</button>
          </div>
        </div>
      </div>

      <!-- 5. PAUSE / LEAVE MODAL -->
      <div id="pause-modal" class="pointer-interactive hidden" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(8, 12, 20, 0.85); backdrop-filter: blur(8px);">
        <div class="glass-panel" style="padding: 36px; width: 360px; display: flex; flex-direction: column; gap: 16px;">
          <h3 style="font-size: 24px; font-weight: 800; text-align: center; margin-bottom: 8px;">MATCH MENU</h3>
          <button id="btn-resume" class="btn" style="width: 100%;">Resume</button>
          <button id="btn-pause-mute" class="btn btn-secondary" style="width: 100%;">Mute Audio</button>
          <button id="btn-leave-match" class="btn btn-danger" style="width: 100%;">Leave Match</button>
        </div>
      </div>

      <!-- 6. CONTROLS & SETTINGS MODAL -->
      <div id="settings-modal" class="pointer-interactive hidden" style="position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(8, 12, 20, 0.9); backdrop-filter: blur(10px);">
        <div class="glass-panel" style="padding: 36px; width: 480px; max-height: 90vh; overflow-y: auto;">
          <h3 style="font-size: 26px; font-weight: 800; margin-bottom: 20px; text-align: center;">Controls & Settings</h3>

          <div style="margin-bottom: 24px;">
            <h4 style="font-size: 15px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; text-transform: uppercase;">Keyboard Controls</h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px; color: #cbd5e1;">
              <div><b>W / Up Arrow</b></div><div>Accelerate</div>
              <div><b>S / Down Arrow</b></div><div>Brake / Reverse</div>
              <div><b>A / D or Arrows</b></div><div>Steer / Air Yaw</div>
              <div><b>Space</b></div><div>Jump / Dodge</div>
              <div><b>Left Shift</b></div><div>Boost</div>
              <div><b>Left Ctrl</b></div><div>Powerslide</div>
              <div><b>Q / E</b></div><div>Air Roll Left / Right</div>
              <div><b>C</b></div><div>Toggle Camera</div>
              <div><b>R</b></div><div>Reset Ball (Free Play)</div>
              <div><b>Esc</b></div><div>Pause Menu</div>
            </div>
          </div>

          <div style="margin-bottom: 24px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px;">
            <h4 style="font-size: 15px; font-weight: 700; color: #38bdf8; margin-bottom: 12px; text-transform: uppercase;">Audio Settings</h4>
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
              <span>Volume</span>
              <input id="slider-volume" type="range" min="0" max="1" step="0.05" value="0.5" style="width: 160px; cursor: pointer;" />
            </div>
          </div>

          <button id="btn-close-settings" class="btn btn-secondary" style="width: 100%;">Close</button>
        </div>
      </div>
    `;

    // Query elements
    this.landingScreen = document.getElementById('landing-screen')!;
    this.searchingScreen = document.getElementById('searching-screen')!;
    this.hudScreen = document.getElementById('hud-screen')!;
    this.countdownBanner = document.getElementById('countdown-banner')!;
    this.goalBanner = document.getElementById('goal-banner')!;
    this.overtimeBanner = document.getElementById('overtime-banner')!;
    this.resultModal = document.getElementById('result-modal')!;
    this.pauseModal = document.getElementById('pause-modal')!;
    this.settingsModal = document.getElementById('settings-modal')!;
    this.disconnectBanner = document.getElementById('disconnect-banner')!;

    this.blueScoreEl = document.getElementById('blue-score')!;
    this.orangeScoreEl = document.getElementById('orange-score')!;
    this.timerEl = document.getElementById('match-timer')!;
    this.teamBadgeEl = document.getElementById('team-badge')!;
    this.cameraBadgeEl = document.getElementById('camera-badge')!;
    this.boostValEl = document.getElementById('boost-val')!;
    this.boostFillEl = document.getElementById('boost-fill-circle')!;
    this.freePlayHelpEl = document.getElementById('freeplay-help')!;
    this.searchTimerEl = document.getElementById('search-timer')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    document.getElementById('btn-quick-match')?.addEventListener('click', () => {
      this.handlers.onPlayQuickMatch();
    });

    document.getElementById('btn-free-play')?.addEventListener('click', () => {
      this.handlers.onPlayFreePlay();
    });

    document.getElementById('btn-settings')?.addEventListener('click', () => {
      this.settingsModal.classList.remove('hidden');
    });

    document.getElementById('btn-close-settings')?.addEventListener('click', () => {
      this.settingsModal.classList.add('hidden');
    });

    document.getElementById('btn-cancel-queue')?.addEventListener('click', () => {
      this.handlers.onCancelQueue();
    });

    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.pauseModal.classList.add('hidden');
    });

    document.getElementById('btn-pause-mute')?.addEventListener('click', () => {
      this.handlers.onToggleMute();
    });

    document.getElementById('btn-leave-match')?.addEventListener('click', () => {
      this.pauseModal.classList.add('hidden');
      this.handlers.onLeaveMatch();
    });

    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.resultModal.classList.add('hidden');
      this.handlers.onPlayAgain();
    });

    document.getElementById('btn-return-menu')?.addEventListener('click', () => {
      this.resultModal.classList.add('hidden');
      this.handlers.onReturnToMenu();
    });

    const volSlider = document.getElementById('slider-volume') as HTMLInputElement;
    volSlider?.addEventListener('input', (e) => {
      const val = parseFloat((e.target as HTMLInputElement).value);
      this.handlers.onVolumeChange(val);
    });
  }

  // State Transition Helpers
  public showLanding(): void {
    this.landingScreen.classList.remove('hidden');
    this.searchingScreen.classList.add('hidden');
    this.hudScreen.classList.add('hidden');
    this.resultModal.classList.add('hidden');
    this.pauseModal.classList.add('hidden');
    this.stopSearchTimer();
  }

  public showSearching(): void {
    this.landingScreen.classList.add('hidden');
    this.searchingScreen.classList.remove('hidden');
    this.startSearchTimer();
  }

  public showGameHUD(isFreePlay = false, team: Team = 'blue'): void {
    this.landingScreen.classList.add('hidden');
    this.searchingScreen.classList.add('hidden');
    this.hudScreen.classList.remove('hidden');
    this.resultModal.classList.add('hidden');
    this.stopSearchTimer();

    if (isFreePlay) {
      this.freePlayHelpEl.classList.remove('hidden');
      this.teamBadgeEl.textContent = 'FREE PLAY';
      this.timerEl.textContent = '∞';
      this.blueScoreEl.parentElement!.style.display = 'none';
      this.orangeScoreEl.parentElement!.style.display = 'none';
    } else {
      this.freePlayHelpEl.classList.add('hidden');
      this.teamBadgeEl.textContent = `YOU: ${team.toUpperCase()}`;
      this.teamBadgeEl.style.color = team === 'blue' ? '#38bdf8' : '#fb923c';
      this.blueScoreEl.parentElement!.style.display = 'flex';
      this.orangeScoreEl.parentElement!.style.display = 'flex';
    }
  }

  public togglePauseMenu(): void {
    this.pauseModal.classList.toggle('hidden');
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraBadgeEl.textContent = mode === 'ball_cam' ? 'BALL CAM [C]' : 'CAR CAM [C]';
    this.cameraBadgeEl.style.color = mode === 'ball_cam' ? '#38bdf8' : '#f8fafc';
  }

  public updateScore(blue: number, orange: number): void {
    this.blueScoreEl.textContent = blue.toString();
    this.orangeScoreEl.textContent = orange.toString();
  }

  public updateTimer(seconds: number, isOvertime = false): void {
    if (isOvertime) {
      this.timerEl.textContent = '+OT';
      this.overtimeBanner.classList.remove('hidden');
      return;
    }
    this.overtimeBanner.classList.add('hidden');
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    this.timerEl.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  public updateBoost(units: number): void {
    const rounded = Math.round(units);
    this.boostValEl.textContent = rounded.toString();

    // 264 is perimeter of circle with r=42
    const totalCircumference = 264;
    const offset = totalCircumference - (totalCircumference * (rounded / 100));
    this.boostFillEl.style.strokeDashoffset = offset.toString();
  }

  public showCountdown(num: number): void {
    this.countdownBanner.classList.remove('hidden');
    this.countdownBanner.textContent = num <= 0 ? 'GO!' : num.toString();
  }

  public hideCountdown(): void {
    this.countdownBanner.classList.add('hidden');
  }

  public showGoal(scorer: Team): void {
    this.goalBanner.classList.remove('hidden');
    const subtext = document.getElementById('goal-subtext')!;
    subtext.textContent = `${scorer.toUpperCase()} SCORED`;
    setTimeout(() => {
      this.goalBanner.classList.add('hidden');
    }, 2800);
  }

  public showResult(winner: Team | 'forfeit_blue' | 'forfeit_orange', blue: number, orange: number, reason?: string): void {
    this.resultModal.classList.remove('hidden');
    const title = document.getElementById('result-title')!;
    const summary = document.getElementById('result-score-summary')!;
    const reasonEl = document.getElementById('result-reason')!;

    summary.textContent = `${blue} - ${orange}`;
    reasonEl.textContent = reason || '';

    if (winner.includes('forfeit')) {
      title.textContent = 'MATCH FORFEIT';
      title.style.color = '#ef4444';
    } else {
      title.textContent = `${winner.toUpperCase()} WINS`;
      title.style.color = winner === 'blue' ? '#38bdf8' : '#ea580c';
    }
  }

  public showDisconnectBanner(countdown: number): void {
    this.disconnectBanner.classList.remove('hidden');
    const el = document.getElementById('disconnect-countdown')!;
    el.textContent = Math.ceil(countdown).toString();
  }

  public hideDisconnectBanner(): void {
    this.disconnectBanner.classList.add('hidden');
  }

  private startSearchTimer(): void {
    this.searchStartTime = Date.now();
    this.searchInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.searchStartTime) / 1000);
      const m = Math.floor(elapsedSec / 60);
      const s = elapsedSec % 60;
      this.searchTimerEl.textContent = `Elapsed: ${m}:${s < 10 ? '0' : ''}${s}`;
    }, 1000);
  }

  private stopSearchTimer(): void {
    if (this.searchInterval) {
      clearInterval(this.searchInterval);
      this.searchInterval = undefined;
    }
  }
}
