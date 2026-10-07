import { afterAll, describe, expect, it } from "bun:test";
import { mockR2 } from "@/__tests__/mocks/r2";
import { createSession, createUser, getUserByToken, verifyCredentials } from "@/auth";
import { connectRemoteDatabase, db, disconnectRemoteDatabase, flushRemoteWrites } from "@/db";
import * as repo from "@/db/repo";
import { createClient } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

mockR2();

// A real libSQL database in a temporary file stands in for Turso
const directory = mkdtempSync(join(tmpdir(), "syncpo-remote-"));
const remote = createClient({ url: `file:${join(directory, "remote.db")}` });

afterAll(() => {
  disconnectRemoteDatabase();
  remote.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("Remote database copy", () => {
  it("brings accounts, playlists and rooms back after the server loses its disk", async () => {
    await connectRemoteDatabase(remote);

    const user = await createUser({ email: "keep@example.com", username: "Keeper", password: "correct horse" });
    const token = createSession(user.id);
    const first = repo.addTrack({
      userId: user.id,
      title: "First",
      url: "/youtube/aaaaaaaaaaa/First.video",
      storageKey: null,
    });
    const second = repo.addTrack({
      userId: user.id,
      title: "Second",
      url: "/youtube/bbbbbbbbbbb/Second.video",
      storageKey: null,
    });
    const playlist = repo.createPlaylist(user.id, "Mix", [first.id, second.id]);
    repo.setPlaylistTracks(user.id, playlist.id, [second.id, first.id]);
    repo.renamePlaylist(user.id, playlist.id, "Party mix");
    const room = repo.createRoom(user.id, "Living room", () => false);
    repo.saveQueue(room.roomId, [{ url: first.url }]);
    await flushRemoteWrites();

    // The host restarts: the working copy is gone, only the remote database remains
    disconnectRemoteDatabase();
    expect(getUserByToken(token)).toBeNull();
    expect(repo.listPlaylists(user.id)).toEqual([]);

    await connectRemoteDatabase(remote);

    expect(getUserByToken(token)?.email).toBe("keep@example.com");
    expect((await verifyCredentials("keep@example.com", "correct horse"))?.id).toBe(user.id);
    const restored = repo.getPlaylist(user.id, playlist.id);
    expect(restored?.name).toBe("Party mix");
    expect(restored?.tracks.map((track) => track.title)).toEqual(["Second", "First"]);
    expect(repo.getSavedQueue(room.roomId)).toEqual([{ url: first.url }]);
  });

  it("still starts when the remote database holds a row whose parent was deleted", async () => {
    // What a remote database without cascading deletes can leave behind
    await remote.execute("PRAGMA foreign_keys = OFF");
    await remote.execute("INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ('gone', 'gone', 0)");
    disconnectRemoteDatabase();

    await connectRemoteDatabase(remote);

    expect(repo.getSavedQueue("000000")).toBeNull(); // the server is up and answering
    const leftovers = db.query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM playlist_tracks WHERE playlist_id = 'gone'"
    );
    expect(leftovers.get()?.n).toBe(0);
  });

  it("does not send changes from a transaction that failed", async () => {
    const user = await createUser({ email: "atomic@example.com", username: "Atomic", password: "correct horse" });
    await flushRemoteWrites();

    expect(() =>
      db.transaction(() => {
        db.query("UPDATE users SET username = ? WHERE id = ?").run("Changed", user.id);
        throw new Error("something went wrong halfway");
      })()
    ).toThrow();
    await flushRemoteWrites();

    const row = await remote.execute({ sql: "SELECT username FROM users WHERE id = ?", args: [user.id] });
    expect(row.rows[0].username).toBe("Atomic");
  });
});
