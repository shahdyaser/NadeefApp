"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import BottomNav from "@/components/bottom-nav";

type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Database["public"]["Tables"]["task"]["Row"];
type RoomType = Database["public"]["Enums"]["room_type"];
type RoomWindow = "today" | "week" | "month";

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

function toFrequencyLabel(days: number) {
  if (days === 1) return "Daily";
  if (days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "Weekly" : `Every ${weeks} weeks`;
  }
  return `Every ${days} days`;
}

function getDueMeta(dateStr: string | null) {
  if (!dateStr) {
    return {
      label: "No due date",
      note: "Scheduled",
      barClass: "bg-slate-300",
      badgeClass: "text-slate-500",
      borderClass: "border-slate-300",
      width: "8%",
    };
  }

  const today = new Date();
  const due = new Date(dateStr);
  const ms = due.setHours(0, 0, 0, 0) - new Date(today.setHours(0, 0, 0, 0)).getTime();
  const days = Math.round(ms / 86400000);

  if (days < 0) {
    return {
      label: "Overdue",
      note: `${Math.abs(days)} day(s) late`,
      barClass: "bg-red-500",
      badgeClass: "text-red-600",
      borderClass: "border-red-500",
      width: "90%",
    };
  }

  if (days === 0) {
    return {
      label: "Due Today",
      note: "Urgent",
      barClass: "bg-orange-500",
      badgeClass: "text-orange-600",
      borderClass: "border-orange-500",
      width: "80%",
    };
  }

  return {
    label: `Due in ${days}d`,
    note: "Scheduled",
    barClass: "bg-slate-400",
    badgeClass: "text-slate-500",
    borderClass: "border-slate-300",
    width: "12%",
  };
}

type GroupedRoomTasks = {
  room: RoomRow | null;
  tasks: TaskRow[];
};
type MemberProfile = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};

function initialsFromName(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "NA"
  );
}

function groupTasksByRoom(rooms: RoomRow[], tasks: TaskRow[]) {
  const tasksByRoom = new Map<string, TaskRow[]>();
  const knownRoomIds = new Set(rooms.map((room) => room.id));
  const orphanTasks: TaskRow[] = [];
  for (const task of tasks) {
    if (!knownRoomIds.has(task.room_id)) {
      orphanTasks.push(task);
      continue;
    }
    const bucket = tasksByRoom.get(task.room_id) ?? [];
    bucket.push(task);
    tasksByRoom.set(task.room_id, bucket);
  }

  const grouped: GroupedRoomTasks[] = rooms
    .map((room) => ({
      room,
      tasks: tasksByRoom.get(room.id) ?? [],
    }))
    .filter((group) => group.tasks.length > 0);

  if (orphanTasks.length > 0) {
    grouped.push({ room: null, tasks: orphanTasks });
  }

  return grouped;
}

function getWindowTitle(window: RoomWindow) {
  if (window === "week") return "Due This Week";
  if (window === "month") return "Due This Month";
  return "Due Today";
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playDoneSound() {
  if (typeof window === "undefined") return;
  try {
    const WindowWithWebkitAudio = window as Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctx = window.AudioContext || WindowWithWebkitAudio.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.connect(gain);
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.linearRampToValueAtTime(988, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.36);
  } catch {
    // Ignore sound issues on unsupported browsers/autoplay policies.
  }
}

function DueTodayPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);
  const selectedWindow = useMemo<RoomWindow>(() => {
    const value = searchParams.get("window");
    if (value === "week" || value === "month") return value;
    return "today";
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberProfile>>({});
  const [windowTasks, setWindowTasks] = useState<TaskRow[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<TaskRow[]>([]);
  const [showOverdue, setShowOverdue] = useState(true);
  const [showAssignedToMeOnly, setShowAssignedToMeOnly] = useState(false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  useEffect(() => {
    async function loadDueTodayTasks() {
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
      setUserId(uid);
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

      const houseId = membershipData?.[0]?.house_id;
      if (!houseId) {
        router.replace("/setup");
        return;
      }

      const { data: roomData, error: roomError } = await supabaseClient
        .from("room")
        .select("*")
        .eq("house_id", houseId)
        .order("name", { ascending: true });

      if (roomError) {
        setError(roomError.message);
        setLoading(false);
        return;
      }

      const { data: memberData, error: memberError } = await supabaseClient
        .from("user_house_bridge")
        .select("user_id,display_name,avatar_url")
        .eq("house_id", houseId);
      if (memberError) {
        setError(memberError.message);
        setLoading(false);
        return;
      }

      const now = new Date();
      const todayIso = now.toISOString().slice(0, 10);

      const weekStartDate = new Date(now);
      weekStartDate.setHours(0, 0, 0, 0);
      weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay());
      const weekEndDate = new Date(weekStartDate);
      weekEndDate.setDate(weekStartDate.getDate() + 6);
      const weekStartIso = weekStartDate.toISOString().slice(0, 10);
      const weekEndIso = weekEndDate.toISOString().slice(0, 10);

      const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      const monthStartIso = monthStartDate.toISOString().slice(0, 10);
      const monthEndIso = monthEndDate.toISOString().slice(0, 10);

      let taskQuery = supabaseClient
        .from("task")
        .select("*")
        .eq("house_id", houseId)
        .eq("status", "active")
        .not("next_due_date", "is", null);

      if (selectedWindow === "today") {
        taskQuery = taskQuery.lte("next_due_date", todayIso);
      } else if (selectedWindow === "week") {
        taskQuery = taskQuery.gte("next_due_date", weekStartIso).lte("next_due_date", weekEndIso);
      } else {
        taskQuery = taskQuery.lte("next_due_date", monthEndIso);
      }

      const { data: taskData, error: taskError } = await taskQuery.order("next_due_date", {
        ascending: true,
        nullsFirst: false,
      });

      if (taskError) {
        setError(taskError.message);
        setLoading(false);
        return;
      }

      const tasks = taskData ?? [];
      let currentWindowTasks: TaskRow[] = [];
      let overdue: TaskRow[] = [];

      if (selectedWindow === "today") {
        currentWindowTasks = tasks.filter((task) => task.next_due_date === todayIso);
        overdue = tasks.filter((task) => !!task.next_due_date && task.next_due_date < todayIso);
      } else if (selectedWindow === "week") {
        currentWindowTasks = tasks;
      } else {
        currentWindowTasks = tasks.filter(
          (task) =>
            !!task.next_due_date &&
            task.next_due_date >= monthStartIso &&
            task.next_due_date <= monthEndIso,
        );
        overdue = tasks.filter((task) => !!task.next_due_date && task.next_due_date < monthStartIso);
      }

      setRooms(roomData ?? []);
      setMemberProfiles(
        Object.fromEntries((memberData ?? []).map((m) => [m.user_id, m])) as Record<
          string,
          MemberProfile
        >,
      );
      setWindowTasks(currentWindowTasks);
      setOverdueTasks(overdue);
      setShowOverdue(selectedWindow !== "week");
      setLoading(false);
    }

    void loadDueTodayTasks();
  }, [router, selectedWindow, supabaseClient]);

  async function handleNadeef(task: TaskRow) {
    if (!supabaseClient || completingTaskId) return;
    setError(null);
    setMessage(null);
    setCompletingTaskId(task.id);

    await wait(1200);

    let uid = userId;
    if (!uid) {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      uid = sessionData.session?.user?.id ?? null;
    }

    if (!uid) {
      setCompletingTaskId(null);
      router.replace("/");
      return;
    }

    const { error: completeError } = await supabaseClient.from("task_history").insert({
      task_id: task.id,
      user_id: uid,
      previous_due_date: task.next_due_date,
      points_awarded: task.effort_points,
    });

    if (completeError) {
      setError(completeError.message);
      setCompletingTaskId(null);
      return;
    }

    playDoneSound();
    setWindowTasks((prev) => prev.filter((item) => item.id !== task.id));
    setOverdueTasks((prev) => prev.filter((item) => item.id !== task.id));
    setMessage(`"${task.name}" is done. Great job!`);
    setCompletingTaskId(null);
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Loading due today tasks...</p>
      </main>
    );
  }

  const includeOverdue = selectedWindow === "today" || showOverdue;
  const visibleTasks = includeOverdue ? [...overdueTasks, ...windowTasks] : windowTasks;
  const filteredTasks = showAssignedToMeOnly
    ? visibleTasks.filter((task) => {
        if (!userId) return false;
        if (task.assigned_user_ids?.length) {
          return task.assigned_user_ids.includes(userId);
        }
        return task.assigned_to === userId;
      })
    : visibleTasks;
  const groups: GroupedRoomTasks[] = groupTasksByRoom(rooms, filteredTasks);
  const visibleCount = filteredTasks.length;
  const windowTitle = getWindowTitle(selectedWindow);
  const groupCountLabel = includeOverdue
    ? "due/overdue"
    : selectedWindow === "week"
      ? "due this week"
      : "due this month";

  return (
    <main className="min-h-screen bg-[#f7f9fb] pb-24 text-[#191c1e]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-white/90 px-4 sm:px-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <Link href="/home" className="text-sm font-semibold text-teal-700">
          ← Home
        </Link>
        <p className="text-base font-bold text-slate-900">{windowTitle}</p>
        <span className="w-[52px] text-right text-xs font-semibold text-orange-600">
          {visibleCount}
        </span>
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

        <div className="space-y-2">
          {!error && selectedWindow === "month" && overdueTasks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowOverdue((prev) => !prev)}
              className={`w-full rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                showOverdue
                  ? "border-red-300 bg-red-50 text-red-700"
                  : "border-orange-300 bg-orange-50 text-orange-700"
              }`}
            >
              {showOverdue
                ? `Overdue shown (${overdueTasks.length}) - Tap to hide`
                : `Show overdue tasks (${overdueTasks.length})`}
            </button>
          )}

          {!error && (
            <button
              type="button"
              onClick={() => setShowAssignedToMeOnly((prev) => !prev)}
              className={`w-full rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                showAssignedToMeOnly
                  ? "border-teal-300 bg-teal-50 text-teal-700"
                  : "border-slate-300 bg-white text-slate-700"
              }`}
            >
              {showAssignedToMeOnly ? "Assigned to me only: ON" : "Filter: Assigned to me only"}
            </button>
          )}
        </div>

        {!error && groups.length === 0 && (
          <div className="rounded-2xl border border-dashed border-orange-300 bg-orange-50/40 p-6 text-center">
            <p className="text-sm font-semibold text-orange-700">
              {includeOverdue ? "No due or overdue tasks" : `No tasks in ${windowTitle.toLowerCase()}`}
            </p>
            <p className="mt-1 text-xs text-orange-700/80">
              You are all caught up. Check other tasks from the Tasks tab.
            </p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.room?.id ?? "unknown-room"} className="space-y-3">
            <div className="flex items-center justify-between">
              {group.room ? (
                <Link href={`/room/${group.room.id}`} className="flex items-center gap-2">
                  <span className="rounded-xl bg-teal-50 p-2 text-base">
                    {group.room.icon_ref || ROOM_EMOJI[group.room.type]}
                  </span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">{group.room.name}</p>
                    <p className="text-[11px] text-slate-500">
                    {group.tasks.length} {groupCountLabel}
                    </p>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="rounded-xl bg-slate-100 p-2 text-base">📌</span>
                  <div>
                    <p className="text-sm font-bold text-slate-900">Unlinked Room</p>
                    <p className="text-[11px] text-slate-500">
                      {group.tasks.length} due/overdue
                    </p>
                  </div>
                </div>
              )}
            </div>

            {group.tasks.map((task) => {
              const dueMeta = getDueMeta(task.next_due_date);
              const effortStars = Math.max(1, Math.min(3, Math.round(task.effort_points / 10)));
              const assigneeId =
                task.assigned_user_ids?.[0] || task.assigned_to || null;
              const profile = assigneeId ? memberProfiles[assigneeId] : undefined;
              const label = profile?.display_name?.trim() || "Unassigned";
              const initials = initialsFromName(label);

              return (
                <article
                  key={task.id}
                  className={`relative rounded-2xl border-l-4 bg-white p-5 shadow-sm ${dueMeta.borderClass}`}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900">
                        <Link href={`/tasks/${task.id}`} className="hover:text-teal-700">
                          {task.name}
                        </Link>
                      </h4>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex">
                          {[1, 2, 3].map((star) => (
                            <span
                              key={star}
                              className={`text-sm ${
                                star <= effortStars ? "text-amber-500" : "text-slate-300"
                              }`}
                            >
                              ★
                            </span>
                          ))}
                        </div>
                        <span className="text-[11px] font-medium text-slate-500">
                          • {toFrequencyLabel(task.frequency_days)}
                        </span>
                      </div>
                    </div>
                    <div
                      className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-slate-100 text-xs font-bold text-slate-600 shadow-sm"
                      style={
                        profile?.avatar_url
                          ? {
                              backgroundImage: `url("${profile.avatar_url}")`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      {!profile?.avatar_url ? initials : null}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <div className="mr-6 flex-1">
                      <div className="mb-1 flex justify-between text-[10px] font-bold">
                        <span className={`${dueMeta.badgeClass} uppercase`}>{dueMeta.label}</span>
                        <span className="text-slate-500">{dueMeta.note}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-200">
                        <div
                          className={`h-full rounded-full ${dueMeta.barClass}`}
                          style={{ width: dueMeta.width }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleNadeef(task)}
                      disabled={completingTaskId === task.id}
                      className={`flex items-center gap-2 rounded-full px-4 py-2 text-white shadow-lg transition-all active:scale-95 ${
                        completingTaskId === task.id
                          ? "bg-teal-600/80"
                          : "bg-gradient-to-br from-teal-700 to-teal-400"
                      }`}
                    >
                      <span className={`text-sm ${completingTaskId === task.id ? "animate-spin" : ""}`}>
                        {completingTaskId === task.id ? "◌" : "✓"}
                      </span>
                      <span className="text-xs font-bold uppercase tracking-wide">
                        {completingTaskId === task.id ? "Nadeefing..." : "Nadeef"}
                      </span>
                    </button>
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </section>

      <BottomNav />
    </main>
  );
}

export default function DueTodayPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
          <p className="text-sm text-slate-600">Loading due tasks...</p>
        </main>
      }
    >
      <DueTodayPageContent />
    </Suspense>
  );
}
