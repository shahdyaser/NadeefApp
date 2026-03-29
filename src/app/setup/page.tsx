"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

type SetupMode = "create" | "join";
type TaskSetupMode = "auto_library" | "empty_rooms";
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
  | "garage";

type RoomTemplate = {
  key: RoomTemplateKey;
  label: string;
  icon: string;
  roomType: Database["public"]["Enums"]["room_type"];
};

const ROOM_TEMPLATES: RoomTemplate[] = [
  { key: "bedroom", label: "Bedroom", icon: "🛏️", roomType: "bedroom" },
  { key: "dressing_room", label: "Dressing Room", icon: "👗", roomType: "bedroom" },
  { key: "bathroom", label: "Bathroom", icon: "🛁", roomType: "bathroom" },
  { key: "kitchen", label: "Kitchen", icon: "🍳", roomType: "kitchen" },
  { key: "dining_room", label: "Dining Room", icon: "🍽️", roomType: "dining_room" },
  { key: "living_room", label: "Living Room", icon: "🛋️", roomType: "living_room" },
  { key: "kids_room", label: "Kids Room", icon: "🧸", roomType: "bedroom" },
  { key: "office_room", label: "Office Room", icon: "💻", roomType: "office" },
  { key: "entrance_hallway", label: "Entrance Hallway", icon: "🚪", roomType: "other" },
  { key: "laundry_room", label: "Laundry Room", icon: "🧺", roomType: "laundry" },
  { key: "balcony", label: "Balcony", icon: "🌿", roomType: "outdoor" },
  { key: "terrace", label: "Terrace", icon: "🌤️", roomType: "outdoor" },
  { key: "basement", label: "Basement", icon: "🏚️", roomType: "other" },
  { key: "storage_room", label: "Storage Room", icon: "📦", roomType: "other" },
  { key: "garage", label: "Garage", icon: "🚗", roomType: "garage" },
];

const DEFAULT_ROOM_COUNTS: Record<RoomTemplateKey, number> = ROOM_TEMPLATES.reduce(
  (acc, template) => {
    acc[template.key] = 0;
    return acc;
  },
  {} as Record<RoomTemplateKey, number>,
);

export default function SetupPage() {
  const router = useRouter();
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [setupMode, setSetupMode] = useState<SetupMode>("create");

  const [houseName, setHouseName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [roomCounts, setRoomCounts] =
    useState<Record<RoomTemplateKey, number>>(DEFAULT_ROOM_COUNTS);
  const [taskSetupMode, setTaskSetupMode] = useState<TaskSetupMode>("auto_library");

  useEffect(() => {
    async function bootstrap() {
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

      const { data: memberships, error: membershipError } = await supabaseClient
        .from("user_house_bridge")
        .select("house_id")
        .eq("user_id", uid)
        .limit(1);

      if (membershipError) {
        setError(membershipError.message);
        setLoading(false);
        return;
      }

      if (memberships?.[0]?.house_id) {
        router.replace("/home");
        return;
      }

      setLoading(false);
    }

    void bootstrap();
  }, [router, supabaseClient]);

  function changeRoomCount(key: RoomTemplateKey, delta: number) {
    setRoomCounts((prev) => ({
      ...prev,
      [key]: Math.max(0, prev[key] + delta),
    }));
  }

  async function handleJoinHouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!supabaseClient || !userId) return;
    if (!inviteCode.trim()) {
      setError("Enter a valid house code.");
      return;
    }

    setSaving(true);
    const { error: joinError } = await supabaseClient.rpc("join_house_by_invite_code", {
      p_invite_code: inviteCode.trim(),
    });
    setSaving(false);

    if (joinError) {
      setError(joinError.message);
      return;
    }

    setMessage("Joined house successfully. Redirecting...");
    router.replace("/home");
  }

  async function handleCreateHouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setError(null);

    if (!supabaseClient || !userId) return;
    if (!houseName.trim()) {
      setError("Enter a house name.");
      return;
    }

    setSaving(true);
    const { data: houseData, error: insertError } = await supabaseClient
      .from("house")
      .insert({
        name: houseName.trim(),
        owner_id: userId,
      })
      .select("id")
      .single();

    if (insertError || !houseData?.id) {
      setSaving(false);
      setError(insertError?.message ?? "Could not create house.");
      return;
    }

    const houseId = houseData.id;
    const roomPlan: Array<{ templateKey: RoomTemplateKey; roomType: Database["public"]["Enums"]["room_type"]; name: string }> = [];
    for (const template of ROOM_TEMPLATES) {
      const count = roomCounts[template.key] ?? 0;
      for (let i = 1; i <= count; i += 1) {
        const roomName = count > 1 ? `${template.label} ${i}` : template.label;
        roomPlan.push({
          templateKey: template.key,
          roomType: template.roomType,
          name: roomName,
        });
      }
    }

    const createdRooms: Array<{ id: string; templateKey: RoomTemplateKey }> = [];
    for (const plannedRoom of roomPlan) {
      const { data: newRoom, error: roomInsertError } = await supabaseClient
        .from("room")
        .insert({
          house_id: houseId,
          name: plannedRoom.name,
          type: plannedRoom.roomType,
        })
        .select("id")
        .single();

      if (roomInsertError || !newRoom?.id) {
        setSaving(false);
        setError(roomInsertError?.message ?? "Failed creating rooms.");
        return;
      }

      createdRooms.push({ id: newRoom.id, templateKey: plannedRoom.templateKey });
    }

    if (taskSetupMode === "auto_library" && createdRooms.length > 0) {
      const templateKeys = Array.from(new Set(createdRooms.map((room) => room.templateKey)));
      const { data: libraryRows, error: libraryError } = await supabaseClient
        .from("task_library")
        .select("room_template,name,default_frequency_days,default_effort")
        .in("room_template", templateKeys);

      if (libraryError) {
        setSaving(false);
        setError(libraryError.message);
        return;
      }

      const libraryByTemplate = new Map<string, Array<{
        room_template: string;
        name: string;
        default_frequency_days: number;
        default_effort: number;
      }>>();
      for (const row of libraryRows ?? []) {
        const bucket = libraryByTemplate.get(row.room_template) ?? [];
        bucket.push(row);
        libraryByTemplate.set(row.room_template, bucket);
      }

      const todayIso = new Date().toISOString().slice(0, 10);
      const taskRows: Array<Database["public"]["Tables"]["task"]["Insert"]> = [];
      for (const room of createdRooms) {
        const templates = libraryByTemplate.get(room.templateKey) ?? [];
        for (const tpl of templates) {
          taskRows.push({
            room_id: room.id,
            house_id: houseId,
            assigned_to: userId,
            assigned_user_ids: [userId],
            assignment_mode: "together",
            name: tpl.name,
            frequency_days: tpl.default_frequency_days,
            effort_points: tpl.default_effort * 10,
            last_completed_at: null,
            next_due_date: todayIso,
            status: "active",
          });
        }
      }

      if (taskRows.length > 0) {
        const { error: taskInsertError } = await supabaseClient.from("task").insert(taskRows);
        if (taskInsertError) {
          setSaving(false);
          setError(taskInsertError.message);
          return;
        }
      }
    }

    setSaving(false);
    setMessage("Home setup complete. Redirecting...");
    router.replace("/home");
  }

  async function handleSignOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
    router.replace("/");
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Preparing setup...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">Nadeef</p>
          <h1 className="text-lg font-bold text-slate-900">Set Up Your Home Access</h1>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Sign out
        </button>
      </header>

      {error && (
        <p className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      {message && (
        <p className="mb-4 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          {message}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <h2 className="text-base font-bold text-slate-900">First-time setup</h2>
        <p className="mt-1 text-xs text-slate-600">
          Create a new home or join an existing one using a house code.
        </p>

        <div className="mt-4 inline-flex rounded-full bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => {
              setSetupMode("create");
              setError(null);
              setMessage(null);
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${
              setupMode === "create" ? "bg-teal-700 text-white" : "text-slate-600"
            }`}
          >
            Create House
          </button>
          <button
            type="button"
            onClick={() => {
              setSetupMode("join");
              setError(null);
              setMessage(null);
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold ${
              setupMode === "join" ? "bg-teal-700 text-white" : "text-slate-600"
            }`}
          >
            Join with Code
          </button>
        </div>

        {setupMode === "create" ? (
          <form className="mt-4 space-y-5" onSubmit={handleCreateHouse}>
            <div className="space-y-3">
              <input
                required
                value={houseName}
                onChange={(event) => setHouseName(event.target.value)}
                placeholder="Home name (e.g. Family Apartment)"
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-500"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Rooms
              </p>
              <p className="text-xs text-slate-500">
                Default is 0. Add/subtract how many rooms you have for each type.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ROOM_TEMPLATES.map((template) => (
                  <div
                    key={template.key}
                    className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span>{template.icon}</span>
                      <span className="text-sm font-medium text-slate-700">{template.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => changeRoomCount(template.key, -1)}
                        className="h-7 w-7 rounded-full bg-slate-200 text-sm font-bold text-slate-700"
                      >
                        -
                      </button>
                      <span className="min-w-6 text-center text-sm font-bold text-slate-800">
                        {roomCounts[template.key]}
                      </span>
                      <button
                        type="button"
                        onClick={() => changeRoomCount(template.key, 1)}
                        className="h-7 w-7 rounded-full bg-teal-100 text-sm font-bold text-teal-700"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-500">
                Task Setup Preference
              </p>
              <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
                <input
                  type="radio"
                  name="task_setup_mode"
                  checked={taskSetupMode === "auto_library"}
                  onChange={() => setTaskSetupMode("auto_library")}
                />
                <span className="text-sm text-slate-700">
                  Automatically add starter tasks from the task library (you can edit later).
                </span>
              </label>
              <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3">
                <input
                  type="radio"
                  name="task_setup_mode"
                  checked={taskSetupMode === "empty_rooms"}
                  onChange={() => setTaskSetupMode("empty_rooms")}
                />
                <span className="text-sm text-slate-700">
                  Create empty rooms only. I will add tasks one by one later.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="h-11 w-full rounded-xl bg-teal-700 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Setting up..." : "Create Home"}
            </button>
          </form>
        ) : (
          <form className="mt-4 space-y-3" onSubmit={handleJoinHouse}>
            <input
              required
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
              placeholder="Enter house code (e.g. ABCD1234)"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm uppercase outline-none focus:border-teal-500"
            />
            <button
              type="submit"
              disabled={saving}
              className="h-11 w-full rounded-xl bg-teal-700 text-sm font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Joining..." : "Join House"}
            </button>
            <p className="text-xs text-slate-500">
              Ask a house owner/member to share the house code with you.
            </p>
          </form>
        )}
      </section>
    </main>
  );
}
