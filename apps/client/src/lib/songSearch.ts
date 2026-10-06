/**
 * Song search by name, straight from the user's browser to Apple's free iTunes Search API.
 *
 * It needs no key and its limit applies per user, not to the whole app, so typing in the
 * search box costs nothing. Only picking a song asks the server to find a video for it.
 * Each result links back to Apple Music, as Apple's terms for this API ask.
 */
export interface SongResult {
  id: number;
  title: string;
  artist: string;
  artworkUrl: string;
  durationSeconds: number;
  appleMusicUrl: string;
}

interface ITunesSong {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  trackViewUrl?: string;
}

export async function searchSongs(query: string, signal?: AbortSignal): Promise<SongResult[]> {
  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", query);
  url.searchParams.set("entity", "song");
  url.searchParams.set("limit", "8");

  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Song search is busy. Try again in a moment.");

  const body = (await response.json()) as { results?: ITunesSong[] };
  const seen = new Set<string>();
  const songs: SongResult[] = [];
  for (const item of body.results ?? []) {
    if (!item.trackId || !item.trackName || !item.artistName) continue;
    // The same recording is often listed once per album; show it once
    const key = `${item.artistName.toLowerCase()}|${item.trackName.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push({
      id: item.trackId,
      title: item.trackName,
      artist: item.artistName,
      artworkUrl: item.artworkUrl100 ?? "",
      durationSeconds: Math.round((item.trackTimeMillis ?? 0) / 1000),
      appleMusicUrl: item.trackViewUrl ?? "",
    });
  }
  return songs;
}
