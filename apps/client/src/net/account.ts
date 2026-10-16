/** Player profile as returned by the server's accounts API. */
export interface Profile {
  username: string;
  createdAt: number;
  matches: number;
  wins: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  botMatches: number;
  botWins: number;
}

export interface LeaderboardRow {
  username: string;
  wins: number;
  losses: number;
  matches: number;
}

const TOKEN_KEY = 'aerial-arena-auth-token';

/**
 * Accounts API client. The HTTP base is derived from the match-server WebSocket URL
 * (ws -> http, wss -> https), so dev and deployed builds need no extra configuration.
 * The session token is kept in localStorage (guarded: private windows may block it).
 */
export class AccountClient {
  public profile: Profile | null = null;
  private token: string | null = null;
  private readonly base: string;

  constructor(serverWsUrl: string) {
    this.base = serverWsUrl.replace(/^ws/, 'http').replace(/\/$/, '');
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      this.token = null;
    }
  }

  get authToken(): string | null {
    return this.token;
  }

  private setToken(t: string | null) {
    this.token = t;
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage unavailable: stay logged in for this tab only */
    }
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(`${this.base}/api/${path}`, { ...init, headers });
    } catch {
      throw new Error('Cannot reach the game server. Is it running?');
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
    return body;
  }

  /** Validate a stored session on startup. Returns the profile, or null if not logged in. */
  async restore(): Promise<Profile | null> {
    if (!this.token) return null;
    try {
      const r = await this.call<{ profile: Profile }>('me');
      this.profile = r.profile;
      return r.profile;
    } catch (err) {
      if (err instanceof Error && /Not logged in/.test(err.message)) this.setToken(null);
      return null;
    }
  }

  async register(username: string, password: string): Promise<Profile> {
    const r = await this.call<{ token: string; profile: Profile }>('register', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.setToken(r.token);
    this.profile = r.profile;
    return r.profile;
  }

  async login(username: string, password: string): Promise<Profile> {
    const r = await this.call<{ token: string; profile: Profile }>('login', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.setToken(r.token);
    this.profile = r.profile;
    return r.profile;
  }

  async logout(): Promise<void> {
    if (this.token) await this.call('logout', { method: 'POST' }).catch(() => undefined);
    this.setToken(null);
    this.profile = null;
  }

  async refresh(): Promise<Profile | null> {
    return this.restore();
  }

  async reportBotResult(won: boolean, goalsFor: number, goalsAgainst: number): Promise<void> {
    if (!this.token) return;
    const r = await this.call<{ profile: Profile }>('bot-result', { method: 'POST', body: JSON.stringify({ won, goalsFor, goalsAgainst }) });
    this.profile = r.profile;
  }

  leaderboard(): Promise<{ players: LeaderboardRow[] }> {
    return this.call<{ players: LeaderboardRow[] }>('leaderboard');
  }
}
