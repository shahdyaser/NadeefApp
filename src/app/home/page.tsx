"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { getViewCache, setViewCache } from "@/lib/view-cache";

type HouseRow = Database["public"]["Tables"]["house"]["Row"];
type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Pick<
  Database["public"]["Tables"]["task"]["Row"],
  "id" | "name" | "room_id" | "status" | "next_due_date" | "effort_points"
>;
type RoomType = Database["public"]["Enums"]["room_type"];
type HomeCachePayload = {
  house: HouseRow | null;
  rooms: RoomRow[];
  tasks: TaskRow[];
  totalPoints: number;
  streakDays: number;
  canManageHome: boolean;
};
const HOME_CACHE_KEY = "home";

const ROOM_MODAL_OPTIONS: Array<{ type: RoomType; label: string; icon: string }> = [
  { type: "bedroom", label: "Bedroom", icon: "🛏️" },
  { type: "bathroom", label: "Bath", icon: "🛁" },
  { type: "kitchen", label: "Kitchen", icon: "🍳" },
  { type: "living_room", label: "Living", icon: "🛋️" },
  { type: "laundry", label: "Laundry", icon: "🧺" },
  { type: "office", label: "Office", icon: "💻" },
  { type: "outdoor", label: "Patio", icon: "🌿" },
  { type: "other", label: "Other", icon: "✨" },
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

function dateDiffDays(fromIsoDate: string, toIsoDate: string) {
  const [fromY, fromM, fromD] = fromIsoDate.split("-").map(Number);
  const [toY, toM, toD] = toIsoDate.split("-").map(Number);
  const fromUtc = Date.UTC(fromY, fromM - 1, fromD);
  const toUtc = Date.UTC(toY, toM - 1, toD);
  return Math.floor((toUtc - fromUtc) / 86400000);
}

function getRoomFreshnessTone(freshness: number) {
  if (freshness >= 80) {
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
  if (freshness >= 80) {
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

  const [showAddRoom, setShowAddRoom] = useState(false);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [roomName, setRoomName] = useState("");
  const [roomType, setRoomType] = useState<RoomType>("other");
  const [roomIconRef, setRoomIconRef] = useState("");

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
      .select(
        "house_id,total_points,current_streak_days,last_opened_on,last_seen_travel_offset_days,role",
      )
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

    let nextStreakDays = member.current_streak_days ?? 0;
    if (!houseData.is_paused) {
      const todayIso = new Date().toISOString().slice(0, 10);
      const lastOpenedOn = member.last_opened_on;
      const previousTravelOffset = member.last_seen_travel_offset_days ?? 0;
      const totalTravelOffset = houseData.travel_offset_days ?? 0;

      if (!lastOpenedOn) {
        nextStreakDays = 1;
      } else if (lastOpenedOn !== todayIso) {
        const rawGap = dateDiffDays(lastOpenedOn, todayIso);
        const travelGap = Math.max(0, totalTravelOffset - previousTravelOffset);
        const effectiveGap = Math.max(0, rawGap - travelGap);
        nextStreakDays = effectiveGap <= 1 ? nextStreakDays + 1 : 1;
      }

      if (!lastOpenedOn || lastOpenedOn !== todayIso || previousTravelOffset !== totalTravelOffset) {
        const { error: streakUpdateError } = await supabaseClient
          .from("user_house_bridge")
          .update({
            current_streak_days: nextStreakDays,
            last_opened_on: todayIso,
            last_seen_travel_offset_days: totalTravelOffset,
          })
          .eq("user_id", uid)
          .eq("house_id", member.house_id);

        if (streakUpdateError) {
          setError(streakUpdateError.message);
        }
      }
    }

    setStreakDays(nextStreakDays);
    setViewCache<HomeCachePayload>(HOME_CACHE_KEY, {
      house: houseData,
      rooms: roomData ?? [],
      tasks: (taskData ?? []) as TaskRow[],
      totalPoints: member.total_points ?? 0,
      streakDays: nextStreakDays,
      canManageHome: member.role === "owner" || member.role === "member",
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
      setLoading(false);
    }
    void loadHome(Boolean(cached));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const { error: insertError } = await supabaseClient.from("room").insert({
      house_id: house.id,
      name: roomName.trim(),
      type: roomType,
      icon_ref: roomIconRef.trim() || null,
    });
    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setRoomName("");
    setRoomIconRef("");
    setShowAddRoom(false);
    setMessage("Room added.");
    await loadHome();
  }

  function openAddRoomModal() {
    setEditingRoomId(null);
    setRoomName("");
    setRoomType("other");
    setRoomIconRef("");
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

  return (
    <main className="min-h-screen bg-[#f7f9fb] pb-24 text-[#191c1e]">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-white/90 px-4 sm:px-6 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="text-teal-600">🌊</span>
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
          {rooms.map((room) => {
            const roomActiveTasks = activeTasks.filter((task) => task.room_id === room.id);
            const roomDueNowTasks = scopedActiveTasks.filter((task) => task.room_id === room.id);
            const roomOverdue = roomDueNowTasks.filter(
              (task) => !!task.next_due_date && task.next_due_date < today,
            ).length;
            const roomFreshness = getFreshnessFromTasks(roomActiveTasks, today);
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

      <nav className="fixed bottom-0 left-0 z-40 flex w-full items-center justify-around rounded-t-[1.5rem] bg-white/90 px-4 pb-5 pt-3 shadow-[0_-10px_30px_rgba(0,0,0,0.04)] backdrop-blur-xl">
        <Link href="/home" className="flex flex-col items-center rounded-2xl bg-teal-50 px-5 py-2 text-teal-700">
          <span className="text-lg">🏠</span>
          <span className="text-[11px] font-medium">Home</span>
        </Link>
        <Link href="/tasks" className="flex flex-col items-center px-5 py-2 text-slate-400 hover:text-teal-600">
          <span className="text-lg">📝</span>
          <span className="text-[11px] font-medium">Tasks</span>
        </Link>
        <Link href="/leaderboard" className="flex flex-col items-center px-5 py-2 text-slate-400 hover:text-teal-600">
          <span className="text-lg">🏆</span>
          <span className="text-[11px] font-medium">Leaderboard</span>
        </Link>
        <Link href="/profile" className="flex flex-col items-center px-5 py-2 text-slate-400 hover:text-teal-600">
          <span className="text-lg">👤</span>
          <span className="text-[11px] font-medium">Profile</span>
        </Link>
      </nav>

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
                <div className="grid grid-cols-4 gap-4">
                  {ROOM_MODAL_OPTIONS.map((option) => {
                    const selected = roomType === option.type;
                    return (
                      <button
                        key={option.type}
                        type="button"
                        onClick={() => setRoomType(option.type)}
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
