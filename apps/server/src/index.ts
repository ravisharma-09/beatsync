import { ADMIN_SECRET, IS_DEMO_MODE } from "@/demo";
import { BackupManager } from "@/managers/BackupManager";
import { deleteExpiredSessions } from "@/auth";
import { flushRemoteWrites, initDatabase } from "@/db";
import { handleAccountRoutes } from "@/routes/account";
import { AUDIUS_STREAM_PATH_PREFIX } from "@/lib/audius";
import { validateR2Config } from "@/lib/r2";
import { getActiveRooms } from "@/routes/active";
import { handleAudiusStream } from "@/routes/audiusStream";
import { handleGetDefaultAudio } from "@/routes/default";
import { handleServeAudio } from "@/routes/demoAudio";
import { handleDiscover } from "@/routes/discover";
import { handleFeatures, handleHealth } from "@/routes/health";
import { handleRoot } from "@/routes/root";
import { handleStats } from "@/routes/stats";
import { handleGetPresignedURL, handleUploadComplete } from "@/routes/upload";
import { handleWebSocketUpgrade } from "@/routes/websocket";
import { handleClose, handleMessage, handleOpen } from "@/routes/websocketHandlers";
import { corsHeaders, errorResponse } from "@/utils/responses";
import type { WSData } from "@/utils/websocket";

// Load accounts, playlists and rooms from the remote database, if one is configured
await initDatabase();

// Bun.serve with WebSocket support
const server = Bun.serve<WSData>({
  hostname: "0.0.0.0",
  // Hosts such as Render tell the app which port to use
  port: Number(process.env.PORT ?? 8080),
  async fetch(req, server) {
    const start = performance.now();
    const url = new URL(req.url);

    // Handle CORS preflight requests
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    let response: Response;

    try {
      // Accounts, library, playlists and permanent rooms (not available in demo mode)
      const accountResponse = IS_DEMO_MODE ? null : await handleAccountRoutes(req, url, server);

      // Demo mode: serve local audio files
      if (accountResponse) {
        response = accountResponse;
      } else if (!IS_DEMO_MODE && url.pathname.startsWith(AUDIUS_STREAM_PATH_PREFIX)) {
        response = await handleAudiusStream(req, url.pathname);
      } else if (IS_DEMO_MODE && url.pathname.startsWith("/audio/")) {
        response = handleServeAudio(url.pathname);
      } else {
        switch (url.pathname) {
          case "/":
            response = handleRoot(req);
            break;

          case "/ws":
            return handleWebSocketUpgrade(req, server);

          case "/upload/get-presigned-url":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleGetPresignedURL(req);
            }
            break;

          case "/upload/complete":
            if (IS_DEMO_MODE) {
              response = errorResponse("Uploads disabled in demo mode", 403);
            } else {
              response = await handleUploadComplete(req, server);
            }
            break;

          case "/stats":
            response = await handleStats();
            break;

          case "/default":
            response = await handleGetDefaultAudio(req);
            break;

          case "/active-rooms":
            response = getActiveRooms(req);
            break;

          case "/discover":
            response = handleDiscover(req);
            break;

          case "/features":
            response = handleFeatures();
            break;

          case "/health":
            response = handleHealth();
            break;

          default:
            response = errorResponse("Not found", 404);
            break;
        }
      }
    } catch (error) {
      const durationMs = (performance.now() - start).toFixed(1);
      console.error(
        `[${new Date().toISOString()}] ${req.method} ${url.pathname} 500 ${durationMs}ms - Unhandled error:`,
        error
      );
      return errorResponse("Internal server error", 500);
    }

    const durationMs = (performance.now() - start).toFixed(1);
    console.log(`[${new Date().toISOString()}] ${req.method} ${url.pathname} ${response.status} ${durationMs}ms`);

    return response;
  },

  websocket: {
    open(ws) {
      handleOpen(ws, server);
    },

    message(ws, message) {
      void handleMessage(ws, message, server);
    },

    close(ws) {
      handleClose(ws, server);
    },
  },
});

console.log(`HTTP listening on http://${server.hostname}:${server.port}`);

if (IS_DEMO_MODE) {
  console.log(`🔑 Admin secret: ${ADMIN_SECRET}`);
}

// Without file storage there is nowhere to back up to. Rooms, search and catalog playback
// still work; only uploads and surviving a restart with live rooms need storage.
const hasStorage = validateR2Config().isValid;
if (!IS_DEMO_MODE && !hasStorage) {
  console.warn("⚠️  File storage (S3_* settings) is not configured: uploads and state backups are off.");
}

if (!IS_DEMO_MODE && hasStorage) {
  // Restore state from backup on startup
  BackupManager.restoreState().catch((error) => {
    console.error("Failed to restore state on startup:", error);
  });

  // Set up periodic backups every minute (for Render persistence issues)
  const BACKUP_INTERVAL_MS = 60 * 1000; // 1 minute
  setInterval(() => {
    console.log("🔄 Performing periodic backup at", new Date().toISOString());
    BackupManager.backupState().catch((error) => {
      console.error("Failed to perform periodic backup:", error);
    });
  }, BACKUP_INTERVAL_MS);
}

// Expired login sessions are never matched, this just keeps the table small
deleteExpiredSessions();
setInterval(deleteExpiredSessions, 1000 * 60 * 60);

// Simple graceful shutdown
const shutdown = async () => {
  console.log("\n⚠️ Shutting down...");

  void server.stop(); // Stop accepting new connections
  if (!IS_DEMO_MODE && hasStorage) {
    await BackupManager.backupState(); // Save state
  }
  await flushRemoteWrites(); // Make sure the last account and playlist changes are stored

  process.exit(0);
};

// Handle shutdown signals
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());

// Crash handlers — log the error before PM2 restarts the process
process.on("uncaughtException", (error) => {
  console.error(`[${new Date().toISOString()}] UNCAUGHT EXCEPTION — process will exit:`, error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(`[${new Date().toISOString()}] UNHANDLED REJECTION:`, reason);
});
