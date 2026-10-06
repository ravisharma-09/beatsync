import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import sinon from "sinon";
import { mockR2 } from "@/__tests__/mocks/r2";
import { mockResponsesWithRealHttp } from "@/__tests__/mocks/responses";
import { CLEANUP_DELAY_MS, globalManager } from "@/managers/GlobalManager";
import { handleAccountRoutes } from "@/routes/account";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { createMockServer, createMockWs } from "@/__tests__/mocks/websocket";
import type { BunServer, WSData } from "@/utils/websocket";
import type { AuthResponseType, SavedRoomType } from "@beatsync/shared";

const deleteObjectsWithPrefix = mock(() => ({ deletedCount: 0 }));
const copyObject = mock(() => undefined);

mockR2({ deleteObjectsWithPrefix, copyObject });
mockResponsesWithRealHttp();

const server = { ...createMockServer(), requestIP: () => ({ address: "127.0.0.1" }) } as unknown as BunServer;

async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
  const url = new URL(`http://localhost${path}`);
  const req = new Request(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return (await handleAccountRoutes(req, url, server))!;
}

let counter = 0;
async function signUp(): Promise<AuthResponseType> {
  const name = `room-user-${counter++}`;
  const response = await call("POST", "/auth/register", {
    body: { email: `${name}@example.com`, username: name, password: "correct horse" },
  });
  return (await response.json()) as AuthResponseType;
}

async function createPermanentRoom(token: string): Promise<SavedRoomType> {
  const response = await call("POST", "/rooms", { token, body: { name: "Living room" } });
  expect(response.status).toBe(201);
  return (await response.json()) as SavedRoomType;
}

/** Runs the real upgrade handler and returns the connection data the server would attach. */
function upgradeData(roomId: string, token?: string): WSData {
  let captured: WSData | undefined;
  const upgradeServer = {
    upgrade: (_req: Request, options: { data: WSData }) => {
      captured = options.data;
      return true;
    },
  } as unknown as BunServer;
  const tokenParam = token ? `&token=${token}` : "";
  handleWebSocketUpgrade(
    new Request(`http://localhost/ws?roomId=${roomId}&username=guest&clientId=c-${Math.random()}${tokenParam}`),
    upgradeServer
  );
  return captured!;
}

function join(data: WSData) {
  const ws = createMockWs({ clientId: data.clientId, roomId: data.roomId });
  Object.assign(ws.data, data);
  const room = globalManager.getOrCreateRoom(data.roomId);
  room.addClient(ws);
  return { room, leave: () => room.removeClient(data.clientId) };
}

describe("Permanent rooms", () => {
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    deleteObjectsWithPrefix.mockClear();
    copyObject.mockClear();
    for (const roomId of globalManager.getRoomIds()) globalManager.deleteRoom(roomId);
  });

  afterEach(() => {
    clock.restore();
  });

  it("keeps uploads and the queue after everyone leaves, and restores the queue on return", async () => {
    const owner = await signUp();
    const { roomId } = await createPermanentRoom(owner.token);

    const { room, leave } = join(upgradeData(roomId, owner.token));
    room.addAudioSource({ url: `https://cdn.test/room-${roomId}/a.mp3` });
    room.addAudioSource({ url: `https://cdn.test/room-${roomId}/b.mp3` });

    leave();
    globalManager.scheduleRoomCleanup(roomId);
    await clock.tickAsync(CLEANUP_DELAY_MS + 1);

    expect(globalManager.hasRoom(roomId)).toBe(false);
    expect(deleteObjectsWithPrefix).not.toHaveBeenCalled();

    const reopened = globalManager.getOrCreateRoom(roomId);
    expect(reopened.getAudioSources().map((source) => source.url)).toEqual([
      `https://cdn.test/room-${roomId}/a.mp3`,
      `https://cdn.test/room-${roomId}/b.mp3`,
    ]);
  });

  it("still deletes the uploads of ordinary temporary rooms", async () => {
    const { room, leave } = join(upgradeData("555555"));
    room.addAudioSource({ url: "https://cdn.test/room-555555/a.mp3" });

    leave();
    globalManager.scheduleRoomCleanup("555555");
    await clock.tickAsync(CLEANUP_DELAY_MS + 1);

    expect(deleteObjectsWithPrefix).toHaveBeenCalledWith("room-555555");
    expect(globalManager.getOrCreateRoom("555555").getAudioSources()).toEqual([]);
  });

  it("makes the owner an admin even when someone else joined first", async () => {
    const owner = await signUp();
    const stranger = await signUp();
    const { roomId } = await createPermanentRoom(owner.token);

    const first = upgradeData(roomId, stranger.token);
    const second = upgradeData(roomId, owner.token);
    const { room } = join(first);
    join(second);

    expect(first.isAdmin).toBe(false);
    expect(room.getClient(second.clientId)?.isAdmin).toBe(true);
    expect(room.getClient(second.clientId)?.username).toBe(owner.user.username);
  });

  it("does not let a user who is not in the room add music to it", async () => {
    const owner = await signUp();
    const outsider = await signUp();
    const { roomId } = await createPermanentRoom(owner.token);
    join(upgradeData(roomId, owner.token));

    const created = await call("POST", "/playlists", { token: outsider.token, body: { name: "Spam" } });
    const { id } = (await created.json()) as { id: string };
    const response = await call("POST", `/rooms/${roomId}/add-playlist`, {
      token: outsider.token,
      body: { playlistId: id },
    });
    expect(response.status).toBe(403);
  });

  it("copies room uploads into the saver's own folder when a queue is saved as a playlist", async () => {
    const guest = await signUp();
    const { room } = join(upgradeData("777777", guest.token));
    room.addAudioSource({ url: "https://cdn.test/room-777777/song___1.mp3" });
    room.addAudioSource({ url: "https://elsewhere.test/default/intro___2.mp3" });

    const response = await call("POST", "/rooms/777777/save-queue", { token: guest.token, body: { name: "Party" } });
    expect(response.status).toBe(201);
    const { playlist } = (await response.json()) as { playlist: { tracks: { title: string; url: string }[] } };

    expect(copyObject).toHaveBeenCalledWith("room-777777/song___1.mp3", `user-${guest.user.id}/song___1.mp3`);
    expect(playlist.tracks).toMatchObject([
      { title: "song", url: `https://cdn.test/user-${guest.user.id}/song___1.mp3` },
      { title: "intro", url: "https://elsewhere.test/default/intro___2.mp3" },
    ]);
  });
});
