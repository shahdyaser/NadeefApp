"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { getViewCache, setViewCache } from "@/lib/view-cache";
import BottomNav from "@/components/bottom-nav";

type HouseRow = Database["public"]["Tables"]["house"]["Row"];
type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Pick<
  Database["public"]["Tables"]["task"]["Row"],
  "id" | "name" | "room_id" | "status" | "next_due_date" | "effort_points"
>;
type RoomType = Database["public"]["Enums"]["room_type"];
type RoomTaskSetupMode = "auto_library" | "empty_room";
type RoomTemplateKey =
  | "bedroom"
  | "dressing_room"
  | "bathroom"
  | "kitchen"
  | "dining_room"
  | "living_room"
  | "kids_room"
  | "office_room"
  | "entrance_hallway"
  | "laundry_room"
  | "balcony"
  | "terrace"
  | "basement"
  | "storage_room"
  | "garage"
  | "other";
type HomeCachePayload = {
  house: HouseRow | null;
  rooms: RoomRow[];
  tasks: TaskRow[];
  totalPoints: number;
  streakDays: number;
  canManageHome: boolean;
  notificationsEnabled: boolean;
};
const HOME_CACHE_KEY = "home";
const DEFAULT_ROOM_TEMPLATE: RoomTemplateKey = "bedroom";
type ReminderSlot = "morning" | "evening";
const REMINDER_CONFIG: Record<
  ReminderSlot,
  { hour: number; title: string; body: (pendingCount: number) => string }
> = {
  morning: {
    hour: 8,
    title: "Good Morning from Nadeef ☀️",
    body: (pendingCount) =>
      `🌿 A fresh home starts with one small win. You have ${pendingCount} task${pendingCount === 1 ? "" : "s"} today — you got this!`,
  },
  evening: {
    hour: 20,
    title: "Nadeef Evening Boost 🌙",
    body: (pendingCount) =>
      `✨ You are close! Finish the remaining ${pendingCount} task${pendingCount === 1 ? "" : "s"} and end the day proud.`,
  },
};

function toLocalDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getNextReminderTime(now: Date) {
  const slots: Array<{ slot: ReminderSlot; at: Date }> = (Object.keys(
    REMINDER_CONFIG,
  ) as ReminderSlot[]).map((slot) => {
    const at = new Date(now);
    at.setHours(REMINDER_CONFIG[slot].hour, 0, 0, 0);
    if (at <= now) {
      at.setDate(at.getDate() + 1);
    }
    return { slot, at };
  });
  slots.sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = slots[0];
  return next.at;
}

function hasSlotPassedToday(slot: ReminderSlot, now: Date) {
  return now.getHours() >= REMINDER_CONFIG[slot].hour;
}

function getReminderStorageKey(houseId: string, slot: ReminderSlot) {
  return `nadeef:reminder:${houseId}:${slot}`;
}

async function countPendingTasksToday(
  supabaseClient: ReturnType<typeof getSupabaseBrowserClient>,
  houseId: string,
  todayIso: string,
) {
  const { count, error } = await supabaseClient
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("house_id", houseId)
    .eq("status", "active")
    .not("next_due_date", "is", null)
    .lte("next_due_date", todayIso);
  if (error) return null;
  return Number(count ?? 0);
}

function getSentToday(slot: ReminderSlot, houseId: string, todayKey: string) {
  if (typeof window === "undefined") return false;
  return (
    window.localStorage.getItem(getReminderStorageKey(houseId, slot)) === todayKey
  );
}

function markSentToday(slot: ReminderSlot, houseId: string, todayKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getReminderStorageKey(houseId, slot), todayKey);
}

async function sendReminderForSlot({
  slot,
  houseId,
  todayKey,
  pendingCount,
  registration,
}: {
  slot: ReminderSlot;
  houseId: string;
  todayKey: string;
  pendingCount: number;
  registration: ServiceWorkerRegistration;
}) {
  const slotConfig = REMINDER_CONFIG[slot];
  await registration.showNotification(slotConfig.title, {
    body: slotConfig.body(pendingCount),
    icon: "/nadeef-logo.png",
    badge: "/nadeef-logo.png",
    tag: `nadeef-${slot}-${todayKey}`,
    data: { url: "/tasks/due-today?window=today" },
  });
  markSentToday(slot, houseId, todayKey);
}

function getDueReminderSlots(now: Date, houseId: string, todayKey: string) {
  return (Object.keys(REMINDER_CONFIG) as ReminderSlot[]).filter(
    (slot) => hasSlotPassedToday(slot, now) && !getSentToday(slot, houseId, todayKey),
  );
}

function toNextReminderDelayMs(now: Date) {
  const next = getNextReminderTime(now);
  return Math.max(1000, next.getTime() - Date.now());
}

function isNotificationSupported() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator
  );
}

function shouldRequestNotificationPermission() {
  return isNotificationSupported() && Notification.permission === "default";
}

function canSendNotificationsNow() {
  return isNotificationSupported() && Notification.permission === "granted";
}

function shouldSkipNotificationSetup({
  supabaseClient,
  house,
  notificationsEnabled,
}: {
  supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null;
  house: HouseRow | null;
  notificationsEnabled: boolean;
}) {
  return !supabaseClient || !house || !notificationsEnabled || !isNotificationSupported();
}

function getTodayKey() {
  return toLocalDateKey(new Date());
}

function getTodayIso() {
  return toLocalDateKey(new Date());
}

async function trySendDueReminders({
  supabaseClient,
  registration,
  houseId,
}: {
  supabaseClient: ReturnType<typeof getSupabaseBrowserClient>;
  registration: ServiceWorkerRegistration;
  houseId: string;
}) {
  const now = new Date();
  const todayKey = getTodayKey();
  const dueSlots = getDueReminderSlots(now, houseId, todayKey);
  if (!dueSlots.length) return;

  const pendingCount = await countPendingTasksToday(
    supabaseClient,
    houseId,
    getTodayIso(),
  );
  if (pendingCount === null || pendingCount <= 0) return;

  for (const slot of dueSlots) {
    await sendReminderForSlot({
      slot,
      houseId,
      todayKey,
      pendingCount,
      registration,
    });
  }
}

const ROOM_MODAL_OPTIONS: Array<{
  templateKey: RoomTemplateKey;
  type: RoomType;
  label: string;
  icon: string;
}> = [
  { templateKey: "bedroom", type: "bedroom", label: "Bedroom", icon: "🛏️" },
  { templateKey: "dressing_room", type: "bedroom", label: "Dressing Room", icon: "👗" },
  { templateKey: "bathroom", type: "bathroom", label: "Bathroom", icon: "🛁" },
  { templateKey: "kitchen", type: "kitchen", label: "Kitchen", icon: "🍳" },
  { templateKey: "dining_room", type: "dining_room", label: "Dining Room", icon: "🍽️" },
  { templateKey: "living_room", type: "living_room", label: "Living Room", icon: "🛋️" },
  { templateKey: "kids_room", type: "bedroom", label: "Kids Room", icon: "🧸" },
  { templateKey: "office_room", type: "office", label: "Office Room", icon: "💻" },
  { templateKey: "entrance_hallway", type: "other", label: "Entrance Hallway", icon: "🚪" },
  { templateKey: "laundry_room", type: "laundry", label: "Laundry Room", icon: "🧺" },
  { templateKey: "balcony", type: "outdoor", label: "Balcony", icon: "🌿" },
  { templateKey: "terrace", type: "outdoor", label: "Terrace", icon: "🌤️" },
  { templateKey: "basement", type: "other", label: "Basement", icon: "🏚️" },
  { templateKey: "storage_room", type: "other", label: "Storage Room", icon: "📦" },
  { templateKey: "garage", type: "garage", label: "Garage", icon: "🚗" },
  { templateKey: "other", type: "other", label: "Other", icon: "✨" },
];

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

function toRoomLabel(type: string) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (x) => x.toUpperCase());
}

function getRoomFreshnessTone(freshness: number) {
  if (freshness === 100) {
    return {
      cardClass: "border border-teal-100",
      badgeClass: "bg-teal-100 text-teal-800",
      progressClass: "bg-teal-400",
      iconClass: "bg-teal-50",
    };
  }

  if (freshness >= 50) {
    return {
      cardClass: "border border-amber-200",
      badgeClass: "bg-amber-100 text-amber-800",
      progressClass: "bg-amber-500",
      iconClass: "bg-amber-50",
    };
  }

  return {
    cardClass: "border border-red-200",
    badgeClass: "bg-red-100 text-red-700",
    progressClass: "bg-red-500",
    iconClass: "bg-red-50",
  };
}

function getFreshnessMessage(freshness: number) {
  if (freshness === 100) {
    return {
      text: "Amazing job. Your home is shining today.",
      percentageClass: "text-teal-700",
      progressClass: "bg-teal-500",
    };
  }

  if (freshness >= 50) {
    return {
      text: "Great progress. A few tasks and you are back on track.",
      percentageClass: "text-amber-700",
      progressClass: "bg-amber-500",
    };
  }

  return {
    text: "You got this. Start with one room and build momentum.",
    percentageClass: "text-red-700",
    progressClass: "bg-red-500",
  };
}

function getFreshnessFromTasks(tasks: TaskRow[], today: string) {
  const dueToday = tasks.filter(
    (task) => !!task.next_due_date && task.next_due_date === today,
  ).length;
  const overdue = tasks.filter(
    (task) => !!task.next_due_date && task.next_due_date < today,
  ).length;
  const pendingNow = dueToday + overdue;

  if (pendingNow === 0) return 100;

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(((tasks.length - pendingNow) / Math.max(tasks.length, 1)) * 100),
    ),
  );
}

export default function HomePage() {
  const router = useRouter();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [travelSaving, setTravelSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showTravelNotice, setShowTravelNotice] = useState(false);

  const [house, setHouse] = useState<HouseRow | null>(null);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [streakDays, setStreakDays] = useState(0);
  const [canManageHome, setCanManageHome] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("other");
  const [roomTemplate, setRoomTemplate] = useState<RoomTemplateKey>(DEFAULT_ROOM_TEMPLATE);
  const [roomIconRef, setRoomIconRef] = useState("");
  const [roomTaskSetupMode, setRoomTaskSetupMode] =
    useState<RoomTaskSetupMode>("auto_library");

  async function loadHome(background = false) {
    if (!supabaseClient) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    if (!background) {
      setLoading(true);
    }
    setError(null);

    const { data: sessionData, error: sessionError } =
      await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      router.replace("/");
      return;
    }

    const uid = sessionData.session.user.id;
    const { data: memberships, error: membershipError } = await supabaseClient
      .from("user_house_bridge")
      .select("house_id,total_points,current_streak_days,role,notifications_enabled")
      .eq("user_id", uid)
      .limit(1);

    if (membershipError) {
      setError(membershipError.message);
      setLoading(false);
      return;
    }

    const member = memberships?.[0];
    if (!member?.house_id) {
      router.replace("/setup");
      return;
    }

    const { data: houseData, error: houseError } = await supabaseClient
      .from("house")
      .select("*")
      .eq("id", member.house_id)
      .single();
    if (houseError) {
      setError(houseError.message);
      setLoading(false);
      return;
    }

    const { data: roomData, error: roomError } = await supabaseClient
      .from("room")
      .select("*")
      .eq("house_id", member.house_id)
      .order("created_at", { ascending: true });
    if (roomError) {
      setError(roomError.message);
      setLoading(false);
      return;
    }

    const { data: taskData, error: taskError } = await supabaseClient
      .from("task")
      .select("id,name,room_id,status,next_due_date,effort_points")
      .eq("house_id", member.house_id);
    if (taskError) {
      setError(taskError.message);
      setLoading(false);
      return;
    }

    setHouse(houseData);
    setRooms(roomData ?? []);
    setTasks((taskData ?? []) as TaskRow[]);
    setTotalPoints(member.total_points ?? 0);
    setCanManageHome(member.role === "owner" || member.role === "member");
    setNotificationsEnabled(member.notifications_enabled ?? true);
    setStreakDays(member.current_streak_days ?? 0);
    setViewCache<HomeCachePayload>(HOME_CACHE_KEY, {
      house: houseData,
      rooms: roomData ?? [],
      tasks: (taskData ?? []) as TaskRow[],
      totalPoints: member.total_points ?? 0,
      streakDays: member.current_streak_days ?? 0,
      canManageHome: member.role === "owner" || member.role === "member",
      notificationsEnabled: member.notifications_enabled ?? true,
    });
    setLoading(false);
  }

  useEffect(() => {
    const cached = getViewCache<HomeCachePayload>(HOME_CACHE_KEY);
    if (cached) {
      setHouse(cached.house);
      setRooms(cached.rooms);
      setTasks(cached.tasks);
      setTotalPoints(cached.totalPoints);
      setStreakDays(cached.streakDays);
      setCanManageHome(cached.canManageHome);
      setNotificationsEnabled(cached.notificationsEnabled ?? true);
      setLoading(false);
    }
    void loadHome(Boolean(cached));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (
      shouldSkipNotificationSetup({
        supabaseClient,
        house,
        notificationsEnabled,
      })
    ) {
      return;
    }

    let timerId: number | null = null;
    let cancelled = false;

    async function registerAndSchedule() {
      try {
        await navigator.serviceWorker.register("/sw.js");
        const registration = await navigator.serviceWorker.ready;
        if (!registration || cancelled) return;

        if (shouldRequestNotificationPermission()) {
          await Notification.requestPermission();
        }
        if (!canSendNotificationsNow() || cancelled) return;

        const scheduleNext = async () => {
          if (cancelled) return;
          await trySendDueReminders({
            supabaseClient,
            registration,
            houseId: house.id,
          });
          const delay = toNextReminderDelayMs(new Date());
          timerId = window.setTimeout(() => {
            void scheduleNext();
          }, delay);
        };

        await scheduleNext();
      } catch {
        // Ignore notification setup issues on unsupported platforms.
      }
    }

    void registerAndSchedule();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [house, notificationsEnabled, supabaseClient]);

  async function handleAddRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!supabaseClient || !house) return;
    if (!canManageHome) {
      setError("Helpers can only view and complete tasks.");
      return;
    }

    setSaving(true);
    const { data: sessionData } = await supabaseClient.auth.getSession();
    const defaultAssigneeId = house.owner_id ?? sessionData.session?.user?.id ?? null;
    const { data: newRoom, error: insertError } = await supabaseClient
      .from("room")
      .insert({
        house_id: house.id,
        name: roomName.trim(),
        type: roomType,
        icon_ref: roomIconRef.trim() || null,
      })
      .select("id")
      .single();
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    let addedTasksCount = 0;
    if (roomTaskSetupMode === "auto_library" && roomTemplate !== "other" && newRoom?.id) {
      const { data: libraryRows, error: libraryError } = await supabaseClient
        .from("task_library")
        .select("name,default_frequency_days,default_effort")
        .eq("room_template", roomTemplate);
      if (libraryError) {
        setError(libraryError.message);
        return;
      }

      const todayBase = new Date();
      todayBase.setHours(0, 0, 0, 0);
      const taskRows: Array<Database["public"]["Tables"]["task"]["Insert"]> = (
        libraryRows ?? []
      ).map((row) => {
        const firstDue = new Date(todayBase);
        firstDue.setDate(firstDue.getDate() + row.default_frequency_days);
        return {
          room_id: newRoom.id,
          house_id: house.id,
          assigned_to: defaultAssigneeId,
          assigned_user_ids: defaultAssigneeId ? [defaultAssigneeId] : [],
          assignment_mode: "together",
          name: row.name,
          frequency_days: row.default_frequency_days,
          effort_points: row.default_effort * 10,
          last_completed_at: null,
          next_due_date: toLocalDateKey(firstDue),
          status: "active",
        };
      });

      if (taskRows.length > 0) {
        const { error: taskInsertError } = await supabaseClient
          .from("task")
          .insert(taskRows);
        if (taskInsertError) {
          setError(taskInsertError.message);
          return;
        }
      }
      addedTasksCount = taskRows.length;
    }

    setRoomName("");
    setRoomIconRef("");
    setRoomTaskSetupMode("auto_library");
    setShowAddRoom(false);
    setMessage(
      addedTasksCount > 0
        ? `Room added with ${addedTasksCount} starter task${addedTasksCount === 1 ? "" : "s"}.`
        : roomTaskSetupMode === "auto_library"
          ? "Room added. No matching library tasks found for this room type."
          : "Room added. You can now add tasks one by one.",
    );
    await loadHome();
  }

  function openAddRoomModal() {
    setEditingRoomId(null);
    setRoomName("");
    setRoomType("bedroom");
    setRoomTemplate(DEFAULT_ROOM_TEMPLATE);
    setRoomIconRef("");
    setRoomTaskSetupMode("auto_library");
    setShowAddRoom(true);
  }

  async function handleSaveRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingRoomId) {
      setError(null);
      setMessage(null);
      if (!supabaseClient) return;
      if (!canManageHome) {
        setError("Helpers can only view and complete tasks.");
        return;
      }

      setSaving(true);
      const { error: updateError } = await supabaseClient
        .from("room")
        .update({
          name: roomName.trim(),
          type: roomType,
          icon_ref: roomIconRef.trim() || null,
        })
        .eq("id", editingRoomId);
      setSaving(false);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setShowAddRoom(false);
      setEditingRoomId(null);
      setRoomName("");
      setRoomIconRef("");
      setMessage("Room updated.");
      await loadHome();
      return;
    }

    await handleAddRoom(event);
  }

  async function handleDeleteRoom() {
    if (!supabaseClient || !editingRoomId) return;
    if (!canManageHome) {
      setError("Helpers can only view and complete tasks.");
      return;
    }
    const targetRoom = rooms.find((room) => room.id === editingRoomId);
    const confirmed = window.confirm(
      `Delete "${targetRoom?.name ?? "this room"}"? This will remove the room and all its tasks.`,
    );
    if (!confirmed) return;

    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: deleteError } = await supabaseClient
      .from("room")
      .delete()
      .eq("id", editingRoomId);
    setSaving(false);

    if (deleteError) {
      setError(deleteError.message);
      return;
    }

    setShowAddRoom(false);
    setEditingRoomId(null);
    setRoomName("");
    setRoomIconRef("");
    setMessage("Room deleted.");
    await loadHome();
  }

  async function handleToggleTravelMode() {
    if (!supabaseClient || !house || travelSaving) return;

    setError(null);
    setMessage(null);
    setTravelSaving(true);
    const nextPaused = !house.is_paused;
    const previousHouse = house;

    if (nextPaused) {
      const startedAt = new Date().toISOString();
      setHouse({ ...house, is_paused: true, travel_mode_started_at: startedAt });
      setShowTravelNotice(true);
      setTimeout(() => setShowTravelNotice(false), 5000);
      const { data: updatedHouse, error: updateError } = await supabaseClient
        .from("house")
        .update({ is_paused: true, travel_mode_started_at: startedAt })
        .eq("id", house.id)
        .select("*")
        .single();

      if (updateError) {
        setHouse(previousHouse);
        setError(updateError.message);
        setShowTravelNotice(false);
        setTravelSaving(false);
        return;
      }

      if (updatedHouse) {
        setHouse(updatedHouse);
      }
      setTravelSaving(false);
      return;
    }

    setHouse({ ...house, is_paused: false, travel_mode_started_at: null });
    setShowTravelNotice(false);

    const { data: offsetDays, error: offsetError } = await supabaseClient.rpc(
      "apply_travel_mode_offset",
      { p_house_id: house.id },
    );

    if (offsetError) {
      setHouse(previousHouse);
      setError(offsetError.message);
      setTravelSaving(false);
      return;
    }

    const addedDays = Number(offsetDays ?? 0);
    if (addedDays > 0) {
      setMessage(
        `Travel mode ended. Added ${addedDays} day${addedDays === 1 ? "" : "s"} to all task due dates.`,
      );
    } else {
      setMessage("Travel mode ended. No full 24-hour day passed, so due dates stayed the same.");
    }

    await loadHome();
    setTravelSaving(false);
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Loading home...</p>
      </main>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const activeTasks = tasks.filter((task) => task.status === "active");
  const scopedActiveTasks = activeTasks.filter((task) => {
    if (!task.next_due_date) return false;
    return task.next_due_date <= today;
  });
  const dueCardCount = scopedActiveTasks.length;

  const roomFreshnessValues = rooms.map((room) =>
    getFreshnessFromTasks(
      activeTasks.filter((task) => task.room_id === room.id),
      today,
    ),
  );
  const freshness =
    roomFreshnessValues.length > 0
      ? Math.round(
          roomFreshnessValues.reduce((sum, value) => sum + value, 0) / roomFreshnessValues.length,
        )
      : 0;
  const homeFreshnessMeta = getFreshnessMessage(freshness);

  const sortedRooms = [...rooms]
    .map((room) => {
      const roomActiveTasks = activeTasks.filter((task) => task.room_id === room.id);
      return {
        room,
        roomFreshness: getFreshnessFromTasks(roomActiveTasks, today),
      };
    })
    .sort((a, b) => a.roomFreshness - b.roomFreshness);

  return (
    <main className="min-h-screen bg-[#f7f9fb] pb-24 text-[#191c1e]">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-white/90 px-4 sm:px-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="text-teal-600">🏠</span>
          <h1 className="text-2xl font-bold tracking-tight text-teal-700">
            {house?.name ?? "Home"}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-teal-700">✈️</span>
          <button
            type="button"
            onClick={handleToggleTravelMode}
            disabled={travelSaving}
            className={`flex h-6 w-12 items-center rounded-full p-1 transition-colors ${
              house?.is_paused ? "bg-teal-400" : "bg-slate-300"
            } ${travelSaving ? "cursor-not-allowed opacity-70" : ""}`}
            aria-label="Toggle travel mode"
          >
            <span
              className={`h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                house?.is_paused ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </header>

      <section className="mx-auto w-full max-w-xl space-y-6 px-4 pt-6 sm:px-6">
        {showTravelNotice && (
          <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
            Travel mode is on and all tasks are paused till it turns off.
          </p>
        )}

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

        <section className="space-y-4">
          <div className="rounded-2xl bg-white p-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)]">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                  Home Freshness
                </p>
                <p className={`text-3xl font-black tracking-tight ${homeFreshnessMeta.percentageClass}`}>
                  {freshness}%
                </p>
                <p className="mt-1 text-xs font-medium text-slate-600">
                  {homeFreshnessMeta.text}
                </p>
              </div>
              <span className="text-3xl">🌿</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full ${homeFreshnessMeta.progressClass}`}
                style={{ width: `${freshness}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Link
              href="/tasks/due-today?window=today"
              className="rounded-2xl bg-white p-3 text-center shadow-[0_10px_20px_rgba(0,0,0,0.02)] transition hover:bg-orange-50"
            >
              <p className="text-[10px] font-bold text-orange-700">DUE TODAY</p>
              <p className="text-xl font-black">{dueCardCount}</p>
            </Link>
            <Link
              href="/tasks/completed"
              className="rounded-2xl bg-white p-3 text-center shadow-[0_10px_20px_rgba(0,0,0,0.02)] transition hover:bg-amber-50"
            >
              <p className="text-[10px] font-bold text-amber-700">POINTS</p>
              <p className="text-xl font-black">{totalPoints}</p>
            </Link>
            <div className="rounded-2xl bg-white p-3 text-center shadow-[0_10px_20px_rgba(0,0,0,0.02)]">
              <p className="text-[10px] font-bold text-teal-700">STREAK</p>
              <p className="text-xl font-black">{streakDays}</p>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4">
          {sortedRooms.map(({ room, roomFreshness }) => {
            const roomDueNowTasks = scopedActiveTasks.filter((task) => task.room_id === room.id);
            const roomOverdue = roomDueNowTasks.filter(
              (task) => !!task.next_due_date && task.next_due_date < today,
            ).length;
            const tone = getRoomFreshnessTone(roomFreshness);

            return (
              <Link
                key={room.id}
                href={`/room/${room.id}`}
                className={`space-y-3 rounded-2xl bg-white p-4 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.04)] ${tone.cardClass}`}
              >
                <div className="flex items-start justify-between">
                  <div className={`rounded-xl p-2.5 text-lg ${tone.iconClass}`}>
                    {room.icon_ref || ROOM_EMOJI[room.type]}
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${tone.badgeClass}`}>
                    {roomFreshness}%
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold">{room.name}</p>
                  <p className="text-xs text-slate-500">
                    {roomDueNowTasks.length} due now - {toRoomLabel(room.type)}
                  </p>
                  <p className={`text-[11px] font-semibold ${roomOverdue > 0 ? "text-red-600" : "text-slate-400"}`}>
                    {roomOverdue > 0 ? `${roomOverdue} overdue` : "No overdue"}
                  </p>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${tone.progressClass}`}
                    style={{ width: `${roomFreshness}%` }}
                  />
                </div>
              </Link>
            );
          })}

          <button
            type="button"
            onClick={openAddRoomModal}
            disabled={!canManageHome}
            className={`flex min-h-[165px] flex-col items-center justify-center rounded-2xl border p-4 text-center shadow-[0_20px_40px_-12px_rgba(25,28,30,0.04)] ${
              canManageHome
                ? "border-dashed border-teal-300 bg-teal-50/40"
                : "cursor-not-allowed border-slate-200 bg-slate-100"
            }`}
          >
            <span className="text-3xl font-light text-teal-700">+</span>
            <p className="text-sm font-bold text-teal-800">Add Room</p>
            <p className="text-xs text-teal-700">
              {canManageHome ? "Start building your home" : "Helper access"}
            </p>
          </button>
        </section>

        {!rooms.length && (
          <p className="text-center text-xs text-slate-500">
            No rooms yet. Use the Add Room card to create your first room.
          </p>
        )}
      </section>

      <BottomNav />

      {showAddRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#191c1e]/20 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveRoom}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-[0_20px_40px_-12px_rgba(25,28,30,0.12)]"
          >
            <div className="flex items-center justify-between px-5 pb-4 pt-6 sm:px-8 sm:pt-8">
              <h2 className="text-2xl font-extrabold tracking-tight text-slate-900">
                {editingRoomId ? "Edit Room" : "Add New Room"}
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowAddRoom(false);
                  setEditingRoomId(null);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[62vh] space-y-8 overflow-y-auto px-5 py-4 sm:px-8">
              <div className="space-y-2">
                <label className="text-sm font-semibold uppercase tracking-wide text-orange-700">
                  Room Name
                </label>
                <input
                  required
                  value={roomName}
                  onChange={(event) => setRoomName(event.target.value)}
                  placeholder="e.g. Master Suite"
                  className="w-full rounded-2xl border-none bg-slate-100 px-6 py-4 text-slate-900 outline-none ring-2 ring-transparent transition-all placeholder:text-slate-400 focus:ring-teal-300"
                />
              </div>

              <div className="space-y-4">
                <label className="text-sm font-semibold uppercase tracking-wide text-orange-700">
                  Select Room Type
                </label>
                <div className="grid grid-cols-3 gap-4 sm:grid-cols-4">
                  {ROOM_MODAL_OPTIONS.map((option) => {
                    const selected = roomTemplate === option.templateKey;
                    return (
                      <button
                        key={option.templateKey}
                        type="button"
                        onClick={() => {
                          setRoomTemplate(option.templateKey);
                          setRoomType(option.type);
                          if (option.templateKey === "other") {
                            setRoomTaskSetupMode("empty_room");
                          } else if (roomTaskSetupMode === "empty_room") {
                            setRoomTaskSetupMode("auto_library");
                          }
                        }}
                        className={`flex flex-col items-center justify-center rounded-2xl p-4 text-center transition-all ${
                          selected
                            ? "bg-teal-50 text-teal-700 ring-2 ring-teal-300"
                            : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                        }`}
                      >
                        <span className="mb-1 text-2xl">{option.icon}</span>
                        <span className="text-[10px] font-bold uppercase">
                          {option.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {!editingRoomId && roomTemplate !== "other" && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold uppercase tracking-wide text-orange-700">
                    Task Setup Preference
                  </label>
                  <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
                    <input
                      type="radio"
                      name="room_task_setup_mode"
                      checked={roomTaskSetupMode === "auto_library"}
                      onChange={() => setRoomTaskSetupMode("auto_library")}
                    />
                    <span className="text-sm text-slate-700">
                      Automatically add starter tasks from task library.
                    </span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
                    <input
                      type="radio"
                      name="room_task_setup_mode"
                      checked={roomTaskSetupMode === "empty_room"}
                      onChange={() => setRoomTaskSetupMode("empty_room")}
                    />
                    <span className="text-sm text-slate-700">
                      Create an empty room and add tasks one by one.
                    </span>
                  </label>
                </div>
              )}

            </div>

            <div className="flex items-center gap-4 bg-slate-100 p-5 sm:p-8">
              <button
                type="button"
                onClick={() => {
                  setShowAddRoom(false);
                  setEditingRoomId(null);
                }}
                className="flex-1 rounded-full py-4 font-semibold text-slate-500 transition-all hover:bg-slate-200"
              >
                Cancel
              </button>
              {editingRoomId ? (
                <button
                  type="button"
                  onClick={() => void handleDeleteRoom()}
                  disabled={saving}
                  className="flex-1 rounded-full bg-red-600 py-4 font-bold text-white transition-all disabled:opacity-60"
                >
                  Delete
                </button>
              ) : null}
              <button
                type="submit"
                disabled={saving}
                className="flex-[2] rounded-full bg-gradient-to-br from-teal-700 to-teal-400 py-4 font-bold text-white shadow-[0_10px_20px_-5px_rgba(0,107,95,0.3)] transition-all disabled:opacity-60"
              >
                {saving ? (editingRoomId ? "Saving..." : "Adding...") : editingRoomId ? "Save Room" : "Add Room"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
