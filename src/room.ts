/**
 * GameRoom Durable Object (relay protocol)
 *
 * Each room is a Durable Object instance managing:
 * - WebSocket connections for peers
 * - Join/leave notifications
 * - Relaying opaque msgpack payloads between peers
 *
 * Durable Objects advantages:
 * - Edge deployment (300+ locations)
 * - WebSocket hibernation (via attachments)
 * - Natural per-room isolation
 */

import { decodeMessage, encodeMessage } from "./codec";
import {
  ErrorCodes,
  PROTOCOL_VERSION,
  isObject,
  type PlayerId,
  type ServerMessage,
} from "./protocol";
import { RateLimiter } from "./rate-limit";

interface Env {
  ALLOWED_ORIGINS?: string;
  MAX_MESSAGES_PER_SECOND?: string;
  MAX_PLAYERS_PER_ROOM?: string;
}

interface PlayerConnection {
  playerId: PlayerId;
  webSocket: WebSocket;
  rateLimiter: RateLimiter;
  joinedAt: number;
}

function nowMs(): number {
  return Date.now();
}

function makePlayerId(): PlayerId {
  return crypto.randomUUID();
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(encodeMessage(message));
  } catch {
    // ignore send errors
  }
}

function error(code: string, message: string): ServerMessage {
  return { type: "error", code, message };
}

export class GameRoom implements DurableObject {
  /** PlayerId → connection data */
  private connections = new Map<PlayerId, PlayerConnection>();
  /** Reverse lookup: WebSocket → PlayerId for O(1) message routing */
  private wsToPlayer = new Map<WebSocket, PlayerId>();

  private allowedOrigins: Set<string>;
  private maxMessagesPerSecond: number;
  private maxPlayersPerRoom: number;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.allowedOrigins = new Set(
      (env.ALLOWED_ORIGINS ?? "http://localhost:3000")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );

    this.maxMessagesPerSecond = Math.max(1, Number(env.MAX_MESSAGES_PER_SECOND ?? 60));
    // Default lower than container servers to stay within DO throughput limits.
    this.maxPlayersPerRoom = Math.max(1, Number(env.MAX_PLAYERS_PER_ROOM ?? 20));

    // Restore WebSocket connections after hibernation
    this.state.getWebSockets().forEach((ws) => {
      const attachment = ws.deserializeAttachment() as { playerId: PlayerId } | null;
      if (!attachment?.playerId) return;

      const conn: PlayerConnection = {
        playerId: attachment.playerId,
        webSocket: ws,
        rateLimiter: new RateLimiter(this.maxMessagesPerSecond),
        joinedAt: nowMs(),
      };
      this.connections.set(conn.playerId, conn);
      this.wsToPlayer.set(ws, conn.playerId);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Origin check
    const origin = request.headers.get("Origin");
    if (origin && !this.allowedOrigins.has(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    // Capacity check
    if (this.connections.size >= this.maxPlayersPerRoom) {
      return new Response("Room is full", { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept with hibernation support
    this.state.acceptWebSocket(server);

    const playerId = makePlayerId();
    server.serializeAttachment({ playerId });

    const conn: PlayerConnection = {
      playerId,
      webSocket: server,
      rateLimiter: new RateLimiter(this.maxMessagesPerSecond),
      joinedAt: nowMs(),
    };

    // Gather peers BEFORE inserting self
    const peers: PlayerId[] = [];
    for (const existing of this.connections.values()) {
      peers.push(existing.playerId);
    }

    this.connections.set(playerId, conn);
    this.wsToPlayer.set(server, playerId);

    // Welcome to the new peer
    send(server, {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      playerId,
      peers,
    });

    // Notify existing peers
    this.broadcast(playerId, { type: "peer_joined", peerId: playerId });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const playerId = this.wsToPlayer.get(ws);
    if (!playerId) return;
    const conn = this.connections.get(playerId);
    if (!conn) return;

    // Rate limiting (per client)
    if (!conn.rateLimiter.allow()) {
      send(ws, error(ErrorCodes.RATE_LIMITED, "Rate limited"));
      return;
    }

    const decoded = decodeMessage(message);
    if (!isObject(decoded) || Array.isArray(decoded)) {
      send(ws, error(ErrorCodes.INVALID_MESSAGE, "Invalid message format"));
      return;
    }

    // Optional hello (protocol version check)
    if (decoded.type === "hello") {
      const clientVersion = (decoded as any).protocolVersion;
      if (typeof clientVersion === "number" && clientVersion !== PROTOCOL_VERSION) {
        send(ws, error(
          ErrorCodes.BAD_PROTOCOL,
          `Protocol mismatch. Server=${PROTOCOL_VERSION}, Client=${clientVersion}`
        ));
        ws.close(1008, "BAD_PROTOCOL");
      }
      return; // hello is consumed, not relayed
    }

    // Optional ping → pong
    if (decoded.type === "ping" && typeof (decoded as any).nonce === "string") {
      send(ws, { type: "pong", nonce: (decoded as any).nonce, serverTime: nowMs() });
      return;
    }

    // Everything else: relay to peers (opaque payload)
    this.broadcast(playerId, { type: "relay", from: playerId, data: decoded });
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    this.handleDisconnect(ws);
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    this.handleDisconnect(ws);
  }

  private handleDisconnect(ws: WebSocket): void {
    const playerId = this.wsToPlayer.get(ws);
    if (!playerId) return;

    this.connections.delete(playerId);
    this.wsToPlayer.delete(ws);

    this.broadcast(null, { type: "peer_left", peerId: playerId });
  }

  private broadcast(excludePlayerId: PlayerId | null, message: ServerMessage): void {
    for (const conn of this.connections.values()) {
      if (excludePlayerId && conn.playerId === excludePlayerId) continue;
      send(conn.webSocket, message);
    }
  }

  // Required for hibernation
  async alarm(): Promise<void> {
    // reserved
  }
}
