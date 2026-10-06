"use client";
import { AccountBar } from "@/components/account/AccountBar";
import { PlaylistsPanel } from "@/components/account/PlaylistsPanel";
import { RoomsPanel } from "@/components/account/RoomsPanel";
import { TracksPanel } from "@/components/account/TracksPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuthStore } from "@/store/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function LibraryPage() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);

  useEffect(() => {
    if (hasHydrated && !user) router.replace("/account");
  }, [hasHydrated, user, router]);

  if (!user) return null;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pb-16">
      <div className="flex items-center justify-between pt-3">
        <Link href="/" className="text-xs font-medium text-neutral-400 hover:text-white transition-colors">
          ← Home
        </Link>
        <AccountBar />
      </div>

      <h1 className="text-lg font-medium tracking-tight text-white mt-8 mb-5">My library</h1>

      <Tabs defaultValue="playlists" className="gap-5">
        <TabsList>
          <TabsTrigger value="playlists">Playlists</TabsTrigger>
          <TabsTrigger value="tracks">Tracks</TabsTrigger>
          <TabsTrigger value="rooms">Rooms</TabsTrigger>
        </TabsList>
        <TabsContent value="playlists">
          <PlaylistsPanel />
        </TabsContent>
        <TabsContent value="tracks">
          <TracksPanel />
        </TabsContent>
        <TabsContent value="rooms">
          <RoomsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
