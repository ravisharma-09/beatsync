"use client";
import { youtubePlayer } from "@/lib/youtubePlayer";
import { useGlobalStore } from "@/store/global";
import { isYouTubeQueueUrl } from "@beatsync/shared";
import { useEffect, useRef } from "react";

/**
 * The visible YouTube player, shown while the current queue item is a YouTube video.
 *
 * It sits outside the desktop and mobile layouts so there is exactly one player, and it is
 * always on screen while a video plays: YouTube does not allow hidden or audio-only players.
 */
export const YouTubeStage = () => {
  const isYouTubeSelected = useGlobalStore((state) => isYouTubeQueueUrl(state.selectedAudioUrl));
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!isYouTubeSelected || !host) return;
    void youtubePlayer.attach(host);
    return () => youtubePlayer.detach(host);
  }, [isYouTubeSelected]);

  if (!isYouTubeSelected) return null;

  return (
    <section
      aria-label="YouTube player"
      className="flex-shrink-0 border-t border-neutral-800/50 bg-black px-3 pt-2 pb-1.5 lg:px-6"
    >
      {/* 16:9, never smaller than YouTube's 200px minimum, capped so the queue stays usable */}
      <div className="mx-auto aspect-video w-full min-h-[200px] max-h-[34dvh] lg:max-h-[42dvh] max-w-[calc(42dvh*16/9)]">
        <div ref={hostRef} className="h-full w-full overflow-hidden rounded-md bg-neutral-950" />
      </div>
      <p className="mt-1 text-center text-[11px] text-neutral-500">
        Playing on YouTube, kept in step for everyone in the room. Keep this player on screen.
      </p>
    </section>
  );
};
