# Syncpo: project report

Syncpo is an open-source app for playing music together in sync. It is a fork of
[Beatsync](https://github.com/freeman-jiang/beatsync) by Freeman Jiang (MIT licence).
This file records what problem the project is solving, how each part is solved, and what
is still open. Update it whenever one of those changes.

Last updated: 7 October 2026.

## The problem

Beatsync does one hard thing well: many phones and laptops play the same audio at the
same instant, so together they act as one speaker system. Around that core it was hard to
use as an everyday music app:

| Problem in Beatsync | Effect on the user |
|---|---|
| No real music catalog. Search went through a private, undisclosed provider that copied tracks onto the server. | A fork has no search at all, and the original approach was not licensed. |
| No accounts. | Nothing belongs to you; every visit starts from zero. |
| No playlists. | A queue is lost when the room closes. |
| Rooms are deleted 60 seconds after the last person leaves, with their uploads. | No room you can come back to. |
| The room screen shows every control at once (sync numbers, spatial grid, nudge, filter). | New users do not know where to start. |
| Web only; search needs Enter; adding one song closes the search. | Slow to build a queue. |

## What Syncpo solves, and how

| Goal | How it is solved | State |
|---|---|---|
| Your own identity | Email and password accounts. Sessions are random tokens stored hashed. Data lives in one SQLite file, so there is nothing extra to run. | Built, tested in a browser |
| Your own music | A personal library. Uploads are stored under the user, not under a room, so room cleanup never deletes them. | Built, tested with a storage stand-in; not yet with real Cloudflare R2 |
| Playlists | Create, rename, reorder, delete. Add a playlist to a room, save a room's queue as a playlist, or save the current track. Start a room straight from a playlist. | Built, tested in a browser |
| Rooms that last | Permanent rooms keep their code, queue and uploads. The owner is always admin. | Built, tested in a browser |
| A legal catalog with tight sync | Audius search. The server never downloads Audius audio: each listener's browser fetches it from Audius, as Audius's terms require. Audio servers that are down or refuse browsers are skipped. | Built; search and audio loading checked against live Audius, full flow tested with a stand-in |
| Mainstream music | YouTube videos play in YouTube's own visible player. The room clock starts every player at the same moment and seeks a player back when it drifts more than half a second. | Built; **not yet seen playing a real video** |
| Finding chart songs for free | Typing searches Apple's free iTunes Search from the user's browser. Picking a song asks the server to find its YouTube video once; the match is saved for 30 days. Fallback: Brave web search. | Built, unit tested; **not yet run with real keys** |
| A simple screen | New home page (Start a room, Join a room, your rooms, your playlists). Room screen: what is playing on the left, Up next on the right, one player bar. Phone: four tabs. Advanced sound tools sit behind two buttons. | Built, tested in a browser on computer and phone sizes |

## Why music works the way it does

Two kinds of sync exist, and the music source decides which one is possible.

- **Tight sync** (phones act as one speaker, a few milliseconds apart) needs the raw audio
  file in the browser. That is possible for uploads and for Audius.
- **Loose sync** (everyone within about half a second) is all that is possible when another
  company's player plays the audio. That is the case for YouTube.

Rules the code follows on purpose. Do not "fix" these:

- **Spotify is not used.** A new Spotify app is limited to 5 users, every listener needs
  Premium, and its policy forbids this kind of product.
- **YouTube audio is never extracted or downloaded.** Videos play only in YouTube's embedded
  player, which stays visible. Ripping audio breaks YouTube's terms and has got apps removed.
- **Audius audio is never stored or proxied.** The server only redirects each listener to Audius.
- **YouTube's search limit is small** (about 100 searches a day per API key), so the app
  spends it only when a song is picked, never while typing.

## How it is put together

- `apps/client`: Next.js web app. New screens are in `src/components/simple/`.
- `apps/server`: one Bun process. HTTP + WebSocket, live rooms in memory, SQLite for
  accounts, library, playlists, permanent rooms and saved song matches.
- `packages/shared`: message and data schemas used by both.
- `CLAUDE.md` has the detailed map of the code.

## Settings (`apps/server/.env`)

| Setting | Needed for | Cost |
|---|---|---|
| `AUDIUS_API_KEY` | Audius search | Free |
| `S3_BUCKET_NAME`, `S3_PUBLIC_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Uploads and the library (Cloudflare R2 or any S3-compatible storage) | Free tier exists |
| `YOUTUBE_API_KEY` | Picking chart songs by name | Free, about 100 new songs a day |
| `BRAVE_SEARCH_API_KEY` | Fallback when the YouTube limit is used up | Free for 2,000 a month |

Without the last two, pasting a YouTube link still works; only search by song name is off.

## Open problems

- YouTube playback and song-name search have not been tried against the real services yet.
- A picked song can match the wrong video (a live version or lyric video). The queue shows
  the video's own title so this is visible.
- Using iTunes Search mainly to find songs that then play on YouTube is a grey area in
  Apple's terms. Each result links to Apple Music. MusicBrainz is the fully open alternative.
- No password reset or email verification.
- Upload size is not limited by the server, only the number of tracks per user.
- Deleting a library track does not remove it from queues that already contain it.
- The law on user uploads has not been reviewed. A takedown process is needed before a public launch.
- Two of Beatsync's own liveness tests fail on the Bun version used here; they failed before any Syncpo change.

## Next

1. Confirm YouTube playback and song search with real keys.
2. Playlist import (pasted lists; Spotify import is limited to 5 users by Spotify).
3. Phone apps, because phone browsers cannot keep synced audio playing in the background.
4. Better sync than Beatsync: drift correction on long tracks, saved Bluetooth delay per device.
