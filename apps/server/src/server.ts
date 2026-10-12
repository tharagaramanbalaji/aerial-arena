import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import crypto from 'crypto';
import { ClientMessage, ServerMessage } from '@aerial-arena/shared';
import { Matchmaker } from './matchmaker.js';
import { GameRoom } from './gameRoom.js';

export interface ServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
  close(): Promise<void>;
}

export function createServer(port = 3001, host = '0.0.0.0'): ServerInstance {
  const matchmaker = new Matchmaker();
  const rooms: Map<string, GameRoom> = new Map();
  const socketToRoom: Map<string, string> = new Map();
  const sockets: Map<string, WebSocket> = new Map();

  const httpServer = http.createServer((req, res) => {
    // Health check endpoint
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          activeRooms: rooms.size,
          queuedPlayers: matchmaker.getQueueLength(),
          connectedSockets: sockets.size,
        })
      );
      return;
    }

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
            try {
              const res = matchmaker.join(socketId, msg.playerName || 'Player');
              if (res.pair) {
                // Matched! Create authoritative room
                const { pair } = res;
                const ws1 = sockets.get(pair.player1.socketId);
                const ws2 = sockets.get(pair.player2.socketId);

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
                  }
                );

                rooms.set(pair.roomId, room);
                socketToRoom.set(pair.player1.socketId, pair.roomId);
                socketToRoom.set(pair.player2.socketId, pair.roomId);

                await room.initialize();

                // Notify both players
                if (ws1 && ws1.readyState === WebSocket.OPEN) {
                  ws1.send(
                    JSON.stringify({
                      type: 'queue/matched',
                      roomId: pair.roomId,
                      token: pair.player1.token,
                      team: pair.player1.team,
                      opponentName: pair.player2.playerName,
                      theme: pair.theme,
                    })
                  );
                }

                if (ws2 && ws2.readyState === WebSocket.OPEN) {
                  ws2.send(
                    JSON.stringify({
                      type: 'queue/matched',
                      roomId: pair.roomId,
                      token: pair.player2.token,
                      team: pair.player2.team,
                      opponentName: pair.player1.playerName,
                      theme: pair.theme,
                    })
                  );
                }
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
      matchmaker.handleDisconnect(socketId);

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
