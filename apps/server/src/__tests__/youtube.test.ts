import { afterEach, describe, expect, it, mock } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import { globalManager } from "@/managers/GlobalManager";
import { handleAddYouTubeVideo } from "@/websocket/handlers/handleAddYouTubeVideo";
import { buildYouTubeQueueUrl, parseYouTubeQueueUrl, parseYouTubeVideoId } from "@beatsync/shared";

mockR2();

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("YouTube links", () => {
  it("finds the video in every common link shape", () => {
    const id = "dQw4w9WgXcQ";
    for (const link of [
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?v=${id}&list=PL123&t=42s`,
      `https://m.youtube.com/watch?feature=share&v=${id}`,
      `https://music.youtube.com/watch?v=${id}`,
      `https://youtu.be/${id}?si=abc`,
      `youtu.be/${id}`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube.com/live/${id}`,
      `  https://www.youtube.com/watch?v=${id}  `,
    ]) {
      expect(parseYouTubeVideoId(link)).toBe(id);
    }
  });

  it("rejects look-alike sites, non-video pages and ordinary search text", () => {
    for (const text of [
      "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch?v=too-short",
      "https://www.youtube.com/@somechannel",
      "youtube lofi beats",
      "dQw4w9WgXcQ",
    ]) {
      expect(parseYouTubeVideoId(text)).toBeNull();
    }
  });

  it("keeps the title as the last path segment, whatever characters it contains", () => {
    const url = buildYouTubeQueueUrl("dQw4w9WgXcQ", "AC/DC - Back In Black? 100% #live");
    expect(parseYouTubeQueueUrl(url)).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(url.split("/")).toHaveLength(4);
    expect(decodeURIComponent(url.split("/")[3])).toBe("AC DC - Back In Black 100 live.video");
  });
});

describe("Adding a YouTube video to a room", () => {
  const server = createMockServer();

  function joinRoom(roomId: string, clientId: string) {
    const ws = createMockWs({ clientId, roomId });
    globalManager.getOrCreateRoom(roomId).addClient(ws);
    return ws;
  }

  const add = async (ws: ReturnType<typeof createMockWs>, url: string) => {
    await handleAddYouTubeVideo({ ws, server, message: { type: "ADD_YOUTUBE_VIDEO", url } });
  };
  const isRefused = (attempt: Promise<void>) =>
    attempt.then(
      () => false,
      () => true
    );

  function stubTitleLookup(respond: () => Response) {
    const calls: string[] = [];
    globalThis.fetch = mock((input: string | URL | Request) => {
      calls.push(input instanceof Request ? input.url : input.toString());
      return Promise.resolve(respond());
    }) as unknown as typeof fetch;
    return calls;
  }

  it("queues the video once, under its real title, whichever link shape is pasted", async () => {
    const calls = stubTitleLookup(() =>
      Response.json({ title: "Never Gonna Give You Up", author_name: "Rick Astley" })
    );
    const admin = joinRoom("yt-room-1", "admin");

    await add(admin, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await add(admin, "https://youtu.be/dQw4w9WgXcQ");

    const queue = globalManager.getRoom("yt-room-1")!.getAudioSources();
    expect(queue).toEqual([{ url: buildYouTubeQueueUrl("dQw4w9WgXcQ", "Never Gonna Give You Up") }]);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]).hostname).toBe("www.youtube.com");
  });

  it("still queues the video when the title cannot be looked up", async () => {
    stubTitleLookup(() => new Response("Unauthorized", { status: 401 }));
    const admin = joinRoom("yt-room-2", "admin");

    await add(admin, "https://youtu.be/aaaaaaaaaaa");

    const [item] = globalManager.getRoom("yt-room-2")!.getAudioSources();
    expect(parseYouTubeQueueUrl(item.url)).toEqual({ videoId: "aaaaaaaaaaa" });
  });

  it("refuses guests in admin-only rooms and links that are not YouTube videos", async () => {
    const calls = stubTitleLookup(() => Response.json({ title: "x" }));
    const admin = joinRoom("yt-room-3", "admin");
    const guest = joinRoom("yt-room-3", "guest");

    expect(await isRefused(add(guest, "https://youtu.be/dQw4w9WgXcQ"))).toBe(true);
    expect(await isRefused(add(admin, "https://evil.example/watch?v=dQw4w9WgXcQ"))).toBe(true);

    expect(globalManager.getRoom("yt-room-3")!.getAudioSources()).toEqual([]);
    // Nothing is fetched for a link that is not YouTube's
    expect(calls).toEqual([]);
  });
});
