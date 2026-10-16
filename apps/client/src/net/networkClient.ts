import {
  ArenaTheme,
  ClientMessage,
  GameSnapshot,
  MatchPhase,
  PlayerInput,
  ServerMessage,
  Team,
} from '@aerial-arena/shared';
import { SnapshotBuffer } from './snapshotBuffer.js';

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
  public readonly snapshots = new SnapshotBuffer();
  public pingMs = 0;

  // Event callbacks
  public onQueueWaiting?: (ticketId: string, position: number) => void;
  public onQueueMatched?: (info: MatchSessionInfo) => void;
  public onQueueCancelled?: () => void;
  /** Session token of the logged-in player (null = guest); sent with lobby messages. */
  public authToken: string | null = null;
  public onRoomCreated?: (code: string, expiresInSec: number) => void;
  public onRoomCancelled?: () => void;
  public onPhaseChange?: (phase: MatchPhase, countdown?: number, timerRemaining?: number) => void;
  public onGoal?: (scorer: Team, blueScore: number, orangeScore: number) => void;
  public onResult?: (winner: Team | 'forfeit_blue' | 'forfeit_orange', blue: number, orange: number, reason?: string) => void;
  public onOpponentDisconnected?: (graceRemainingSec: number) => void;
  public onOpponentReconnected?: () => void;
  public onError?: (msg: string) => void;
  public onSnapshot?: (snap: GameSnapshot) => void;

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

      case 'room/created': {
        this.onRoomCreated?.(msg.code, msg.expiresInSec);
        break;
      }

      case 'room/cancelled': {
        this.onRoomCancelled?.();
        break;
      }

      case 'queue/cancelled': {
        this.onQueueCancelled?.();
        break;
      }

      case 'game/snapshot': {
        this.prevSnapshot = this.lastSnapshot;
        this.lastSnapshot = msg.snapshot;

        this.snapshots.push(msg.snapshot);
        this.onSnapshot?.(msg.snapshot);
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
    this.send({ type: 'queue/join', playerName, authToken: this.authToken ?? undefined });
  }

  /** Host a private room; the server answers with room/created { code }. */
  public createRoom(playerName = 'Player', theme?: ArenaTheme): void {
    this.send({ type: 'room/create', playerName, theme, authToken: this.authToken ?? undefined });
  }

  /** Join a friend's private room by code; on success the server sends queue/matched. */
  public joinRoom(code: string, playerName = 'Player'): void {
    this.send({ type: 'room/join', code, playerName, authToken: this.authToken ?? undefined });
  }

  public cancelRoom(): void {
    this.send({ type: 'room/cancel' });
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
