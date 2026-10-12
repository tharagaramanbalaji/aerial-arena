import { MATCH_CONFIG, MatchPhase, Team } from '@aerial-arena/shared';

export interface MatchStateEvent {
  type: 'phase_change' | 'score_update' | 'match_end';
  phase?: MatchPhase;
  scorer?: Team;
  winner?: Team | 'forfeit_blue' | 'forfeit_orange';
  blueScore: number;
  orangeScore: number;
}

export interface MatchStateMachine {
  phase: MatchPhase;
  blueScore: number;
  orangeScore: number;
  timerRemaining: number;
  countdownTimer: number;
  pauseTimer: number;
  winner?: Team | 'forfeit_blue' | 'forfeit_orange';
  lastScorer?: Team;
  update(
    dt: number,
    isBallGrounded: boolean,
    goalEvent?: { scorer: Team }
  ): MatchStateEvent[];
  forfeit(team: Team): MatchStateEvent[];
  resetMatch(): void;
}

export function createMatchStateMachine(): MatchStateMachine {
  let phase: MatchPhase = 'countdown';
  let blueScore = 0;
  let orangeScore = 0;
  let timerRemaining = MATCH_CONFIG.regulationDurationSec; // 300s
  let countdownTimer = MATCH_CONFIG.kickoffCountdownSec;   // 3s
  let pauseTimer = 0;
  let winner: Team | 'forfeit_blue' | 'forfeit_orange' | undefined;
  let lastScorer: Team | undefined;

  const forfeit = (team: Team): MatchStateEvent[] => {
    if (phase === 'ended' || phase === 'closed') return [];
    phase = 'ended';
    winner = team === 'blue' ? 'forfeit_blue' : 'forfeit_orange';
    return [
      {
        type: 'match_end',
        winner,
        blueScore,
        orangeScore,
      },
    ];
  };

  const resetMatch = () => {
    phase = 'countdown';
    blueScore = 0;
    orangeScore = 0;
    timerRemaining = MATCH_CONFIG.regulationDurationSec;
    countdownTimer = MATCH_CONFIG.kickoffCountdownSec;
    pauseTimer = 0;
    winner = undefined;
    lastScorer = undefined;
  };

  const update = (
    dt: number,
    isBallGrounded: boolean,
    goalEvent?: { scorer: Team }
  ): MatchStateEvent[] => {
    const events: MatchStateEvent[] = [];

    switch (phase) {
      case 'countdown': {
        countdownTimer -= dt;
        if (countdownTimer <= 0) {
          phase = 'active';
          countdownTimer = 0;
          events.push({
            type: 'phase_change',
            phase: 'active',
            blueScore,
            orangeScore,
          });
        }
        break;
      }

      case 'active': {
        // Clock decreases during active play
        if (timerRemaining > 0) {
          timerRemaining = Math.max(0, timerRemaining - dt);
        }

        // Goal scoring check
        if (goalEvent) {
          lastScorer = goalEvent.scorer;
          if (goalEvent.scorer === 'blue') {
            blueScore++;
          } else {
            orangeScore++;
          }
          events.push({
            type: 'score_update',
            scorer: goalEvent.scorer,
            blueScore,
            orangeScore,
          });

          // Check if regulation time has expired at the moment of the goal
          if (timerRemaining <= 0) {
            // Overtime check or win check
            if (blueScore !== orangeScore) {
              phase = 'ended';
              winner = blueScore > orangeScore ? 'blue' : 'orange';
              events.push({
                type: 'match_end',
                winner,
                blueScore,
                orangeScore,
              });
              return events;
            } else {
              // Tied at buzzer -> sudden-death overtime
              phase = 'overtimeCountdown';
              countdownTimer = MATCH_CONFIG.kickoffCountdownSec;
              events.push({
                type: 'phase_change',
                phase: 'overtimeCountdown',
                blueScore,
                orangeScore,
              });
              return events;
            }
          }

          // Normal regulation goal -> pause briefly then kickoff
          phase = 'goalPause';
          pauseTimer = MATCH_CONFIG.goalPauseDurationSec;
          events.push({
            type: 'phase_change',
            phase: 'goalPause',
            blueScore,
            orangeScore,
          });
          return events;
        }

        // Clock reached zero check: keep play alive until ball hits the floor
        if (timerRemaining <= 0 && isBallGrounded) {
          if (blueScore !== orangeScore) {
            phase = 'ended';
            winner = blueScore > orangeScore ? 'blue' : 'orange';
            events.push({
              type: 'match_end',
              winner,
              blueScore,
              orangeScore,
            });
          } else {
            // Tied game -> Sudden death overtime!
            phase = 'overtimeCountdown';
            countdownTimer = MATCH_CONFIG.kickoffCountdownSec;
            events.push({
              type: 'phase_change',
              phase: 'overtimeCountdown',
              blueScore,
              orangeScore,
            });
          }
        }
        break;
      }

      case 'goalPause': {
        pauseTimer -= dt;
        if (pauseTimer <= 0) {
          phase = 'countdown';
          countdownTimer = MATCH_CONFIG.kickoffCountdownSec;
          events.push({
            type: 'phase_change',
            phase: 'countdown',
            blueScore,
            orangeScore,
          });
        }
        break;
      }

      case 'overtimeCountdown': {
        countdownTimer -= dt;
        if (countdownTimer <= 0) {
          phase = 'overtime';
          countdownTimer = 0;
          events.push({
            type: 'phase_change',
            phase: 'overtime',
            blueScore,
            orangeScore,
          });
        }
        break;
      }

      case 'overtime': {
        // Sudden death: first goal wins!
        if (goalEvent) {
          lastScorer = goalEvent.scorer;
          if (goalEvent.scorer === 'blue') {
            blueScore++;
            winner = 'blue';
          } else {
            orangeScore++;
            winner = 'orange';
          }
          phase = 'ended';
          events.push({
            type: 'score_update',
            scorer: goalEvent.scorer,
            blueScore,
            orangeScore,
          });
          events.push({
            type: 'match_end',
            winner,
            blueScore,
            orangeScore,
          });
        }
        break;
      }

      case 'ended':
      case 'closed':
      default:
        break;
    }

    return events;
  };

  return {
    get phase() { return phase; },
    get blueScore() { return blueScore; },
    get orangeScore() { return orangeScore; },
    get timerRemaining() { return timerRemaining; },
    get countdownTimer() { return countdownTimer; },
    get pauseTimer() { return pauseTimer; },
    get winner() { return winner; },
    get lastScorer() { return lastScorer; },
    update,
    forfeit,
    resetMatch,
  };
}
