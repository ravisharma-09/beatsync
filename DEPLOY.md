# Putting Syncpo online

Syncpo has two parts that are deployed separately:

| Part | What it is | Needs |
|---|---|---|
| **Web app** (`apps/client`) | Next.js site | Any Next.js host. Vercel's free plan works. |
| **Server** (`apps/server`) | One Bun process: HTTP + WebSocket | A host that keeps a process running and allows WebSockets. Accounts need either a **persistent disk** or a free **Turso** database. |

## The free setup: Vercel + Render + Turso

No card is needed for Vercel or Turso. What you give up: Render's free server sleeps after
15 minutes without visitors and takes about a minute to wake, and rooms that were open are
gone after a sleep. Accounts, playlists and permanent rooms are safe in Turso.

1. **Turso** (turso.tech): create a database. Copy its URL (`libsql://…`) and create an
   auth token for it.
2. **Render** (render.com): New → Blueprint → pick this repo. `render.yaml` describes the
   server. Fill in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, plus the keys you have
   (table below). When it is live, open `https://<your-service>.onrender.com/health`.
3. **Vercel** (vercel.com): import this repo and set
   `NEXT_PUBLIC_API_URL=https://<your-service>.onrender.com` and
   `NEXT_PUBLIC_WS_URL=wss://<your-service>.onrender.com/ws`, then deploy.
4. Back on Render, set `PUBLIC_WEB_ORIGIN` to the Vercel address.

How Turso is used: the server works on a local copy of the database for speed. At startup
it loads everything from Turso, and every change is also written to Turso right away. If
the server is killed in the same second as a change, that one change can be lost.

## 1. Server on a host with a disk

The repo's `Dockerfile` builds the server. On any Docker host:

1. Deploy from the repo root using the `Dockerfile`. The server listens on port `8080`.
2. Attach a persistent volume mounted at `/data`. The database is `/data/syncpo.db`.
   Without the volume, accounts, playlists and permanent rooms are wiped on every redeploy.
3. Set the environment variables below.
4. Give it a public HTTPS address, for example `https://api.example.com`.

| Variable | Needed for |
|---|---|
| `AUDIUS_API_KEY` | Audius search |
| `YOUTUBE_API_KEY` | Picking songs by name (about 100 new songs a day) |
| `BRAVE_SEARCH_API_KEY` | Optional fallback when the YouTube limit is used up |
| `S3_BUCKET_NAME`, `S3_PUBLIC_URL`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Uploads and the library (Cloudflare R2 or other S3 storage) |
| `PUBLIC_WEB_ORIGIN` | The web app's address, e.g. `https://syncpo.example.com` |

Check it: open `https://api.example.com/health`. It should answer `{"status":"ok",…}`.

## 2. Web app

On Vercel: import the repo. `vercel.json` already sets the build. Add two environment
variables that point at the server from step 1, then deploy:

```
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/ws
```

These are read when the site is built, so redeploy after changing them.

## 3. Storage (for uploads)

Create a Cloudflare R2 bucket, enable public access for it (its public URL is
`S3_PUBLIC_URL`), and apply the CORS rules in `apps/storage/cors-config.json` so browsers
can upload to it and read from it. Then set the five `S3_*` variables on the server.

## Before inviting the public

- Restrict the YouTube key to "YouTube Data API v3" in Google Cloud Console.
- There is no password reset yet, and no takedown process for uploaded music. See
  `PROJECT.md` → Open problems.
