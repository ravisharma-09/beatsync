import type { WSRequestType, WSUnicastType } from "@beatsync/shared";
import type { ServerWebSocket } from "bun";
import type { BunServer, WSData } from "@/utils/websocket";
import { WS_REGISTRY } from "@/websocket/registry";

const ADD_TO_QUEUE_ACTIONS: ReadonlySet<WSRequestType["type"]> = new Set([
  "ADD_SONG",
  "ADD_YOUTUBE_VIDEO",
  "STREAM_MUSIC",
]);

/**
 * Type-safe message dispatcher
 *
 * The TypeScript compiler cannot track the relationship between a dynamic
 * property access (WS_REGISTRY[message.type]) and the discriminated union.
 * This is a known limitation when using mapped types with discriminated unions.
 *
 * The safest approach here is to acknowledge that we've validated the handler
 * exists and trust our registry structure.
 */
export async function dispatchMessage({
  ws,
  message,
  server,
}: {
  ws: ServerWebSocket<WSData>;
  message: WSRequestType;
  server: BunServer;
}): Promise<void> {
  const handler = WS_REGISTRY[message.type];

  if (!handler) {
    console.log(`UNRECOGNIZED MESSAGE: ${JSON.stringify(message)}`);
    return;
  }

  // We've validated that:
  // 1. message.type exists in our registry
  // 2. The registry maps each type to the correct handler
  // 3. The message shape matches because it passed WSRequestSchema validation
  //
  // TypeScript can't track this relationship through dynamic property access,
  // so we use a type assertion that we know is safe.

  try {
    await handler.handle({
      ws,
      // @ts-expect-error - we know the message matches the expected type for this handler
      message,
      server,
    });
  } catch (error) {
    console.error(`[${ws.data.roomId}] Websocket handler ${handler.description} threw error:"`, error);
    // Someone pressed "add" and is waiting: tell them, instead of leaving the screen unchanged
    if (ADD_TO_QUEUE_ACTIONS.has(message.type)) {
      try {
        ws.send(
          JSON.stringify({
            type: "NOTICE",
            level: "error",
            message: "That could not be added. Try again in a moment.",
          } satisfies WSUnicastType)
        );
      } catch {
        // The connection is gone; nothing to tell
      }
    }
  }
}
