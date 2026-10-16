import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { ArenaTheme, ClientMessage, ServerMessage } from '@aerial-arena/shared';
import { MatchedPair, Matchmaker } from './matchmaker.js';
import { AuthUser, PlayerStore } from './db.js';
import { GameRoom } from './gameRoom.js';

export interface ServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
  close(): Promise<void>;
}

export function createServer(port = 3001, host = '0.0.0.0', store?: PlayerStore): ServerInstance {
  void port;
  void host;
  const matchmaker = new Matchmaker();
  const rooms: Map<string, GameRoom> = new Map();
  const socketToRoom: Map<string, string> = new Map();
  const sockets: Map<string, WebSocket> = new Map();
  const socketUser: Map<string, AuthUser> = new Map(); // logged-in identity per socket

  /** Resolve the player's identity: logged-in username, or a guest name. */
  const identify = async (socketId: string, authToken?: string, fallback?: string): Promise<string> => {
    let user: AuthUser | null = null;
    try {
      user = store && authToken ? await store.userForToken(authToken) : null;
    } catch (err) {
      console.error('[accounts] token lookup failed; continuing as guest', err);
    }
    if (user) {
      socketUser.set(socketId, user);
      return user.username;
    }
    socketUser.delete(socketId);
    const clean = String(fallback ?? '').replace(/[^A-Za-z0-9_ ]/g, '').slice(0, 16);
    return clean && clean !== 'Player' ? `${clean} (guest)` : 'Guest';
  };

  // ---- Private rooms: host creates a short code, a friend joins with it ----
  interface PrivateRoom { code: string; hostSocketId: string; hostName: string; theme: ArenaTheme; createdAt: number }
  const privateRooms: Map<string, PrivateRoom> = new Map(); // code -> room
  const codeBySocket: Map<string, string> = new Map(); // host socketId -> code
  const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 look-alikes
  const PRIVATE_ROOM_TTL_MS = 15 * 60 * 1000;
  const THEMES: ArenaTheme[] = ['coastal_dome', 'foundry', 'neon_grid'];

  const newRoomCode = (): string => {
    for (;;) {
      let code = '';
      for (let i = 0; i < 5; i++) code += ROOM_CODE_CHARS[crypto.randomInt(ROOM_CODE_CHARS.length)];
      if (!privateRooms.has(code)) return code;
    }
  };
  const removePrivateRoom = (code: string) => {
    const r = privateRooms.get(code);
    if (!r) return;
    privateRooms.delete(code);
    codeBySocket.delete(r.hostSocketId);
  };
  const sweepExpiredRooms = () => {
    const now = Date.now();
    for (const r of privateRooms.values()) if (now - r.createdAt > PRIVATE_ROOM_TTL_MS) removePrivateRoom(r.code);
  };

  /** Create the authoritative room for a pair and notify both players (queue or private room). */
  const startMatch = async (pair: MatchedPair) => {
    const ws1 = sockets.get(pair.player1.socketId);
    const ws2 = sockets.get(pair.player2.socketId);
    // Capture accounts now: sockets may disconnect before the match ends.
    const accounts = [
      { user: socketUser.get(pair.player1.socketId), team: pair.player1.team },
      { user: socketUser.get(pair.player2.socketId), team: pair.player2.team },
    ];
    const room = new GameRoom(
      pair.roomId,
      pair.theme,
      { ...pair.player1, ws: ws1 },
      { ...pair.player2, ws: ws2 },
      (closedRoomId) => {
        rooms.delete(closedRoomId);
        matchmaker.releasePlayer(pair.player1.socketId);
        matchmaker.releasePlayer(pair.player2.socketId);
        socketToRoom.delete(pair.player1.socketId);
        socketToRoom.delete(pair.player2.socketId);
      },
      (winner, blueScore, orangeScore) => {
        if (!store) return;
        const winTeam = winner === 'forfeit_blue' ? 'orange' : winner === 'forfeit_orange' ? 'blue' : winner;
        for (const a of accounts) {
          if (!a.user) continue;
          const mine = a.team === 'blue' ? blueScore : orangeScore;
          const theirs = a.team === 'blue' ? orangeScore : blueScore;
          store
            .recordMatch(a.user.id, { won: a.team === winTeam, goalsFor: mine, goalsAgainst: theirs, vsBot: false })
            .catch((err) => console.error('[accounts] failed to record match', err));
        }
      }
    );
    rooms.set(pair.roomId, room);
    socketToRoom.set(pair.player1.socketId, pair.roomId);
    socketToRoom.set(pair.player2.socketId, pair.roomId);
    await room.initialize();
    for (const [me, other, sock] of [
      [pair.player1, pair.player2, ws1],
      [pair.player2, pair.player1, ws2],
    ] as const) {
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify({
          type: 'queue/matched', roomId: pair.roomId, token: me.token, team: me.team,
          opponentName: other.playerName, theme: pair.theme,
        } satisfies ServerMessage));
      }
    }
  };

  // ---- Optional static hosting of the built client (single-service deployment) ----
  const here = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(process.env.CLIENT_DIST ?? path.join(here, '../../client/dist'));
  const serveClient = fs.existsSync(path.join(clientDist, 'index.html'));
  const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
    '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
  };
  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse): boolean => {
    if (!serveClient || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname);
    } catch {
      return false;
    }
    let file = path.resolve(clientDist, '.' + urlPath);
    if (!file.startsWith(clientDist)) {
      res.writeHead(403);
      res.end();
      return true;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(clientDist, 'index.html'); // SPA fallback
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') res.end();
    else fs.createReadStream(file).pipe(res);
    return true;
  };

  // ---- Accounts API (JSON). CORS is open because auth uses bearer tokens, not cookies. ----
  const attempts: Map<string, { n: number; reset: number }> = new Map();
  const rateLimited = (ip: string): boolean => {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || a.reset < now) {
      attempts.set(ip, { n: 1, reset: now + 60_000 });
      return false;
    }
    a.n++;
    return a.n > 10; // 10 login/register attempts per minute per IP
  };
  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    res.end(status === 204 ? undefined : JSON.stringify(body));
  };
  const readJson = (req: http.IncomingMessage): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > 4096) {
          reject(new Error('Request too large'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {};
          resolve(v && typeof v === 'object' ? v : {});
        } catch {
          reject(new Error('Invalid JSON'));
        }
      });
      req.on('error', reject);
    });
  const bearer = (req: http.IncomingMessage) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '') || null;

  const handleApi = async (req: http.IncomingMessage, res: http.ServerResponse, route: string): Promise<void> => {
    if (req.method === 'OPTIONS') return json(res, 204, null);
    if (!store) return json(res, 503, { error: 'Accounts are not enabled on this server' });
    const ip = req.socket.remoteAddress ?? 'unknown';
    try {
      if (req.method === 'POST' && (route === 'register' || route === 'login')) {
        if (rateLimited(ip)) return json(res, 429, { error: 'Too many attempts, wait a minute' });
        const body = await readJson(req);
        const username = String(body.username ?? '').trim();
        const password = String(body.password ?? '');
        const r = route === 'register' ? await store.register(username, password) : await store.login(username, password);
        if (!r.ok) return json(res, route === 'login' ? 401 : 400, { error: r.error });
        return json(res, 200, { token: r.token, profile: await store.profile(r.user.id) });
      }
      if (req.method === 'POST' && route === 'logout') {
        const t = bearer(req);
        if (t) await store.logout(t);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && route === 'me') {
        const user = await store.userForToken(bearer(req));
        if (!user) return json(res, 401, { error: 'Not logged in' });
        return json(res, 200, { profile: await store.profile(user.id) });
      }
      if (req.method === 'GET' && route === 'leaderboard') {
        return json(res, 200, { players: await store.leaderboard(10) });
      }
      if (req.method === 'POST' && route === 'bot-result') {
        const user = await store.userForToken(bearer(req));
        if (!user) return json(res, 401, { error: 'Not logged in' });
        const body = await readJson(req);
        await store.recordMatch(user.id, { won: body.won === true, goalsFor: Number(body.goalsFor), goalsAgainst: Number(body.goalsAgainst), vsBot: true });
        return json(res, 200, { profile: await store.profile(user.id) });
      }
      return json(res, 404, { error: 'Unknown endpoint' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === 'Request too large' || msg === 'Invalid JSON') return json(res, 400, { error: msg });
      console.error('[accounts] API error', err);
      return json(res, 500, { error: 'Server error, try again' }); // never leak database details
    }
  };

  const httpServer = http.createServer((req, res) => {
    const apiMatch = /^\/api\/([a-z-]+)\/?(?:\?.*)?$/.exec(req.url ?? '');
    if (apiMatch) {
      void handleApi(req, res, apiMatch[1]);
      return;
    }
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          activeRooms: rooms.size,
          privateRoomsWaiting: privateRooms.size,
          queuedPlayers: matchmaker.getQueueLength(),
          connectedSockets: sockets.size,
        })
      );
      return;
    }

    if (serveStatic(req, res)) return;
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws: WebSocket) => {
    const socketId = crypto.randomUUID();
    sockets.set(socketId, ws);

    const send = (msg: ServerMessage) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    ws.on('message', async (data: Buffer | string) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf-8');
        const msg = JSON.parse(text) as ClientMessage;

        switch (msg.type) {
          case 'ping': {
            send({
              type: 'pong',
              clientTime: msg.clientTime,
              serverTime: Date.now(),
            });
            break;
          }

          case 'queue/join': {
            const name = await identify(socketId, msg.authToken, msg.playerName);
            if (socketToRoom.has(socketId) || codeBySocket.has(socketId)) {
              send({ type: 'error', message: 'Already in a match or hosting a private room', code: 'BUSY' });
              break;
            }
            try {
              const res = matchmaker.join(socketId, name);
              if (res.pair) {
                await startMatch(res.pair);
              } else {
                send({
                  type: 'queue/waiting',
                  ticketId: res.ticket.ticketId,
                  queuePosition: 1,
                });
              }
            } catch (err: unknown) {
              const errorMessage = err instanceof Error ? err.message : 'Queue error';
              send({ type: 'error', message: errorMessage });
            }
            break;
          }

          case 'queue/cancel': {
            const cancelled = matchmaker.cancel(socketId);
            if (cancelled) {
              send({ type: 'queue/cancelled' });
            }
            break;
          }

          case 'room/create': {
            const hostName = await identify(socketId, msg.authToken, msg.playerName);
            if (socketToRoom.has(socketId)) {
              send({ type: 'error', message: 'Already in a match', code: 'BUSY' });
              break;
            }
            sweepExpiredRooms();
            matchmaker.cancel(socketId); // leave the public queue if needed
            const existing = codeBySocket.get(socketId);
            if (existing) removePrivateRoom(existing);
            const code = newRoomCode();
            const theme = msg.theme && THEMES.includes(msg.theme) ? msg.theme : THEMES[crypto.randomInt(THEMES.length)];
            privateRooms.set(code, { code, hostSocketId: socketId, hostName, theme, createdAt: Date.now() });
            codeBySocket.set(socketId, code);
            send({ type: 'room/created', code, expiresInSec: PRIVATE_ROOM_TTL_MS / 1000 });
            break;
          }

          case 'room/join': {
            const guestName = await identify(socketId, msg.authToken, msg.playerName);
            sweepExpiredRooms();
            const code = String(msg.code ?? '').trim().toUpperCase();
            const pr = privateRooms.get(code);
            if (!pr) {
              send({ type: 'error', message: `Room ${code || '?'} not found or expired`, code: 'ROOM_NOT_FOUND' });
              break;
            }
            if (pr.hostSocketId === socketId) {
              send({ type: 'error', message: 'You are the host of this room; share the code with a friend', code: 'OWN_ROOM' });
              break;
            }
            if (socketToRoom.has(socketId)) {
              send({ type: 'error', message: 'Already in a match', code: 'BUSY' });
              break;
            }
            if (!sockets.has(pr.hostSocketId)) {
              removePrivateRoom(code);
              send({ type: 'error', message: 'The host has left this room', code: 'ROOM_NOT_FOUND' });
              break;
            }
            removePrivateRoom(code); // consumed exactly once
            matchmaker.cancel(socketId);
            const pair: MatchedPair = {
              roomId: crypto.randomUUID(),
              theme: pr.theme,
              player1: { socketId: pr.hostSocketId, ticketId: `private-${code}-host`, playerName: pr.hostName, team: 'blue', token: crypto.randomUUID() },
              player2: { socketId, ticketId: `private-${code}-guest`, playerName: guestName, team: 'orange', token: crypto.randomUUID() },
            };
            await startMatch(pair);
            break;
          }

          case 'room/cancel': {
            const code = codeBySocket.get(socketId);
            if (code) removePrivateRoom(code);
            send({ type: 'room/cancelled' });
            break;
          }

          case 'game/input': {
            const roomId = socketToRoom.get(socketId);
            if (roomId) {
              const room = rooms.get(roomId);
              if (room) {
                room.handleInput(socketId, msg.input);
              }
            }
            break;
          }

          case 'game/reconnect': {
            const room = rooms.get(msg.roomId);
            if (room) {
              const ok = room.handleReconnect(msg.token, socketId, ws);
              if (ok) {
                socketToRoom.set(socketId, msg.roomId);
              } else {
                send({ type: 'error', message: 'Invalid or expired reconnect token' });
              }
            } else {
              send({ type: 'error', message: 'Room not found or already closed' });
            }
            break;
          }

          case 'game/leave': {
            const roomId = socketToRoom.get(socketId);
            if (roomId) {
              const room = rooms.get(roomId);
              if (room) {
                room.handleDisconnect(socketId);
                socketToRoom.delete(socketId);
              }
            }
            break;
          }

          default:
            break;
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : 'Invalid message format';
        send({ type: 'error', message: errorMsg });
      }
    });

    ws.on('close', () => {
      sockets.delete(socketId);
      socketUser.delete(socketId);
      matchmaker.handleDisconnect(socketId);
      const hostedCode = codeBySocket.get(socketId);
      if (hostedCode) removePrivateRoom(hostedCode);

      const roomId = socketToRoom.get(socketId);
      if (roomId) {
        const room = rooms.get(roomId);
        if (room) {
          room.handleDisconnect(socketId);
        }
        socketToRoom.delete(socketId);
      }
    });
  });

  const close = (): Promise<void> => {
    return new Promise((resolve) => {
      for (const room of rooms.values()) {
        room.destroy();
      }
      wss.close(() => {
        httpServer.close(() => {
          resolve();
        });
      });
    });
  };

  return {
    httpServer,
    wss,
    close,
  };
}
