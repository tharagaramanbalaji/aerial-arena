import {
  ArenaTheme,
  ClientMessage,
  GameSnapshot,
  MatchPhase,
  PlayerInput,
  ServerMessage,
  Team,
  TransformSnapshot,
  lerp,
  quatSlerp,
} from '@aerial-arena/shared';

export interface MatchSessionInfo {
  roomId: string;
  token: string;
  team: Team;
  opponentName: string;
  theme: ArenaTheme;
}

export class NetworkClient {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private isConnected = false;

  public sessionInfo: MatchSessionInfo | null = null;
  public lastSnapshot: GameSnapshot | null = null;
  public prevSnapshot: GameSnapshot | null = null;

  // Snapshot buffer for interpolation (ordered by serverTime)
  private snapshotBuffer: GameSnapshot[] = [];
  public pingMs = 0;

  // Event callbacks
  public onQueueWaiting?: (ticketId: string, position: number) => void;
  public onQueueMatched?: (info: MatchSessionInfo) => void;
  public onQueueCancelled?: () => void;
  public onPhaseChange?: (phase: MatchPhase, countdown?: number, timerRemaining?: number) => void;
  public onGoal?: (scorer: Team, blueScore: number, orangeScore: number) => void;
  public onResult?: (winner: Team | 'forfeit_blue' | 'forfeit_orange', blue: number, orange: number, reason?: string) => void;
  public onOpponentDisconnected?: (graceRemainingSec: number) => void;
  public onOpponentReconnected?: () => void;
  public onError?: (msg: string) => void;

  constructor(serverUrl = 'ws://localhost:3001') {
    this.serverUrl = serverUrl;
  }

  public connect(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          this.isConnected = true;
          this.startPing();
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data) as ServerMessage;
            this.handleMessage(msg);
          } catch (err) {
            console.error('[Net] Failed to parse message', err);
          }
        };

        this.ws.onclose = () => {
          this.isConnected = false;
        };

        this.ws.onerror = (err) => {
          this.isConnected = false;
          resolve(false);
        };
      } catch (err) {
        this.isConnected = false;
        resolve(false);
      }
    });
  }

  private startPing(): void {
    setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: 'ping', clientTime: Date.now() });
      }
    }, 2000);
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'pong': {
        this.pingMs = Math.max(0, Date.now() - msg.clientTime);
        break;
      }

      case 'queue/waiting': {
        this.onQueueWaiting?.(msg.ticketId, msg.queuePosition);
        break;
      }

      case 'queue/matched': {
        this.sessionInfo = {
          roomId: msg.roomId,
          token: msg.token,
          team: msg.team,
          opponentName: msg.opponentName,
          theme: msg.theme,
        };
        this.onQueueMatched?.(this.sessionInfo);
        break;
      }

      case 'queue/cancelled': {
        this.onQueueCancelled?.();
        break;
      }

      case 'game/snapshot': {
        this.prevSnapshot = this.lastSnapshot;
        this.lastSnapshot = msg.snapshot;

        this.snapshotBuffer.push(msg.snapshot);
        if (this.snapshotBuffer.length > 30) {
          this.snapshotBuffer.shift();
        }
        break;
      }

      case 'game/phase': {
        this.onPhaseChange?.(msg.phase, msg.countdown, msg.timerRemaining);
        break;
      }

      case 'game/goal': {
        this.onGoal?.(msg.scorer, msg.blueScore, msg.orangeScore);
        break;
      }

      case 'game/result': {
        this.onResult?.(msg.winner, msg.blueScore, msg.orangeScore, msg.reason);
        break;
      }

      case 'game/opponent_disconnected': {
        this.onOpponentDisconnected?.(msg.graceRemainingSec);
        break;
      }

      case 'game/opponent_reconnected': {
        this.onOpponentReconnected?.();
        break;
      }

      case 'error': {
        this.onError?.(msg.message);
        break;
      }

      default:
        break;
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public joinQueue(playerName = 'Player'): void {
    this.send({ type: 'queue/join', playerName });
  }

  public cancelQueue(): void {
    this.send({ type: 'queue/cancel' });
  }

  public sendInput(input: PlayerInput): void {
    this.send({ type: 'game/input', input });
  }

  public leaveMatch(): void {
    this.send({ type: 'game/leave' });
    this.sessionInfo = null;
  }

  /**
   * Interpolates an entity between two snapshots
   */
  public interpolateTransform(
    tPrev: TransformSnapshot,
    tNext: TransformSnapshot,
    alpha: number
  ): TransformSnapshot {
    const a = Math.max(0, Math.min(1, alpha));
    const rot = quatSlerp(
      { x: tPrev.qx, y: tPrev.qy, z: tPrev.qz, w: tPrev.qw },
      { x: tNext.qx, y: tNext.qy, z: tNext.qz, w: tNext.qw },
      a
    );

    return {
      x: lerp(tPrev.x, tNext.x, a),
      y: lerp(tPrev.y, tNext.y, a),
      z: lerp(tPrev.z, tNext.z, a),
      qx: rot.x,
      qy: rot.y,
      qz: rot.z,
      qw: rot.w,
      vx: lerp(tPrev.vx, tNext.vx, a),
      vy: lerp(tPrev.vy, tNext.vy, a),
      vz: lerp(tPrev.vz, tNext.vz, a),
      wx: lerp(tPrev.wx, tNext.wx, a),
      wy: lerp(tPrev.wy, tNext.wy, a),
      wz: lerp(tPrev.wz, tNext.wz, a),
    };
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public getConnected(): boolean {
    return this.isConnected;
  }
}
