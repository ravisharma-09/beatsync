import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { mockResponsesWithRealHttp } from "@/__tests__/mocks/responses";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { AUDIUS_SEARCH_PAGE_SIZE, buildQueueUrl, resolveStreamUrl, searchTracks } from "@/lib/audius";
import { globalManager } from "@/managers/GlobalManager";
import { handleAudiusStream } from "@/routes/audiusStream";
import { handleStreamMusic } from "@/websocket/handlers/handleStreamMusic";

mockR2();
mockResponsesWithRealHttp();

const realFetch = globalThis.fetch;
let requests: { url: URL; init?: RequestInit }[] = [];

function stubFetch(respond: (url: URL) => Response) {
  globalThis.fetch = mock((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    requests.push({ url, init });
    return Promise.resolve(respond(url));
  }) as unknown as typeof fetch;
}

const audiusTrack = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Song ${id}`,
  duration: 187.4,
  user: { name: "Some Artist", handle: "someartist" },
  artwork: { "150x150": `https://img.test/${id}-150.jpg`, "480x480": `https://img.test/${id}-480.jpg` },
  ...overrides,
});

beforeEach(() => {
  requests = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Audius search", () => {
  it("only returns tracks that anyone can stream for free", async () => {
    stubFetch(() =>
      Response.json({
        data: [
          audiusTrack("free1"),
          audiusTrack("paid", { is_stream_gated: true }),
          audiusTrack("nostream", { access: { stream: false } }),
          audiusTrack("gone", { is_delete: true }),
          audiusTrack("hidden", { is_unlisted: true }),
          { id: 42, title: null }, // malformed entry must not break the whole search
          audiusTrack("free2"),
        ],
      })
    );

    const result = await searchTracks("lofi");

    expect(result.data.tracks.items.map((track) => track.id)).toEqual(["free1", "free2"]);
    expect(result.data.tracks.items[0]).toMatchObject({
      title: "Song free1",
      duration: 187,
      performer: { name: "Some Artist" },
      album: { image: { thumbnail: "https://img.test/free1-150.jpg" } },
    });
    expect(requests[0].url.searchParams.get("query")).toBe("lofi");
  });

  it("offers another page only after a full page of results", async () => {
    const fullPage = Array.from({ length: AUDIUS_SEARCH_PAGE_SIZE }, (_, i) => audiusTrack(`t${i}`));

    stubFetch(() => Response.json({ data: fullPage }));
    const full = (await searchTracks("a")).data.tracks;
    expect(full.offset + full.items.length).toBeLessThan(full.total);

    stubFetch(() => Response.json({ data: fullPage.slice(0, 3) }));
    const last = (await searchTracks("a", 20)).data.tracks;
    expect(last.offset + last.items.length).toBe(last.total);
  });
});

describe("Audius stream links", () => {
  it("reads the redirect target instead of downloading the audio", async () => {
    stubFetch(() => new Response(null, { status: 302, headers: { Location: "https://node.audius.test/a.mp3?sig=1" } }));

    expect(await resolveStreamUrl("redirect1")).toBe("https://node.audius.test/a.mp3?sig=1");
    expect(requests[0].init?.redirect).toBe("manual");
  });

  it("also accepts the link as a JSON body, and asks Audius only once for a burst of listeners", async () => {
    stubFetch(() => Response.json({ data: "https://node.audius.test/b.mp3" }));

    const links = await Promise.all([resolveStreamUrl("json1"), resolveStreamUrl("json1")]);
    await resolveStreamUrl("json1");

    expect(new Set(links)).toEqual(new Set(["https://node.audius.test/b.mp3"]));
    // Two simultaneous first requests may both go out; the third must come from the cache.
    expect(requests.length).toBeLessThanOrEqual(2);
  });

  it("redirects the browser to Audius and reports unavailable tracks", async () => {
    stubFetch((url) =>
      url.pathname.includes("/ok1/")
        ? new Response(null, { status: 302, headers: { Location: "https://node.audius.test/ok.mp3" } })
        : new Response("nope", { status: 404 })
    );

    const ok = await handleAudiusStream(new Request("http://localhost/x"), "/audius/stream/ok1/Artist%20-%20Song.mp3");
    expect(ok.status).toBe(302);
    expect(ok.headers.get("Location")).toBe("https://node.audius.test/ok.mp3");

    const missing = await handleAudiusStream(new Request("http://localhost/x"), "/audius/stream/missing1/Song.mp3");
    expect(missing.status).toBe(502);

    const invalid = await handleAudiusStream(new Request("http://localhost/x"), "/audius/stream/..%2Fetc/Song.mp3");
    expect(invalid.status).toBe(404);
  });
});

describe("Adding a catalog track to a room", () => {
  const server = createMockServer();

  function joinRoom(roomId: string, clientId: string) {
    const ws = createMockWs({ clientId, roomId });
    globalManager.getOrCreateRoom(roomId).addClient(ws);
    return ws;
  }

  const add = (ws: ReturnType<typeof createMockWs>, trackId: string, trackName: string) =>
    handleStreamMusic({ ws, server, message: { type: "STREAM_MUSIC", trackId, trackName } });

  it("queues a link to this server, never a copy of the audio, and no duplicates", async () => {
    const admin = joinRoom("audius-room-1", "admin");
    const room = globalManager.getRoom("audius-room-1")!;

    await add(admin, "D7KyD", "Artist - Song / Live?");
    await add(admin, "D7KyD", "Artist - Song (renamed)");

    expect(room.getAudioSources()).toEqual([{ url: buildQueueUrl("D7KyD", "Artist - Song / Live?") }]);
    expect(room.getAudioSources()[0].url).toStartWith("/audius/stream/D7KyD/");
    // The display name is the last path segment, so it must not contain a raw slash
    expect(room.getAudioSources()[0].url.split("/")).toHaveLength(5);
  });

  it("refuses guests when only admins may change the queue", () => {
    joinRoom("audius-room-2", "admin");
    const guest = joinRoom("audius-room-2", "guest");

    expect(() => add(guest, "abc12", "Song")).toThrow();
    expect(globalManager.getRoom("audius-room-2")!.getAudioSources()).toEqual([]);
  });
});
