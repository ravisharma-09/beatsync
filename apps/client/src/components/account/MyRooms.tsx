"use client";
import { fetchMyRooms } from "@/lib/accountApi";
import { useAuthStore } from "@/store/auth";
import { useQuery } from "@tanstack/react-query";
import { Pin } from "lucide-react";
import Link from "next/link";
import { queryKeys } from "./shared";

/** Home page shortcut to the logged-in user's permanent rooms. */
export const MyRooms = () => {
  const user = useAuthStore((state) => state.user);
  const rooms = useQuery({ queryKey: queryKeys.rooms, queryFn: fetchMyRooms, enabled: !!user });

  if (!user || !rooms.data) return null;

  return (
    <section className="mt-6" aria-labelledby="my-rooms-heading">
      <div className="flex items-center justify-between mb-2 px-1">
        <h2 id="my-rooms-heading" className="text-xs font-medium text-neutral-400">
          Your permanent rooms
        </h2>
        <Link href="/library" className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors">
          Manage
        </Link>
      </div>
      {rooms.data.length === 0 ? (
        <p className="text-xs text-neutral-500 px-1">
          None yet. Create one in your library to get a room code that never changes.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rooms.data.map((room) => (
            <li key={room.roomId}>
              <Link
                href={`/room/${room.roomId}`}
                className="flex items-center gap-3 px-3 py-2.5 bg-neutral-900 border border-neutral-800 rounded-lg hover:border-neutral-700 transition-colors"
              >
                <Pin className="size-3.5 text-neutral-500 shrink-0" />
                <span className="flex-1 truncate text-sm text-neutral-200">{room.name}</span>
                <span className="text-xs text-neutral-500 font-mono">{room.roomId}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
