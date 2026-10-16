import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { createServer, ServerInstance } from '../src/server.js';
import { ServerMessage } from '@aerial-arena/shared';

describe('E2E Two-Client Real-Time Multiplayer Integration', () => {
  let server: ServerInstance;
  const PORT = 3099;
  const WS_URL = `ws://localhost:${PORT}`;

  beforeAll(async () => {
    server = createServer(PORT);
    await new Promise<void>((resolve) => {
      server.httpServer.listen(PORT, 'localhost', () => {
        resolve();
      });
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('Two distinct WebSocket clients connect, pair via queue, receive snapshots, and drive cars', async () => {
    const ws1 = new WebSocket(WS_URL);
    const ws2 = new WebSocket(WS_URL);

    // Wait for both sockets to open
    await Promise.all([
      new Promise((resolve) => ws1.on('open', resolve)),
      new Promise((resolve) => ws2.on('open', resolve)),
    ]);

    const messages1: ServerMessage[] = [];
    const messages2: ServerMessage[] = [];

    ws1.on('message', (data) => {
      messages1.push(JSON.parse(data.toString()));
    });

    ws2.on('message', (data) => {
      messages2.push(JSON.parse(data.toString()));
    });

    // Client 1 joins queue
    ws1.send(JSON.stringify({ type: 'queue/join', playerName: 'Player1' }));

    // Wait 100ms
    await new Promise((r) => setTimeout(r, 100));
    expect(messages1.some((m) => m.type === 'queue/waiting')).toBe(true);

    // Client 2 joins queue -> Pairs both clients!
    ws2.send(JSON.stringify({ type: 'queue/join', playerName: 'Player2' }));

    // Wait for match creation
    await new Promise((r) => setTimeout(r, 300));

    const matched1 = messages1.find((m) => m.type === 'queue/matched');
    const matched2 = messages2.find((m) => m.type === 'queue/matched');

    expect(matched1).toBeDefined();
    expect(matched2).toBeDefined();

    if (matched1?.type === 'queue/matched' && matched2?.type === 'queue/matched') {
      expect(matched1.roomId).toBe(matched2.roomId);
      expect(matched1.team).toBe('blue');
      expect(matched2.team).toBe('orange');
      expect(matched1.opponentName).toBe('Player2 (guest)');
      expect(matched2.opponentName).toBe('Player1 (guest)');
    }

    // Both clients send drive inputs
    ws1.send(
      JSON.stringify({
        type: 'game/input',
        input: {
          seq: 1,
          timestamp: Date.now(),
          throttle: 1.0,
          steer: 0,
          pitch: 0,
          yaw: 0,
          roll: 0,
          jump: false,
          jumpHeld: false,
          boost: false,
          powerslide: false,
        },
      })
    );

    ws2.send(
      JSON.stringify({
        type: 'game/input',
        input: {
          seq: 1,
          timestamp: Date.now(),
          throttle: 1.0,
          steer: 0,
          pitch: 0,
          yaw: 0,
          roll: 0,
          jump: false,
          jumpHeld: false,
          boost: false,
          powerslide: false,
        },
      })
    );

    // Wait for snapshots
    await new Promise((r) => setTimeout(r, 500));

    const snapshots = messages1.filter((m) => m.type === 'game/snapshot');
    expect(snapshots.length).toBeGreaterThan(5);

    const latestSnap = snapshots[snapshots.length - 1];
    if (latestSnap?.type === 'game/snapshot') {
      expect(latestSnap.snapshot.phase).toBeDefined();
      expect(latestSnap.snapshot.ball.transform.y).toBeGreaterThan(0);
      expect(Object.keys(latestSnap.snapshot.players).length).toBe(2);
    }

    ws1.close();
    ws2.close();
  });
});
