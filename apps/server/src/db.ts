import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';

/**
 * Player accounts + simple stats in SQLite (sql.js: SQLite compiled to WebAssembly, so there is
 * no native build step and it runs the same on Windows, Linux and Docker).
 *
 * The database lives in memory and is written to `file` atomically after every change
 * (temp file + rename). Pass no file for an in-memory store (tests).
 *
 * Security notes:
 *  - passwords: scrypt with a per-user random salt, compared in constant time
 *  - sessions: random 32-byte tokens; only their SHA-256 is stored; expire after 30 days
 */
export interface PublicProfile {
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

export interface AuthUser {
  id: number;
  username: string;
}

export type AuthResult = { ok: true; token: string; user: AuthUser } | { ok: false; error: string };

const SESSION_MS = 30 * 24 * 3600 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (password: string, salt: string) => crypto.scryptSync(password, salt, 64).toString('hex');

export class PlayerStore {
  private constructor(
    private readonly db: Database,
    private readonly file: string | null
  ) {}

  static async open(file: string | null = null): Promise<PlayerStore> {
    const SQL = await initSqlJs();
    const db = file && fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER PRIMARY KEY,
        matches INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        goals_for INTEGER NOT NULL DEFAULT 0,
        goals_against INTEGER NOT NULL DEFAULT 0,
        bot_matches INTEGER NOT NULL DEFAULT 0,
        bot_wins INTEGER NOT NULL DEFAULT 0
      );
    `);
    if (file) fs.mkdirSync(path.dirname(file), { recursive: true });
    const store = new PlayerStore(db, file);
    store.save();
    return store;
  }

  private save(): void {
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  private one<T>(sql: string, params: (string | number)[] = []): T | null {
    const st = this.db.prepare(sql);
    try {
      st.bind(params);
      return st.step() ? (st.getAsObject() as T) : null;
    } finally {
      st.free();
    }
  }

  private all<T>(sql: string, params: (string | number)[] = []): T[] {
    const st = this.db.prepare(sql);
    const rows: T[] = [];
    try {
      st.bind(params);
      while (st.step()) rows.push(st.getAsObject() as T);
    } finally {
      st.free();
    }
    return rows;
  }

  private newSession(userId: number): string {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
    this.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), userId, now + SESSION_MS]);
    this.db.run('UPDATE users SET last_seen = ? WHERE id = ?', [now, userId]);
    return token;
  }

  register(username: string, password: string): AuthResult {
    if (!USERNAME_RE.test(username)) return { ok: false, error: 'Username must be 3-16 letters, numbers or _' };
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
      return { ok: false, error: 'Password must be 6-72 characters' };
    }
    if (this.one('SELECT id FROM users WHERE username = ?', [username])) return { ok: false, error: 'That username is taken' };
    const salt = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    this.db.run('INSERT INTO users (username, pass_hash, salt, created_at, last_seen) VALUES (?, ?, ?, ?, ?)', [
      username, hashPassword(password, salt), salt, now, now,
    ]);
    const row = this.one<{ id: number }>('SELECT id FROM users WHERE username = ?', [username])!;
    this.db.run('INSERT INTO stats (user_id) VALUES (?)', [row.id]);
    const token = this.newSession(row.id);
    this.save();
    return { ok: true, token, user: { id: row.id, username } };
  }

  login(username: string, password: string): AuthResult {
    const row = this.one<{ id: number; username: string; pass_hash: string; salt: string }>(
      'SELECT id, username, pass_hash, salt FROM users WHERE username = ?',
      [String(username ?? '')]
    );
    // Hash even when the user is missing so response time doesn't reveal which usernames exist.
    const candidate = Buffer.from(hashPassword(String(password ?? ''), row?.salt ?? 'no-such-user'), 'hex');
    const expected = Buffer.from(row?.pass_hash ?? '0'.repeat(128), 'hex');
    if (!row || !crypto.timingSafeEqual(candidate, expected)) return { ok: false, error: 'Wrong username or password' };
    const token = this.newSession(row.id);
    this.save();
    return { ok: true, token, user: { id: row.id, username: row.username } };
  }

  userForToken(token: string | undefined | null): AuthUser | null {
    if (!token) return null;
    const row = this.one<{ id: number; username: string }>(
      'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      [sha256(token), Date.now()]
    );
    return row ? { id: row.id, username: row.username } : null;
  }

  logout(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
    this.save();
  }

  profile(userId: number): PublicProfile | null {
    const r = this.one<Record<string, number | string>>(
      `SELECT u.username, u.created_at, s.matches, s.wins, s.losses, s.goals_for, s.goals_against, s.bot_matches, s.bot_wins
       FROM users u JOIN stats s ON s.user_id = u.id WHERE u.id = ?`,
      [userId]
    );
    if (!r) return null;
    return {
      username: String(r.username),
      createdAt: Number(r.created_at),
      matches: Number(r.matches),
      wins: Number(r.wins),
      losses: Number(r.losses),
      goalsFor: Number(r.goals_for),
      goalsAgainst: Number(r.goals_against),
      botMatches: Number(r.bot_matches),
      botWins: Number(r.bot_wins),
    };
  }

  /** Online result (server-authoritative) or a bot match reported by the client. */
  recordMatch(userId: number, r: { won: boolean; goalsFor: number; goalsAgainst: number; vsBot: boolean }): void {
    const gf = Math.max(0, Math.min(99, Math.floor(r.goalsFor) || 0));
    const ga = Math.max(0, Math.min(99, Math.floor(r.goalsAgainst) || 0));
    if (r.vsBot) {
      this.db.run('UPDATE stats SET bot_matches = bot_matches + 1, bot_wins = bot_wins + ? WHERE user_id = ?', [r.won ? 1 : 0, userId]);
    } else {
      this.db.run(
        `UPDATE stats SET matches = matches + 1, wins = wins + ?, losses = losses + ?,
           goals_for = goals_for + ?, goals_against = goals_against + ? WHERE user_id = ?`,
        [r.won ? 1 : 0, r.won ? 0 : 1, gf, ga, userId]
      );
    }
    this.save();
  }

  /** Top players by online wins (ties: fewer losses, then earlier signup). */
  leaderboard(limit = 10): { username: string; wins: number; losses: number; matches: number }[] {
    return this.all<{ username: string; wins: number; losses: number; matches: number }>(
      `SELECT u.username, s.wins, s.losses, s.matches FROM stats s JOIN users u ON u.id = s.user_id
       ORDER BY s.wins DESC, s.losses ASC, u.created_at ASC LIMIT ?`,
      [Math.max(1, Math.min(50, limit))]
    );
  }
}
