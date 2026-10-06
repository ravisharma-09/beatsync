"use client";
import { generateName } from "@/lib/randomNames";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useAuthStore } from "@/store/auth";
import { useRoomStore } from "@/store/room";
import { motion } from "motion/react";
import { useEffect } from "react";
import { IS_DEMO_MODE } from "@/lib/demo";
import { Dashboard } from "./dashboard/Dashboard";
import { DemoDashboard } from "./dashboard/DemoDashboard";
import { WebSocketManager } from "./room/WebSocketManager";

interface NewSyncerProps {
  roomId: string;
}

// Main component has been refactored into smaller components
export const NewSyncer = ({ roomId }: NewSyncerProps) => {
  const setUsername = useRoomStore((state) => state.setUsername);
  const setRoomId = useRoomStore((state) => state.setRoomId);
  const username = useRoomStore((state) => state.username);
  const accountName = useAuthStore((state) => state.user?.username);
  const hasHydrated = useAuthStore((state) => state.hasHydrated);

  // Update document title based on playback state
  useDocumentTitle();

  // Generate a new random username when the component mounts
  useEffect(() => {
    setRoomId(roomId);
    // Wait for the saved login so a logged-in user never connects under a random name first
    if (!hasHydrated) return;
    if (accountName) {
      if (username !== accountName) setUsername(accountName);
    } else if (!username) {
      setUsername(generateName());
    }
  }, [setUsername, username, roomId, setRoomId, accountName, hasHydrated]);

  // Connect only once the name is settled. Changing it after connecting would tear the
  // connection down mid-handshake (a name picked on the home page can differ from the account's).
  const isUsernameFinal = hasHydrated && (accountName ? username === accountName : !!username);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
      {/* WebSocket connection manager (non-visual component) */}
      <WebSocketManager roomId={roomId} username={isUsernameFinal ? username : ""} />

      {/* Spatial audio background effects */}
      {/* <SpatialAudioBackground /> */}

      {IS_DEMO_MODE ? <DemoDashboard roomId={roomId} /> : <Dashboard roomId={roomId} />}
    </motion.div>
  );
};
