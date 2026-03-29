"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Database["public"]["Tables"]["task"]["Row"];

const ROOM_ICON: Record<Database["public"]["Enums"]["room_type"], string> = {
  kitchen: "🍳",
  bathroom: "🛁",
  bedroom: "🛏️",
  living_room: "🛋️",
  dining_room: "🍽️",
  laundry: "🧺",
  garage: "🚗",
  outdoor: "🌿",
  office: "💻",
  other: "🏠",
};

function effortStars(points: number) {
  return Math.max(1, Math.min(3, Math.round(points / 10)));
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
    // Ignore unsupported browser sound issues.
  }
}

function relativeDue(nextDueDate: string | null) {
  if (!nextDueDate) return "Scheduled";
  const today = new Date();
  const due = new Date(nextDueDate);
  const ms = due.setHours(0, 0, 0, 0) - new Date(today.setHours(0, 0, 0, 0)).getTime();
  const days = Math.round(ms / 86400000);

  if (days < 0) return days === -1 ? "Yesterday" : `${Math.abs(days)} days ago`;
  if (days === 0) return "Due Today";
  return `Due in ${days}d`;
}

function daysUntil(dateOnly: string | null, today: Date) {
  if (!dateOnly) return null;
  const target = new Date(dateOnly);
  const dayMs = 86400000;
  const base = new Date(today);
  base.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - base.getTime()) / dayMs);
}

function getFreshnessFromTasks(tasks: TaskRow[], today: string) {
  const dueTodayCount = tasks.filter((task) => !!task.next_due_date && task.next_due_date === today).length;
  const overdueCount = tasks.filter((task) => !!task.next_due_date && task.next_due_date < today).length;
  const pendingNow = dueTodayCount + overdueCount;

  if (pendingNow === 0) return 100;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(((tasks.length - pendingNow) / Math.max(tasks.length, 1)) * 100),
    ),
  );
}

type TaskWithRoom = {
  task: TaskRow;
  room: RoomRow | undefined;
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

export default function TasksPage() {
  const router = useRouter();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [tasksWithRoom, setTasksWithRoom] = useState<TaskWithRoom[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberProfile>>({});
  const [freshness, setFreshness] = useState(0);
  const [doneToday, setDoneToday] = useState(0);
  const [dueToday, setDueToday] = useState(0);
  const [overdue, setOverdue] = useState(0);

  const loadTasks = useCallback(async () => {
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
        .eq("house_id", houseId);
      if (roomError) {
        setError(roomError.message);
        setLoading(false);
        return;
      }

      const { data: taskData, error: taskError } = await supabaseClient
        .from("task")
        .select("*")
        .eq("house_id", houseId)
        .order("next_due_date", { ascending: true, nullsFirst: false });
      if (taskError) {
        setError(taskError.message);
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

      const roomsById = new Map((roomData ?? []).map((room) => [room.id, room]));
      const rows: TaskWithRoom[] = (taskData ?? []).map((task) => ({
        task,
        room: roomsById.get(task.room_id),
      }));

      const today = new Date().toISOString().slice(0, 10);
      const active = rows.filter((row) => row.task.status === "active");
      const dueTodayCount = active.filter((row) => row.task.next_due_date === today).length;
      const overdueCount = active.filter(
        (row) => !!row.task.next_due_date && row.task.next_due_date < today,
      ).length;
      const doneTodayCount = rows.filter(
        (row) =>
          !!row.task.last_completed_at &&
          new Date(row.task.last_completed_at).toISOString().slice(0, 10) === today,
      ).length;

      const scopedActive = active.filter(
        (row) => !!row.task.next_due_date && row.task.next_due_date <= today,
      );
      const roomFreshnessValues = (roomData ?? []).map((room) =>
        getFreshnessFromTasks(
          scopedActive
            .filter((row) => row.task.room_id === room.id)
            .map((row) => row.task),
          today,
        ),
      );
      const freshnessValue =
        roomFreshnessValues.length > 0
          ? Math.round(
              roomFreshnessValues.reduce((sum, value) => sum + value, 0) / roomFreshnessValues.length,
            )
          : 0;

      setTasksWithRoom(rows);
      setMemberProfiles(
        Object.fromEntries((memberData ?? []).map((m) => [m.user_id, m])) as Record<
          string,
          MemberProfile
        >,
      );
      setFreshness(freshnessValue);
      setDueToday(dueTodayCount);
      setOverdue(overdueCount);
      setDoneToday(doneTodayCount);
      setLoading(false);
  }, [router, supabaseClient]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
  }, [loadTasks]);

  async function handleNadeefTask(task: TaskRow) {
    if (!supabaseClient || !userId || completingTaskId) return;
    setError(null);
    setCompletingTaskId(task.id);
    await wait(2000);

    const { error: completeError } = await supabaseClient.from("task_history").insert({
      task_id: task.id,
      user_id: userId,
      previous_due_date: task.next_due_date,
      points_awarded: task.effort_points,
    });

    if (completeError) {
      setError(completeError.message);
      setCompletingTaskId(null);
      return;
    }

    playDoneSound();
    setCompletingTaskId(null);
    await loadTasks();
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Loading tasks...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      </main>
    );
  }

  const todayDate = new Date();
  const overdueTasks = tasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff < 0;
      })(),
  );
  const dueTodayTasks = tasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff === 0;
      })(),
  );
  const thisWeekTasks = tasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff >= 1 && diff <= 7;
      })(),
  );
  const thisMonthTasks = tasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff >= 8 && diff <= 30;
      })(),
  );
  const laterTasks = tasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff > 30;
      })(),
  );
  const currentProfile = userId ? memberProfiles[userId] : undefined;
  const currentInitials = initialsFromName(
    currentProfile?.display_name?.trim() || "You",
  );

  return (
    <main className="min-h-screen bg-[#f7f9fb] font-sans text-[#191c1e]">
      <header className="fixed top-0 z-50 w-full bg-[#f7f9fb]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="text-teal-600">☰</span>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">All Tasks</h1>
          </div>
          <div
            className="h-8 w-8 rounded-full border border-slate-300 bg-slate-100"
            style={
              currentProfile?.avatar_url
                ? {
                    backgroundImage: `url("${currentProfile.avatar_url}")`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }
                : undefined
            }
            aria-label="Current user avatar"
            title={currentProfile?.display_name?.trim() || "You"}
          >
            {!currentProfile?.avatar_url ? (
              <span className="flex h-full w-full items-center justify-center text-[9px] font-bold text-slate-600">
                {currentInitials}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-4 pb-28 pt-20">
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white p-3 shadow-sm">
          <div className="flex items-center gap-3 px-2">
            <div className="relative flex h-10 w-10 items-center justify-center">
              <svg className="h-full w-full -rotate-90">
                <circle
                  className="text-slate-200"
                  cx="20"
                  cy="20"
                  r="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <circle
                  className="text-teal-700"
                  cx="20"
                  cy="20"
                  r="18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeDasharray="113"
                  strokeDashoffset={Math.max(0, 113 - (113 * freshness) / 100)}
                />
              </svg>
              <span className="absolute text-[10px] font-bold">{freshness}%</span>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                Freshness
              </p>
              <p className="text-sm font-semibold text-teal-700">
                {freshness >= 80 ? "Excellent" : freshness >= 60 ? "Good" : "Needs Work"}
              </p>
            </div>
          </div>
          <div className="flex gap-4 pr-2">
            <div className="text-center">
              <p className="text-[10px] font-medium text-slate-500">Done</p>
              <p className="text-sm font-bold">{doneToday}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-medium text-slate-500">Due</p>
              <p className="text-sm font-bold text-orange-600">{dueToday}</p>
            </div>
            <div className="text-center">
              <p className="text-[10px] font-medium text-red-600">Overdue</p>
              <p className="text-sm font-bold text-red-600">{overdue}</p>
            </div>
          </div>
        </section>

        <div className="space-y-6">
          <TaskGroup
            title="Overdue"
            tone="error"
            items={overdueTasks}
            fallback="No overdue tasks."
            completingTaskId={completingTaskId}
            onConfirmTask={handleNadeefTask}
            memberProfiles={memberProfiles}
            currentUserId={userId}
          />
          <TaskGroup
            title="Due Today"
            tone="due"
            items={dueTodayTasks}
            fallback="No tasks due today."
            completingTaskId={completingTaskId}
            onConfirmTask={handleNadeefTask}
            memberProfiles={memberProfiles}
            currentUserId={userId}
          />
          <TaskGroup
            title="This Week"
            tone="week"
            items={thisWeekTasks}
            fallback="No upcoming tasks."
            completingTaskId={completingTaskId}
            onConfirmTask={handleNadeefTask}
            memberProfiles={memberProfiles}
            currentUserId={userId}
          />
          <TaskGroup
            title="This Month"
            tone="week"
            items={thisMonthTasks}
            fallback="No tasks later this month."
            completingTaskId={completingTaskId}
            onConfirmTask={handleNadeefTask}
            memberProfiles={memberProfiles}
            currentUserId={userId}
          />
          <TaskGroup
            title="Later"
            tone="week"
            items={laterTasks}
            fallback="No later tasks."
            completingTaskId={completingTaskId}
            onConfirmTask={handleNadeefTask}
            memberProfiles={memberProfiles}
            currentUserId={userId}
          />
        </div>
      </section>

      <nav className="fixed bottom-0 z-50 w-full rounded-t-[1.5rem] bg-[#f7f9fb]/90 shadow-[0_-10px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <div className="flex items-center justify-around px-4 pb-6 pt-3">
          <Link
            href="/home"
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500"
          >
            <span>🏠</span>
            <span className="text-[11px] font-medium tracking-wide">Home</span>
          </Link>
          <Link
            href="/tasks"
            className="flex flex-col items-center justify-center rounded-2xl bg-teal-50 px-5 py-2 text-teal-700"
          >
            <span>📝</span>
            <span className="text-[11px] font-medium tracking-wide">Tasks</span>
          </Link>
          <Link
            href="/leaderboard"
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500 hover:text-teal-700"
          >
            <span>🏆</span>
            <span className="text-[11px] font-medium tracking-wide">Leaderboard</span>
          </Link>
          <Link
            href="/profile"
            className="flex flex-col items-center justify-center px-5 py-2 text-slate-500 hover:text-teal-700"
          >
            <span>👤</span>
            <span className="text-[11px] font-medium tracking-wide">Profile</span>
          </Link>
        </div>
      </nav>
    </main>
  );
}

function TaskGroup({
  title,
  tone,
  items,
  fallback,
  onConfirmTask,
  completingTaskId,
  memberProfiles,
  currentUserId,
}: {
  title: string;
  tone: "error" | "due" | "week";
  items: TaskWithRoom[];
  fallback: string;
  onConfirmTask: (task: TaskRow) => void;
  completingTaskId: string | null;
  memberProfiles: Record<string, MemberProfile>;
  currentUserId: string | null;
}) {
  const headingColor =
    tone === "error"
      ? "text-red-600"
      : tone === "due"
        ? "text-orange-600"
        : "text-teal-700";
  const dotColor =
    tone === "error"
      ? "bg-red-600"
      : tone === "due"
        ? "bg-orange-600"
        : "bg-teal-700";
  const borderColor =
    tone === "error"
      ? "border-red-500"
      : tone === "due"
        ? "border-orange-500"
        : "border-slate-300";

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
        <h2 className={`text-[11px] font-bold uppercase tracking-widest ${headingColor}`}>
          {title}
        </h2>
      </div>

      {!items.length && (
        <p className="rounded-xl bg-white p-3 text-xs text-slate-500 shadow-sm">{fallback}</p>
      )}

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {items.map(({ task, room }) => {
          const assigneeId = task.assigned_to ?? currentUserId ?? "";
          const profile = assigneeId ? memberProfiles[assigneeId] : undefined;
          const label =
            profile?.display_name?.trim() ||
            (assigneeId && assigneeId === currentUserId ? "You" : "Member");
          const initials = initialsFromName(label);

          return (
            <div
            key={task.id}
            className={`flex items-center justify-between rounded-xl border-l-4 bg-white p-2.5 shadow-sm transition-shadow hover:shadow-md ${borderColor}`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
                {room ? ROOM_ICON[room.type] : "📌"}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs font-bold text-slate-900">{task.name}</p>
                  <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                    {room?.name ?? "Room"}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <div className="flex">
                    {[1, 2, 3].map((star) => (
                      <span
                        key={star}
                        className={`text-[10px] ${
                          star <= effortStars(task.effort_points)
                            ? "text-amber-500"
                            : "text-slate-300"
                        }`}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <span
                    className={`text-[10px] font-medium ${
                      tone === "error"
                        ? "text-red-600"
                        : tone === "due"
                          ? "text-orange-600"
                          : "text-slate-500"
                    }`}
                  >
                    {relativeDue(task.next_due_date)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div
                className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[8px] font-bold text-slate-600"
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
              <button
                type="button"
                onClick={() => onConfirmTask(task)}
                disabled={completingTaskId === task.id}
                className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  completingTaskId === task.id
                    ? "bg-teal-600/80 text-white"
                    : "bg-teal-100 text-teal-700"
                }`}
              >
                <span className={completingTaskId === task.id ? "animate-spin" : ""}>
                  {completingTaskId === task.id ? "◌" : "✓"}
                </span>
              </button>
            </div>
          </div>
          );
        })}
      </div>
    </section>
  );
}
