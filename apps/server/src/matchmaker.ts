import crypto from 'crypto';
import { ArenaTheme, Team } from '@aerial-arena/shared';

export interface QueueTicket {
  ticketId: string;
  socketId: string;
  playerName: string;
  createdAt: number;
  matched: boolean;
  roomId?: string;
}

export interface MatchedPair {
  roomId: string;
  theme: ArenaTheme;
  player1: {
    socketId: string;
    ticketId: string;
    playerName: string;
    team: Team;
    token: string;
  };
  player2: {
    socketId: string;
    ticketId: string;
    playerName: string;
    team: Team;
    token: string;
  };
}

const THEMES: ArenaTheme[] = ['foundry', 'neon_grid', 'coastal_dome'];

export class Matchmaker {
  private queue: QueueTicket[] = [];
  private socketToTicket: Map<string, string> = new Map();
  private activePlayerRooms: Map<string, string> = new Map(); // socketId -> roomId

  /**
   * Joins the matchmaking queue.
   * Atomic and idempotent: duplicate joins for the same socket return the existing ticket.
   */
  public join(socketId: string, playerName = 'Player'): {
    ticket: QueueTicket;
    pair?: MatchedPair;
  } {
    // If socket is already in a match, prevent joining queue
    if (this.activePlayerRooms.has(socketId)) {
      throw new Error('Socket already in active match');
    }

    // Check if already in queue (idempotent duplicate join)
    const existingTicketId = this.socketToTicket.get(socketId);
    if (existingTicketId) {
      const existing = this.queue.find((t) => t.ticketId === existingTicketId);
      if (existing) {
        return { ticket: existing };
      }
    }

    const ticket: QueueTicket = {
      ticketId: crypto.randomUUID(),
      socketId,
      playerName,
      createdAt: Date.now(),
      matched: false,
    };

    this.queue.push(ticket);
    this.socketToTicket.set(socketId, ticket.ticketId);

    // Check if we have at least 2 distinct waiting tickets
    const eligibleTickets = this.queue.filter((t) => !t.matched);
    if (eligibleTickets.length >= 2) {
      const t1 = eligibleTickets[0];
      const t2 = eligibleTickets[1];

      // Atomic reservation
      t1.matched = true;
      t2.matched = true;

      // Remove from queue
      this.queue = this.queue.filter((t) => t.ticketId !== t1.ticketId && t.ticketId !== t2.ticketId);
      this.socketToTicket.delete(t1.socketId);
      this.socketToTicket.delete(t2.socketId);

      const roomId = crypto.randomUUID();
      const theme = THEMES[Math.floor(Math.random() * THEMES.length)];

      this.activePlayerRooms.set(t1.socketId, roomId);
      this.activePlayerRooms.set(t2.socketId, roomId);

      const pair: MatchedPair = {
        roomId,
        theme,
        player1: {
          socketId: t1.socketId,
          ticketId: t1.ticketId,
          playerName: t1.playerName,
          team: 'blue',
          token: crypto.randomUUID(),
        },
        player2: {
          socketId: t2.socketId,
          ticketId: t2.ticketId,
          playerName: t2.playerName,
          team: 'orange',
          token: crypto.randomUUID(),
        },
      };

      return { ticket: t1, pair };
    }

    return { ticket };
  }

  /**
   * Cancels a waiting queue ticket.
   * Returns true if successfully removed, false if not in queue or already matched.
   */
  public cancel(socketId: string): boolean {
    const ticketId = this.socketToTicket.get(socketId);
    if (!ticketId) return false;

    const idx = this.queue.findIndex((t) => t.ticketId === ticketId);
    if (idx !== -1) {
      const ticket = this.queue[idx];
      if (ticket.matched) return false; // Already matched in race condition
      this.queue.splice(idx, 1);
      this.socketToTicket.delete(socketId);
      return true;
    }

    this.socketToTicket.delete(socketId);
    return false;
  }

  /**
   * Cleans up on socket disconnect.
   */
  public handleDisconnect(socketId: string): void {
    this.cancel(socketId);
  }

  /**
   * Releases room assignment when match is over.
   */
  public releasePlayer(socketId: string): void {
    this.activePlayerRooms.delete(socketId);
  }

  public getQueueLength(): number {
    return this.queue.length;
  }
}
