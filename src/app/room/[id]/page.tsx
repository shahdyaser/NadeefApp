"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Database["public"]["Tables"]["task"]["Row"];
type RoomType = Database["public"]["Enums"]["room_type"];
type PeriodWindow = "today" | "week" | "month";
type AssignmentMode = "together" | "round_robin";
type TaskEntryMode = "library" | "custom";
type MemberOption = {
  userId: string;
  label: string;
  initials: string;
  avatarUrl: string | null;
};
type TaskLibraryRow = Database["public"]["Tables"]["task_library"]["Row"];

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

const EFFORT_TO_POINTS = {
  1: 10,
  2: 20,
  3: 30,
} as const;
const SWIPE_ACTION_WIDTH = 204;
type TaskListFilter = "all" | "done_today" | "due_today" | "overdue";

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

  if (days <= 2) {
    return {
      label: `Due in ${days}d`,
      note: "Soon",
      barClass: "bg-teal-500",
      badgeClass: "text-teal-700",
      borderClass: "border-teal-500",
      width: "35%",
    };
  }

  return {
    label: days >= 7 ? "Next Week" : `Due in ${days}d`,
    note: "Scheduled",
    barClass: "bg-slate-400",
    badgeClass: "text-slate-500",
    borderClass: "border-slate-300",
    width: "12%",
  };
}

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getFreshnessTone(freshness: number) {
  if (freshness >= 80) {
    return {
      percentageClass: "text-teal-700",
      progressClass: "from-teal-700 to-teal-400",
      cardAccentClass: "bg-teal-50",
      message: "Great work. This room is looking fresh.",
      messageClass: "text-slate-600",
    };
  }

  if (freshness >= 50) {
    return {
      percentageClass: "text-amber-700",
      progressClass: "from-amber-600 to-amber-400",
      cardAccentClass: "bg-amber-50",
      message: "Nice progress. A few tasks will make it sparkle.",
      messageClass: "text-slate-600",
    };
  }

  return {
    percentageClass: "text-red-700",
    progressClass: "from-red-600 to-red-400",
    cardAccentClass: "bg-red-50",
    message: "You got this. One task at a time.",
    messageClass: "text-slate-600",
  };
}

export default function RoomDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const roomId = params.id;

  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [houseName, setHouseName] = useState<string>("Home");
  const [houseOwnerId, setHouseOwnerId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [roomsInHouse, setRoomsInHouse] = useState<RoomRow[]>([]);
  const [membersInHouse, setMembersInHouse] = useState<MemberOption[]>([]);
  const [taskLibrary, setTaskLibrary] = useState<TaskLibraryRow[]>([]);
  const [canManageTasks, setCanManageTasks] = useState(false);

  const [showAddTask, setShowAddTask] = useState(false);
  const [showEditRoom, setShowEditRoom] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const [editRoomName, setEditRoomName] = useState("");
  const [editRoomIconRef, setEditRoomIconRef] = useState("");
  const [taskName, setTaskName] = useState("");
  const [selectedRoomId, setSelectedRoomId] = useState<string>("");
  const [startingDueDate, setStartingDueDate] = useState("");
  const [frequencyValue, setFrequencyValue] = useState(3);
  const [frequencyUnit, setFrequencyUnit] = useState<"days" | "weeks" | "months">(
    "days",
  );
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>([]);
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>("together");
  const [showAssigneeMenu, setShowAssigneeMenu] = useState(false);
  const [effortStars, setEffortStars] = useState<1 | 2 | 3>(1);
  const [taskEntryMode, setTaskEntryMode] = useState<TaskEntryMode>("library");
  const [taskLibrarySearch, setTaskLibrarySearch] = useState("");
  const [selectedLibraryTaskId, setSelectedLibraryTaskId] = useState<string | null>(null);
  const [activeActionTaskId, setActiveActionTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [taskListFilter, setTaskListFilter] = useState<TaskListFilter>("all");
  const [periodWindow, setPeriodWindow] = useState<PeriodWindow>("today");
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  async function loadRoomData() {
    if (!supabaseClient) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      router.replace("/");
      return;
    }

    const uid = sessionData.session.user.id;
    setUserId(uid);

    const { data: roomData, error: roomError } = await supabaseClient
      .from("room")
      .select("*")
      .eq("id", roomId)
      .single();

    if (roomError) {
      setError(roomError.message);
      setLoading(false);
      return;
    }

    const { data: membershipData, error: membershipError } = await supabaseClient
      .from("user_house_bridge")
      .select("role")
      .eq("house_id", roomData.house_id)
      .eq("user_id", uid)
      .single();
    if (membershipError) {
      setError(membershipError.message);
      setLoading(false);
      return;
    }
    setCanManageTasks(
      membershipData.role === "owner" || membershipData.role === "member",
    );

    const { data: houseData, error: houseError } = await supabaseClient
      .from("house")
      .select("name,owner_id")
      .eq("id", roomData.house_id)
      .single();

    if (houseError) {
      setError(houseError.message);
      setLoading(false);
      return;
    }

    const { data: taskData, error: taskError } = await supabaseClient
      .from("task")
      .select("*")
      .eq("room_id", roomId)
      .order("next_due_date", { ascending: true, nullsFirst: false });

    if (taskError) {
      setError(taskError.message);
      setLoading(false);
      return;
    }

    const { data: roomListData, error: roomListError } = await supabaseClient
      .from("room")
      .select("*")
      .eq("house_id", roomData.house_id)
      .order("name", { ascending: true });

    if (roomListError) {
      setError(roomListError.message);
      setLoading(false);
      return;
    }

    const { data: membersData, error: membersError } = await supabaseClient
      .from("user_house_bridge")
      .select("user_id,display_name,avatar_url")
      .eq("house_id", roomData.house_id)
      .order("created_at", { ascending: true });

    if (membersError) {
      setError(membersError.message);
      setLoading(false);
      return;
    }

    const { data: libraryData } = await supabaseClient
      .from("task_library")
      .select("*")
      .order("name", { ascending: true });

    setRoom(roomData);
    setHouseName(houseData.name);
    setHouseOwnerId(houseData.owner_id ?? null);
    const sortedTasks = [...(taskData ?? [])].sort((a, b) => {
      if (!a.next_due_date && !b.next_due_date) return 0;
      if (!a.next_due_date) return 1;
      if (!b.next_due_date) return -1;
      return a.next_due_date.localeCompare(b.next_due_date);
    });

    setTasks(sortedTasks);
    setRoomsInHouse(roomListData ?? []);
    const memberOptions: MemberOption[] = (membersData ?? []).map((member, index) => {
      const isCurrentUser = member.user_id === uid;
      const baseLabel =
        member.display_name?.trim() || (isCurrentUser ? "You" : `Member ${index + 1}`);
      return {
        userId: member.user_id,
        label: baseLabel,
        initials: baseLabel
          .split(" ")
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? "")
          .join(""),
        avatarUrl: member.avatar_url,
      };
    });
    setMembersInHouse(memberOptions);
    setTaskLibrary((libraryData ?? []) as TaskLibraryRow[]);
    setLoading(false);
  }

  useEffect(() => {
    void loadRoomData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    if (!supabaseClient || !room || !userId) return;
    if (!canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    if (!selectedRoomId) {
      setError("Please select a room.");
      return;
    }
    if (!selectedAssigneeIds.length) {
      setError("Please select at least one assignee.");
      return;
    }
    if (!startingDueDate) {
      setError("Please choose a starting due date.");
      return;
    }

    const selectedLibraryTask =
      taskEntryMode === "library" && !editingTask
        ? taskLibrary.find((entry) => entry.id === selectedLibraryTaskId) ??
          taskLibrary.find(
            (entry) =>
              entry.name.trim().toLowerCase() === taskName.trim().toLowerCase(),
          )
        : null;

    const frequencyDays = selectedLibraryTask
      ? selectedLibraryTask.default_frequency_days
      : frequencyUnit === "days"
        ? frequencyValue
        : frequencyUnit === "weeks"
          ? frequencyValue * 7
          : frequencyValue * 30;
    const effectiveEffortStars = selectedLibraryTask
      ? (Math.max(1, Math.min(3, selectedLibraryTask.default_effort)) as 1 | 2 | 3)
      : effortStars;

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + frequencyDays);

    setSaving(true);

    if (editingTask) {
      const updatePayload: Database["public"]["Tables"]["task"]["Update"] = {
        room_id: selectedRoomId,
        name: taskName.trim(),
        assigned_to: selectedAssigneeIds[0] ?? null,
        assigned_user_ids: selectedAssigneeIds,
        assignment_mode: assignmentMode,
        frequency_days: frequencyDays,
        effort_points: EFFORT_TO_POINTS[effectiveEffortStars],
      };

      if (!editingTask.next_due_date) {
        updatePayload.next_due_date = startingDueDate;
      }
      if (editingTask.next_due_date !== startingDueDate) {
        updatePayload.next_due_date = startingDueDate;
      }

      const { error: updateError } = await supabaseClient
        .from("task")
        .update(updatePayload)
        .eq("id", editingTask.id);
      setSaving(false);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setMessage("Task updated.");
    } else {
      const { error: insertError } = await supabaseClient.from("task").insert({
        room_id: selectedRoomId,
        house_id: room.house_id,
        assigned_to: selectedAssigneeIds[0] ?? houseOwnerId ?? userId,
        assigned_user_ids: selectedAssigneeIds,
        assignment_mode: assignmentMode,
        name: taskName.trim(),
        frequency_days: frequencyDays,
        effort_points: EFFORT_TO_POINTS[effectiveEffortStars],
        last_completed_at: null,
        next_due_date: startingDueDate,
        status: "active",
      });
      setSaving(false);

      if (insertError) {
        setError(insertError.message);
        return;
      }

      setMessage("Task added.");
    }

    setTaskName("");
    setSelectedRoomId(room.id);
    setStartingDueDate(new Date().toISOString().slice(0, 10));
    setFrequencyValue(3);
    setFrequencyUnit("days");
    setSelectedAssigneeIds(houseOwnerId ? [houseOwnerId] : [userId]);
    setAssignmentMode("together");
    setShowAssigneeMenu(false);
    setEffortStars(1);
    setTaskEntryMode("library");
    setTaskLibrarySearch("");
    setSelectedLibraryTaskId(null);
    setEditingTask(null);
    setShowAddTask(false);
    await loadRoomData();
  }

  async function handleSkipTask(task: TaskRow) {
    if (!supabaseClient) return;
    if (!canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    setError(null);
    setMessage(null);

    const nextDue = new Date();
    nextDue.setDate(nextDue.getDate() + task.frequency_days);

    const { error: updateError } = await supabaseClient
      .from("task")
      .update({
        next_due_date: nextDue.toISOString().slice(0, 10),
        status: "active",
      })
      .eq("id", task.id);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setActiveActionTaskId(null);
    setMessage("Task skipped. Due date moved forward with no points awarded.");
    await loadRoomData();
  }

  async function handleDeleteTask(task: TaskRow) {
    if (!supabaseClient) return;
    if (!canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    setError(null);
    setMessage(null);

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

    setActiveActionTaskId(null);
    setMessage("Task deleted.");
    await loadRoomData();
  }

  function openEditRoomModal() {
    if (!room || !canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    setEditRoomName(room.name);
    setEditRoomIconRef(room.icon_ref ?? "");
    setShowEditRoom(true);
  }

  async function handleSaveRoomEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabaseClient || !room) return;
    if (!canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    if (!editRoomName.trim()) {
      setError("Room name cannot be empty.");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: updateError } = await supabaseClient
      .from("room")
      .update({
        name: editRoomName.trim(),
        icon_ref: editRoomIconRef.trim() || null,
      })
      .eq("id", room.id);
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setShowEditRoom(false);
    setMessage("Room updated.");
    await loadRoomData();
  }

  async function handleNadeefTask(task: TaskRow) {
    if (!supabaseClient || !userId || completingTaskId) return;
    setError(null);
    setMessage(null);
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
    setMessage(`"${task.name}" completed.`);
    setCompletingTaskId(null);
    await loadRoomData();
  }

  function openAddTaskModal() {
    if (!canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    setEditingTask(null);
    setTaskName("");
    setSelectedRoomId(room?.id ?? "");
    setStartingDueDate(new Date().toISOString().slice(0, 10));
    setFrequencyValue(3);
    setFrequencyUnit("days");
    setSelectedAssigneeIds(houseOwnerId ? [houseOwnerId] : userId ? [userId] : []);
    setAssignmentMode("together");
    setShowAssigneeMenu(false);
    setEffortStars(1);
    setTaskEntryMode("library");
    setTaskLibrarySearch("");
    setSelectedLibraryTaskId(null);
    setShowAddTask(true);
  }

  function openEditTaskModal(task: TaskRow) {
    if (!canManageTasks) {
      setError("Helpers can only view and mark tasks as done.");
      return;
    }
    setEditingTask(task);
    setTaskName(task.name);
    setSelectedRoomId(task.room_id);
    setStartingDueDate(task.next_due_date ?? new Date().toISOString().slice(0, 10));
    const days = task.frequency_days;
    if (days % 30 === 0) {
      setFrequencyUnit("months");
      setFrequencyValue(Math.max(1, Math.round(days / 30)));
    } else if (days % 7 === 0) {
      setFrequencyUnit("weeks");
      setFrequencyValue(Math.max(1, Math.round(days / 7)));
    } else {
      setFrequencyUnit("days");
      setFrequencyValue(Math.max(1, days));
    }
    const assignees =
      task.assigned_user_ids && task.assigned_user_ids.length > 0
        ? task.assigned_user_ids
        : task.assigned_to
          ? [task.assigned_to]
          : userId
            ? [userId]
            : [];
    setSelectedAssigneeIds(assignees);
    setAssignmentMode(
      task.assignment_mode === "round_robin" ? "round_robin" : "together",
    );
    setShowAssigneeMenu(false);
    setEffortStars(Math.max(1, Math.min(3, Math.round(task.effort_points / 10))) as 1 | 2 | 3);
    setTaskEntryMode("custom");
    setTaskLibrarySearch(task.name);
    setSelectedLibraryTaskId(null);
    setShowAddTask(true);
  }

  function toggleAssignee(userIdValue: string) {
    setSelectedAssigneeIds((prev) => {
      if (prev.includes(userIdValue)) {
        const next = prev.filter((id) => id !== userIdValue);
        return next.length > 0 ? next : prev;
      }
      return [...prev, userIdValue];
    });
  }

  function applyLibraryTaskSelection(entry: TaskLibraryRow) {
    setTaskName(entry.name);
    setTaskLibrarySearch(entry.name);
    setSelectedLibraryTaskId(entry.id);
    setFrequencyUnit("days");
    setFrequencyValue(Math.max(1, entry.default_frequency_days));
    setEffortStars(
      Math.max(1, Math.min(3, entry.default_effort)) as 1 | 2 | 3,
    );
  }

  function handleTaskPointerDown(taskId: string, clientX: number) {
    const baseOffset = activeActionTaskId === taskId ? -SWIPE_ACTION_WIDTH : 0;
    setDragTaskId(taskId);
    setDragStartX(clientX);
    setDragOffset(baseOffset);
  }

  function handleTaskPointerMove(taskId: string, clientX: number) {
    if (dragTaskId !== taskId) return;
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

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Loading room detail...</p>
      </main>
    );
  }

  if (!room) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-center">
          <p className="text-sm text-red-700">{error ?? "Room not found."}</p>
          <Link
            href="/home"
            className="mt-3 inline-block rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
          >
            Back to Home
          </Link>
        </div>
      </main>
    );
  }

  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayDateOnly = formatDateKey(now);
  const weekStartDate = new Date(now);
  weekStartDate.setDate(now.getDate() - now.getDay());
  const weekEndDate = new Date(weekStartDate);
  weekEndDate.setDate(weekStartDate.getDate() + 6);
  const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  const periodStart =
    periodWindow === "today"
      ? todayDateOnly
      : periodWindow === "week"
        ? formatDateKey(weekStartDate)
        : formatDateKey(monthStartDate);
  const periodEnd =
    periodWindow === "today"
      ? todayDateOnly
      : periodWindow === "week"
        ? formatDateKey(weekEndDate)
        : formatDateKey(monthEndDate);

  const donePeriodTasks = tasks.filter((task) => {
    if (!task.last_completed_at) return false;
    const completedDate = formatDateKey(new Date(task.last_completed_at));
    return completedDate >= periodStart && completedDate <= periodEnd;
  });
  const duePeriodTasks = tasks.filter(
    (task) => !!task.next_due_date && task.next_due_date >= periodStart && task.next_due_date <= periodEnd,
  );
  const overduePeriodTasks = tasks.filter(
    (task) => !!task.next_due_date && task.next_due_date < todayDateOnly,
  );
  const scopedActiveTasks = tasks.filter(
    (task) => !!task.next_due_date && task.next_due_date <= periodEnd,
  );

  const dueTodayCount = duePeriodTasks.length;
  const doneTodayCount = donePeriodTasks.length;
  const overdueCount = overduePeriodTasks.length;
  const activeTaskCount = scopedActiveTasks.length;
  const pendingToday = dueTodayCount + overdueCount;
  const cleanliness =
    activeTaskCount === 0
      ? 100
      : Math.max(
          0,
          Math.min(100, Math.round(((activeTaskCount - pendingToday) / activeTaskCount) * 100)),
        );
  const freshnessTone = getFreshnessTone(cleanliness);

  const allPeriodTaskIds = new Set<string>([
    ...donePeriodTasks.map((task) => task.id),
    ...duePeriodTasks.map((task) => task.id),
    ...overduePeriodTasks.map((task) => task.id),
  ]);
  const periodTasks = tasks.filter((task) => allPeriodTaskIds.has(task.id));
  const filteredTasks = periodTasks.filter((task) => {
    if (taskListFilter === "done_today") {
      return donePeriodTasks.some((row) => row.id === task.id);
    }
    if (taskListFilter === "due_today") {
      return duePeriodTasks.some((row) => row.id === task.id);
    }
    if (taskListFilter === "overdue") {
      return overduePeriodTasks.some((row) => row.id === task.id);
    }
    return true;
  });
  const libraryQuery = taskLibrarySearch.trim().toLowerCase();
  const filteredLibraryTasks = taskLibrary
    .filter((entry) => {
      if (!libraryQuery) return true;
      return entry.name.toLowerCase().includes(libraryQuery);
    })
    .slice(0, 8);

  return (
    <main className="min-h-screen bg-[#f7f9fb] pb-24 text-[#191c1e]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-white/90 px-4 sm:px-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <Link href="/home" className="text-sm font-semibold text-teal-700">
            ← {houseName}
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-base font-bold text-slate-900">{room.name}</p>
          {canManageTasks && (
            <button
              type="button"
              onClick={openEditRoomModal}
              className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-teal-700"
            >
              Edit
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={openAddTaskModal}
          disabled={!canManageTasks}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            canManageTasks
              ? "bg-teal-50 text-teal-700"
              : "cursor-not-allowed bg-slate-100 text-slate-400"
          }`}
        >
          + Task
        </button>
      </header>

      <section className="mx-auto w-full max-w-xl space-y-6 px-4 pt-6 sm:px-6">
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

        <section className="flex justify-center">
          <div className="inline-flex rounded-full bg-slate-200 p-1">
            <button
              type="button"
              onClick={() => {
                setPeriodWindow("today");
                setTaskListFilter("all");
              }}
              className={`rounded-full px-6 py-2 text-sm font-semibold shadow-sm ${
                periodWindow === "today"
                  ? "bg-teal-700 text-white"
                  : "text-slate-500"
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriodWindow("week");
                setTaskListFilter("all");
              }}
              className={`rounded-full px-6 py-2 text-sm font-semibold ${
                periodWindow === "week"
                  ? "bg-teal-700 text-white shadow-sm"
                  : "text-slate-500"
              }`}
            >
              This Week
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriodWindow("month");
                setTaskListFilter("all");
              }}
              className={`rounded-full px-6 py-2 text-sm font-semibold ${
                periodWindow === "month"
                  ? "bg-teal-700 text-white shadow-sm"
                  : "text-slate-500"
              }`}
            >
              This Month
            </button>
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-2xl border border-slate-200/60 bg-white p-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)]">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="mb-1 text-sm font-medium text-slate-500">{room.name} Status</p>
                <h2 className={`text-3xl font-extrabold tracking-tight ${freshnessTone.percentageClass}`}>
                  {cleanliness}%{" "}
                  <span className="text-lg font-medium text-slate-500">Cleanliness</span>
                </h2>
                <p className={`mt-1 text-xs font-medium ${freshnessTone.messageClass}`}>
                  {freshnessTone.message}
                </p>
              </div>
              <div className={`rounded-2xl px-4 py-3 text-3xl ${freshnessTone.cardAccentClass}`}>
                {room.icon_ref || ROOM_EMOJI[room.type]}
              </div>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${freshnessTone.progressClass}`}
                style={{ width: `${cleanliness}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <button
              type="button"
              onClick={() => setTaskListFilter((prev) => (prev === "done_today" ? "all" : "done_today"))}
              className={`rounded-2xl p-4 text-center shadow-sm transition ${
                taskListFilter === "done_today"
                  ? "bg-teal-50 ring-2 ring-teal-300"
                  : "bg-white"
              }`}
            >
              <span className="text-2xl font-bold text-teal-700">{doneTodayCount}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {periodWindow === "today"
                  ? "Done Today"
                  : periodWindow === "week"
                    ? "Done Week"
                    : "Done Month"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTaskListFilter((prev) => (prev === "due_today" ? "all" : "due_today"))}
              className={`rounded-2xl p-4 text-center shadow-sm transition ${
                taskListFilter === "due_today"
                  ? "bg-orange-50 ring-2 ring-orange-300"
                  : "bg-white"
              }`}
            >
              <span className="text-2xl font-bold text-orange-600">{dueTodayCount}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {periodWindow === "today"
                  ? "Due Today"
                  : periodWindow === "week"
                    ? "Due Week"
                    : "Due Month"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setTaskListFilter((prev) => (prev === "overdue" ? "all" : "overdue"))}
              className={`rounded-2xl p-4 text-center shadow-sm transition ${
                taskListFilter === "overdue"
                  ? "bg-red-50 ring-2 ring-red-300"
                  : "bg-white"
              }`}
            >
              <span className="text-2xl font-bold text-red-600">{overdueCount}</span>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Overdue
              </span>
            </button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">
              {taskListFilter === "done_today"
                ? periodWindow === "today"
                  ? "Done Today"
                  : periodWindow === "week"
                    ? "Done This Week"
                    : "Done This Month"
                : taskListFilter === "due_today"
                  ? periodWindow === "today"
                    ? "Due Today"
                    : periodWindow === "week"
                      ? "Due This Week"
                      : "Due This Month"
                  : taskListFilter === "overdue"
                    ? "Overdue"
                    : `${room.name} ${periodWindow === "today" ? "Today" : periodWindow === "week" ? "Week" : "Month"} Tasks`}
            </h2>
            {taskListFilter === "all" ? (
              <button
                type="button"
                onClick={openAddTaskModal}
                className={`text-sm font-medium ${
                  canManageTasks ? "text-teal-700" : "cursor-not-allowed text-slate-400"
                }`}
              >
                Add Task
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setTaskListFilter("all")}
                className="text-sm font-medium text-slate-600"
              >
                Show all
              </button>
            )}
          </div>

          {!filteredTasks.length && (
            <div className="rounded-2xl border border-dashed border-teal-300 bg-teal-50/50 p-6 text-center">
              <p className="text-sm font-semibold text-teal-800">0 tasks</p>
              <p className="mt-1 text-xs text-teal-700">
                {taskListFilter === "all"
                  ? "No tasks in this room yet. Add your first one."
                  : "No tasks in this filter right now."}
              </p>
              <button
                type="button"
                onClick={openAddTaskModal}
                disabled={!canManageTasks}
                className="mt-4 rounded-full bg-teal-700 px-4 py-2 text-xs font-semibold text-white"
              >
                Add Task
              </button>
            </div>
          )}

          {filteredTasks.map((task) => {
            const dueMeta = getDueMeta(task.next_due_date);
            const effortStars = Math.max(1, Math.min(3, Math.round(task.effort_points / 10)));
            const primaryAssigneeId =
              task.assigned_user_ids?.[0] || task.assigned_to || null;
            const assigneeProfile = primaryAssigneeId
              ? membersInHouse.find((member) => member.userId === primaryAssigneeId)
              : null;
            const assigneeInitials = assigneeProfile?.initials || "ME";
            const translateX =
              dragTaskId === task.id
                ? dragOffset
                : activeActionTaskId === task.id
                  ? -SWIPE_ACTION_WIDTH
                  : 0;

            return (
              <div key={task.id} className="relative overflow-hidden rounded-2xl">
                {canManageTasks ? (
                  <div className="absolute inset-y-0 right-0 flex w-[204px]">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveActionTaskId(null);
                        openEditTaskModal(task);
                      }}
                      className="flex w-1/3 items-center justify-center bg-amber-500 text-xs font-bold uppercase tracking-wide text-white"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSkipTask(task)}
                      className="flex w-1/3 items-center justify-center bg-teal-700 text-xs font-bold uppercase tracking-wide text-white"
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTask(task)}
                      className="flex w-1/3 items-center justify-center bg-red-600 text-xs font-bold uppercase tracking-wide text-white"
                    >
                      Delete
                    </button>
                  </div>
                ) : null}

                <article
                  className={`relative rounded-2xl border-l-4 bg-white p-5 shadow-sm ${dueMeta.borderClass} transition-transform`}
                  style={{
                    transform: `translateX(${canManageTasks ? translateX : 0}px)`,
                    touchAction: "pan-y",
                  }}
                  onPointerDown={
                    canManageTasks ? (event) => handleTaskPointerDown(task.id, event.clientX) : undefined
                  }
                  onPointerMove={
                    canManageTasks ? (event) => handleTaskPointerMove(task.id, event.clientX) : undefined
                  }
                  onPointerUp={canManageTasks ? () => handleTaskPointerEnd(task.id) : undefined}
                  onPointerCancel={canManageTasks ? () => handleTaskPointerEnd(task.id) : undefined}
                >
                  <div className="mb-3 flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-slate-900">{task.name}</h4>
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
                        assigneeProfile?.avatarUrl
                          ? {
                              backgroundImage: `url("${assigneeProfile.avatarUrl}")`,
                              backgroundSize: "cover",
                              backgroundPosition: "center",
                            }
                          : undefined
                      }
                    >
                      {!assigneeProfile?.avatarUrl ? assigneeInitials : null}
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
                      onClick={() => void handleNadeefTask(task)}
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
              </div>
            );
          })}
        </section>
      </section>

      {showAddTask && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/10 backdrop-blur-sm" />
          <section className="fixed bottom-0 left-0 right-0 z-[70] mx-auto w-full max-w-2xl overflow-hidden rounded-t-[2.5rem] bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.08)]">
            <div className="flex justify-center pb-2 pt-4">
              <div className="h-1.5 w-12 rounded-full bg-slate-300" />
            </div>

            <form
              onSubmit={handleCreateTask}
              className="hide-scrollbar max-h-[82vh] space-y-8 overflow-y-auto px-5 pb-10 pt-4 sm:px-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold tracking-tight text-slate-900">
                  {editingTask ? "Edit Sanctuary Task" : "New Sanctuary Task"}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowAddTask(false)}
                  className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                {!editingTask && (
                  <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Task Source
                    </p>
                    <div className="inline-flex rounded-full bg-slate-200 p-1">
                      <button
                        type="button"
                        onClick={() => setTaskEntryMode("library")}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          taskEntryMode === "library"
                            ? "bg-teal-700 text-white"
                            : "text-slate-600"
                        }`}
                      >
                        Search Library
                      </button>
                      <button
                        type="button"
                        onClick={() => setTaskEntryMode("custom")}
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          taskEntryMode === "custom"
                            ? "bg-teal-700 text-white"
                            : "text-slate-600"
                        }`}
                      >
                        Custom Task
                      </button>
                    </div>

                    {taskEntryMode === "library" && (
                      <div className="space-y-2">
                        <input
                          value={taskLibrarySearch}
                          onChange={(event) => {
                            setTaskLibrarySearch(event.target.value);
                            setSelectedLibraryTaskId(null);
                          }}
                          placeholder="Search task library (vacuum, sink, mop...)"
                          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-teal-400"
                        />
                        <div className="space-y-1">
                          {filteredLibraryTasks.map((entry) => (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => applyLibraryTaskSelection(entry)}
                              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-teal-300"
                            >
                              <span className="text-sm font-medium text-slate-700">{entry.name}</span>
                              <span className="text-[10px] font-semibold text-slate-500">
                                Every {entry.default_frequency_days}d - Effort {entry.default_effort}
                              </span>
                            </button>
                          ))}
                          {!filteredLibraryTasks.length && (
                            <p className="text-xs text-slate-500">
                              No library match. Switch to custom task.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <label className="ml-1 block text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Task Name
                </label>
                <input
                  required
                  value={taskName}
                  onChange={(event) => setTaskName(event.target.value)}
                  className="w-full rounded-xl border-none bg-slate-100 px-6 py-5 text-lg font-medium placeholder:text-slate-400 outline-none ring-2 ring-transparent transition-all focus:ring-teal-300"
                  placeholder="Deep Clean Living Room..."
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-end justify-between px-1">
                  <label className="block text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Select Room
                  </label>
                </div>
                <div className="hide-scrollbar -mx-2 flex gap-4 overflow-x-auto px-2 py-2">
                  {roomsInHouse.map((r) => {
                    const active = r.id === selectedRoomId;
                    return (
                      <button
                        type="button"
                        key={r.id}
                        onClick={() => setSelectedRoomId(r.id)}
                        className="flex flex-shrink-0 flex-col items-center gap-3"
                      >
                        <span
                          className={`flex h-20 w-20 items-center justify-center rounded-xl text-3xl ${
                            active
                              ? "bg-teal-200 text-teal-800 shadow-lg"
                              : "bg-slate-100 text-slate-400"
                          }`}
                        >
                          {r.icon_ref || ROOM_EMOJI[r.type]}
                        </span>
                        <span
                          className={`text-xs font-semibold ${active ? "text-teal-700" : "text-slate-500"}`}
                        >
                          {r.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-slate-500">
                  Task will be added to{" "}
                  {roomsInHouse.find((entry) => entry.id === selectedRoomId)?.name ?? room.name}.
                </p>
              </div>

              <div className="space-y-2">
                <label className="ml-1 block text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Starting Due Date
                </label>
                <input
                  aria-label="Starting due date"
                  type="date"
                  value={startingDueDate}
                  onChange={(event) => setStartingDueDate(event.target.value)}
                  className="w-full rounded-xl border-none bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 outline-none ring-2 ring-transparent transition-all focus:ring-teal-300"
                />
                <p className="text-xs text-slate-500">
                  Default is today. Change it if this task should start later.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                <div className="space-y-4">
                  <label className="ml-1 block text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Frequency
                  </label>
                  <div className="flex items-center gap-3 rounded-xl bg-slate-100 p-1">
                    <div className="flex flex-1 items-center gap-2 rounded-lg bg-white px-3 py-3 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setFrequencyValue((prev) => Math.max(1, prev - 1))}
                        className="h-8 w-8 rounded-full bg-slate-200 text-lg font-bold text-slate-700"
                        aria-label="Decrease frequency"
                      >
                        -
                      </button>
                      <span className="mb-1 block text-xs text-slate-500">Every</span>
                      <input
                        aria-label="Frequency value"
                        type="number"
                        min={1}
                        value={frequencyValue}
                        onChange={(event) =>
                          setFrequencyValue(Math.max(1, Number(event.target.value)))
                        }
                        className="w-14 bg-transparent p-0 text-center text-xl font-bold text-slate-900 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setFrequencyValue((prev) => prev + 1)}
                        className="h-8 w-8 rounded-full bg-slate-200 text-lg font-bold text-slate-700"
                        aria-label="Increase frequency"
                      >
                        +
                      </button>
                    </div>
                    <div className="flex-1 px-4 py-3">
                      <span className="mb-1 block text-[11px] font-medium text-slate-500">
                        Unit (dropdown)
                      </span>
                      <select
                        aria-label="Frequency unit"
                        value={frequencyUnit}
                        onChange={(event) =>
                          setFrequencyUnit(event.target.value as "days" | "weeks" | "months")
                        }
                        className="w-full appearance-none bg-transparent p-0 text-sm font-bold uppercase tracking-widest text-teal-700 outline-none"
                      >
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="ml-1 block text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Effort Level
                  </label>
                  <div className="flex h-[72px] items-center justify-around rounded-xl bg-slate-100 px-4">
                    {[1, 2, 3].map((star) => {
                      const active = star <= effortStars;
                      return (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setEffortStars(star as 1 | 2 | 3)}
                          className={`text-3xl transition-transform active:scale-90 ${
                            active ? "text-orange-400" : "text-slate-300"
                          }`}
                        >
                          ★
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <label className="ml-1 block text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Assignee
                </label>
                <button
                  type="button"
                  onClick={() => setShowAssigneeMenu((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-xl bg-slate-100 px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold text-slate-700">
                    {selectedAssigneeIds.length > 0
                      ? `${selectedAssigneeIds.length} selected`
                      : "Select assignees"}
                  </span>
                  <span className="text-slate-500">{showAssigneeMenu ? "▲" : "▼"}</span>
                </button>

                {showAssigneeMenu && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                    {membersInHouse.map((member) => {
                      const active = selectedAssigneeIds.includes(member.userId);
                      return (
                        <button
                          key={member.userId}
                          type="button"
                          onClick={() => toggleAssignee(member.userId)}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${
                            active ? "bg-teal-50" : "bg-slate-50"
                          }`}
                        >
                          <span
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-300 text-[10px] font-bold text-slate-700"
                            style={
                              member.avatarUrl
                                ? {
                                    backgroundImage: `url("${member.avatarUrl}")`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }
                                : undefined
                            }
                          >
                            {!member.avatarUrl ? member.initials : null}
                          </span>
                          <span className="flex-1 text-sm font-medium text-slate-700">{member.label}</span>
                          <span className={`text-xs font-bold ${active ? "text-teal-700" : "text-slate-400"}`}>
                            {active ? "Selected" : "Tap"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {selectedAssigneeIds.length > 1 && (
                  <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Advanced Assignee Settings
                    </p>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="assignment_mode"
                        checked={assignmentMode === "together"}
                        onChange={() => setAssignmentMode("together")}
                      />
                      Together (all selected members do this task)
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="assignment_mode"
                        checked={assignmentMode === "round_robin"}
                        onChange={() => setAssignmentMode("round_robin")}
                      />
                      Round Robin (one member each cycle)
                    </label>
                  </div>
                )}
              </div>

              <div className="space-y-5 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-teal-700 to-teal-400 py-5 text-lg font-bold text-white shadow-xl shadow-teal-700/20 transition-all active:scale-[0.98] disabled:opacity-60"
                >
                  <span>✓</span>
                  {saving
                    ? editingTask
                      ? "Saving..."
                      : "Creating..."
                    : editingTask
                      ? "Save Task"
                      : "Create Task"}
                </button>
                <p className="text-center text-sm font-medium text-slate-500">
                  This task will be added to your <span className="text-slate-900">Weekly Flow</span>
                </p>
              </div>
            </form>
          </section>
        </>
      )}

      {showEditRoom && (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveRoomEdit}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.2)]"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Edit Room</h3>
              <button
                type="button"
                onClick={() => setShowEditRoom(false)}
                className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Room Name
              </span>
              <input
                required
                value={editRoomName}
                onChange={(event) => setEditRoomName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                placeholder="Room name"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Icon (emoji)
              </span>
              <input
                value={editRoomIconRef}
                onChange={(event) => setEditRoomIconRef(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
                placeholder="e.g. 🛏️"
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-teal-700 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Room"}
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
