import { AccountClient, Profile } from '../net/account.js';

/**
 * Login / create-account screen, the profile card on the main menu, and the leaderboard.
 * Usernames are always inserted with textContent (never as HTML).
 */
export class AuthPanel {
  readonly el = document.createElement('div');
  private mode: 'login' | 'register' = 'login';
  private q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;

  constructor(
    private readonly account: AccountClient,
    private readonly onChange: (profile: Profile | null) => void
  ) {
    this.el.innerHTML = `
      <div id="auth" class="modal interactive hidden">
        <form class="panel auth-panel" role="dialog" aria-label="Log in" novalidate>
          <div class="logo" style="font-size:44px">Aerial<br/>Arena</div>
          <div class="tabs" role="tablist">
            <button type="button" role="tab" data-mode="login" aria-selected="true">Log in</button>
            <button type="button" role="tab" data-mode="register" aria-selected="false">Create account</button>
          </div>
          <label class="field">Username
            <input name="username" autocomplete="username" maxlength="16" required spellcheck="false" />
          </label>
          <label class="field">Password
            <input name="password" type="password" autocomplete="current-password" maxlength="72" required />
          </label>
          <div class="hint" data-rules>3-16 letters, numbers or _ · password 6+ characters</div>
          <div class="hint auth-error" role="alert"></div>
          <button type="submit" class="btn" data-submit>Log in</button>
          <button type="button" class="btn ghost" data-guest>Continue as guest <small>Play without saving stats</small></button>
        </form>
      </div>

      <div id="profile-card" class="profile-card interactive hidden">
        <div class="pc-name"></div>
        <div class="pc-stats"></div>
        <div class="pc-actions">
          <button type="button" class="chip" data-leaderboard>Leaderboard</button>
          <button type="button" class="chip" data-logout>Log out</button>
        </div>
      </div>
      <div id="guest-card" class="profile-card interactive hidden">
        <div class="pc-name">Guest</div>
        <div class="pc-stats">Stats aren't saved.</div>
        <div class="pc-actions">
          <button type="button" class="chip" data-leaderboard>Leaderboard</button>
          <button type="button" class="chip" data-login>Log in / Sign up</button>
        </div>
      </div>

      <div id="leaderboard" class="modal interactive hidden">
        <div class="panel" role="dialog" aria-label="Leaderboard">
          <div class="title-sm">Leaderboard</div>
          <table class="binds lb"><thead><tr><th>#</th><th>Player</th><th>W</th><th>L</th><th>Played</th></tr></thead><tbody></tbody></table>
          <div class="hint lb-msg"></div>
          <button type="button" class="btn" data-close-lb>Close</button>
        </div>
      </div>`;

    const form = this.q<HTMLFormElement>('form');
    this.el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) =>
      b.addEventListener('click', () => this.setMode(b.dataset.mode as 'login' | 'register'))
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submit();
    });
    this.q('[data-guest]').addEventListener('click', () => {
      this.showLogin(false);
      this.renderCard();
      this.onChange(null);
    });
    this.el.querySelectorAll('[data-leaderboard]').forEach((b) => b.addEventListener('click', () => void this.openLeaderboard()));
    this.q('[data-close-lb]').addEventListener('click', () => this.q('#leaderboard').classList.add('hidden'));
    this.q('[data-logout]').addEventListener('click', async () => {
      await this.account.logout();
      this.renderCard();
      this.onChange(null);
      this.showLogin(true);
    });
    this.q('[data-login]').addEventListener('click', () => this.showLogin(true));
  }

  private setMode(mode: 'login' | 'register') {
    this.mode = mode;
    this.el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    this.q('[data-submit]').textContent = mode === 'login' ? 'Log in' : 'Create account';
    this.q<HTMLInputElement>('input[name="password"]').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    this.error('');
  }

  private error(text: string) {
    this.q('.auth-error').textContent = text;
  }

  private async submit() {
    const username = this.q<HTMLInputElement>('input[name="username"]').value.trim();
    const password = this.q<HTMLInputElement>('input[name="password"]').value;
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return this.error('Username: 3-16 letters, numbers or _');
    if (password.length < 6) return this.error('Password must be at least 6 characters');
    const btn = this.q<HTMLButtonElement>('[data-submit]');
    btn.disabled = true;
    try {
      const profile = this.mode === 'login' ? await this.account.login(username, password) : await this.account.register(username, password);
      this.q<HTMLInputElement>('input[name="password"]').value = '';
      this.showLogin(false);
      this.renderCard();
      this.onChange(profile);
    } catch (err) {
      this.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      btn.disabled = false;
    }
  }

  showLogin(open: boolean): void {
    this.q('#auth').classList.toggle('hidden', !open);
    if (open) {
      this.setMode(this.mode);
      setTimeout(() => this.q<HTMLInputElement>('input[name="username"]').focus(), 0);
    }
  }

  /** Show/hide the menu profile card (only on the landing screen). */
  showCard(visible: boolean): void {
    const p = this.account.profile;
    this.q('#profile-card').classList.toggle('hidden', !visible || !p);
    this.q('#guest-card').classList.toggle('hidden', !visible || !!p);
  }

  renderCard(): void {
    const p = this.account.profile;
    if (!p) return;
    this.q('#profile-card .pc-name').textContent = p.username;
    const stats = this.q('#profile-card .pc-stats');
    stats.replaceChildren();
    const rows: [string, string][] = [
      ['Online', `${p.wins}W · ${p.losses}L · ${p.matches} played`],
      ['Goals', `${p.goalsFor} for · ${p.goalsAgainst} against`],
      ['Vs Bot', `${p.botWins} wins / ${p.botMatches}`],
    ];
    for (const [k, v] of rows) {
      const row = document.createElement('div');
      const key = document.createElement('span');
      key.textContent = k;
      const val = document.createElement('b');
      val.textContent = v;
      row.append(key, val);
      stats.append(row);
    }
  }

  private async openLeaderboard() {
    const modal = this.q('#leaderboard');
    const body = this.q('#leaderboard tbody');
    const msg = this.q('.lb-msg');
    modal.classList.remove('hidden');
    body.replaceChildren();
    msg.textContent = 'Loading…';
    try {
      const { players } = await this.account.leaderboard();
      msg.textContent = players.length ? 'Ranked by online wins.' : 'No players yet. Create an account and win a match!';
      players.forEach((p, i) => {
        const tr = document.createElement('tr');
        for (const v of [String(i + 1), p.username, String(p.wins), String(p.losses), String(p.matches)]) {
          const td = document.createElement('td');
          td.textContent = v;
          tr.append(td);
        }
        if (p.username === this.account.profile?.username) tr.classList.add('me');
        body.append(tr);
      });
    } catch (err) {
      msg.textContent = err instanceof Error ? err.message : 'Could not load the leaderboard';
    }
  }
}
