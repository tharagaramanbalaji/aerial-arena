import { describe, it, expect } from 'vitest';
import { createMatchStateMachine } from '../src/matchStateMachine.js';

describe('Match State Machine & Rules', () => {
  it('1. Countdown starts at 3s and transitions to active', () => {
    const sm = createMatchStateMachine();
    expect(sm.phase).toBe('countdown');
    expect(sm.countdownTimer).toBe(3);

    // Step 2 seconds
    sm.update(2.0, false);
    expect(sm.phase).toBe('countdown');
    expect(sm.countdownTimer).toBeCloseTo(1.0, 1);

    // Step another 1.1 seconds
    const events = sm.update(1.1, false);
    expect(sm.phase).toBe('active');
    expect(events.some((e) => e.type === 'phase_change' && e.phase === 'active')).toBe(true);
  });

  it('2. Goal during regulation increments score and pauses for reset', () => {
    const sm = createMatchStateMachine();
    sm.update(3.0, false); // finish countdown -> active

    const events = sm.update(1.0, false, { scorer: 'blue' });
    expect(sm.blueScore).toBe(1);
    expect(sm.orangeScore).toBe(0);
    expect(sm.phase).toBe('goalPause');
    expect(events.some((e) => e.type === 'score_update' && e.scorer === 'blue')).toBe(true);

    // Goal pause (3s)
    sm.update(3.0, false);
    expect(sm.phase).toBe('countdown');
    // Score preserved during reset
    expect(sm.blueScore).toBe(1);
  });

  it('3. Timer cutoff at 0:00 keeps play alive until ball is grounded', () => {
    const sm = createMatchStateMachine();
    sm.update(3.0, false); // active

    // Simulate clock reaching 0:00 (300 seconds)
    sm.update(300, false);
    expect(sm.timerRemaining).toBe(0);
    // Ball is airborne -> match still active!
    expect(sm.phase).toBe('active');

    // Score is 1-0 for blue
    sm.update(0.1, false, { scorer: 'blue' });
    sm.update(3.0, false); // goal pause
    sm.update(3.0, false); // countdown

    // Ball hits ground after 0:00 with unequal score
    const events = sm.update(0.1, true); // ball grounded
    expect(sm.phase).toBe('ended');
    expect(sm.winner).toBe('blue');
  });

  it('4. Tied game at 0:00 triggers sudden-death overtime', () => {
    const sm = createMatchStateMachine();
    sm.update(3.0, false); // active
    sm.update(300, false); // time 0:00, score 0-0

    // Ball hits ground with tied score -> overtime countdown
    const events = sm.update(0.1, true);
    expect(sm.phase).toBe('overtimeCountdown');

    // Countdown 3s to overtime
    sm.update(3.0, false);
    expect(sm.phase).toBe('overtime');

    // First goal in overtime ends match immediately
    const otEvents = sm.update(5.0, false, { scorer: 'orange' });
    expect(sm.phase).toBe('ended');
    expect(sm.orangeScore).toBe(1);
    expect(sm.winner).toBe('orange');
  });

  it('5. Forfeit safely ends match and awards winner', () => {
    const sm = createMatchStateMachine();
    sm.update(3.0, false); // active

    const events = sm.forfeit('blue');
    expect(sm.phase).toBe('ended');
    expect(sm.winner).toBe('forfeit_blue');
  });
});
