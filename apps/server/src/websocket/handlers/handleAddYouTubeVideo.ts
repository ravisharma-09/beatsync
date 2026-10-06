import { IS_DEMO_MODE } from "@/demo";
import { sendBroadcast } from "@/utils/responses";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { buildYouTubeQueueUrl, parseYouTubeQueueUrl, parseYouTubeVideoId } from "@beatsync/shared";
import { z } from "zod";

const TITLE_LOOKUP_TIMEOUT_MS = 5000;

/**
 * Looks up a video's title through YouTube's public oEmbed endpoint (no API key, no quota).
 * Returns null when the video cannot be embedded or does not exist.
 */
export async function fetchYouTubeTitle(videoId: string): Promise<string | null> {
  const oembed = new URL("https://www.youtube.com/oembed");
  oembed.searchParams.set("url", `https://www.youtube.com/watch?v=${videoId}`);
  oembed.searchParams.set("format", "json");

  const response = await fetch(oembed, { signal: AbortSignal.timeout(TITLE_LOOKUP_TIMEOUT_MS) });
  if (!response.ok) return null;

  const body = z.object({ title: z.string(), author_name: z.string().optional() }).safeParse(await response.json());
  return body.success ? body.data.title : null;
}

/**
 * Adds a pasted YouTube link to the queue. Only the link is stored: every listener plays
 * the video in YouTube's own embedded player, kept in step by the room clock.
 */
export const handleAddYouTubeVideo: HandlerFunction<ExtractWSRequestFrom["ADD_YOUTUBE_VIDEO"]> = async ({
  ws,
  message,
  server,
}) => {
  if (IS_DEMO_MODE) return;
  const { room } = requireCanMutate(ws);

  const videoId = parseYouTubeVideoId(message.url);
  if (!videoId) throw new Error(`Not a YouTube video link: ${message.url}`);

  const isQueued = () => room.getAudioSources().some((source) => parseYouTubeQueueUrl(source.url)?.videoId === videoId);
  if (isQueued()) return;

  let title: string | null = null;
  try {
    title = await fetchYouTubeTitle(videoId);
  } catch (error) {
    console.warn(`YouTube title lookup failed for ${videoId}:`, error);
  }

  // Re-check after the lookup: the same link may have been added while we waited
  if (isQueued()) return;

  const sources = room.addAudioSource({ url: buildYouTubeQueueUrl(videoId, title ?? `YouTube video ${videoId}`) });
  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: { type: "ROOM_EVENT", event: { type: "SET_AUDIO_SOURCES", sources } },
  });
};
