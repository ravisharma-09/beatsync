import { IS_DEMO_MODE } from "@/demo";
import { findVideoForSong, SongSearchUnavailableError } from "@/lib/songMatch";
import { sendBroadcast, sendUnicast } from "@/utils/responses";
import { requireCanMutate } from "@/websocket/middlewares";
import type { HandlerFunction } from "@/websocket/types";
import type { ExtractWSRequestFrom } from "@beatsync/shared";
import { buildYouTubeQueueUrl, parseYouTubeQueueUrl } from "@beatsync/shared";

// Each lookup can spend limited search quota, so one person cannot burn through it
const MAX_LOOKUPS_PER_MINUTE = 10;
const recentLookups = new Map<string, number[]>();

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const recent = (recentLookups.get(clientId) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= MAX_LOOKUPS_PER_MINUTE) {
    recentLookups.set(clientId, recent);
    return true;
  }
  recent.push(now);
  recentLookups.set(clientId, recent);
  if (recentLookups.size > 5000) recentLookups.clear();
  return false;
}

/**
 * Adds a song picked from name search. The server finds the YouTube video for it and
 * queues that video; it plays in YouTube's embedded player like any pasted link.
 */
export const handleAddSong: HandlerFunction<ExtractWSRequestFrom["ADD_SONG"]> = async ({ ws, message, server }) => {
  if (IS_DEMO_MODE) return;
  const { room } = requireCanMutate(ws);
  const notify = (text: string) => sendUnicast({ ws, message: { type: "NOTICE", level: "error", message: text } });

  if (isRateLimited(ws.data.clientId)) {
    notify("You are adding songs very quickly. Wait a moment and try again.");
    return;
  }

  let match;
  try {
    match = await findVideoForSong({ artist: message.artist, title: message.title });
  } catch (error) {
    if (error instanceof SongSearchUnavailableError) {
      notify(error.message);
      return;
    }
    console.error("Song lookup failed:", error);
    notify("Could not look up that song right now. Try again, or paste a YouTube link.");
    return;
  }

  if (!match) {
    notify(`No playable video found for "${message.title}". Try pasting a YouTube link.`);
    return;
  }

  const { videoId, videoTitle } = match;
  const alreadyQueued = room.getAudioSources().some((source) => parseYouTubeQueueUrl(source.url)?.videoId === videoId);
  if (alreadyQueued) {
    sendUnicast({ ws, message: { type: "NOTICE", level: "info", message: "That song is already in the queue" } });
    return;
  }

  // Show the video's own title, so everyone can see exactly which video was matched
  const sources = room.addAudioSource({ url: buildYouTubeQueueUrl(videoId, videoTitle) });
  sendBroadcast({
    server,
    roomId: ws.data.roomId,
    message: { type: "ROOM_EVENT", event: { type: "SET_AUDIO_SOURCES", sources } },
  });
};
