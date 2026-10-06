import { IS_DEMO_MODE } from "@/demo";
import { buildQueueUrl, parseQueueUrl } from "@/lib/audius";
import { sendBroadcast } from "@/utils/responses";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";

/**
 * Adds a catalog (Audius) track to the room's queue.
 *
 * Nothing is downloaded or stored: the queue item is a link to /audius/stream/…, and each
 * listener's browser is redirected from there to Audius for the audio.
 */
export const handleStreamMusic: HandlerFunction<ExtractWSRequestFrom["STREAM_MUSIC"]> = ({ ws, message, server }) => {
  if (IS_DEMO_MODE) return;
  const { room } = requireCanMutate(ws);

  const trackId = message.trackId.toString();
  const url = buildQueueUrl(trackId, message.trackName ?? `Audius track ${trackId}`);

  // The same track can arrive under a different display name; compare by track ID.
  const alreadyQueued = room.getAudioSources().some((source) => parseQueueUrl(source.url)?.trackId === trackId);
  if (alreadyQueued) return;

  const sources = room.addAudioSource({ url });

  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: { type: "ROOM_EVENT", event: { type: "SET_AUDIO_SOURCES", sources } },
  });
};
