import { accountStorage } from "@/db";
import { validateR2Config } from "@/lib/r2";
import { isSongSearchEnabled } from "@/lib/songMatch";
import { globalManager } from "@/managers";
import { jsonResponse } from "@/utils/responses";

const startedAt = Date.now();

/** What this server has switched on, so the client only offers what will work. */
export function handleFeatures(): Response {
  return jsonResponse({
    songSearch: isSongSearchEnabled(),
    uploads: validateR2Config().isValid,
    accountStorage: accountStorage(),
  });
}

export function handleHealth(): Response {
  return jsonResponse({
    status: "ok",
    uptimeMs: Date.now() - startedAt,
    startedAt: new Date(startedAt).toISOString(),
    rooms: globalManager.getRoomCount(),
  });
}
