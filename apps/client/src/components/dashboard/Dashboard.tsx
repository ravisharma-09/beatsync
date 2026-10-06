import { useGlobalStore } from "@/store/global";
import { motion } from "motion/react";
import { TopBar } from "../room/TopBar";
import { SyncProgress } from "../ui/SyncProgress";
import { SimpleRoom } from "../simple/SimpleRoom";
import { BeatFlash } from "./BeatFlash";

interface DashboardProps {
  roomId: string;
}

export const Dashboard = ({ roomId }: DashboardProps) => {
  const isSynced = useGlobalStore((state) => state.isSynced);
  const isLoadingAudio = useGlobalStore((state) => state.isInitingSystem);
  const hasUserStartedSystem = useGlobalStore((state) => state.hasUserStartedSystem);

  const isReady = isSynced && !isLoadingAudio;

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.5,
        staggerChildren: 0.1,
      },
    },
  };

  return (
    <div className="w-full h-dvh flex flex-col text-white bg-neutral-950">
      <BeatFlash />
      {/* Before the device is synced, TopBar shows the sync progress and the Start button */}
      {!isReady && <TopBar roomId={roomId} />}

      {/* Show SyncProgress during reconnection (when user has already started but lost sync) */}
      {!isSynced && hasUserStartedSystem && !isLoadingAudio && <SyncProgress />}

      {isReady && (
        <motion.div
          className="flex flex-1 flex-col overflow-hidden min-h-0"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <SimpleRoom />
        </motion.div>
      )}
    </div>
  );
};
