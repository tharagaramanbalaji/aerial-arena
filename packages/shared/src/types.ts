export type MatchPhase =
  | 'queued'
  | 'waitingForOpponent'
  | 'countdown'
  | 'active'
  | 'goalPause'
  | 'overtimeCountdown'
  | 'overtime'
  | 'ended'
  | 'closed';

export type Team = 'blue' | 'orange';

export type ArenaTheme = 'foundry' | 'neon_grid' | 'coastal_dome';

export interface PlayerInput {
  seq: number;
  timestamp: number;
  throttle: number; // -1 (reverse/brake) to 1 (accelerate)
  steer: number;    // -1 (left) to 1 (right)
  pitch: number;    // -1 (pitch down/forward) to 1 (pitch up/back)
  yaw: number;      // -1 (yaw left) to 1 (yaw right)
  roll: number;     // -1 (roll left) to 1 (roll right)
  jump: boolean;    // edge trigger
  jumpHeld: boolean;// true while jump button is held
  boost: boolean;   // true while boost button is held
  powerslide: boolean;
}

export interface TransformSnapshot {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  vx: number;
  vy: number;
  vz: number;
  wx: number;
  wy: number;
  wz: number;
}

export interface PlayerStateSnapshot {
  id: string;
  team: Team;
  transform: TransformSnapshot;
  boost: number;
  isGrounded: boolean;
  isBoosting: boolean;
  isDodging: boolean;
  score: number;
  lastInputSeq: number;
}

export interface BallStateSnapshot {
  transform: TransformSnapshot;
}

export interface BoostPadSnapshot {
  id: number;
  active: boolean;
  cooldownRemaining: number;
}

export interface GameSnapshot {
  seq: number;
  tick: number;
  serverTime: number;
  phase: MatchPhase;
  countdown: number;
  timerRemaining: number;
  blueScore: number;
  orangeScore: number;
  players: Record<string, PlayerStateSnapshot>;
  ball: BallStateSnapshot;
  pads: BoostPadSnapshot[];
  lastScorer?: Team;
}

// Client -> Server messages
export type ClientMessage =
  | { type: 'queue/join'; playerName?: string }
  | { type: 'queue/cancel' }
  | { type: 'game/input'; input: PlayerInput }
  | { type: 'game/reconnect'; roomId: string; token: string }
  | { type: 'game/leave' }
  | { type: 'ping'; clientTime: number };

// Server -> Client messages
export type ServerMessage =
  | { type: 'queue/waiting'; ticketId: string; queuePosition: number }
  | { type: 'queue/matched'; roomId: string; token: string; team: Team; opponentName: string; theme: ArenaTheme }
  | { type: 'queue/cancelled' }
  | { type: 'game/snapshot'; snapshot: GameSnapshot }
  | { type: 'game/phase'; phase: MatchPhase; countdown?: number; timerRemaining?: number }
  | { type: 'game/goal'; scorer: Team; blueScore: number; orangeScore: number }
  | { type: 'game/result'; winner: Team | 'forfeit_blue' | 'forfeit_orange'; blueScore: number; orangeScore: number; reason?: string }
  | { type: 'game/reconnected'; team: Team; theme: ArenaTheme }
  | { type: 'game/opponent_disconnected'; graceRemainingSec: number }
  | { type: 'game/opponent_reconnected' }
  | { type: 'pong'; clientTime: number; serverTime: number }
  | { type: 'error'; message: string; code?: string };
