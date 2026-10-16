import { WebSocket } from 'ws';
import {
  ArenaTheme,
  BALL_CONFIG,
  GameEvent,
  GameSnapshot,
  MATCH_CONFIG,
  MatchPhase,
  PlayerInput,
  ServerMessage,
  Team,
  clamp,
} from '@aerial-arena/shared';
import {
  GameSimulation,
  MatchStateMachine,
  createGameSimulation,
  createMatchStateMachine,
} from '@aerial-arena/game-core';

export interface PlayerSession {
  playerId: string;
  socketId: string;
  playerName: string;
  team: Team;
  token: string;
  ws?: WebSocket;
  connected: boolean;
  disconnectTimer?: NodeJS.Timeout;
  lastInputSeq: number;
  inputCountThisSec: number;
  lastInputSecTimestamp: number;
  /** Wall-clock ms of the last accepted input packet. */
  lastInputAt: number;
}

/** Inputs older than this are treated as neutral (client stalled, tab hidden, packet loss). */
const INPUT_STALE_MS = 250;

export class GameRoom {
  public readonly roomId: string;
  public readonly theme: ArenaTheme;
  public readonly createdAt: number;

  private sim!: GameSimulation;
  private sm: MatchStateMachine;
  private players: Map<string, PlayerSession> = new Map(); // token -> session
  private socketToToken: Map<string, string> = new Map(); // socketId -> token

  private loopInterval?: NodeJS.Timeout;
  private snapshotSeq = 0;
  private lastSnapshotTick = 0;
  private pendingEvents: GameEvent[] = [];
  private isDestroyed = false;
  private onRoomClosed?: (roomId: string) => void;
  private onMatchResult?: (winner: Team | 'forfeit_blue' | 'forfeit_orange', blueScore: number, orangeScore: number) => void;
  private resultReported = false;

  /** Report the final result exactly once (normal end or forfeit). */
  private reportResult(winner: Team | 'forfeit_blue' | 'forfeit_orange', blue: number, orange: number): void {
    if (this.resultReported) return;
    this.resultReported = true;
    try {
      this.onMatchResult?.(winner, blue, orange);
    } catch (err) {
      console.error('[GameRoom] failed to record result', err);
    }
  }

  // Stored current validated inputs for next physics tick
  private currentInputs: Map<string, PlayerInput> = new Map();

  constructor(
    roomId: string,
    theme: ArenaTheme,
    player1: { socketId: string; playerName: string; team: Team; token: string; ws?: WebSocket },
    player2: { socketId: string; playerName: string; team: Team; token: string; ws?: WebSocket },
    onRoomClosed?: (roomId: string) => void,
    onMatchResult?: (winner: Team | 'forfeit_blue' | 'forfeit_orange', blueScore: number, orangeScore: number) => void
  ) {
    this.onMatchResult = onMatchResult;
    this.roomId = roomId;
    this.theme = theme;
    this.createdAt = Date.now();
    this.sm = createMatchStateMachine();
    this.onRoomClosed = onRoomClosed;

    // Register players
    this.addPlayer(player1);
    this.addPlayer(player2);
  }

  public async initialize(): Promise<void> {
    this.sim = await createGameSimulation();

    // Spawn both cars
    for (const session of this.players.values()) {
      this.sim.addCar(session.playerId, session.team);
    }

    // Start 60 Hz authoritative game loop
    // Wall-clock loop at 60 Hz; the simulation substeps at 120 Hz internally.
    const tickIntervalMs = 1000 / MATCH_CONFIG.serverLoopHz;
    let lastTime = performance.now();

    this.loopInterval = setInterval(() => {
      if (this.isDestroyed) return;
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      this.tick(dt);
    }, tickIntervalMs);
  }

  private addPlayer(p: {
    socketId: string;
    playerName: string;
    team: Team;
    token: string;
    ws?: WebSocket;
  }): void {
    const session: PlayerSession = {
      playerId: p.socketId,
      socketId: p.socketId,
      playerName: p.playerName,
      team: p.team,
      token: p.token,
      ws: p.ws,
      connected: true,
      lastInputSeq: 0,
      inputCountThisSec: 0,
      lastInputSecTimestamp: Date.now(),
      lastInputAt: 0,
    };
    this.players.set(p.token, session);
    this.socketToToken.set(p.socketId, p.token);
  }

  public getPlayerBySocket(socketId: string): PlayerSession | undefined {
    const token = this.socketToToken.get(socketId);
    return token ? this.players.get(token) : undefined;
  }

  public getPlayerByToken(token: string): PlayerSession | undefined {
    return this.players.get(token);
  }

  /**
   * Validates and ingests client input.
   * Clamps values, rejects non-finite numbers, drops stale sequence numbers and rate-limits.
   */
  public handleInput(socketId: string, raw: PlayerInput): void {
    const session = this.getPlayerBySocket(socketId);
    if (!session || !session.connected) return;

    // Reject stale sequence numbers
    if (raw.seq <= session.lastInputSeq) return;

    // Rate limiting: max 120 input packets per second
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec !== session.lastInputSecTimestamp) {
      session.lastInputSecTimestamp = nowSec;
      session.inputCountThisSec = 0;
    }
    session.inputCountThisSec++;
    if (session.inputCountThisSec > 120) return; // Drop excessive input rate

    // Sanitize numeric axes
    const clampAxis = (val: unknown): number => {
      if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
      return clamp(val, -1, 1);
    };

    const sanitized: PlayerInput = {
      seq: raw.seq,
      timestamp: raw.timestamp || Date.now(),
      throttle: clampAxis(raw.throttle),
      steer: clampAxis(raw.steer),
      pitch: clampAxis(raw.pitch),
      yaw: clampAxis(raw.yaw),
      roll: clampAxis(raw.roll),
      jump: Boolean(raw.jump),
      jumpHeld: Boolean(raw.jumpHeld),
      boost: Boolean(raw.boost),
      powerslide: Boolean(raw.powerslide),
    };

    // A jump press must survive being coalesced with a newer packet before the
    // simulation consumed it (the car de-duplicates jump edges by seq).
    const prev = this.currentInputs.get(session.playerId);
    const car = this.sim?.cars.get(session.playerId);
    if (prev?.jump && car && car.lastInputSeq < prev.seq) sanitized.jump = true;

    session.lastInputSeq = raw.seq;
    session.lastInputAt = Date.now();
    this.currentInputs.set(session.playerId, sanitized);
  }

  /**
   * Authoritative fixed simulation tick
   */
  private tick(dt: number): void {
    if (this.isDestroyed) return;

    const ballPos = this.sim.ball.getTransform();
    const isBallGrounded = ballPos.y <= BALL_CONFIG.restHeight + 0.05; // ball touching the floor

    // Controls locked during countdown, goal pause, or match end
    const locked = this.sm.phase === 'countdown' ||
                   this.sm.phase === 'goalPause' ||
                   this.sm.phase === 'overtimeCountdown' ||
                   this.sm.phase === 'ended';

    const effectiveInputs = new Map<string, PlayerInput>();
    if (locked) {
      // Presses made during a countdown/pause must not fire a jump the instant play resumes.
      for (const input of this.currentInputs.values()) input.jump = false;
    } else {
      const now = Date.now();
      for (const session of this.players.values()) {
        const input = this.currentInputs.get(session.playerId);
        // A stalled client must not keep driving with its last held keys.
        if (input && session.connected && now - session.lastInputAt <= INPUT_STALE_MS) {
          effectiveInputs.set(session.playerId, input);
        }
      }
    }

    // Step physics
    const { goalEvent, events: simEvents } = this.sim.step(effectiveInputs, dt);
    this.pendingEvents.push(...simEvents.filter((e) => e.type !== 'padPickup'));

    // Update match state machine
    const events = this.sm.update(dt, isBallGrounded, goalEvent);

    // Process state machine events
    for (const event of events) {
      if (event.type === 'phase_change') {
        this.broadcast({
          type: 'game/phase',
          phase: this.sm.phase,
          countdown: Math.ceil(this.sm.countdownTimer),
          timerRemaining: Math.ceil(this.sm.timerRemaining),
        });

        // Reset to kickoff when countdown begins
        if (event.phase === 'countdown' || event.phase === 'overtimeCountdown') {
          this.sim.resetToKickoff();
          this.currentInputs.clear();
        }
      } else if (event.type === 'score_update') {
        this.broadcast({
          type: 'game/goal',
          scorer: event.scorer!,
          blueScore: event.blueScore,
          orangeScore: event.orangeScore,
        });
      } else if (event.type === 'match_end') {
        this.broadcast({
          type: 'game/result',
          winner: event.winner!,
          blueScore: event.blueScore,
          orangeScore: event.orangeScore,
        });
        this.reportResult(event.winner!, event.blueScore, event.orangeScore);

        // Schedule room cleanup 10s after end
        setTimeout(() => this.destroy(), 10000);
      }
    }

    // Broadcast snapshots at ~30 Hz (every snapshotIntervalTicks physics ticks)
    if (this.sim.tickCount - this.lastSnapshotTick >= MATCH_CONFIG.snapshotIntervalTicks) {
      this.lastSnapshotTick = this.sim.tickCount;
      this.broadcastSnapshot();
    }
  }

  private broadcastSnapshot(): void {
    const playersSnapshot: GameSnapshot['players'] = {};
    for (const [token, session] of this.players.entries()) {
      const car = this.sim.cars.get(session.playerId);
      if (car) {
        playersSnapshot[session.playerId] = car.getSnapshot();
      }
    }

    const snapshot: GameSnapshot = {
      seq: ++this.snapshotSeq,
      tick: this.sim.tickCount,
      serverTime: Date.now(),
      phase: this.sm.phase,
      countdown: Math.max(0, Math.ceil(this.sm.countdownTimer)),
      timerRemaining: Math.max(0, Math.ceil(this.sm.timerRemaining)),
      blueScore: this.sm.blueScore,
      orangeScore: this.sm.orangeScore,
      players: playersSnapshot,
      ball: { transform: this.sim.ball.getTransform() },
      pads: this.sim.pads.getSnapshots(),
      lastScorer: this.sm.lastScorer,
      events: this.pendingEvents.length > 0 ? this.pendingEvents.splice(0) : undefined,
    };

    this.broadcast({ type: 'game/snapshot', snapshot });
  }

  public broadcast(msg: ServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const session of this.players.values()) {
      if (session.connected && session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(payload);
      }
    }
  }

  public sendTo(token: string, msg: ServerMessage): void {
    const session = this.players.get(token);
    if (session && session.connected && session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Disconnect handling with 10-second grace window.
   */
  public handleDisconnect(socketId: string): void {
    const session = this.getPlayerBySocket(socketId);
    if (!session || !session.connected) return;

    session.connected = false;
    session.ws = undefined;
    this.socketToToken.delete(socketId);

    // Notify opponent
    this.broadcast({
      type: 'game/opponent_disconnected',
      graceRemainingSec: MATCH_CONFIG.reconnectGraceSec,
    });

    // Start 10-second grace countdown
    session.disconnectTimer = setTimeout(() => {
      // Grace period expired without reconnection -> Forfeit match!
      if (!session.connected && !this.isDestroyed) {
        const events = this.sm.forfeit(session.team);
        for (const event of events) {
          if (event.type === 'match_end') {
            this.broadcast({
              type: 'game/result',
              winner: event.winner!,
              blueScore: event.blueScore,
              orangeScore: event.orangeScore,
              reason: `Player ${session.playerName} disconnected and timed out`,
            });
            this.reportResult(event.winner!, event.blueScore, event.orangeScore);
          }
        }
        setTimeout(() => this.destroy(), 3000);
      }
    }, MATCH_CONFIG.reconnectGraceSec * 1000);
  }

  /**
   * Reconnection handling: validates resume token and restores session.
   */
  public handleReconnect(token: string, newSocketId: string, ws: WebSocket): boolean {
    const session = this.players.get(token);
    if (!session) return false;

    // Clear disconnect grace timer
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = undefined;
    }

    session.connected = true;
    session.socketId = newSocketId;
    session.ws = ws;
    this.socketToToken.set(newSocketId, token);

    // Acknowledge reconnection to client
    ws.send(JSON.stringify({
      type: 'game/reconnected',
      team: session.team,
      theme: this.theme,
    }));

    // Inform opponent
    this.broadcast({ type: 'game/opponent_reconnected' });

    return true;
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = undefined;
    }

    for (const session of this.players.values()) {
      if (session.disconnectTimer) {
        clearTimeout(session.disconnectTimer);
      }
    }

    this.sim.destroy();
    this.onRoomClosed?.(this.roomId);
  }

  public getPhase(): MatchPhase {
    return this.sm.phase;
  }

  public getScore(): { blue: number; orange: number } {
    return { blue: this.sm.blueScore, orange: this.sm.orangeScore };
  }
}
