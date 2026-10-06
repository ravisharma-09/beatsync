import type { RawSearchResponseSchema, TrackType } from "@beatsync/shared";
import { z } from "zod";

/**
 * Audius is the searchable catalog: an open music platform whose API licenses tracks to
 * third-party apps for streaming.
 *
 * Their terms allow "active streaming use only", not downloading or re-hosting. So this
 * server never touches the audio: it only searches, and tells each listener's browser where
 * to fetch a track from Audius directly (see resolveStreamUrl).
 */

const API_URL = (process.env.AUDIUS_API_URL ?? "https://api.audius.co").replace(/\/$/, "");
const API_KEY = process.env.AUDIUS_API_KEY;
const APP_NAME = process.env.AUDIUS_APP_NAME ?? "beatsync";

export const AUDIUS_SEARCH_PAGE_SIZE = 20;
const REQUEST_TIMEOUT_MS = 8000;

// Only the fields we use; everything else in the response is ignored.
const AudiusTrackSchema = z.object({
  id: z.string(),
  title: z.string(),
  duration: z.number().nullish(),
  genre: z.string().nullish(),
  isrc: z.string().nullish(),
  release_date: z.string().nullish(),
  artwork: z.record(z.string(), z.unknown()).nullish(),
  user: z.object({ name: z.string().nullish(), handle: z.string().nullish() }).nullish(),
  is_streamable: z.boolean().nullish(),
  is_stream_gated: z.boolean().nullish(),
  is_delete: z.boolean().nullish(),
  is_unlisted: z.boolean().nullish(),
  access: z.object({ stream: z.boolean().nullish() }).nullish(),
});
type AudiusTrack = z.infer<typeof AudiusTrackSchema>;

const AudiusSearchResponseSchema = z.object({
  // Tolerate a malformed entry instead of failing the whole search
  data: z.array(z.unknown()).nullish(),
});

function buildUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${API_URL}/v1${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("app_name", APP_NAME);
  return url.toString();
}

/** The key goes in a header (as Audius documents), never in the URL, so it does not end up in logs. */
function headers(): Record<string, string> {
  return { Accept: "application/json", ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) };
}

/** Tracks everyone can stream for free: not paid, not follower-only, not deleted or hidden. */
export function isFreelyStreamable(track: AudiusTrack): boolean {
  return (
    track.is_streamable !== false &&
    track.is_stream_gated !== true &&
    track.is_delete !== true &&
    track.is_unlisted !== true &&
    track.access?.stream !== false
  );
}

const artworkUrl = (track: AudiusTrack, size: string): string => {
  const value = track.artwork?.[size];
  return typeof value === "string" ? value : "";
};

/** Maps an Audius track onto the search-result shape the client already renders. */
export function toSearchTrack(track: AudiusTrack): TrackType {
  const artist = track.user?.name ?? track.user?.handle ?? "Unknown artist";
  return {
    id: track.id,
    title: track.title,
    duration: Math.round(track.duration ?? 0),
    isrc: track.isrc ?? null,
    performer: { name: artist, id: 0 },
    track_number: 1,
    parental_warning: false,
    album: {
      id: track.id,
      title: track.title,
      duration: Math.round(track.duration ?? 0),
      parental_warning: false,
      release_date_original: track.release_date ?? "",
      image: {
        small: artworkUrl(track, "150x150"),
        thumbnail: artworkUrl(track, "150x150"),
        large: artworkUrl(track, "480x480"),
      },
    },
  };
}

export async function searchTracks(query: string, offset = 0): Promise<z.infer<typeof RawSearchResponseSchema>> {
  const response = await fetch(
    buildUrl("/tracks/search", {
      query,
      offset: offset.toString(),
      limit: AUDIUS_SEARCH_PAGE_SIZE.toString(),
    }),
    { headers: headers(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  );
  if (!response.ok) throw new Error(`Audius search failed with status ${response.status}`);

  const raw = AudiusSearchResponseSchema.parse(await response.json()).data ?? [];
  const items = raw
    .map((entry) => AudiusTrackSchema.safeParse(entry))
    .flatMap((result) => (result.success ? [result.data] : []))
    .filter(isFreelyStreamable)
    .map(toSearchTrack);

  // Audius does not return a total. A full page means there is probably another one,
  // which is all the client needs to decide whether to show "Show more results".
  const isFullPage = raw.length >= AUDIUS_SEARCH_PAGE_SIZE;
  return {
    data: {
      tracks: {
        limit: AUDIUS_SEARCH_PAGE_SIZE,
        offset,
        total: offset + raw.length + (isFullPage ? 1 : 0),
        items,
      },
    },
  };
}

// ── Streaming ───────────────────────────────────────────────────────────────

const STREAM_URL_TTL_MS = 60_000;
const streamUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Where a browser should fetch this track's audio from, on Audius's own servers.
 *
 * Everyone in a room asks for the same track at the same moment, so the answer is cached
 * briefly. Not for long: these links can be signed and expire.
 */
export async function resolveStreamUrl(trackId: string): Promise<string> {
  const cached = streamUrlCache.get(trackId);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  // Audius serves audio from many independent nodes and picks one per request. Now and
  // then a node is down or refuses browser requests, so check the link and ask again
  // for another node if needed, instead of handing every listener a dead link.
  let url = "";
  for (let attempt = 0; attempt < MAX_NODE_ATTEMPTS; attempt++) {
    url = await requestStreamUrl(trackId);
    if (await isUsableFromBrowsers(url)) break;
    console.warn(`Audius node ${new URL(url).host} failed the check for track ${trackId}, trying another`);
  }

  streamUrlCache.set(trackId, { url, expiresAt: Date.now() + STREAM_URL_TTL_MS });
  if (streamUrlCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of streamUrlCache) if (entry.expiresAt <= now) streamUrlCache.delete(key);
  }
  return url;
}

const MAX_NODE_ATTEMPTS = 4;

/** Asks Audius where the audio is, without fetching the audio. */
async function requestStreamUrl(trackId: string): Promise<string> {
  // With no_redirect Audius answers {"data": "<link>"}. A redirect is handled too (read its
  // target instead of following it), so the audio itself never passes through this server.
  const response = await fetch(buildUrl(`/tracks/${encodeURIComponent(trackId)}/stream`, { no_redirect: "true" }), {
    headers: headers(),
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  let url: string | null = null;
  if (response.status >= 300 && response.status < 400) {
    url = response.headers.get("Location");
  } else if (response.ok) {
    const body = z.object({ data: z.string() }).safeParse(await response.json().catch(() => null));
    url = body.success ? body.data.data : null;
  } else {
    throw new Error(`Audius stream lookup failed with status ${response.status}`);
  }

  // Plain http is only accepted when the API itself was pointed at a local stand-in.
  const isAllowedLink =
    !!url && (url.startsWith("https://") || (API_URL.startsWith("http://") && url.startsWith("http://")));
  if (!url || !isAllowedLink) throw new Error("Audius did not return a stream link");
  return url;
}

/**
 * True when the node answers and lets web pages read the audio (CORS). Asks for a single
 * byte only; the track is not downloaded.
 */
async function isUsableFromBrowsers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { Range: "bytes=0-0", Origin: PROBE_ORIGIN },
      signal: AbortSignal.timeout(NODE_PROBE_TIMEOUT_MS),
    });
    void response.body?.cancel();
    const allowOrigin = response.headers.get("Access-Control-Allow-Origin");
    return response.ok && (allowOrigin === "*" || allowOrigin === PROBE_ORIGIN);
  } catch {
    return false;
  }
}

const NODE_PROBE_TIMEOUT_MS = 4000;
const PROBE_ORIGIN = process.env.PUBLIC_WEB_ORIGIN ?? "http://localhost:3000";

export const AUDIUS_STREAM_PATH_PREFIX = "/audius/stream/";

/**
 * Queue link for an Audius track. It points at this server (which redirects to Audius), and
 * ends in a readable file name because the client shows the last path segment as the title.
 */
export function buildQueueUrl(trackId: string, displayName: string): string {
  const safeName =
    displayName
      .replace(/[/\\?#%]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200) || "Audius track";
  return `${AUDIUS_STREAM_PATH_PREFIX}${encodeURIComponent(trackId)}/${encodeURIComponent(safeName)}.mp3`;
}

export function parseQueueUrl(pathname: string): { trackId: string } | null {
  if (!pathname.startsWith(AUDIUS_STREAM_PATH_PREFIX)) return null;
  const [trackId] = pathname.slice(AUDIUS_STREAM_PATH_PREFIX.length).split("/");
  return /^[A-Za-z0-9]{1,32}$/.test(trackId) ? { trackId } : null;
}
