import { ArenaTheme, Team } from '@aerial-arena/shared';
import { CameraMode } from '../camera/cameraManager.js';
import { THEMES } from '../renderer/themes.js';
import { ActionId, keyLabel, settings } from '../settings/settingsStore.js';
import { BoostGauge } from './boostGauge.js';
import { SettingsPanel } from './settingsPanel.js';
import { GaragePanel } from './garagePanel.js';

export interface UIEventHandlers {
  onPlayQuickMatch: () => void;
  onPlayFreePlay: () => void;
  onPlayBot: () => void;
  onCreateRoom: () => void;
  onJoinRoom: (code: string) => void;
  onCancelRoom: () => void;
  onGarage: (open: boolean) => void;
  onCancelQueue: () => void;
  onLeaveMatch: () => void;
  onPlayAgain: () => void;
  onReturnToMenu: () => void;
  onToggleMute: () => boolean;
  onVolumeChange: (vol: number) => void;
  onThemeChange: (theme: ArenaTheme) => void;
  onFreePlayUnlimitedBoost: (on: boolean) => void;
  onFreePlayGoalReset: (on: boolean) => void;
  onModalChange: (open: boolean) => void;
  /** Capture the next key/mouse press for rebinding (null = cancelled). */
  captureKey: (cb: (code: string | null) => void) => void;
}

/**
 * All HTML overlays: landing menu, queue, HUD, banners and modals.
 * The canvas stays full-viewport underneath; nothing here touches the simulation.
 */
export class UIOverlay {
  private readonly root: HTMLElement;
  private readonly h: UIEventHandlers;
  private els: Record<string, HTMLElement> = {};
  private searchStart = 0;
  private searchTimer?: number;
  private goalTimer?: number;
  private toastTimer?: number;
  private helpTimer?: number;
  private lastCountdown = -1;
  private theme: ArenaTheme = 'coastal_dome';
  private localTeam: Team = 'blue';
  private inLiveMatch = false;
  private readonly gauge = new BoostGauge();
  private readonly garage = new GaragePanel(() => this.setGarage(false));
  private settingsPanel!: SettingsPanel;

  constructor(root: HTMLElement, handlers: UIEventHandlers) {
    this.root = root;
    this.h = handlers;
    this.render();
  }

  private render(): void {
    const themeButtons = (Object.keys(THEMES) as ArenaTheme[])
      .map((t) => `<button data-theme="${t}" aria-pressed="${t === this.theme}">${THEMES[t].displayName}</button>`)
      .join('');
    this.root.innerHTML = `
      <div id="landing" class="interactive">
        <div class="logo">Aerial<br/>Arena</div>
        <div class="tagline">Rocket-powered car soccer</div>
        <nav class="menu" aria-label="Main menu">
          <button id="btn-quick" class="btn">Quick Match <small>Online 1v1 against a real player</small></button>
          <button id="btn-private" class="btn">Private Match <small>Create a room or join a friend with a code</small></button>
          <button id="btn-bot" class="btn">Vs Bot <small>Full 5:00 match against an AI opponent</small></button>
          <button id="btn-free" class="btn orange">Free Play <small>Practice alone with the ball</small></button>
          <div class="arena-pick" role="group" aria-label="Free Play arena">${themeButtons}</div>
          <button id="btn-garage" class="btn ghost">Garage <small>Customise rims, tires, decals and boost</small></button>
          <button id="btn-settings" class="btn ghost">Controls &amp; Settings</button>
        </nav>
        <div class="status"><span id="status-dot" class="dot"></span><span id="status-text">Server is contacted when you press Quick Match</span></div>
      </div>

      <div id="private" class="modal interactive hidden">
        <div class="panel" role="dialog" aria-label="Private match">
          <div class="title-sm">Private Match</div>
          <div id="pm-choose" style="display:flex;flex-direction:column;gap:12px">
            <button id="btn-create-room" class="btn">Create room <small>Get a code to share with a friend</small></button>
            <label class="hint" for="pm-code">Or join with a code</label>
            <div style="display:flex;gap:8px">
              <input id="pm-code" class="code-input" maxlength="5" autocomplete="off" spellcheck="false" placeholder="ABCDE" aria-label="Room code" />
              <button id="btn-join-room" class="btn" style="width:auto">Join</button>
            </div>
            <div id="pm-error" class="hint" style="color:#fca5a5" role="alert"></div>
          </div>
          <div id="pm-hosting" class="hidden" style="display:flex;flex-direction:column;gap:10px;align-items:center">
            <div class="hint">Share this code (or the link) with your friend:</div>
            <div id="pm-room-code" class="room-code">-----</div>
            <button id="btn-copy-link" class="btn ghost" style="text-align:center">Copy invite link</button>
            <div class="spinner"></div>
            <div class="hint">Waiting for your friend to join… (code expires in 15 min)</div>
          </div>
          <button id="btn-private-close" class="btn ghost">Cancel</button>
        </div>
      </div>

      <div id="searching" class="modal interactive hidden">
        <div class="panel" role="dialog" aria-label="Searching">
          <div class="spinner"></div>
          <div class="title-sm" style="text-align:center">Searching for opponent…</div>
          <div id="search-time" style="text-align:center;color:var(--muted);font-variant-numeric:tabular-nums">0:00</div>
          <button id="btn-cancel" class="btn ghost">Cancel</button>
        </div>
      </div>

      <div id="hud" class="hidden">
        <div id="scoreboard" class="scoreboard">
          <div class="sb-team blue"><span id="score-blue">0</span></div>
          <div id="clock" class="sb-clock"><span id="clock-text">5:00</span></div>
          <div class="sb-team orange"><span id="score-orange">0</span></div>
        </div>
        <div id="freeplay-tag" class="freeplay-tag hidden"><span class="fp-dot"></span>Free Play<em>Training</em></div>
        <div id="team-tag" class="team-tag hidden"></div>
        <div id="ot-banner" class="ot-banner hidden">Overtime</div>
        <div id="dc-banner" class="dc-banner hidden">Opponent disconnected — forfeit in <span id="dc-count">10</span>s</div>
        <div id="toast" class="toast hidden"></div>
        <div id="cam-tag" class="cam-tag"><span class="cam-ico"></span><span id="cam-text">Ball Cam</span></div>
        <div id="gauge-slot"></div>
        <div id="help" class="help hidden"><span id="help-keys"></span><br/><span id="fp-keys"></span></div>
        <div id="countdown" class="countdown hidden">3</div>
        <div id="goal" class="goal-banner hidden"><h2 id="goal-title">GOAL!</h2><p id="goal-sub">Blue scored</p></div>
      </div>

      <div id="result" class="modal interactive hidden">
        <div class="panel" role="dialog" aria-label="Match result">
          <div id="result-title" class="result-title">Victory</div>
          <div id="result-score" class="result-score">0 - 0</div>
          <div id="result-reason" style="text-align:center;color:var(--muted);font-size:13px"></div>
          <button id="btn-again" class="btn">Find another match</button>
          <button id="btn-menu" class="btn ghost">Main menu</button>
        </div>
      </div>

      <div id="pause" class="modal interactive hidden">
        <div class="panel" role="dialog" aria-label="Menu">
          <div class="title-sm">Menu</div>
          <div id="pause-note" style="font-size:12px;color:var(--muted)">The match keeps running for your opponent while this menu is open.</div>
          <button id="btn-resume" class="btn">Resume</button>
          <div id="fp-options" class="hidden" style="display:flex;flex-direction:column;gap:8px">
            <label class="row">Unlimited boost <input id="opt-unlimited" type="checkbox" checked /></label>
            <label class="row">Reset ball after a goal <input id="opt-goalreset" type="checkbox" checked /></label>
          </div>
          <button id="btn-pause-settings" class="btn ghost">Controls &amp; Settings</button>
          <button id="btn-leave" class="btn danger">Leave</button>
          <div id="leave-confirm" class="hidden" style="display:flex;flex-direction:column;gap:8px">
            <div style="font-size:13px">Leave the live match? Your opponent wins by forfeit.</div>
            <button id="btn-leave-yes" class="btn danger">Yes, leave match</button>
          </div>
        </div>
      </div>

      <div id="settings" class="modal interactive hidden">
        <div class="panel wide" role="dialog" aria-label="Settings">
          <div class="title-sm">Settings</div>
          <div id="settings-slot"></div>
          <button id="btn-settings-close" class="btn">Close</button>
        </div>
      </div>

      <div id="loading" class="loading hidden">LOADING ARENA…</div>
    `;
    this.root.querySelectorAll<HTMLElement>('[id]').forEach((el) => (this.els[el.id] = el));
    this.els['gauge-slot'].replaceWith(this.gauge.el);
    this.settingsPanel = new SettingsPanel({
      captureKey: (cb) => this.h.captureKey(cb),
      onVolumeChange: (v) => this.h.onVolumeChange(v),
      onToggleMute: () => this.h.onToggleMute(),
    });
    this.els['settings-slot'].replaceWith(this.settingsPanel.el);
    this.root.appendChild(this.garage.el);
    this.renderHelp();
    settings.subscribe(() => this.renderHelp());
    this.bind();
  }

  private bind(): void {
    const on = (id: string, fn: () => void) => this.els[id].addEventListener('click', fn);
    on('btn-quick', () => this.h.onPlayQuickMatch());
    on('btn-free', () => this.h.onPlayFreePlay());
    on('btn-bot', () => this.h.onPlayBot());
    on('btn-private', () => this.showPrivate());
    on('btn-create-room', () => this.h.onCreateRoom());
    on('btn-join-room', () => this.submitJoin());
    on('btn-private-close', () => {
      if (!this.els['pm-hosting'].classList.contains('hidden')) this.h.onCancelRoom();
      this.hide('private');
    });
    on('btn-copy-link', () => {
      const code = this.els['pm-room-code'].textContent ?? '';
      const link = `${location.origin}${location.pathname}?room=${code}`;
      void navigator.clipboard?.writeText(link).then(
        () => (this.els['btn-copy-link'].textContent = 'Link copied!'),
        () => (this.els['btn-copy-link'].textContent = link)
      );
    });
    (this.els['pm-code'] as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.submitJoin();
    });
    on('btn-garage', () => this.setGarage(true));
    on('btn-settings', () => this.openModal('settings'));
    on('btn-pause-settings', () => this.openModal('settings'));
    on('btn-settings-close', () => this.closeModal('settings'));
    on('btn-cancel', () => this.h.onCancelQueue());
    on('btn-resume', () => this.closeModal('pause'));
    on('btn-leave', () => {
      if (this.inLiveMatch) this.els['leave-confirm'].classList.remove('hidden');
      else {
        this.closeModal('pause');
        this.h.onLeaveMatch();
      }
    });
    on('btn-leave-yes', () => {
      this.closeModal('pause');
      this.h.onLeaveMatch();
    });
    on('btn-again', () => {
      this.closeModal('result');
      this.h.onPlayAgain();
    });
    on('btn-menu', () => {
      this.closeModal('result');
      this.h.onReturnToMenu();
    });
    (this.els['opt-unlimited'] as HTMLInputElement).addEventListener('change', (e) => this.h.onFreePlayUnlimitedBoost((e.target as HTMLInputElement).checked));
    (this.els['opt-goalreset'] as HTMLInputElement).addEventListener('change', (e) => this.h.onFreePlayGoalReset((e.target as HTMLInputElement).checked));
    this.root.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((b) =>
      b.addEventListener('click', () => {
        this.theme = b.dataset.theme as ArenaTheme;
        this.root.querySelectorAll<HTMLButtonElement>('[data-theme]').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        this.h.onThemeChange(this.theme);
      })
    );
  }

  private openModal(id: string) {
    this.els[id].classList.remove('hidden');
    this.h.onModalChange(true);
  }

  private closeModal(id: string) {
    this.els[id].classList.add('hidden');
    if (id === 'pause') this.els['leave-confirm'].classList.add('hidden');
    const anyOpen = ['pause', 'settings', 'result'].some((m) => !this.els[m].classList.contains('hidden'));
    this.h.onModalChange(anyOpen);
  }

  // ------------------------------------------------------------- states
  showLanding(): void {
    this.inLiveMatch = false;
    this.show('landing');
    for (const id of ['searching', 'hud', 'result', 'pause', 'loading']) this.hide(id);
    this.stopSearchTimer();
    this.h.onModalChange(false);
  }

  private submitJoin(): void {
    const input = this.els['pm-code'] as HTMLInputElement;
    const code = input.value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      this.privateError('Room codes are 5 letters/numbers.');
      return;
    }
    this.privateError('');
    this.h.onJoinRoom(code);
  }

  showPrivate(prefillCode = ''): void {
    this.show('private');
    this.els['pm-choose'].classList.remove('hidden');
    this.els['pm-hosting'].classList.add('hidden');
    (this.els['pm-code'] as HTMLInputElement).value = prefillCode;
    this.privateError('');
  }

  showRoomCode(code: string): void {
    this.show('private');
    this.els['pm-choose'].classList.add('hidden');
    this.els['pm-hosting'].classList.remove('hidden');
    this.els['pm-room-code'].textContent = code;
    this.els['btn-copy-link'].textContent = 'Copy invite link';
  }

  privateError(text: string): void {
    this.els['pm-error'].textContent = text;
  }

  setGarage(open: boolean): void {
    this.garage.show(open);
    this.els['landing'].classList.toggle('hidden', open);
    this.h.onGarage(open);
  }

  showLoading(on: boolean): void {
    this.els['loading'].classList.toggle('hidden', !on);
  }

  showSearching(): void {
    this.hide('landing');
    this.show('searching');
    this.searchStart = Date.now();
    this.stopSearchTimer();
    this.searchTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - this.searchStart) / 1000);
      this.els['search-time'].textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 500);
  }

  showGameHUD(isFreePlay: boolean, team: Team = 'blue'): void {
    this.localTeam = team;
    this.inLiveMatch = !isFreePlay;
    this.stopSearchTimer();
    for (const id of ['landing', 'searching', 'result', 'pause', 'private']) this.hide(id);
    this.show('hud');
    this.els['scoreboard'].classList.toggle('hidden', isFreePlay);
    this.els['freeplay-tag'].classList.toggle('hidden', !isFreePlay);
    this.els['fp-options'].classList.toggle('hidden', !isFreePlay);
    this.els['fp-keys'].classList.toggle('hidden', !isFreePlay);
    this.els['pause-note'].classList.toggle('hidden', isFreePlay);
    this.showHelp(12000);
    const tag = this.els['team-tag'];
    tag.classList.toggle('hidden', isFreePlay);
    tag.textContent = `YOU ARE ${team.toUpperCase()}`;
    tag.style.borderLeft = `3px solid ${team === 'blue' ? 'var(--blue-hi)' : 'var(--orange)'}`;
    this.updateScore(0, 0);
    this.hideCountdown();
    this.hide('ot-banner');
    this.hide('dc-banner');
  }

  /** Show the controls card; hide again after `ms` (0 = keep). */
  showHelp(ms = 0): void {
    this.show('help');
    window.clearTimeout(this.helpTimer);
    if (ms > 0) this.helpTimer = window.setTimeout(() => this.hide('help'), ms);
  }

  toggleHelp(): void {
    if (this.els['help'].classList.contains('hidden')) this.showHelp();
    else this.hide('help');
  }

  setStatus(state: 'unknown' | 'ok' | 'bad', text: string): void {
    this.els['status-dot'].className = `dot ${state === 'ok' ? 'ok' : state === 'bad' ? 'bad' : ''}`;
    this.els['status-text'].textContent = text;
  }

  togglePauseMenu(): void {
    if (this.els['pause'].classList.contains('hidden')) this.openModal('pause');
    else this.closeModal('pause');
  }

  setCameraMode(mode: CameraMode): void {
    const el = this.els['cam-tag'];
    this.els['cam-text'].textContent = mode === 'ball_cam' ? 'Ball Cam' : 'Car Cam';
    el.classList.toggle('car', mode === 'car_cam');
  }

  updateScore(blue: number, orange: number): void {
    this.els['score-blue'].textContent = String(blue);
    this.els['score-orange'].textContent = String(orange);
  }

  updateTimer(seconds: number, overtime = false): void {
    const s = Math.max(0, Math.floor(seconds));
    const txt = `${overtime ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (this.els['clock-text'].textContent !== txt) this.els['clock-text'].textContent = txt;
    this.els['clock'].classList.toggle('ot', overtime);
    this.els['ot-banner'].classList.toggle('hidden', !overtime);
  }

  /** Boost units 0..100, car speed in m/s. */
  updateBoost(units: number, speedMs = 0, supersonic = false): void {
    this.gauge.update(units, speedMs, supersonic);
  }

  /** True while the settings panel waits for a key press (Esc must cancel, not close menus). */
  get capturingKey(): boolean {
    return this.settingsPanel.isCapturing;
  }

  private renderHelp(): void {
    const k = (a: ActionId) => `<kbd>${keyLabel(settings.get().keybinds[a][0])}</kbd>`;
    this.els['help-keys'].innerHTML =
      `${k('throttle')}/${k('reverse')} drive · ${k('steerLeft')}/${k('steerRight')} steer · ${k('jump')} jump/flip · ${k('boost')} boost · ` +
      `${k('powerslide')} slide / air roll · ${k('airRollLeft')}/${k('airRollRight')} roll · ${k('ballCam')} camera · ${k('help')} hide help`;
    this.els['fp-keys'].innerHTML =
      `${k('resetBall')} reset ball · ${k('resetCar')} reset car · ${k('unlimitedBoost')} unlimited boost · ` +
      `${k('popBall')} pop ball up · ${k('lobBall')} lob to me · ${k('ballOnHood')} ball on hood`;
  }

  showCountdown(n: number): void {
    const el = this.els['countdown'];
    if (n === this.lastCountdown && !el.classList.contains('hidden')) return;
    this.lastCountdown = n;
    el.textContent = n <= 0 ? 'GO!' : String(n);
    el.classList.remove('hidden', 'pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  hideCountdown(): void {
    this.lastCountdown = -1;
    this.hide('countdown');
  }

  showGoal(scorer: Team): void {
    const title = this.els['goal-title'];
    const color = scorer === 'blue' ? '#5aa0ff' : '#ff8c2a';
    title.textContent = 'GOAL!';
    title.style.color = '#fff';
    title.style.textShadow = `0 0 40px ${color}, 0 0 90px ${color}, 0 8px 0 rgba(0,0,0,0.35)`;
    this.els['goal-sub'].textContent = `${scorer === this.localTeam && this.inLiveMatch ? 'You' : scorer === 'blue' ? 'Blue' : 'Orange'} scored`;
    this.els['goal-sub'].style.color = color;
    const el = this.els['goal'];
    el.classList.remove('hidden');
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = '';
    window.clearTimeout(this.goalTimer);
    this.goalTimer = window.setTimeout(() => this.hide('goal'), 2600);
  }

  toast(text: string): void {
    const el = this.els['toast'];
    el.textContent = text;
    el.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.add('hidden'), 1600);
  }

  showResult(winner: Team | 'forfeit_blue' | 'forfeit_orange', blue: number, orange: number, reason?: string): void {
    this.inLiveMatch = false;
    const title = this.els['result-title'];
    const winTeam: Team = winner === 'forfeit_blue' ? 'orange' : winner === 'forfeit_orange' ? 'blue' : (winner as Team);
    const won = winTeam === this.localTeam;
    title.textContent = won ? 'Victory' : 'Defeat';
    title.style.color = won ? '#7dd3fc' : '#fca5a5';
    this.els['result-score'].textContent = `${blue} - ${orange}`;
    this.els['result-reason'].textContent = reason ?? (winner.startsWith('forfeit') ? 'Win by forfeit' : `${winTeam === 'blue' ? 'Blue' : 'Orange'} wins`);
    this.openModal('result');
  }

  showDisconnectBanner(sec: number): void {
    this.els['dc-count'].textContent = String(Math.ceil(sec));
    this.show('dc-banner');
  }

  hideDisconnectBanner(): void {
    this.hide('dc-banner');
  }

  private show(id: string) {
    this.els[id].classList.remove('hidden');
  }

  private hide(id: string) {
    this.els[id].classList.add('hidden');
  }

  private stopSearchTimer() {
    if (this.searchTimer) window.clearInterval(this.searchTimer);
    this.searchTimer = undefined;
  }
}
