/**
 * Multiplayer Protocol (Cloudflare Workers + Durable Objects)
 *
 * This server implements the SAME "relay" protocol as:
 * - `node-ws-gameserver`
 * - `bun-ws-gameserver`
 *
 * The server is protocol-agnostic: it relays any client msgpack payload to peers
 * wrapped in `{ type: "relay", from, data }`.
 */

export const PROTOCOL_VERSION = 1 as const;

export type RoomId = string;
export type PlayerId = string;

// ─────────────────────────────────────────────────────────────────────────────
// Client → Server
// ─────────────────────────────────────────────────────────────────────────────

/** Optional — if sent, server validates protocolVersion and closes on mismatch */
export type ClientHelloMessage = {
  type: "hello";
  protocolVersion: number;
};

/** Optional keepalive / RTT measurement */
export type ClientPingMessage = {
  type: "ping";
  nonce: string;
};

/**
 * Any other message shape is treated as "game data" and relayed.
 * (The server does not inspect or validate it.)
 */

export type ClientMessage = ClientHelloMessage | ClientPingMessage;

// ─────────────────────────────────────────────────────────────────────────────
// Server → Client
// ─────────────────────────────────────────────────────────────────────────────

export type ServerWelcomeMessage = {
  type: "welcome";
  protocolVersion: number;
  playerId: PlayerId;
  peers: PlayerId[];
};

export type ServerPeerJoinedMessage = {
  type: "peer_joined";
  peerId: PlayerId;
};

export type ServerPeerLeftMessage = {
  type: "peer_left";
  peerId: PlayerId;
};

export type ServerRelayMessage = {
  type: "relay";
  from: PlayerId;
  data: unknown;
};

export type ServerPongMessage = {
  type: "pong";
  nonce: string;
  serverTime: number;
};

export type ServerErrorMessage = {
  type: "error";
  code: string;
  message: string;
};

export type ServerMessage =
  | ServerWelcomeMessage
  | ServerPeerJoinedMessage
  | ServerPeerLeftMessage
  | ServerRelayMessage
  | ServerPongMessage
  | ServerErrorMessage;

export type AnyMessage = ClientMessage | ServerMessage | Record<string, unknown>;

export const ErrorCodes = {
  RATE_LIMITED: "RATE_LIMITED",
  ROOM_FULL: "ROOM_FULL",
  INVALID_MESSAGE: "INVALID_MESSAGE",
  BAD_PROTOCOL: "BAD_PROTOCOL",
} as const;

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
