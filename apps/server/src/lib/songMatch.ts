import { db } from "@/db";
import { parseYouTubeVideoId } from "@beatsync/shared";
import { z } from "zod";

/**
 * Finds the YouTube video for a song picked from name search.
 *
 * Name search itself happens in the user's browser (iTunes Search, free and unlimited per
 * user). Only this step touches a limited service, and only once per song:
 *
 *   1. Saved match from an earlier lookup (30 days, the longest YouTube lets API data be kept).
 *   2. YouTube Data API search: free, about 100 searches a day per deployment.
 *   3. Brave web search limited to youtube.com: free 2,000 a month, used when (2) is spent.
 *
 * Both keys are optional. With neither, song search is off and the client hides it.
 */

// Read at call time, not at import, so a key added to the environment is picked up
const youtubeKey = () => process.env.YOUTUBE_API_KEY;
const braveKey = () => process.env.BRAVE_SEARCH_API_KEY;

/** Google allows 100 search.list calls a day; stop a little early so a miscount cannot overrun it. */
export const YOUTUBE_DAILY_SEARCH_BUDGET = 95;
const MATCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;

export interface SongMatch {
  videoId: string;
  videoTitle: string;
}

export class SongSearchUnavailableError extends Error {}

export const isSongSearchEnabled = (): boolean => !!youtubeKey() || !!braveKey();

/** Same song, same key: ignores case, accents, punctuation and extra spaces. */
export function songKey(artist: string, title: string): string {
  const clean = (text: string) =>
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  return `${clean(artist)}|${clean(title)}`;
}

// YouTube's quota resets at midnight Pacific time, so count days in that zone
const quotaDay = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);

function youtubeSearchesToday(): number {
  const row = db
    .query<{ count: number }, [string]>("SELECT count FROM daily_counters WHERE day = ? AND name = 'youtube_search'")
    .get(quotaDay());
  return row?.count ?? 0;
}

function countYouTubeSearch(): void {
  db.query(
    `INSERT INTO daily_counters (day, name, count) VALUES (?, 'youtube_search', 1)
     ON CONFLICT (day, name) DO UPDATE SET count = count + 1`
  ).run(quotaDay());
}

function getSavedMatch(key: string): SongMatch | null {
  const row = db
    .query<
      { video_id: string; video_title: string },
      [string, number]
    >("SELECT video_id, video_title FROM youtube_matches WHERE song_key = ? AND created_at > ?")
    .get(key, Date.now() - MATCH_TTL_MS);
  return row ? { videoId: row.video_id, videoTitle: row.video_title } : null;
}

function saveMatch(key: string, match: SongMatch): void {
  db.query(
    `INSERT INTO youtube_matches (song_key, video_id, video_title, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (song_key) DO UPDATE SET video_id = excluded.video_id, video_title = excluded.video_title, created_at = excluded.created_at`
  ).run(key, match.videoId, match.videoTitle, Date.now());
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

async function searchYouTube(query: string): Promise<SongMatch | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("videoEmbeddable", "true"); // it has to play in the embedded player
  url.searchParams.set("maxResults", "1");
  url.searchParams.set("q", query);
  url.searchParams.set("key", youtubeKey()!);

  countYouTubeSearch(); // count the attempt: a failed call still costs quota
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`YouTube search failed with status ${response.status}`);

  const body = z
    .object({
      items: z.array(z.object({ id: z.object({ videoId: z.string() }), snippet: z.object({ title: z.string() }) })),
    })
    .parse(await response.json());
  const [first] = body.items;
  return first ? { videoId: first.id.videoId, videoTitle: decodeEntities(first.snippet.title) } : null;
}

async function searchBrave(query: string): Promise<SongMatch | null> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", `site:youtube.com ${query}`);
  url.searchParams.set("count", "5");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": braveKey()! },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Brave search failed with status ${response.status}`);

  const body = z
    .object({ web: z.object({ results: z.array(z.object({ url: z.string(), title: z.string() })) }).optional() })
    .parse(await response.json());

  for (const result of body.web?.results ?? []) {
    const videoId = parseYouTubeVideoId(result.url);
    if (videoId) return { videoId, videoTitle: result.title.replace(/\s*-\s*YouTube\s*$/i, "") };
  }
  return null;
}

/** Returns null when no video was found for the song. */
export async function findVideoForSong(song: { artist: string; title: string }): Promise<SongMatch | null> {
  if (!isSongSearchEnabled()) throw new SongSearchUnavailableError("Song search is not set up on this server");

  const key = songKey(song.artist, song.title);
  const saved = getSavedMatch(key);
  if (saved) return saved;

  const query = `${song.artist} ${song.title}`.trim();

  if (youtubeKey() && youtubeSearchesToday() < YOUTUBE_DAILY_SEARCH_BUDGET) {
    try {
      const match = await searchYouTube(query);
      if (match) saveMatch(key, match);
      return match;
    } catch (error) {
      console.warn("YouTube search failed, trying the fallback:", error);
    }
  }

  if (braveKey()) {
    // Brave's free plan does not allow keeping results, so this match is used but not saved
    return await searchBrave(query);
  }

  throw new SongSearchUnavailableError("Today's free song lookups are used up. Paste a YouTube link instead.");
}
