import { parseQueueUrl, resolveStreamUrl } from "@/lib/audius";
import { corsHeaders, errorResponse } from "@/utils/responses";

/**
 * GET /audius/stream/{trackId}/{name}.mp3
 * Redirects the listener's browser to the track's audio on Audius. The audio never passes
 * through or is stored on this server.
 */
export async function handleAudiusStream(req: Request, pathname: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return errorResponse("Method not allowed", 405);

  const parsed = parseQueueUrl(pathname);
  if (!parsed) return errorResponse("Not found", 404);

  try {
    const url = await resolveStreamUrl(parsed.trackId);
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: url, "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error(`Audius stream lookup failed for ${parsed.trackId}:`, error);
    return errorResponse("This track is not available from Audius right now", 502);
  }
}
