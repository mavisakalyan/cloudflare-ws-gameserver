# cloudflare-ws-gameserver

Protocol-agnostic WebSocket relay server on Cloudflare Workers + Durable Objects with msgpack binary protocol. Same relay protocol as [`node-ws-gameserver`](https://github.com/mavisakalyan/node-ws-gameserver) and [`bun-ws-gameserver`](https://github.com/mavisakalyan/bun-ws-gameserver) — clients switch runtimes by changing only the server URL.

## Features

- **Cloudflare Durable Objects** — Each room is a Durable Object with natural per-room isolation
- **Edge deployment** — Runs on 300+ Cloudflare edge locations worldwide
- **WebSocket hibernation** — Connections persist without consuming CPU when idle
- **Room-based architecture** — `/ws/:roomId` with auto-created rooms and configurable player caps
- **Protocol-agnostic relay** — Server relays any msgpack message between peers without inspecting payloads
- **Binary protocol (msgpack)** — ~40% smaller payloads than JSON
- **Instant relay** — Messages forwarded immediately to peers (no server-side batching)
- **Per-client rate limiting** — Sliding window algorithm
- **Origin allowlist** — Configurable CORS protection
- **Health endpoint** — `/health` for monitoring
- **Zero cold start** — Workers boot in <5ms, Durable Objects resume from hibernation instantly

## Quick Start

```bash
# Install dependencies
npm install

# Development (local Durable Objects emulation)
npm run dev

# Deploy to Cloudflare
npm run deploy
```

## Local Demo (2 tabs)

This repo includes a tiny browser demo at `examples/browser-demo.html` that lets you connect two tabs and see `relay` messages in real time.

1. Start the Worker (wrangler dev):

```bash
npm run dev
```

2. Serve the demo page (any static server works):

```bash
cd examples
python3 -m http.server 3000
```

3. Open `http://localhost:3000/browser-demo.html` in two tabs.
4. Click **Connect** in both tabs.
   - For local dev, use `ws://localhost:8787/ws/lobby`
5. Type a message and click **Send** — the other tab will receive a `relay`.

## Environment Variables

Configuration is set in `wrangler.toml` `[vars]` section or via the Cloudflare Dashboard:

| Variable | Default | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |
| `MAX_MESSAGES_PER_SECOND` | `60` | Per-client rate limit |
| `MAX_PLAYERS_PER_ROOM` | `20` | Room capacity (conservative for DO throughput) |

For local development, copy `.dev.vars.example` to `.dev.vars` to override.

## Protocol

`cloudflare-ws-gameserver`, [`node-ws-gameserver`](https://github.com/mavisakalyan/node-ws-gameserver), and [`bun-ws-gameserver`](https://github.com/mavisakalyan/bun-ws-gameserver) all use the **same msgpack binary relay protocol**, so clients are backend-agnostic.

The server is **protocol-agnostic** — it manages rooms and connections, but treats game data as opaque payloads. Any client that speaks msgpack can use it: multiplayer games, collaborative tools, IoT dashboards, chat apps, etc.

### Connection Flow

1. Client connects to `wss://host/ws/:roomId`
2. Server auto-assigns a `playerId` and sends `welcome` with list of existing peers
3. Client sends any msgpack messages — server wraps each in a `relay` envelope and forwards to all other peers
4. When peers join/leave, server notifies all remaining peers

### Server → Client

```typescript
// Sent on connect
{ type: "welcome", protocolVersion: 1, playerId: string, peers: string[] }

// Peer lifecycle
{ type: "peer_joined", peerId: string }
{ type: "peer_left",   peerId: string }

// Relayed game data from another peer (data is passed through untouched)
{ type: "relay", from: string, data: any }

// Keepalive response
{ type: "pong", nonce: string, serverTime: number }

// Errors (rate limit, room full, bad message)
{ type: "error", code: string, message: string }
```

### Client → Server

```typescript
// Optional protocol version check (consumed by server, not relayed)
{ type: "hello", protocolVersion: 1 }

// Optional keepalive
{ type: "ping", nonce: string }

// ANYTHING ELSE is relayed to all other peers in the room.
// The server does not inspect or validate your game data.
// Examples:
{ type: "position", x: 1.5, y: 0, z: -3.2 }
{ type: "chat", text: "hello" }
{ type: "snapshot", pos: [0, 1, 0], rotY: 3.14, locomotion: "run" }
```

### Example Client (browser)

```typescript
import { encode, decode } from '@msgpack/msgpack';

const ws = new WebSocket('wss://cloudflare-ws-gameserver.your-account.workers.dev/ws/lobby');
ws.binaryType = 'arraybuffer';

let myId: string;

ws.onmessage = (event) => {
  const msg = decode(new Uint8Array(event.data));

  switch (msg.type) {
    case 'welcome':
      myId = msg.playerId;
      console.log(`Joined as ${myId}, peers:`, msg.peers);
      break;
    case 'peer_joined':
      console.log(`${msg.peerId} joined`);
      break;
    case 'peer_left':
      console.log(`${msg.peerId} left`);
      break;
    case 'relay':
      // msg.from = peer ID, msg.data = whatever they sent
      handlePeerData(msg.from, msg.data);
      break;
  }
};

// Send your game state (any shape you want)
setInterval(() => {
  ws.send(encode({
    type: 'position',
    x: Math.random() * 10,
    y: 0,
    z: Math.random() * 10,
  }));
}, 50);
```

## Why Cloudflare Workers + Durable Objects?

| | Container (Node/Bun) | Cloudflare DO |
|---|---|---|
| Deployment | Docker image → any host | `wrangler deploy` → global edge |
| Cold start | ~200ms (Node) / ~20ms (Bun) | <5ms |
| Scaling | Manual / autoscaler | Automatic per-room isolation |
| State | In-process memory | Hibernatable, survives restarts |
| Locations | 1 region (unless multi-region) | 300+ edge locations |
| Cost model | Per-hour (container) | Per-request + duration |
| DePIN / self-host | Yes (Docker) | No (Cloudflare only) |

**Choose CF DO when:** you want global edge latency, zero-ops scaling, and WebSocket hibernation.
**Choose Node/Bun when:** you need DePIN/self-hosted deployment, higher per-room player caps, or full infrastructure control.

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/ws/:roomId` | WS | WebSocket connection (default room: "lobby") |
| `/health` | GET | Health check — server status and runtime info |

## Deploy

### Cloudflare

```bash
# First time — authenticate
npx wrangler login

# Deploy
npm run deploy
```

Your server will be live at `https://cloudflare-ws-gameserver.<your-subdomain>.workers.dev`.

### Custom Domain

Add a route in `wrangler.toml`:

```toml
routes = [
  { pattern = "ws.yourgame.com/*", zone_name = "yourgame.com" }
]
```

## Project Structure

```
src/
├── index.ts        # Worker entry — routes /ws/:roomId to Durable Objects
├── room.ts         # GameRoom Durable Object — relay logic, join/leave, broadcast
├── protocol.ts     # Shared protocol types and error codes
├── codec.ts        # msgpack encode/decode with JSON fallback
└── rate-limit.ts   # Sliding-window per-client rate limiter
```

## Sibling Repos

| Repo | Runtime | Deploy Target |
|------|---------|---------------|
| [`node-ws-gameserver`](https://github.com/mavisakalyan/node-ws-gameserver) | Node.js 20 + `ws` | Docker, Railway, DePIN, any host |
| [`bun-ws-gameserver`](https://github.com/mavisakalyan/bun-ws-gameserver) | Bun native WS | Docker, Railway, DePIN, any host |
| [`cloudflare-ws-gameserver`](https://github.com/mavisakalyan/cloudflare-ws-gameserver) | Cloudflare Workers + DO | Cloudflare edge (global) |

All three implement the same msgpack relay protocol. Clients connect to any of them by changing the server URL.

## License

GPL-3.0-only
