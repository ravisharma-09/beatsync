/**
 * YouTube videos in a room queue.
 *
 * A YouTube queue item is the link "/youtube/{videoId}/{title}.video". It is never fetched:
 * clients recognise the prefix and play the video in YouTube's own embedded player.
 * The last path segment is the title because clients show it as the item's name.
 */
export const YOUTUBE_QUEUE_PREFIX = "/youtube/";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Extracts the video ID from a pasted YouTube link (watch, youtu.be, shorts, embed, music). */
export function parseYouTubeVideoId(input: string): string | null {
  const text = input.trim();
  if (!/^(https?:\/\/)?([\w-]+\.)?(youtube\.com|youtu\.be|youtube-nocookie\.com)\//i.test(text)) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);

  let candidate: string | null | undefined;
  if (host === "youtu.be") {
    candidate = segments[0];
  } else if (segments[0] === "watch") {
    candidate = url.searchParams.get("v");
  } else if (["shorts", "embed", "live", "v"].includes(segments[0] ?? "")) {
    candidate = segments[1];
  }

  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

export function buildYouTubeQueueUrl(videoId: string, title: string): string {
  const safeTitle =
    title
      .replace(/[/\\?#%]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "YouTube video";
  return `${YOUTUBE_QUEUE_PREFIX}${videoId}/${encodeURIComponent(safeTitle)}.video`;
}

export function parseYouTubeQueueUrl(url: string): { videoId: string } | null {
  if (!url.startsWith(YOUTUBE_QUEUE_PREFIX)) return null;
  const [videoId] = url.slice(YOUTUBE_QUEUE_PREFIX.length).split("/");
  return VIDEO_ID.test(videoId) ? { videoId } : null;
}

export const isYouTubeQueueUrl = (url: string): boolean => parseYouTubeQueueUrl(url) !== null;
