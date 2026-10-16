import { describe, it, expect, afterEach } from 'vitest';
import { GameRoom } from '../src/gameRoom.js';
import { PlayerInput } from '@aerial-arena/shared';

describe('GameRoom Authoritative Simulation Tests', () => {
  let room: GameRoom;

  afterEach(() => {
    if (room) room.destroy();
  });

  it('1. Initializes room with mirrored spawns for Blue and Orange', async () => {
    room = new GameRoom(
      'room-1',
      'foundry',
      { socketId: 's1', playerName: 'P1', team: 'blue', token: 'tok-1' },
      { socketId: 's2', playerName: 'P2', team: 'orange', token: 'tok-2' }
    );

    await room.initialize();
    expect(room.getPhase()).toBe('countdown');
    expect(room.getScore()).toEqual({ blue: 0, orange: 0 });
  });

  it('2. Discards stale or non-finite inputs', async () => {
    room = new GameRoom(
      'room-2',
      'neon_grid',
      { socketId: 's1', playerName: 'P1', team: 'blue', token: 'tok-1' },
      { socketId: 's2', playerName: 'P2', team: 'orange', token: 'tok-2' }
    );
    await room.initialize();

    const p1 = room.getPlayerBySocket('s1');
    expect(p1).toBeDefined();

    // Valid input with seq 1
    const input1: PlayerInput = {
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
    };
    room.handleInput('s1', input1);
    expect(p1?.lastInputSeq).toBe(1);

    // Stale sequence number (seq 1 again) -> should be discarded
    room.handleInput('s1', { ...input1, throttle: -1.0 });
    expect(p1?.lastInputSeq).toBe(1);

    // Non-finite input (NaN, Infinity) should be clamped to 0
    const crazyInput: PlayerInput = {
      ...input1,
      seq: 2,
      throttle: Infinity as unknown as number,
      steer: NaN as unknown as number,
    };
    room.handleInput('s1', crazyInput);
    expect(p1?.lastInputSeq).toBe(2);
  });

  it('3. Reconnect succeeds only with valid unexpired token', async () => {
    room = new GameRoom(
      'room-3',
      'coastal_dome',
      { socketId: 's1', playerName: 'P1', team: 'blue', token: 'tok-valid' },
      { socketId: 's2', playerName: 'P2', team: 'orange', token: 'tok-p2' }
    );
    await room.initialize();

    // Simulate disconnect of s1
    room.handleDisconnect('s1');
    const p1 = room.getPlayerByToken('tok-valid');
    expect(p1?.connected).toBe(false);

    // Mock WebSocket
    const mockWs = { send: () => {} } as any;

    // Try reconnect with invalid token
    const fail = room.handleReconnect('tok-fake', 's1-new', mockWs);
    expect(fail).toBe(false);

    // Try reconnect with valid token
    const ok = room.handleReconnect('tok-valid', 's1-new', mockWs);
    expect(ok).toBe(true);
    expect(p1?.connected).toBe(true);
    expect(p1?.socketId).toBe('s1-new');
  });

  it('4. Closed room frees resources without leaking', async () => {
    let closedCalled = false;
    room = new GameRoom(
      'room-4',
      'foundry',
      { socketId: 's1', playerName: 'P1', team: 'blue', token: 'tok-1' },
      { socketId: 's2', playerName: 'P2', team: 'orange', token: 'tok-2' },
      () => { closedCalled = true; }
    );
    await room.initialize();
    room.destroy();
    expect(closedCalled).toBe(true);
  });
  it('treats a stalled client (no input for >250 ms) as neutral instead of replaying held keys', async () => {
    room = new GameRoom(
      'room-stale',
      'coastal_dome',
      { socketId: 's1', playerName: 'P1', team: 'blue', token: 'tok-1' },
      { socketId: 's2', playerName: 'P2', team: 'orange', token: 'tok-2' }
    );
    await room.initialize();
    const internals = room as unknown as {
      loopInterval?: NodeJS.Timeout;
      sm: { update(dt: number, ballGrounded: boolean): unknown };
      sim: { cars: Map<string, { getTransform(): { vz: number } }> };
      tick(dt: number): void;
    };
    clearInterval(internals.loopInterval); // drive ticks manually
    internals.sm.update(3.1, false); // skip the kickoff countdown

    room.handleInput('s1', {
      seq: 1, timestamp: Date.now(), throttle: 1, steer: 0, pitch: 0, yaw: 0, roll: 0,
      jump: false, jumpHeld: false, boost: true, powerslide: false,
    });
    for (let i = 0; i < 30; i++) internals.tick(1 / 60);
    const car = internals.sim.cars.get('s1')!;
    const vDriving = car.getTransform().vz;
    expect(vDriving).toBeGreaterThan(5);

    room.getPlayerBySocket('s1')!.lastInputAt = Date.now() - 1000; // client went silent
    for (let i = 0; i < 30; i++) internals.tick(1 / 60);
    expect(car.getTransform().vz).toBeLessThan(vDriving); // coasting, not boosting
  });
});
