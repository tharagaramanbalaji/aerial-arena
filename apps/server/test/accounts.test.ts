import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PlayerStore } from '../src/db.js';
import { createServer, ServerInstance } from '../src/server.js';

describe('PlayerStore (SQLite)', () => {
  it('registers, rejects bad input and duplicates, logs in, and tracks sessions', async () => {
    const store = await PlayerStore.open(null);
    expect(store.register('ab', 'secret1')).toMatchObject({ ok: false });
    expect(store.register('bad name!', 'secret1')).toMatchObject({ ok: false });
    expect(store.register('Rocket_1', '123')).toMatchObject({ ok: false });
    const r = store.register('Rocket_1', 'secret1');
    expect(r.ok).toBe(true);
    expect(store.register('rocket_1', 'another1')).toMatchObject({ ok: false, error: 'That username is taken' });
    expect(store.login('Rocket_1', 'wrong')).toMatchObject({ ok: false });
    const l = store.login('ROCKET_1', 'secret1');
    expect(l.ok).toBe(true);
    if (!l.ok || !r.ok) return;
    expect(store.userForToken(l.token)?.username).toBe('Rocket_1');
    store.logout(l.token);
    expect(store.userForToken(l.token)).toBeNull();
    expect(store.userForToken(r.token)?.username).toBe('Rocket_1'); // other session still valid
    expect(store.userForToken('forged')).toBeNull();
  });

  it('records online and bot results, builds a leaderboard, and persists to disk', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aa-db-')), 'test.sqlite');
    const store = await PlayerStore.open(file);
    const a = store.register('alpha', 'secret1');
    const b = store.register('bravo', 'secret1');
    if (!a.ok || !b.ok) throw new Error('register failed');
    store.recordMatch(a.user.id, { won: true, goalsFor: 3, goalsAgainst: 1, vsBot: false });
    store.recordMatch(b.user.id, { won: false, goalsFor: 1, goalsAgainst: 3, vsBot: false });
    store.recordMatch(b.user.id, { won: true, goalsFor: 2, goalsAgainst: 0, vsBot: true });
    expect(store.profile(a.user.id)).toMatchObject({ matches: 1, wins: 1, losses: 0, goalsFor: 3, goalsAgainst: 1 });
    expect(store.profile(b.user.id)).toMatchObject({ matches: 1, wins: 0, losses: 1, botMatches: 1, botWins: 1 });
    expect(store.leaderboard().map((p) => p.username)).toEqual(['alpha', 'bravo']);

    const reopened = await PlayerStore.open(file); // simulates a server restart
    expect(reopened.profile(a.user.id)).toMatchObject({ username: 'alpha', wins: 1 });
    expect(reopened.userForToken(a.token)?.username).toBe('alpha');
  });
});

describe('Accounts HTTP API + identity in matches', () => {
  let server: ServerInstance | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  async function start() {
    const store = await PlayerStore.open(null);
    server = createServer(0, '127.0.0.1', store);
    await new Promise<void>((r) => server!.httpServer.listen(0, '127.0.0.1', r));
    const addr = server.httpServer.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}` };
  }
  const post = (url: string, body: object, token?: string) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });

  it('register / login / me / bot-result / leaderboard', async () => {
    const s = await start();
    const reg = await post(`${s.http}/api/register`, { username: 'Pilot_7', password: 'hunter22' });
    expect(reg.status).toBe(200);
    const { token, profile } = (await reg.json()) as { token: string; profile: { username: string } };
    expect(profile.username).toBe('Pilot_7');
    expect((await post(`${s.http}/api/register`, { username: 'pilot_7', password: 'hunter22' })).status).toBe(400);
    expect((await post(`${s.http}/api/login`, { username: 'Pilot_7', password: 'nope' })).status).toBe(401);

    const me = await fetch(`${s.http}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(200);
    expect((await fetch(`${s.http}/api/me`)).status).toBe(401);

    const bot = await post(`${s.http}/api/bot-result`, { won: true, goalsFor: 4, goalsAgainst: 2 }, token);
    expect(((await bot.json()) as { profile: { botWins: number } }).profile.botWins).toBe(1);
    const lb = (await (await fetch(`${s.http}/api/leaderboard`)).json()) as { players: { username: string }[] };
    expect(lb.players[0].username).toBe('Pilot_7');
    const pre = await fetch(`${s.http}/api/login`, { method: 'OPTIONS' });
    expect(pre.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('a logged-in player is shown to their opponent by username', async () => {
    const s = await start();
    const { token } = (await (await post(`${s.http}/api/register`, { username: 'HostUser', password: 'secret1' })).json()) as { token: string };
    const open = async () => {
      const ws = new WebSocket(s.ws);
      await new Promise((r) => ws.once('open', r));
      return ws;
    };
    const next = (ws: WebSocket, type: string) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const on = (d: Buffer) => {
          const m = JSON.parse(d.toString());
          if (m.type === type) {
            ws.off('message', on);
            resolve(m);
          }
        };
        ws.on('message', on);
      });
    const host = await open();
    const guest = await open();
    host.send(JSON.stringify({ type: 'room/create', authToken: token }));
    const { code } = (await next(host, 'room/created')) as { code: string };
    const matched = next(guest, 'queue/matched');
    guest.send(JSON.stringify({ type: 'room/join', code, playerName: 'Sam' }));
    const m = await matched;
    expect(m.opponentName).toBe('HostUser');
    host.close();
    guest.close();
  });
});
