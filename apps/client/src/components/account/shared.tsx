"use client";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const queryKeys = {
  tracks: ["library", "tracks"] as const,
  playlists: ["library", "playlists"] as const,
  playlist: (id: string) => ["library", "playlist", id] as const,
  rooms: ["library", "rooms"] as const,
};

export const Panel = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("bg-neutral-900 rounded-lg border border-neutral-800", className)}>{children}</div>
);

export const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
  <div className="px-4 py-10 text-center">
    <p className="text-sm text-neutral-300">{title}</p>
    <p className="text-xs text-neutral-500 mt-1">{hint}</p>
  </div>
);

export const Row = ({ className, children }: { className?: string; children: ReactNode }) => (
  <li
    className={cn(
      "flex items-center gap-3 px-4 py-2.5 border-b border-neutral-800/70 last:border-b-0 text-sm text-neutral-200",
      className
    )}
  >
    {children}
  </li>
);

export const IconButton = ({
  label,
  className,
  children,
  ...props
}: { label: string } & React.ComponentProps<"button">) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    className={cn(
      "size-7 shrink-0 inline-flex items-center justify-center rounded-md text-neutral-500 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none",
      className
    )}
    {...props}
  >
    {children}
  </button>
);

export const ErrorNote = ({ error }: { error: Error | null }) =>
  error ? (
    <p role="alert" className="text-xs text-red-400 px-4 py-3">
      {error.message}
    </p>
  ) : null;
