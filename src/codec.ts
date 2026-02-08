/**
 * Message encoding/decoding for Cloudflare Workers
 *
 * Uses MessagePack binary encoding for ~50% bandwidth savings over JSON.
 * Retains JSON fallback for backwards compatibility during rolling upgrades.
 */

import { encode, decode } from "@msgpack/msgpack";
import type { AnyMessage } from "./protocol";

/**
 * Encode a protocol message to binary (MessagePack).
 * Returns Uint8Array suitable for WebSocket.send().
 */
export function encodeMessage(message: AnyMessage): Uint8Array {
  return encode(message);
}

/**
 * Decode a received WebSocket message.
 * Supports both binary (MessagePack) and string (JSON) for backwards compatibility.
 */
export function decodeMessage(data: string | ArrayBuffer): unknown {
  try {
    // Primary: binary MessagePack
    if (data instanceof ArrayBuffer) {
      return decode(new Uint8Array(data));
    }

    // Fallback: JSON string (backwards compat)
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return null;
      }
    }

    return null;
  } catch {
    return null;
  }
}
