"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { getViewCache, setViewCache } from "@/lib/view-cache";
import { useScrollRestoration } from "@/lib/scroll-restoration";
import BottomNav from "@/components/bottom-nav";
import PostponeSkipModal, { type PostponeChoice } from "@/components/postpone-skip-modal";
import TaskEditorModal, {
  type TaskEditorMemberOption,
  type TaskEditorValues,
} from "@/components/task-editor-modal";

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
type TasksCachePayload = {
  userId: string | null;
  canManageTasks: boolean;
  rooms: RoomRow[];
  tasksWithRoom: TaskWithRoom[];
  members: TaskEditorMemberOption[];
  memberProfiles: Record<string, MemberProfile>;
  freshness: number;
  doneToday: number;
  dueToday: number;
  overdue: number;
};
const TASKS_CACHE_KEY = "tasks";
const SWIPE_ACTION_WIDTH = 204;
type DueDateFilter = "all" | "overdue" | "today" | "tomorrow" | "week" | "month" | "later";

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
  const saveTasksScroll = useScrollRestoration("tasks");
  const router = useRouter();
  const cachedTasks = useMemo(
    () => getViewCache<TasksCachePayload>(TASKS_CACHE_KEY),
    [],
  );
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(!cachedTasks);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(cachedTasks?.userId ?? null);
  const [canManageTasks, setCanManageTasks] = useState(cachedTasks?.canManageTasks ?? false);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);
  const [savingTaskEdit, setSavingTaskEdit] = useState(false);
  const [postponeTask, setPostponeTask] = useState<TaskRow | null>(null);
  const [postponeResolve, setPostponeResolve] = useState<((choice: PostponeChoice | null) => void) | null>(
    null,
  );
  const [rooms, setRooms] = useState<RoomRow[]>(cachedTasks?.rooms ?? []);
  const [tasksWithRoom, setTasksWithRoom] = useState<TaskWithRoom[]>(cachedTasks?.tasksWithRoom ?? []);
  const [members, setMembers] = useState<TaskEditorMemberOption[]>(cachedTasks?.members ?? []);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberProfile>>(
    cachedTasks?.memberProfiles ?? {},
  );
  const [freshness, setFreshness] = useState(cachedTasks?.freshness ?? 0);
  const [doneToday, setDoneToday] = useState(cachedTasks?.doneToday ?? 0);
  const [dueToday, setDueToday] = useState(cachedTasks?.dueToday ?? 0);
  const [overdue, setOverdue] = useState(cachedTasks?.overdue ?? 0);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRoomFilter, setSelectedRoomFilter] = useState("all");
  const [selectedAssigneeFilter, setSelectedAssigneeFilter] = useState("all");
  const [selectedDueDateFilter, setSelectedDueDateFilter] = useState<DueDateFilter>("all");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem("tasks:ui");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<{
        showFilters: boolean;
        selectedRoomFilter: string;
        selectedAssigneeFilter: string;
        selectedDueDateFilter: DueDateFilter;
      }>;
      // Defer to avoid cascading renders lint (and to keep hydration stable).
      window.setTimeout(() => {
        if (typeof parsed.showFilters === "boolean") setShowFilters(parsed.showFilters);
        if (typeof parsed.selectedRoomFilter === "string") setSelectedRoomFilter(parsed.selectedRoomFilter);
        if (typeof parsed.selectedAssigneeFilter === "string")
          setSelectedAssigneeFilter(parsed.selectedAssigneeFilter);
        if (typeof parsed.selectedDueDateFilter === "string")
          setSelectedDueDateFilter(parsed.selectedDueDateFilter as DueDateFilter);
      }, 0);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(
        "tasks:ui",
        JSON.stringify({
          showFilters,
          selectedRoomFilter,
          selectedAssigneeFilter,
          selectedDueDateFilter,
        }),
      );
    } catch {
      // ignore
    }
  }, [showFilters, selectedRoomFilter, selectedAssigneeFilter, selectedDueDateFilter]);

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
        .select("house_id,role")
        .eq("user_id", uid)
        .limit(1);

      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      const houseId = membershipData?.[0]?.house_id;
      const role = membershipData?.[0]?.role;
      if (!houseId) {
        router.replace("/setup");
        return;
      }
      setCanManageTasks(role === "owner" || role === "member");

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
      const memberOptions: TaskEditorMemberOption[] = (memberData ?? []).map((member) => {
        const label = member.display_name?.trim() || "Member";
        return {
          userId: member.user_id,
          label,
          initials: initialsFromName(label),
          avatarUrl: member.avatar_url,
        };
      });

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

      const roomFreshnessValues = (roomData ?? []).map((room) =>
        getFreshnessFromTasks(
          active
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

      setRooms((roomData ?? []) as RoomRow[]);
      setTasksWithRoom(rows);
      setMembers(memberOptions);
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
      setViewCache<TasksCachePayload>(TASKS_CACHE_KEY, {
        userId: uid,
        canManageTasks: role === "owner" || role === "member",
        rooms: (roomData ?? []) as RoomRow[],
        tasksWithRoom: rows,
        members: memberOptions,
        memberProfiles: Object.fromEntries((memberData ?? []).map((m) => [m.user_id, m])) as Record<
          string,
          MemberProfile
        >,
        freshness: freshnessValue,
        doneToday: doneTodayCount,
        dueToday: dueTodayCount,
        overdue: overdueCount,
      });
      setLoading(false);
  }, [router, supabaseClient]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTasks();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadTasks]);

  async function handleNadeefTask(task: TaskRow) {
    if (!supabaseClient || !userId || completingTaskId) return;
    setError(null);
    setCompletingTaskId(task.id);
    await wait(1200);

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

  async function handleSkipTask(task: TaskRow) {
    if (!supabaseClient || !canManageTasks) return;
    setError(null);
    const todayIso = new Date().toISOString().slice(0, 10);
    if (!task.next_due_date || task.next_due_date > todayIso) {
      return;
    }

    const choice = await new Promise<PostponeChoice | null>((resolve) => {
      setPostponeTask(task);
      setPostponeResolve(() => resolve);
    });
    if (!choice) return;

    const nextDue = new Date();
    nextDue.setDate(
      nextDue.getDate() + (choice === "tomorrow" ? 1 : Math.max(1, task.frequency_days)),
    );
    const { error: skipError } = await supabaseClient
      .from("task")
      .update({
        next_due_date: nextDue.toISOString().slice(0, 10),
        status: "active",
      })
      .eq("id", task.id);
    if (skipError) {
      setError(skipError.message);
      return;
    }
    await loadTasks();
  }

  async function handleDeleteTask(task: TaskRow) {
    if (!supabaseClient || !canManageTasks) return;
    setError(null);
    const confirmed = window.confirm(`Delete "${task.name}"? This will also remove its history.`);
    if (!confirmed) return;

    const { error: deleteError } = await supabaseClient
      .from("task")
      .delete()
      .eq("id", task.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await loadTasks();
  }

  function openEditTaskModal(task: TaskRow) {
    if (!canManageTasks) return;
    setEditingTask(task);
  }

  async function handleSaveTaskEdit(values: TaskEditorValues) {
    if (!supabaseClient || !editingTask || !canManageTasks) return;
    setError(null);
    setSavingTaskEdit(true);
    const { error: updateError } = await supabaseClient
      .from("task")
      .update({
        name: values.name,
        room_id: values.roomId,
        next_due_date: values.nextDueDate,
        frequency_days: Math.max(1, values.frequencyDays),
        effort_points: values.effortPoints,
        assigned_to: values.assignedUserIds[0] ?? null,
        assigned_user_ids: values.assignedUserIds,
        assignment_mode: values.assignmentMode,
      })
      .eq("id", editingTask.id);
    setSavingTaskEdit(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setEditingTask(null);
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
  const filteredTasksWithRoom = tasksWithRoom.filter((row) => {
    const roomMatches = selectedRoomFilter === "all" || row.task.room_id === selectedRoomFilter;
    const assigneeMatches =
      selectedAssigneeFilter === "all"
        ? true
        : selectedAssigneeFilter === "me"
          ? (!!userId &&
              (row.task.assigned_to === userId ||
                row.task.assigned_user_ids?.includes(userId) === true))
          : row.task.assigned_to === selectedAssigneeFilter ||
            row.task.assigned_user_ids?.includes(selectedAssigneeFilter) === true;
    return roomMatches && assigneeMatches;
  });
  const overdueTasks = filteredTasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff < 0;
      })(),
  );
  const dueTodayTasks = filteredTasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff === 0;
      })(),
  );
  const dueTomorrowTasks = filteredTasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff === 1;
      })(),
  );
  const thisWeekTasks = filteredTasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff >= 2 && diff <= 7;
      })(),
  );
  const thisMonthTasks = filteredTasksWithRoom.filter(
    (row) =>
      row.task.status === "active" &&
      (() => {
        const diff = daysUntil(row.task.next_due_date, todayDate);
        return diff !== null && diff >= 8 && diff <= 30;
      })(),
  );
  const laterTasks = filteredTasksWithRoom.filter(
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
  const taskSections: Array<{
    key: Exclude<DueDateFilter, "all">;
    title: string;
    tone: "error" | "due" | "week";
    items: TaskWithRoom[];
    fallback: string;
  }> = [
    {
      key: "overdue",
      title: "Overdue",
      tone: "error",
      items: overdueTasks,
      fallback: "No overdue tasks.",
    },
    {
      key: "today",
      title: "Due Today",
      tone: "due",
      items: dueTodayTasks,
      fallback: "No tasks due today.",
    },
    {
      key: "tomorrow",
      title: "Due Tomorrow",
      tone: "due",
      items: dueTomorrowTasks,
      fallback: "No tasks due tomorrow.",
    },
    {
      key: "week",
      title: "This Week",
      tone: "week",
      items: thisWeekTasks,
      fallback: "No upcoming tasks.",
    },
    {
      key: "month",
      title: "This Month",
      tone: "week",
      items: thisMonthTasks,
      fallback: "No tasks later this month.",
    },
    {
      key: "later",
      title: "Later",
      tone: "week",
      items: laterTasks,
      fallback: "No later tasks.",
    },
  ];
  const hasActiveFilters =
    selectedRoomFilter !== "all" ||
    selectedAssigneeFilter !== "all" ||
    selectedDueDateFilter !== "all";
  const visibleSections =
    selectedDueDateFilter === "all"
      ? taskSections
      : selectedDueDateFilter === "week"
        ? taskSections.filter((section) =>
            ["overdue", "today", "tomorrow", "week"].includes(section.key),
          )
        : selectedDueDateFilter === "month"
          ? taskSections.filter((section) =>
              ["overdue", "today", "tomorrow", "week", "month"].includes(section.key),
            )
          : taskSections.filter((section) => section.key === selectedDueDateFilter);
  const sectionsToRender = hasActiveFilters
    ? visibleSections.filter((section) => section.items.length > 0)
    : visibleSections;

  return (
    <main className="min-h-screen bg-[#f7f9fb] font-sans text-[#191c1e]">
      <header className="fixed top-0 z-50 w-full bg-[#f7f9fb]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-teal-600">☰</span>
            <h1 className="text-lg font-semibold tracking-tight text-slate-900">All Tasks</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className={`relative flex h-8 w-8 items-center justify-center rounded-full border text-sm transition-colors ${
                showFilters || hasActiveFilters
                  ? "border-teal-200 bg-teal-50 text-teal-700"
                  : "border-slate-300 bg-white text-slate-500"
              }`}
              aria-label="Toggle task filters"
              title="Filters"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" aria-hidden="true">
                <path
                  d="M3 5h14M5 10h10M8 15h4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="7" cy="5" r="1.6" fill="currentColor" />
                <circle cx="12.5" cy="10" r="1.6" fill="currentColor" />
                <circle cx="10" cy="15" r="1.6" fill="currentColor" />
              </svg>
              {hasActiveFilters ? (
                <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-orange-500" />
              ) : null}
            </button>
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

        {showFilters ? (
          <section className="mb-6 rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                Filter Tasks
              </p>
              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRoomFilter("all");
                    setSelectedAssigneeFilter("all");
                    setSelectedDueDateFilter("all");
                  }}
                  className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600"
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Room
                </span>
                <select
                  value={selectedRoomFilter}
                  onChange={(event) => setSelectedRoomFilter(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-teal-400"
                >
                  <option value="all">All rooms</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Due Date
                </span>
                <select
                  value={selectedDueDateFilter}
                  onChange={(event) => setSelectedDueDateFilter(event.target.value as DueDateFilter)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-teal-400"
                >
                  <option value="all">All due dates</option>
                  <option value="overdue">Overdue</option>
                  <option value="today">Due today</option>
                  <option value="tomorrow">Due tomorrow</option>
                  <option value="week">This week</option>
                  <option value="month">This month</option>
                  <option value="later">Later</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Assignee
                </span>
                <select
                  value={selectedAssigneeFilter}
                  onChange={(event) => setSelectedAssigneeFilter(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-700 outline-none focus:border-teal-400"
                >
                  <option value="all">All assignees</option>
                  <option value="me">Assigned to me</option>
                  {members.map((member) => (
                    <option key={member.userId} value={member.userId}>
                      {member.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        ) : null}

        <div className="space-y-6">
          {sectionsToRender.length ? (
            sectionsToRender.map((section) => (
              <TaskGroup
                key={section.key}
                title={section.title}
                tone={section.tone}
                items={section.items}
                fallback={section.fallback}
                completingTaskId={completingTaskId}
                onConfirmTask={handleNadeefTask}
                onEditTask={openEditTaskModal}
                onSkipTask={handleSkipTask}
                onDeleteTask={handleDeleteTask}
                onNavigateTask={saveTasksScroll}
                canManageTasks={canManageTasks}
                memberProfiles={memberProfiles}
              />
            ))
          ) : (
            <p className="rounded-xl bg-white p-4 text-sm text-slate-500 shadow-sm">
              No tasks match the current filters.
            </p>
          )}
        </div>
      </section>

      <TaskEditorModal
        key={editingTask?.id ?? "closed"}
        open={!!editingTask}
        title="Edit Sanctuary Task"
        task={editingTask}
        rooms={rooms}
        members={members}
        saving={savingTaskEdit}
        onClose={() => setEditingTask(null)}
        onSave={handleSaveTaskEdit}
      />

      <PostponeSkipModal
        open={!!postponeTask}
        taskName={postponeTask?.name ?? "this task"}
        onChoose={(choice) => {
          postponeResolve?.(choice);
          setPostponeResolve(null);
          setPostponeTask(null);
        }}
        onClose={() => {
          postponeResolve?.(null);
          setPostponeResolve(null);
          setPostponeTask(null);
        }}
      />

      <BottomNav />
    </main>
  );
}

function TaskGroup({
  title,
  tone,
  items,
  fallback,
  onConfirmTask,
  onEditTask,
  onSkipTask,
  onDeleteTask,
  onNavigateTask,
  canManageTasks,
  completingTaskId,
  memberProfiles,
}: {
  title: string;
  tone: "error" | "due" | "week";
  items: TaskWithRoom[];
  fallback: string;
  onConfirmTask: (task: TaskRow) => void;
  onEditTask: (task: TaskRow) => void;
  onSkipTask: (task: TaskRow) => void;
  onDeleteTask: (task: TaskRow) => void;
  onNavigateTask: () => void;
  canManageTasks: boolean;
  completingTaskId: string | null;
  memberProfiles: Record<string, MemberProfile>;
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
  const [activeActionTaskId, setActiveActionTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const dragOriginXRef = useRef(0);
  const dragHasMovedRef = useRef(false);
  const groupedByRoom = useMemo(() => {
    const groups = new Map<string, { roomLabel: string; rows: TaskWithRoom[] }>();
    for (const row of items) {
      const roomLabel = row.room?.name ?? "Unlinked Room";
      const key = row.room?.id ?? "unlinked-room";
      const existing = groups.get(key);
      if (existing) {
        existing.rows.push(row);
      } else {
        groups.set(key, { roomLabel, rows: [row] });
      }
    }
    return Array.from(groups.values()).sort((a, b) => a.roomLabel.localeCompare(b.roomLabel));
  }, [items]);

  function handleTaskPointerDown(taskId: string, clientX: number) {
    const baseOffset = activeActionTaskId === taskId ? -SWIPE_ACTION_WIDTH : 0;
    setDragTaskId(taskId);
    setDragStartX(clientX);
    setDragOffset(baseOffset);
    dragOriginXRef.current = clientX;
    dragHasMovedRef.current = false;
  }

  function handleTaskPointerMove(taskId: string, clientX: number) {
    if (dragTaskId !== taskId) return;
    if (Math.abs(clientX - dragOriginXRef.current) > 6) {
      dragHasMovedRef.current = true;
    }
    const next = dragOffset + (clientX - dragStartX);
    const clamped = Math.min(0, Math.max(-SWIPE_ACTION_WIDTH, next));
    setDragOffset(clamped);
    setDragStartX(clientX);
  }

  function handleTaskPointerEnd(taskId: string) {
    if (dragTaskId !== taskId) return;
    const shouldOpen = dragOffset <= -(SWIPE_ACTION_WIDTH * 0.45);
    setActiveActionTaskId(shouldOpen ? taskId : null);
    setDragTaskId(null);
    setDragOffset(0);
  }

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

      <div className="space-y-3">
        {groupedByRoom.map((group) => (
          <section key={group.roomLabel} className="space-y-2">
            <h3 className="px-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              {group.roomLabel}
            </h3>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {group.rows.map(({ task, room }) => {
                const assigneeId =
                  task.assigned_user_ids?.[0] || task.assigned_to || null;
                const profile = assigneeId ? memberProfiles[assigneeId] : undefined;
                const label = profile?.display_name?.trim() || "Unassigned";
                const initials = initialsFromName(label);
                const todayIso = new Date().toISOString().slice(0, 10);
                const canSkipTask =
                  !!task.next_due_date && task.next_due_date <= todayIso;

                return (
                  <div key={task.id} className="relative overflow-hidden rounded-xl">
                    {canManageTasks ? (
                      <div className="absolute inset-y-0 right-0 flex w-[204px]">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveActionTaskId(null);
                            onEditTask(task);
                          }}
                          className={`flex items-center justify-center bg-amber-500 text-xs font-bold uppercase tracking-wide text-white ${
                            canSkipTask ? "w-1/3" : "w-1/2"
                          }`}
                        >
                          Edit
                        </button>
                        {canSkipTask ? (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveActionTaskId(null);
                              void onSkipTask(task);
                            }}
                            onPointerDown={(event) => event.stopPropagation()}
                            className="flex w-1/3 items-center justify-center bg-teal-700 text-xs font-bold uppercase tracking-wide text-white"
                          >
                            Skip
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => {
                            setActiveActionTaskId(null);
                            void onDeleteTask(task);
                          }}
                          className={`flex items-center justify-center bg-red-600 text-xs font-bold uppercase tracking-wide text-white ${
                            canSkipTask ? "w-1/3" : "w-1/2"
                          }`}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                    <div
                      className={`flex items-center justify-between rounded-xl border-l-4 bg-white p-2.5 shadow-sm transition-transform ${borderColor}`}
                      style={{
                        transform: `translateX(${
                          canManageTasks
                            ? dragTaskId === task.id
                              ? dragOffset
                              : activeActionTaskId === task.id
                                ? -SWIPE_ACTION_WIDTH
                                : 0
                            : 0
                        }px)`,
                        touchAction: "pan-y",
                      }}
                      onPointerDown={
                        canManageTasks
                          ? (event) => {
                              const target = event.target as HTMLElement | null;
                              if (target?.closest("a,button")) {
                                return;
                              }
                              try {
                                event.currentTarget.setPointerCapture(event.pointerId);
                              } catch {
                                // ignore
                              }
                              handleTaskPointerDown(task.id, event.clientX);
                            }
                          : undefined
                      }
                      onPointerMove={
                        canManageTasks ? (event) => handleTaskPointerMove(task.id, event.clientX) : undefined
                      }
                      onPointerUp={
                        canManageTasks
                          ? (event) => {
                              try {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              } catch {
                                // ignore
                              }
                              handleTaskPointerEnd(task.id);
                            }
                          : undefined
                      }
                      onPointerCancel={
                        canManageTasks
                          ? (event) => {
                              try {
                                event.currentTarget.releasePointerCapture(event.pointerId);
                              } catch {
                                // ignore
                              }
                              handleTaskPointerEnd(task.id);
                            }
                          : undefined
                      }
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">
                          {room ? room.icon_ref || ROOM_ICON[room.type] : "📌"}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/tasks/${task.id}`}
                            scroll={false}
                            className="truncate text-xs font-bold text-slate-900 hover:text-teal-700"
                            onClick={(event) => {
                              if (
                                canManageTasks &&
                                (activeActionTaskId === task.id ||
                                  (dragTaskId === task.id && dragHasMovedRef.current))
                              ) {
                                event.preventDefault();
                                event.stopPropagation();
                                return;
                              }
                              onNavigateTask();
                            }}
                          >
                            {task.name}
                          </Link>
                          <span className="mt-1 inline-flex rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                            {room?.name ?? "Room"}
                          </span>
                          <div className="mt-1 flex items-center gap-2">
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
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
