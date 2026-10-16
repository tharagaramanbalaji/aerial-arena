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

/**
 * Server-authoritative goal detection.
 *
 * Rule (as in RL): a goal counts once the *entire* ball is past the goal line,
 * i.e. the ball center crosses the plane |z| = halfLength + radius inside the goal
 * mouth. The crossing is swept between the previous and current tick so a fast
 * shot cannot tunnel past the test. A goal is awarded at most once until reset().
 */
export function createGoalDetector(
  arena: ArenaConfig = ARENA_CONFIG,
  ball: BallConfig = BALL_CONFIG
): GoalDetector {
  let goalAwarded = false;
  const lineZ = arena.halfLength + ball.radius;

  const crossesInto = (prev: Vec3, curr: Vec3, sign: 1 | -1): Vec3 | null => {
    const planeZ = sign * lineZ;
    const beyond = (p: Vec3) => (sign > 0 ? p.z >= planeZ : p.z <= planeZ);
    if (!beyond(curr)) return null;
    let cross = { x: curr.x, y: curr.y, z: planeZ };
    if (!beyond(prev)) {
      const t = (planeZ - prev.z) / (curr.z - prev.z);
      cross = { x: prev.x + (curr.x - prev.x) * t, y: prev.y + (curr.y - prev.y) * t, z: planeZ };
    }
    // The goal box only admits balls through the mouth; validate anyway so a
    // teleported / corrupted state behind the back wall cannot score.
    const inMouth = Math.abs(cross.x) <= arena.goalHalfWidth && cross.y >= 0 && cross.y <= arena.goalHeight;
    const inBox = Math.abs(curr.z) <= arena.halfLength + arena.goalDepth + ball.radius;
    return inMouth && inBox ? cross : null;
  };

  const check = (prevPos: Vec3, currPos: Vec3): GoalResult => {
    if (goalAwarded) return { scored: false };
    const intoBlue = crossesInto(prevPos, currPos, -1);
    if (intoBlue) {
      goalAwarded = true;
      return { scored: true, scorer: 'orange', scoringPosition: intoBlue };
    }
    const intoOrange = crossesInto(prevPos, currPos, 1);
    if (intoOrange) {
      goalAwarded = true;
      return { scored: true, scorer: 'blue', scoringPosition: intoOrange };
    }
    return { scored: false };
  };

  return {
    check,
    reset: () => {
      goalAwarded = false;
    },
    isGoalAwarded: () => goalAwarded,
  };
}
