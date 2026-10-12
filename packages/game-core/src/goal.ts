import { ARENA_CONFIG, ArenaConfig, BALL_CONFIG, BallConfig, Team, Vec3 } from '@aerial-arena/shared';

export interface GoalResult {
  scored: boolean;
  scorer?: Team;
  scoringPosition?: Vec3;
}

export interface GoalDetector {
  check(prevPos: Vec3, currPos: Vec3): GoalResult;
  reset(): void;
  isGoalAwarded(): boolean;
}

export function createGoalDetector(
  arena: ArenaConfig = ARENA_CONFIG,
  ball: BallConfig = BALL_CONFIG
): GoalDetector {
  let goalAwarded = false;

  const halfL = arena.length / 2;
  const goalHalfW = arena.goalWidth / 2;
  const goalH = arena.goalHeight;
  const radiusTolerance = ball.radius * 0.25;

  const check = (prevPos: Vec3, currPos: Vec3): GoalResult => {
    if (goalAwarded) {
      return { scored: false };
    }

    // 1. Check Blue Goal (Z = -halfL, attacked by Orange team)
    // Moving from inside field (Z > -halfL) into goal (Z <= -halfL)
    if (currPos.z <= -halfL) {
      let validCrossing = false;
      let crossX = currPos.x;
      let crossY = currPos.y;

      if (prevPos.z >= -halfL) {
        // Swept plane crossing
        const dz = currPos.z - prevPos.z;
        if (Math.abs(dz) > 1e-5) {
          const t = (-halfL - prevPos.z) / dz;
          crossX = prevPos.x + (currPos.x - prevPos.x) * t;
          crossY = prevPos.y + (currPos.y - prevPos.y) * t;
        }
      }

      // Validate opening bounds: within goal frame
      const withinX = Math.abs(crossX) <= (goalHalfW - radiusTolerance);
      const withinY = crossY >= 0 && crossY <= (goalH - radiusTolerance);

      // Guard against ball outside field on the side of goal
      const withinDepth = currPos.z >= -(halfL + arena.goalDepth);

      if (withinX && withinY && withinDepth) {
        goalAwarded = true;
        return {
          scored: true,
          scorer: 'orange',
          scoringPosition: { x: crossX, y: crossY, z: -halfL },
        };
      }
    }

    // 2. Check Orange Goal (Z = halfL, attacked by Blue team)
    // Moving from inside field (Z < halfL) into goal (Z >= halfL)
    if (currPos.z >= halfL) {
      let validCrossing = false;
      let crossX = currPos.x;
      let crossY = currPos.y;

      if (prevPos.z <= halfL) {
        // Swept plane crossing
        const dz = currPos.z - prevPos.z;
        if (Math.abs(dz) > 1e-5) {
          const t = (halfL - prevPos.z) / dz;
          crossX = prevPos.x + (currPos.x - prevPos.x) * t;
          crossY = prevPos.y + (currPos.y - prevPos.y) * t;
        }
      }

      // Validate opening bounds
      const withinX = Math.abs(crossX) <= (goalHalfW - radiusTolerance);
      const withinY = crossY >= 0 && crossY <= (goalH - radiusTolerance);

      // Guard against ball outside field behind goal
      const withinDepth = currPos.z <= (halfL + arena.goalDepth);

      if (withinX && withinY && withinDepth) {
        goalAwarded = true;
        return {
          scored: true,
          scorer: 'blue',
          scoringPosition: { x: crossX, y: crossY, z: halfL },
        };
      }
    }

    return { scored: false };
  };

  const reset = () => {
    goalAwarded = false;
  };

  return {
    check,
    reset,
    isGoalAwarded: () => goalAwarded,
  };
}
