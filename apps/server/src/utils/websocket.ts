import type { Server } from "bun";

export interface WSData {
  roomId: string;
  clientId: string;
  username: string;
  isAdmin: boolean;
  isCreator: boolean;
  /** Set when the client connected with a valid login token. */
  userId?: string;
}

export type BunServer = Server<WSData>;
