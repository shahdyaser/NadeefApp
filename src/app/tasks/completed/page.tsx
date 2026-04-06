"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import BottomNav from "@/components/bottom-nav";

type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Pick<Database["public"]["Tables"]["task"]["Row"], "id" | "name" | "room_id">;
type HistoryRow = Database["public"]["Tables"]["task_history"]["Row"];
type RoomType = Database["public"]["Enums"]["room_type"];

const ROOM_EMOJI: Record<RoomType, string> = {
  kitchen: "🍽️",
  bathroom: "🛁",
  bedroom: "🛏️",
  living_room: "🛋️",
  dining_room: "🍴",
  laundry: "🧺",
  garage: "🚗",
  outdoor: "🌿",
  office: "💼",
  other: "🏠",
};

type CompletedItem = {
  history: HistoryRow;
  taskName: string;
  roomId: string;
  doneByLabel: string;
  doneByAvatarUrl: string | null;
};

type GroupedCompleted = {
  room: RoomRow;
  items: CompletedItem[];
};

function formatCompletedAt(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function CompletedTasksPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [houseId, setHouseId] = useState<string | null>(null);
  const [actingHistoryId, setActingHistoryId] = useState<string | null>(null);
  const [groups, setGroups] = useState<GroupedCompleted[]>([]);
  const [totalPointsEarned, setTotalPointsEarned] = useState(0);

  const loadCompleted = useCallback(async () => {
    if (!supabaseClient) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      router.replace("/");
      return;
    }

    const uid = sessionData.session.user.id;
    setCurrentUserId(uid);
    const { data: membershipData, error: membershipError } = await supabaseClient
      .from("user_house_bridge")
      .select("house_id")
      .eq("user_id", uid)
      .limit(1);

    if (membershipError) {
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const homeId = membershipData?.[0]?.house_id;
    if (!homeId) {
      router.replace("/setup");
      return;
    }
    setHouseId(homeId);

    const { data: roomData, error: roomError } = await supabaseClient
      .from("room")
      .select("*")
      .eq("house_id", homeId)
      .order("name", { ascending: true });
    if (roomError) {
      setError(roomError.message);
      setLoading(false);
      return;
    }

    const { data: taskData, error: taskError } = await supabaseClient
      .from("task")
      .select("id,name,room_id")
      .eq("house_id", homeId);
    if (taskError) {
      setError(taskError.message);
      setLoading(false);
      return;
    }

    const { data: houseMembers, error: houseMembersError } = await supabaseClient
      .from("user_house_bridge")
      .select("user_id,display_name,avatar_url")
      .eq("house_id", homeId);
    if (houseMembersError) {
      setError(houseMembersError.message);
      setLoading(false);
      return;
    }

    const windowValue = searchParams.get("window");
    const todayOnly = windowValue === "today";
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    let historyQuery = supabaseClient
      .from("task_history")
      .select("*")
      .in(
        "user_id",
        (houseMembers ?? []).map((member) => member.user_id),
      )
      .gt("points_awarded", 0)
      .order("completed_at", { ascending: false });
    if (todayOnly) {
      historyQuery = historyQuery
        .gte("completed_at", startOfDay.toISOString())
        .lt("completed_at", endOfDay.toISOString());
    }
    const { data: historyData, error: historyError } = await historyQuery;
    if (historyError) {
      setError(historyError.message);
      setLoading(false);
      return;
    }

    const taskMap = new Map((taskData ?? []).map((task) => [task.id, task as TaskRow]));
    const roomMap = new Map((roomData ?? []).map((room) => [room.id, room]));

    const memberMap = new Map(
      (houseMembers ?? []).map((member, index) => [
        member.user_id,
        {
          label:
            member.display_name?.trim() ||
            (member.user_id === uid ? "You" : `Member ${index + 1}`),
          avatarUrl: member.avatar_url ?? null,
        },
      ]),
    );

    const completedItems: CompletedItem[] = (historyData ?? []).reduce<CompletedItem[]>(
      (acc, history) => {
        const task = taskMap.get(history.task_id);
        if (!task) return acc;
        const member = memberMap.get(history.user_id);
        acc.push({
          history,
          taskName: task.name,
          roomId: task.room_id,
          doneByLabel: member?.label ?? "Member",
          doneByAvatarUrl: member?.avatarUrl ?? null,
        });
        return acc;
      },
      [],
    );

    const itemsByRoom = new Map<string, CompletedItem[]>();
    for (const item of completedItems) {
      if (roomMap.has(item.roomId)) {
        const bucket = itemsByRoom.get(item.roomId) ?? [];
        bucket.push(item);
        itemsByRoom.set(item.roomId, bucket);
      }
    }

    const grouped: GroupedCompleted[] = (roomData ?? [])
      .map((room) => ({
        room,
        items: itemsByRoom.get(room.id) ?? [],
      }))
      .filter((group) => group.items.length > 0);

    setTotalPointsEarned(
      completedItems.reduce((sum, item) => sum + item.history.points_awarded, 0),
    );
    setGroups(grouped);
    setLoading(false);
  }, [router, searchParams, supabaseClient]);

  useEffect(() => {
    void loadCompleted();
  }, [loadCompleted]);

  async function adjustPointsDown(userId: string, points: number) {
    if (!supabaseClient || !houseId) return;
    const { data: bridgeData, error: bridgeError } = await supabaseClient
      .from("user_house_bridge")
      .select("total_points")
      .eq("user_id", userId)
      .eq("house_id", houseId)
      .single();

    if (bridgeError) throw new Error(bridgeError.message);

    const nextPoints = Math.max(0, (bridgeData?.total_points ?? 0) - points);
    const { error: updateBridgeError } = await supabaseClient
      .from("user_house_bridge")
      .update({ total_points: nextPoints })
      .eq("user_id", userId)
      .eq("house_id", houseId);

    if (updateBridgeError) throw new Error(updateBridgeError.message);
  }

  async function recalculateTaskAfterHistoryChange(taskId: string, restoredDueDate?: string | null) {
    if (!supabaseClient) return;
    const { data: taskData, error: taskError } = await supabaseClient
      .from("task")
      .select("frequency_days")
      .eq("id", taskId)
      .single();
    if (taskError) throw new Error(taskError.message);

    const { data: latestData, error: latestError } = await supabaseClient
      .from("task_history")
      .select("completed_at")
      .eq("task_id", taskId)
      .order("completed_at", { ascending: false })
      .limit(1);
    if (latestError) throw new Error(latestError.message);

    const latest = latestData?.[0];
    if (restoredDueDate) {
      const { error: restoreTaskError } = await supabaseClient
        .from("task")
        .update({
          last_completed_at: latest?.completed_at ?? null,
          next_due_date: restoredDueDate,
          status: "active",
        })
        .eq("id", taskId);
      if (restoreTaskError) throw new Error(restoreTaskError.message);
      return;
    }

    if (latest?.completed_at) {
      const nextDue = new Date(latest.completed_at);
      nextDue.setDate(nextDue.getDate() + taskData.frequency_days);
      const { error: updateTaskError } = await supabaseClient
        .from("task")
        .update({
          last_completed_at: latest.completed_at,
          next_due_date: nextDue.toISOString().slice(0, 10),
          status: "active",
        })
        .eq("id", taskId);
      if (updateTaskError) throw new Error(updateTaskError.message);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const { error: resetTaskError } = await supabaseClient
      .from("task")
      .update({
        last_completed_at: null,
        next_due_date: today,
        status: "active",
      })
      .eq("id", taskId);
    if (resetTaskError) throw new Error(resetTaskError.message);
  }

  async function handleUndoTask(item: CompletedItem) {
    if (!supabaseClient || actingHistoryId) return;
    setError(null);
    setMessage(null);
    setActingHistoryId(item.history.id);
    try {
      const { data: deletedRows, error: deleteError } = await supabaseClient
        .from("task_history")
        .delete()
        .eq("id", item.history.id)
        .select("id");
      if (deleteError) throw new Error(deleteError.message);
      if (!deletedRows || deletedRows.length === 0) {
        throw new Error("Undo failed: completion record was not deleted.");
      }

      await adjustPointsDown(item.history.user_id, item.history.points_awarded);
      await recalculateTaskAfterHistoryChange(item.history.task_id, item.history.previous_due_date);

      // Remove undone item immediately from completed view.
      setGroups((prev) =>
        prev
          .map((group) => ({
            ...group,
            items: group.items.filter((entry) => entry.history.id !== item.history.id),
          }))
          .filter((group) => group.items.length > 0),
      );
      setTotalPointsEarned((prev) => Math.max(0, prev - item.history.points_awarded));

      setMessage("Task undone and moved back to active tasks.");
      await loadCompleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to undo task.");
    } finally {
      setActingHistoryId(null);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Loading completed tasks...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f9fb] pb-24 text-[#191c1e]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-white/90 px-4 sm:px-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <Link href="/home" className="text-sm font-semibold text-teal-700">
          ← Home
        </Link>
        <p className="text-base font-bold text-slate-900">Completed Tasks</p>
        <span className="text-xs font-semibold text-amber-700">{totalPointsEarned} pts</span>
      </header>

      <section className="mx-auto w-full max-w-xl space-y-5 px-4 pt-6 sm:px-6">
        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}
        {message && (
          <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
            {message}
          </p>
        )}

        {!error && groups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/40 p-6 text-center">
            <p className="text-sm font-semibold text-teal-800">No completed tasks yet</p>
            <p className="mt-1 text-xs text-teal-700">Use the Nadeef button to complete tasks.</p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.room.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="rounded-xl bg-teal-50 p-2 text-base">
                {group.room.icon_ref || ROOM_EMOJI[group.room.type]}
              </span>
              <div>
                <p className="text-sm font-bold text-slate-900">{group.room.name}</p>
                <p className="text-[11px] text-slate-500">{group.items.length} completed</p>
              </div>
            </div>

            <div className="space-y-2">
              {group.items.map((item) => (
                <article
                  key={item.history.id}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-900">
                        <Link href={`/tasks/${item.history.task_id}`} className="hover:text-teal-700">
                          {item.taskName}
                        </Link>
                      </p>
                      <p className="mt-1 text-xs text-slate-500" suppressHydrationWarning>
                        Done {formatCompletedAt(item.history.completed_at)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Done by {item.doneByLabel}
                      </p>
                    </div>
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-600"
                      style={
                        item.doneByAvatarUrl
                          ? {
                              backgroundImage: `url("${item.doneByAvatarUrl}")`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      {!item.doneByAvatarUrl
                        ? item.doneByLabel
                            .split(" ")
                            .map((part) => part[0]?.toUpperCase() ?? "")
                            .join("")
                            .slice(0, 2) || "NA"
                        : null}
                    </div>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700">
                      +{item.history.points_awarded} pts
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleUndoTask(item)}
                      disabled={actingHistoryId === item.history.id || !currentUserId}
                      className="rounded-full bg-teal-100 px-3 py-1.5 text-[11px] font-semibold text-teal-700 disabled:opacity-60"
                    >
                      {actingHistoryId === item.history.id ? "Undoing..." : "Undo Task"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
      </section>

      <BottomNav />
    </main>
  );
}

export default function CompletedTasksPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
          <p className="text-sm text-slate-600">Loading completed tasks...</p>
        </main>
      }
    >
      <CompletedTasksPageContent />
    </Suspense>
  );
}
