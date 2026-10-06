"use client";
import type { UserType } from "@beatsync/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  token: string | null;
  user: UserType | null;
  /** False until the saved login has been read from localStorage (avoids a logged-out flash). */
  hasHydrated: boolean;
  setSession: (session: { token: string; user: UserType }) => void;
  clearSession: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hasHydrated: false,
      setSession: ({ token, user }) => set({ token, user }),
      clearSession: () => set({ token: null, user: null }),
    }),
    {
      name: "beatsync-auth",
      partialize: ({ token, user }) => ({ token, user }),
      // Hydrated from an effect (see AuthHydrator) so the server-rendered HTML and the first
      // client render agree; reading localStorage during render would cause a mismatch.
      skipHydration: true,
    }
  )
);

/** Loads the saved login from localStorage. Call once, after mount. */
export async function hydrateAuth(): Promise<void> {
  try {
    await useAuthStore.persist.rehydrate();
  } finally {
    useAuthStore.setState({ hasHydrated: true });
  }
}
