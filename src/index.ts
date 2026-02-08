/**
 * Cloudflare Worker Entry Point
 *
 * Routes WebSocket connections to the appropriate GameRoom Durable Object.
 * Each room ID maps to a unique Durable Object instance.
 */

import { GameRoom } from "./room";

export { GameRoom };

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
  MAX_MESSAGES_PER_SECOND?: string;
  MAX_PLAYERS_PER_ROOM?: string;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === "/" || url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: "cloudflare-ws-gameserver",
        runtime: "cloudflare-workers",
        timestamp: Date.now(),
      });
    }

    // WebSocket connections go to /ws/:roomId or just /ws (defaults to "lobby")
    if (url.pathname.startsWith("/ws")) {
      const upgradeHeader = request.headers.get("Upgrade");
      if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", { status: 426 });
      }

      // Extract room ID from path: /ws/roomId or /ws (defaults to lobby)
      const pathParts = url.pathname.split("/").filter(Boolean);
      const roomId = pathParts[1] || "lobby";

      // Get or create the Durable Object for this room
      const roomObjectId = env.GAME_ROOM.idFromName(roomId);
      const roomObject = env.GAME_ROOM.get(roomObjectId);

      // Forward the WebSocket upgrade request to the Durable Object
      return roomObject.fetch(request);
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
} satisfies ExportedHandler<Env>;
