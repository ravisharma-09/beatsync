"use client";
import { logout } from "@/lib/accountApi";
import { IS_DEMO_MODE } from "@/lib/demo";
import { useAuthStore } from "@/store/auth";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";

/** Top-right account links: log in, or your name, library and log out. */
export const AccountBar = () => {
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);
  const queryClient = useQueryClient();

  if (IS_DEMO_MODE || !hasHydrated) return <div className="h-8" />;

  return (
    <nav className="h-8 flex items-center justify-end gap-4 text-xs text-neutral-400">
      {user ? (
        <>
          <span className="text-neutral-500 truncate max-w-[10rem]">{user.username}</span>
          <Link href="/library" className="hover:text-white transition-colors">
            My library
          </Link>
          <button
            type="button"
            className="hover:text-white transition-colors cursor-pointer"
            onClick={async () => {
              await logout().catch(() => undefined);
              queryClient.clear();
            }}
          >
            Log out
          </button>
        </>
      ) : (
        <Link href="/account" className="hover:text-white transition-colors">
          Log in or sign up
        </Link>
      )}
    </nav>
  );
};
