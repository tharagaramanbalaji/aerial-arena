import { describe, it, expect, beforeEach } from 'vitest';
import { Matchmaker } from '../src/matchmaker.js';

describe('Matchmaker Unit Tests', () => {
  let mm: Matchmaker;

  beforeEach(() => {
    mm = new Matchmaker();
  });

  it('1. First player waits in queue', () => {
    const res = mm.join('s1', 'Alice');
    expect(res.pair).toBeUndefined();
    expect(res.ticket.socketId).toBe('s1');
    expect(res.ticket.matched).toBe(false);
    expect(mm.getQueueLength()).toBe(1);
  });

  it('2. Second distinct player pairs them atomically into one match', () => {
    mm.join('s1', 'Alice');
    const res2 = mm.join('s2', 'Bob');

    expect(res2.pair).toBeDefined();
    expect(res2.pair?.player1.socketId).toBe('s1');
    expect(res2.pair?.player2.socketId).toBe('s2');
    expect(res2.pair?.player1.team).toBe('blue');
    expect(res2.pair?.player2.team).toBe('orange');
    expect(mm.getQueueLength()).toBe(0);
  });

  it('3. Duplicate join is idempotent', () => {
    const res1 = mm.join('s1', 'Alice');
    const res2 = mm.join('s1', 'Alice');

    expect(res1.ticket.ticketId).toBe(res2.ticket.ticketId);
    expect(mm.getQueueLength()).toBe(1);
  });

  it('4. Cancel before pair prevents match', () => {
    mm.join('s1', 'Alice');
    expect(mm.getQueueLength()).toBe(1);

    const cancelled = mm.cancel('s1');
    expect(cancelled).toBe(true);
    expect(mm.getQueueLength()).toBe(0);

    // Another player joining should now wait, not pair
    const res2 = mm.join('s2', 'Bob');
    expect(res2.pair).toBeUndefined();
    expect(mm.getQueueLength()).toBe(1);
  });

  it('5. Disconnect removes ticket cleanly', () => {
    mm.join('s1', 'Alice');
    expect(mm.getQueueLength()).toBe(1);

    mm.handleDisconnect('s1');
    expect(mm.getQueueLength()).toBe(0);
  });

  it('6. Exactly two players per match, third player waits', () => {
    mm.join('s1', 'Alice');
    const res2 = mm.join('s2', 'Bob');
    expect(res2.pair).toBeDefined();

    const res3 = mm.join('s3', 'Charlie');
    expect(res3.pair).toBeUndefined();
    expect(mm.getQueueLength()).toBe(1);
  });

  it('7. Matched player cannot join a second match while active', () => {
    mm.join('s1', 'Alice');
    mm.join('s2', 'Bob');

    expect(() => mm.join('s1', 'Alice')).toThrowError('Socket already in active match');
  });
});
