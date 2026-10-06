import { searchTracks } from "@/lib/audius";
import type { RawSearchResponseSchema } from "@beatsync/shared";
import { SearchParamsSchema } from "@beatsync/shared";
import type { z } from "zod";

/**
 * Catalog search for rooms. Backed by Audius (see lib/audius.ts).
 * Audio is never downloaded here: queue items link to /audius/stream/…, which sends each
 * listener to Audius for the audio.
 */
export class MusicProviderManager {
  async search(query: string, offset = 0): Promise<z.infer<typeof RawSearchResponseSchema>> {
    try {
      const { q, offset: validOffset } = SearchParamsSchema.parse({ q: query.trim(), offset });
      return await searchTracks(q, validOffset);
    } catch (error) {
      throw new Error(`Search failed: ${error instanceof Error ? error.message : "Unknown error"}`, { cause: error });
    }
  }
}

// Export singleton instance
export const MUSIC_PROVIDER_MANAGER = new MusicProviderManager();
