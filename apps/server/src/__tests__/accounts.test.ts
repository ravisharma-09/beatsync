import { describe, expect, it, mock } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { mockResponsesWithRealHttp } from "@/__tests__/mocks/responses";
import { db } from "@/db";
import { handleAccountRoutes } from "@/routes/account";
import type { BunServer } from "@/utils/websocket";
import type { AuthResponseType, PlaylistType } from "@beatsync/shared";

mockR2();
mockResponsesWithRealHttp();

const server = { requestIP: () => ({ address: "127.0.0.1" }), publish: mock() } as unknown as BunServer;

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
  const response = await handleAccountRoutes(req, url, server);
  if (!response) throw new Error(`No route for ${method} ${path}`);
  return response;
}

async function signUp(name: string): Promise<AuthResponseType> {
  const response = await call("POST", "/auth/register", {
    body: { email: `${name}@example.com`, username: name, password: "correct horse" },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as AuthResponseType;
}

async function addLibraryTrack(account: AuthResponseType, fileName: string) {
  const response = await call("POST", "/library/upload-complete", {
    token: account.token,
    body: { fileName, publicUrl: `https://cdn.test/user-${account.user.id}/${fileName}` },
  });
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string; title: string; url: string };
}

describe("Accounts", () => {
  it("logs in with the right password only, and never stores it in readable form", async () => {
    const { user } = await signUp("login-user");

    const wrong = await call("POST", "/auth/login", { body: { email: user.email, password: "wrong password" } });
    expect(wrong.status).toBe(401);

    const right = await call("POST", "/auth/login", {
      body: { email: "LOGIN-USER@example.com", password: "correct horse" },
    });
    expect(right.status).toBe(200);
    const { token } = (await right.json()) as AuthResponseType;

    const me = await call("GET", "/auth/me", { token });
    expect(((await me.json()) as { id: string }).id).toBe(user.id);

    const row = db
      .query<{ password_hash: string }, [string]>("SELECT password_hash FROM users WHERE id = ?")
      .get(user.id);
    expect(row!.password_hash).not.toContain("correct horse");
  });

  it("rejects a second account with the same email", async () => {
    await signUp("duplicate");
    const again = await call("POST", "/auth/register", {
      body: { email: "Duplicate@example.com", username: "someone else", password: "another password" },
    });
    expect(again.status).toBe(409);
  });

  it("stops accepting a token after logout", async () => {
    const { token } = await signUp("logout-user");
    await call("POST", "/auth/logout", { token });
    expect((await call("GET", "/auth/me", { token })).status).toBe(401);
  });

  it("blocks further login attempts after repeated failures", async () => {
    const { user } = await signUp("throttled");
    for (let i = 0; i < 10; i++) {
      await call("POST", "/auth/login", { body: { email: user.email, password: "wrong password" } });
    }
    const blocked = await call("POST", "/auth/login", { body: { email: user.email, password: "correct horse" } });
    expect(blocked.status).toBe(429);
  });
});

describe("Library and playlists", () => {
  it("requires a login", async () => {
    expect((await call("GET", "/playlists")).status).toBe(401);
    expect((await call("GET", "/library/tracks")).status).toBe(401);
  });

  it("refuses to register a file from another user's folder", async () => {
    const alice = await signUp("folder-alice");
    const bob = await signUp("folder-bob");
    const response = await call("POST", "/library/upload-complete", {
      token: bob.token,
      body: { fileName: "song.mp3", publicUrl: `https://cdn.test/user-${alice.user.id}/song.mp3` },
    });
    expect(response.status).toBe(400);
  });

  it("keeps playlist order and ignores tracks that belong to someone else", async () => {
    const alice = await signUp("order-alice");
    const bob = await signUp("order-bob");
    const first = await addLibraryTrack(alice, "first___1.mp3");
    const second = await addLibraryTrack(alice, "second___2.mp3");
    const bobs = await addLibraryTrack(bob, "bobs___3.mp3");

    const created = await call("POST", "/playlists", { token: alice.token, body: { name: "Mix" } });
    const { id } = (await created.json()) as PlaylistType;

    const updated = await call("PUT", `/playlists/${id}/tracks`, {
      token: alice.token,
      body: { trackIds: [second.id, bobs.id, first.id, second.id] },
    });
    const playlist = (await updated.json()) as PlaylistType;
    expect(playlist.tracks.map((track) => track.title)).toEqual(["second", "first"]);
  });

  it("does not let one user read, change or delete another user's playlist", async () => {
    const alice = await signUp("private-alice");
    const bob = await signUp("private-bob");
    const created = await call("POST", "/playlists", { token: alice.token, body: { name: "Private" } });
    const { id } = (await created.json()) as PlaylistType;

    expect((await call("GET", `/playlists/${id}`, { token: bob.token })).status).toBe(404);
    expect((await call("PATCH", `/playlists/${id}`, { token: bob.token, body: { name: "Mine now" } })).status).toBe(
      404
    );
    expect((await call("DELETE", `/playlists/${id}`, { token: bob.token })).status).toBe(404);
    expect((await call("GET", `/playlists/${id}`, { token: alice.token })).status).toBe(200);
  });

  it("removes a deleted track from playlists that used it", async () => {
    const alice = await signUp("delete-alice");
    const track = await addLibraryTrack(alice, "gone___1.mp3");
    const created = await call("POST", "/playlists", { token: alice.token, body: { name: "Mix" } });
    const { id } = (await created.json()) as PlaylistType;
    await call("PUT", `/playlists/${id}/tracks`, { token: alice.token, body: { trackIds: [track.id] } });

    expect((await call("DELETE", `/library/tracks/${track.id}`, { token: alice.token })).status).toBe(200);

    const playlist = (await (await call("GET", `/playlists/${id}`, { token: alice.token })).json()) as PlaylistType;
    expect(playlist.tracks).toEqual([]);
  });
});
