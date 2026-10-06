import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { db } from "@/db";
import { findVideoForSong, SongSearchUnavailableError, songKey, YOUTUBE_DAILY_SEARCH_BUDGET } from "@/lib/songMatch";

mockR2();

const realFetch = globalThis.fetch;
let calls: string[] = [];

function stubSearch() {
  calls = [];
  globalThis.fetch = mock((input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push(url.hostname);
    if (url.hostname === "www.googleapis.com") {
      return Promise.resolve(
        Response.json({
          items: [{ id: { videoId: "yyyyyyyyyyy" }, snippet: { title: "Artist - Song (Official Video)" } }],
        })
      );
    }
    return Promise.resolve(
      Response.json({
        web: {
          results: [
            { url: "https://www.youtube.com/@artistchannel", title: "Artist - YouTube" },
            { url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", title: "Artist - Song (Lyrics) - YouTube" },
          ],
        },
      })
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  db.run("DELETE FROM youtube_matches");
  db.run("DELETE FROM daily_counters");
  process.env.YOUTUBE_API_KEY = "test-youtube-key";
  process.env.BRAVE_SEARCH_API_KEY = "test-brave-key";
  stubSearch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.YOUTUBE_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
});

describe("Finding the YouTube video for a song", () => {
  it("spends one search per song, however it is typed and however often it is picked", async () => {
    const first = await findVideoForSong({ artist: "Beyoncé", title: "Halo" });
    const again = await findVideoForSong({ artist: "  BEYONCE ", title: "halo!" });

    expect(first).toEqual({ videoId: "yyyyyyyyyyy", videoTitle: "Artist - Song (Official Video)" });
    expect(again).toEqual(first);
    expect(calls).toEqual(["www.googleapis.com"]);
  });

  it("treats different songs by the same artist as different", () => {
    expect(songKey("Artist", "Song One")).not.toBe(songKey("Artist", "Song Two"));
    expect(songKey("Beyoncé", "Halo")).toBe(songKey("beyonce", " HALO "));
  });

  it("switches to the fallback when today's YouTube budget is spent, and does not keep its results", async () => {
    for (let i = 0; i < YOUTUBE_DAILY_SEARCH_BUDGET; i++) {
      await findVideoForSong({ artist: "Artist", title: `Song ${i}` });
    }
    calls = [];

    const overBudget = await findVideoForSong({ artist: "Artist", title: "One more" });
    await findVideoForSong({ artist: "Artist", title: "One more" });

    // The channel page is skipped; the first real video link is used
    expect(overBudget).toEqual({ videoId: "bbbbbbbbbbb", videoTitle: "Artist - Song (Lyrics)" });
    // Asked twice because fallback results may not be stored
    expect(calls).toEqual(["api.search.brave.com", "api.search.brave.com"]);
  });

  it("uses the fallback alone when there is no YouTube key", async () => {
    delete process.env.YOUTUBE_API_KEY;
    const match = await findVideoForSong({ artist: "Artist", title: "Song" });
    expect(match?.videoId).toBe("bbbbbbbbbbb");
    expect(calls).toEqual(["api.search.brave.com"]);
  });

  it("says so, without calling anyone, when no search is available", async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;
    for (let i = 0; i < YOUTUBE_DAILY_SEARCH_BUDGET; i++) {
      await findVideoForSong({ artist: "Artist", title: `Song ${i}` });
    }
    calls = [];

    let error: unknown;
    try {
      await findVideoForSong({ artist: "Artist", title: "Over the limit" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SongSearchUnavailableError);
    expect(calls).toEqual([]);
  });
});
