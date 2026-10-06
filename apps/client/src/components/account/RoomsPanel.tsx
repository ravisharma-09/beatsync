"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createPermanentRoom, deletePermanentRoom, fetchMyRooms } from "@/lib/accountApi";
import { ROOM_NAME_MAX_LENGTH } from "@beatsync/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { EmptyState, ErrorNote, IconButton, Panel, queryKeys, Row } from "./shared";

export const RoomsPanel = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const rooms = useQuery({ queryKey: queryKeys.rooms, queryFn: fetchMyRooms });

  const create = useMutation({
    mutationFn: createPermanentRoom,
    onSuccess: () => {
      setName("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.rooms });
    },
    onError: (error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: deletePermanentRoom,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rooms }),
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-neutral-500">
        A permanent room keeps its code and its queue, even when nobody is in it. You are always the admin.
      </p>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) create.mutate(name.trim());
        }}
      >
        <Input
          aria-label="New room name"
          placeholder="New room name, e.g. Living room"
          maxLength={ROOM_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button type="submit" className="rounded-full shrink-0" disabled={!name.trim() || create.isPending}>
          <Plus />
          Create
        </Button>
      </form>

      <Panel>
        <ErrorNote error={rooms.error} />
        {rooms.data?.length === 0 && (
          <EmptyState title="No permanent rooms yet" hint="Create one and share its code once. It never changes." />
        )}
        <ul>
          {rooms.data?.map((room) => (
            <Row key={room.roomId}>
              <div className="flex-1 min-w-0">
                <div className="truncate">{room.name}</div>
                <div className="text-xs text-neutral-500">
                  <span className="font-mono">{room.roomId}</span> · {room.trackCount}{" "}
                  {room.trackCount === 1 ? "track" : "tracks"} in queue
                </div>
              </div>
              <Button asChild size="sm" variant="secondary" className="rounded-full">
                <Link href={`/room/${room.roomId}`}>Open</Link>
              </Button>
              <IconButton
                label={`Delete room ${room.name}`}
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete the room "${room.name}"? Its code stops working and music uploaded inside it is deleted.`
                    )
                  ) {
                    remove.mutate(room.roomId);
                  }
                }}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </Row>
          ))}
        </ul>
      </Panel>
    </div>
  );
};
