import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { ServerMessage } from '@aerial-arena/shared';
import { createServer, ServerInstance } from '../src/server.js';

/** Real WebSocket clients against a real server on an ephemeral port. */
async function start(): Promise<{ server: ServerInstance; url: string }> {
  const server = createServer();
  await new Promise<void>((r) => server.httpServer.listen(0, '127.0.0.1', r));
  const addr = server.httpServer.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, url: `ws://127.0.0.1:${port}` };
}

interface Client { ws: WebSocket; next(type: ServerMessage['type'], timeoutMs?: number): Promise<ServerMessage>; send(m: object): void }

async function client(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const inbox: ServerMessage[] = [];
  const waiters: { type: string; resolve: (m: ServerMessage) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    const w = waiters.findIndex((x) => x.type === m.type);
    if (w >= 0) waiters.splice(w, 1)[0].resolve(m);
    else inbox.push(m);
  });
  await new Promise((r) => ws.once('open', r));
  return {
    ws,
    send: (m) => ws.send(JSON.stringify(m)),
    next: (type, timeoutMs = 3000) =>
      new Promise((resolve, reject) => {
        const i = inbox.findIndex((m) => m.type === type);
        if (i >= 0) return resolve(inbox.splice(i, 1)[0]);
        const t = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs);
        waiters.push({ type, resolve: (m) => (clearTimeout(t), resolve(m)) });
      }),
  };
}

describe('Private rooms (create / join by code)', () => {
  let server: ServerInstance | undefined;
  const clients: Client[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await server?.close();
    server = undefined;
  });

  it('host creates a code, friend joins, both are matched on opposite teams; the code is single-use', async () => {
    const s = await start();
    server = s.server;
    const host = await client(s.url);
    const friend = await client(s.url);
    const third = await client(s.url);
    clients.push(host, friend, third);

    host.send({ type: 'room/create', playerName: 'Host', theme: 'neon_grid' });
    const created = (await host.next('room/created')) as Extract<ServerMessage, { type: 'room/created' }>;
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);

    friend.send({ type: 'room/join', code: created.code.toLowerCase(), playerName: 'Friend' });
    const a = (await host.next('queue/matched')) as Extract<ServerMessage, { type: 'queue/matched' }>;
    const b = (await friend.next('queue/matched')) as Extract<ServerMessage, { type: 'queue/matched' }>;
    expect(a.roomId).toBe(b.roomId);
    expect([a.team, b.team].sort()).toEqual(['blue', 'orange']);
    expect(a.theme).toBe('neon_grid');
    expect(a.opponentName).toBe('Friend (guest)'); // guests are marked so they can't pose as registered players
    await host.next('game/snapshot'); // the authoritative room is running

    third.send({ type: 'room/join', code: created.code });
    const err = (await third.next('error')) as Extract<ServerMessage, { type: 'error' }>;
    expect(err.code).toBe('ROOM_NOT_FOUND');
  });

  it('rejects unknown codes and the host joining their own room; disconnect removes the room', async () => {
    const s = await start();
    server = s.server;
    const host = await client(s.url);
    const friend = await client(s.url);
    clients.push(host, friend);

    friend.send({ type: 'room/join', code: 'ZZZZZ' });
    expect(((await friend.next('error')) as { code?: string }).code).toBe('ROOM_NOT_FOUND');

    host.send({ type: 'room/create' });
    const { code } = (await host.next('room/created')) as Extract<ServerMessage, { type: 'room/created' }>;
    host.send({ type: 'room/join', code });
    expect(((await host.next('error')) as { code?: string }).code).toBe('OWN_ROOM');

    host.ws.close();
    await new Promise((r) => setTimeout(r, 100));
    friend.send({ type: 'room/join', code });
    expect(((await friend.next('error')) as { code?: string }).code).toBe('ROOM_NOT_FOUND');
  });
});
