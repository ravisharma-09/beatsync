"use client";
import { queryKeys } from "@/components/account/shared";
import { ActiveRooms } from "@/components/ActiveRooms";
import { fetchMyRooms, fetchPlaylists } from "@/lib/accountApi";
import { generateName } from "@/lib/randomNames";
import { validateFullRoomId } from "@/lib/room";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { useQuery } from "@tanstack/react-query";
import { ListMusic, Play, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { AccountButton, APP_NAME, formatRoomCode, Logo } from "./RoomParts";

const newRoomCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const Card = ({ title, text, children }: { title: string; text: string; children: ReactNode }) => (
  <div className="flex flex-1 basis-72 flex-col gap-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
    <div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-1.5 text-sm text-neutral-400">{text}</p>
    </div>
    {children}
  </div>
);

const SectionHeader = ({ id, title }: { id: string; title: string }) => (
  <div className="flex items-baseline justify-between gap-3">
    <h2 id={id} className="text-lg font-semibold text-white">
      {title}
    </h2>
    <Link href="/library" className="text-[13px] text-neutral-300 underline-offset-2 hover:text-white hover:underline">
      Manage
    </Link>
  </div>
);

export const Home = () => {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const username = useRoomStore((state) => state.username);
  const setUsername = useRoomStore((state) => state.setUsername);

  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");

  // Guests get a random name; logged-in users always use their account name
  useEffect(() => {
    setUsername(user?.username ?? generateName());
  }, [user?.username, setUsername]);

  const rooms = useQuery({ queryKey: queryKeys.rooms, queryFn: fetchMyRooms, enabled: !!user });
  const playlists = useQuery({ queryKey: queryKeys.playlists, queryFn: fetchPlaylists, enabled: !!user });

  const join = () => {
    const digits = code.replace(/\D/g, "");
    if (!validateFullRoomId(digits)) {
      setCodeError("A room code has 6 digits.");
      return;
    }
    router.push(`/room/${digits}`);
  };

  return (
    <div className="min-h-dvh bg-neutral-950 text-white">
      <header className="flex items-center justify-between gap-3 border-b border-neutral-800 px-5 py-3">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-2">
          {hasHydrated && (
            <Link
              href={user ? "/library" : "/account"}
              className="flex h-11 items-center rounded-full px-4 text-sm text-neutral-200 hover:bg-neutral-900 hover:text-white"
            >
              {user ? "My music" : "Log in"}
            </Link>
          )}
          <AccountButton />
        </nav>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-11 px-5 pt-12 pb-16">
        <section aria-label="Start listening" className="flex flex-col gap-5">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Play music together, in sync.</h1>

          <div className="flex flex-wrap gap-4">
            <Card title="Start a room" text="You get a code. Friends type it in and their phones play with yours.">
              <button
                type="button"
                onClick={() => router.push(`/room/${newRoomCode()}`)}
                className="mt-auto flex h-13 cursor-pointer items-center justify-center gap-2 rounded-full bg-green-500 text-base font-semibold text-green-950 transition-colors hover:bg-green-400"
              >
                <Plus className="size-5" aria-hidden />
                Start a room
              </button>
            </Card>

            <Card title="Join a room" text="Got a 6-digit code from a friend? Type it here.">
              <form
                className="mt-auto flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  join();
                }}
              >
                <div className="flex gap-2.5">
                  <label htmlFor="join-code" className="sr-only">
                    Room code
                  </label>
                  <input
                    id="join-code"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="6-digit code"
                    maxLength={7}
                    value={code}
                    aria-invalid={!!codeError}
                    aria-describedby={codeError ? "join-code-error" : undefined}
                    onChange={(event) => {
                      setCode(event.target.value.replace(/[^\d ]/g, ""));
                      setCodeError("");
                    }}
                    className="h-13 min-w-0 flex-1 rounded-full border border-neutral-700 bg-neutral-950 px-5 text-lg tracking-widest text-white placeholder:tracking-normal placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="h-13 cursor-pointer rounded-full bg-white px-6 text-base font-semibold text-neutral-950 transition-colors hover:bg-neutral-200"
                  >
                    Join
                  </button>
                </div>
                {codeError && (
                  <p id="join-code-error" role="alert" className="text-sm text-red-400">
                    {codeError}
                  </p>
                )}
              </form>
            </Card>
          </div>

          {hasHydrated && !user && (
            <p className="text-sm text-neutral-400">
              You will appear as <span className="text-white">{username}</span>.{" "}
              <button
                type="button"
                onClick={() => setUsername(generateName())}
                className="cursor-pointer underline underline-offset-2 hover:text-white"
              >
                Pick another name
              </button>{" "}
              or{" "}
              <Link href="/account" className="underline underline-offset-2 hover:text-white">
                log in
              </Link>{" "}
              to keep your playlists and rooms.
            </p>
          )}
        </section>

        {user && (
          <section aria-labelledby="rooms-heading" className="flex flex-col gap-3.5">
            <SectionHeader id="rooms-heading" title="Your rooms" />
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
              {rooms.data?.map((room) => (
                <Link
                  key={room.roomId}
                  href={`/room/${room.roomId}`}
                  className="flex flex-col gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600"
                >
                  <span className="truncate font-medium text-white">{room.name}</span>
                  <span className="text-[13px] text-neutral-400">
                    Code {formatRoomCode(room.roomId)} ·{" "}
                    {room.trackCount === 0
                      ? "Empty"
                      : `${room.trackCount} ${room.trackCount === 1 ? "song" : "songs"} waiting`}
                  </span>
                </Link>
              ))}
              <Link
                href="/library"
                className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-600 p-4 text-sm text-neutral-300 transition-colors hover:border-neutral-400 hover:text-white"
              >
                <Plus className="size-[18px]" aria-hidden />
                New permanent room
              </Link>
            </div>
          </section>
        )}

        {user && (
          <section aria-labelledby="playlists-heading" className="flex flex-col gap-3.5">
            <SectionHeader id="playlists-heading" title="Your playlists" />
            {playlists.data?.length === 0 ? (
              <p className="text-sm text-neutral-400">
                No playlists yet. In a room, use &ldquo;Save to playlist&rdquo; on any song, or make one in{" "}
                <Link href="/library" className="underline underline-offset-2 hover:text-white">
                  My music
                </Link>
                .
              </p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {playlists.data?.map((playlist) => (
                  <div
                    key={playlist.id}
                    className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-3"
                  >
                    <div className="flex size-13 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-500">
                      <ListMusic className="size-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-white">{playlist.name}</div>
                      <div className="text-[13px] text-neutral-400">
                        {playlist.trackCount} {playlist.trackCount === 1 ? "song" : "songs"}
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label={`Play ${playlist.name} in a new room`}
                      title="Play in a new room"
                      disabled={playlist.trackCount === 0}
                      onClick={() => router.push(`/room/${newRoomCode()}?playlist=${playlist.id}`)}
                      className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-green-500 text-green-950 transition-colors hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Play className="size-[18px] fill-current" aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <section aria-label="Rooms playing now">
          <ActiveRooms />
        </section>
      </main>

      <footer className="border-t border-neutral-900 px-5 py-6 text-center text-xs text-neutral-500">
        {APP_NAME} is open source, built on Beatsync by Freeman Jiang.
      </footer>
    </div>
  );
};
