import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import initSqlJs, { Database } from 'sql.js';
import pg from 'pg';

/**
 * Player accounts + simple stats.
 *
 * Two interchangeable backends behind one async interface:
 *  - Postgres (e.g. Neon) when DATABASE_URL is set: survives host restarts/redeploys.
 *  - SQLite (sql.js, WebAssembly, no native build) otherwise: a local file, or memory for tests.
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

export interface MatchRecord {
  won: boolean;
  goalsFor: number;
  goalsAgainst: number;
  vsBot: boolean;
}

export type AuthResult = { ok: true; token: string; user: AuthUser } | { ok: false; error: string };

export interface PlayerStore {
  readonly kind: 'postgres' | 'sqlite';
  register(username: string, password: string): Promise<AuthResult>;
  login(username: string, password: string): Promise<AuthResult>;
  userForToken(token: string | undefined | null): Promise<AuthUser | null>;
  logout(token: string): Promise<void>;
  profile(userId: number): Promise<PublicProfile | null>;
  recordMatch(userId: number, r: MatchRecord): Promise<void>;
  leaderboard(limit?: number): Promise<{ username: string; wins: number; losses: number; matches: number }[]>;
  close(): Promise<void>;
}

const SESSION_MS = 30 * 24 * 3600 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const hashPassword = (password: string, salt: string) => crypto.scryptSync(password, salt, 64).toString('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function validateNew(username: string, password: string): string | null {
  if (!USERNAME_RE.test(username)) return 'Username must be 3-16 letters, numbers or _';
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) return 'Password must be 6-72 characters';
  return null;
}

/** Constant-time password check; hashes even for unknown users so timing doesn't reveal them. */
function passwordMatches(password: string, row: { pass_hash: string; salt: string } | null): boolean {
  const candidate = Buffer.from(hashPassword(String(password ?? ''), row?.salt ?? 'no-such-user'), 'hex');
  const expected = Buffer.from(row?.pass_hash ?? '0'.repeat(128), 'hex');
  return !!row && crypto.timingSafeEqual(candidate, expected);
}

const clampGoals = (n: number) => Math.max(0, Math.min(99, Math.floor(n) || 0));
const clampLimit = (n: number) => Math.max(1, Math.min(50, Math.floor(n) || 10));

/** Choose the backend: Postgres when a URL is given, otherwise SQLite at `file` (memory if null). */
export async function openPlayerStore(opts: { databaseUrl?: string; file?: string | null }): Promise<PlayerStore> {
  if (opts.databaseUrl) return PostgresPlayerStore.connect(opts.databaseUrl);
  return SqlitePlayerStore.open(opts.file ?? null);
}

// ===========================================================================
// Postgres (Neon)
// ===========================================================================

type Queryable = Pick<pg.Pool, 'query' | 'end'>;

export class PostgresPlayerStore implements PlayerStore {
  readonly kind = 'postgres' as const;
  private constructor(private readonly pool: Queryable) {}

  /** Connect with TLS (Neon requires it) and create tables if needed. */
  static async connect(databaseUrl: string): Promise<PostgresPlayerStore> {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
    const pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000, // Neon may need a few seconds to wake a suspended database
      ssl: local ? undefined : { rejectUnauthorized: true },
    });
    // Neon drops idle connections when it suspends; without this listener that error would crash the server.
    pool.on('error', (err) => console.error('[accounts] idle database connection closed:', err.message));
    return PostgresPlayerStore.withPool(pool);
  }

  /** Use an existing pool (tests inject pg-mem). */
  static async withPool(pool: Queryable): Promise<PostgresPlayerStore> {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at BIGINT NOT NULL,
        last_seen BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stats (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        matches INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        goals_for INTEGER NOT NULL DEFAULT 0,
        goals_against INTEGER NOT NULL DEFAULT 0,
        bot_matches INTEGER NOT NULL DEFAULT 0,
        bot_wins INTEGER NOT NULL DEFAULT 0
      );
    `);
    return new PostgresPlayerStore(pool);
  }

  private async newSession(userId: number): Promise<string> {
    const token = newToken();
    const now = Date.now();
    await this.pool.query('DELETE FROM sessions WHERE expires_at < $1', [now]);
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, now + SESSION_MS]);
    await this.pool.query('UPDATE users SET last_seen = $1 WHERE id = $2', [now, userId]);
    return token;
  }

  async register(username: string, password: string): Promise<AuthResult> {
    const invalid = validateNew(username, password);
    if (invalid) return { ok: false, error: invalid };
    const salt = crypto.randomBytes(16).toString('hex');
    const now = Date.now();
    let id: number;
    try {
      const r = await this.pool.query(
        'INSERT INTO users (username, username_lower, pass_hash, salt, created_at, last_seen) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [username, username.toLowerCase(), hashPassword(password, salt), salt, now, now]
      );
      id = Number(r.rows[0].id);
    } catch (err) {
      // The unique constraint settles races between two sign-ups for the same name.
      if ((err as { code?: string }).code === '23505' || /unique|duplicate/i.test(String((err as Error).message))) {
        return { ok: false, error: 'That username is taken' };
      }
      throw err;
    }
    await this.pool.query('INSERT INTO stats (user_id) VALUES ($1)', [id]);
    return { ok: true, token: await this.newSession(id), user: { id, username } };
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const r = await this.pool.query('SELECT id, username, pass_hash, salt FROM users WHERE username_lower = $1', [String(username ?? '').toLowerCase()]);
    const row = (r.rows[0] as { id: number; username: string; pass_hash: string; salt: string } | undefined) ?? null;
    if (!passwordMatches(password, row)) return { ok: false, error: 'Wrong username or password' };
    const id = Number(row!.id);
    return { ok: true, token: await this.newSession(id), user: { id, username: row!.username } };
  }

  async userForToken(token: string | undefined | null): Promise<AuthUser | null> {
    if (!token) return null;
    const r = await this.pool.query(
      'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > $2',
      [sha256(token), Date.now()]
    );
    const row = r.rows[0] as { id: number; username: string } | undefined;
    return row ? { id: Number(row.id), username: row.username } : null;
  }

  async logout(token: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }

  async profile(userId: number): Promise<PublicProfile | null> {
    const r = await this.pool.query(
      `SELECT u.username, u.created_at, s.matches, s.wins, s.losses, s.goals_for, s.goals_against, s.bot_matches, s.bot_wins
       FROM users u JOIN stats s ON s.user_id = u.id WHERE u.id = $1`,
      [userId]
    );
    return r.rows[0] ? toProfile(r.rows[0]) : null;
  }

  async recordMatch(userId: number, m: MatchRecord): Promise<void> {
    if (m.vsBot) {
      await this.pool.query('UPDATE stats SET bot_matches = bot_matches + 1, bot_wins = bot_wins + $1 WHERE user_id = $2', [m.won ? 1 : 0, userId]);
    } else {
      await this.pool.query(
        `UPDATE stats SET matches = matches + 1, wins = wins + $1, losses = losses + $2,
           goals_for = goals_for + $3, goals_against = goals_against + $4 WHERE user_id = $5`,
        [m.won ? 1 : 0, m.won ? 0 : 1, clampGoals(m.goalsFor), clampGoals(m.goalsAgainst), userId]
      );
    }
  }

  async leaderboard(limit = 10) {
    const r = await this.pool.query(
      `SELECT u.username, s.wins, s.losses, s.matches FROM stats s JOIN users u ON u.id = s.user_id
       ORDER BY s.wins DESC, s.losses ASC, u.created_at ASC LIMIT $1`,
      [clampLimit(limit)]
    );
    return r.rows.map((x: Record<string, unknown>) => ({
      username: String(x.username), wins: Number(x.wins), losses: Number(x.losses), matches: Number(x.matches),
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function toProfile(r: Record<string, unknown>): PublicProfile {
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

// ===========================================================================
// SQLite (sql.js): local development and tests
// ===========================================================================

export class SqlitePlayerStore implements PlayerStore {
  readonly kind = 'sqlite' as const;
  private constructor(
    private readonly db: Database,
    private readonly file: string | null
  ) {}

  /** In-memory when `file` is null; otherwise loads/creates the file and saves after each change. */
  static async open(file: string | null = null): Promise<SqlitePlayerStore> {
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
    const store = new SqlitePlayerStore(db, file);
    store.save();
    return store;
  }

  /** Atomic write: temp file + rename, so a crash can't leave a half-written database. */
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
    const token = newToken();
    const now = Date.now();
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', [now]);
    this.db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [sha256(token), userId, now + SESSION_MS]);
    this.db.run('UPDATE users SET last_seen = ? WHERE id = ?', [now, userId]);
    return token;
  }

  async register(username: string, password: string): Promise<AuthResult> {
    const invalid = validateNew(username, password);
    if (invalid) return { ok: false, error: invalid };
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

  async login(username: string, password: string): Promise<AuthResult> {
    const row = this.one<{ id: number; username: string; pass_hash: string; salt: string }>(
      'SELECT id, username, pass_hash, salt FROM users WHERE username = ?',
      [String(username ?? '')]
    );
    if (!passwordMatches(password, row)) return { ok: false, error: 'Wrong username or password' };
    const token = this.newSession(row!.id);
    this.save();
    return { ok: true, token, user: { id: row!.id, username: row!.username } };
  }

  async userForToken(token: string | undefined | null): Promise<AuthUser | null> {
    if (!token) return null;
    const row = this.one<{ id: number; username: string }>(
      'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
      [sha256(token), Date.now()]
    );
    return row ? { id: row.id, username: row.username } : null;
  }

  async logout(token: string): Promise<void> {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
    this.save();
  }

  async profile(userId: number): Promise<PublicProfile | null> {
    const r = this.one<Record<string, unknown>>(
      `SELECT u.username, u.created_at, s.matches, s.wins, s.losses, s.goals_for, s.goals_against, s.bot_matches, s.bot_wins
       FROM users u JOIN stats s ON s.user_id = u.id WHERE u.id = ?`,
      [userId]
    );
    return r ? toProfile(r) : null;
  }

  async recordMatch(userId: number, m: MatchRecord): Promise<void> {
    if (m.vsBot) {
      this.db.run('UPDATE stats SET bot_matches = bot_matches + 1, bot_wins = bot_wins + ? WHERE user_id = ?', [m.won ? 1 : 0, userId]);
    } else {
      this.db.run(
        `UPDATE stats SET matches = matches + 1, wins = wins + ?, losses = losses + ?,
           goals_for = goals_for + ?, goals_against = goals_against + ? WHERE user_id = ?`,
        [m.won ? 1 : 0, m.won ? 0 : 1, clampGoals(m.goalsFor), clampGoals(m.goalsAgainst), userId]
      );
    }
    this.save();
  }

  async leaderboard(limit = 10) {
    return this.all<{ username: string; wins: number; losses: number; matches: number }>(
      `SELECT u.username, s.wins, s.losses, s.matches FROM stats s JOIN users u ON u.id = s.user_id
       ORDER BY s.wins DESC, s.losses ASC, u.created_at ASC LIMIT ?`,
      [clampLimit(limit)]
    );
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
