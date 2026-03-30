"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import BottomNav from "@/components/bottom-nav";

type TaskRow = Database["public"]["Tables"]["task"]["Row"];
type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type HistoryRow = Database["public"]["Tables"]["task_history"]["Row"];
type MemberProfile = Pick<
  Database["public"]["Tables"]["user_house_bridge"]["Row"],
  "user_id" | "display_name" | "avatar_url"
>;

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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

function toDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCompletionStatus(completedAtIso: string, previousDueDate: string | null) {
  if (!previousDueDate) {
    return { label: "Unknown", className: "bg-slate-100 text-slate-600" };
  }
  const completedDate = completedAtIso.slice(0, 10);
  if (completedDate < previousDueDate) {
    return { label: "Early", className: "bg-teal-100 text-teal-700" };
  }
  if (completedDate > previousDueDate) {
    return { label: "Late", className: "bg-red-100 text-red-700" };
  }
  return { label: "On Time", className: "bg-amber-100 text-amber-700" };
}

export default function TaskDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const taskId = params.id;
  const supabaseClient = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [canManageTasks, setCanManageTasks] = useState(false);
  const [task, setTask] = useState<TaskRow | null>(null);
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberProfile>>({});
  const [showEditModal, setShowEditModal] = useState(false);

  const [editName, setEditName] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editFrequencyDays, setEditFrequencyDays] = useState(1);
  const [editEffortPoints, setEditEffortPoints] = useState(10);

  async function loadTaskDetail() {
    if (!supabaseClient) {
      setError(
        "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    setError(null);
    const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
    if (sessionError || !sessionData.session?.user) {
      router.replace("/");
      return;
    }
    const uid = sessionData.session.user.id;
    setUserId(uid);

    const { data: memberData, error: memberError } = await supabaseClient
      .from("user_house_bridge")
      .select("house_id,role")
      .eq("user_id", uid)
      .limit(1);
    if (memberError) {
      setError(memberError.message);
      setLoading(false);
      return;
    }
    const member = memberData?.[0];
    if (!member?.house_id) {
      router.replace("/setup");
      return;
    }
    setCanManageTasks(member.role === "owner" || member.role === "member");

    const { data: taskData, error: taskError } = await supabaseClient
      .from("task")
      .select("*")
      .eq("id", taskId)
      .eq("house_id", member.house_id)
      .single();
    if (taskError || !taskData) {
      setError(taskError?.message ?? "Task not found.");
      setLoading(false);
      return;
    }

    const { data: roomData } = await supabaseClient
      .from("room")
      .select("*")
      .eq("id", taskData.room_id)
      .maybeSingle();

    const { data: historyData, error: historyError } = await supabaseClient
      .from("task_history")
      .select("*")
      .eq("task_id", taskId)
      .order("completed_at", { ascending: false });
    if (historyError) {
      setError(historyError.message);
      setLoading(false);
      return;
    }

    const actorIds = Array.from(new Set((historyData ?? []).map((entry) => entry.user_id)));
    const { data: profilesData } =
      actorIds.length > 0
        ? await supabaseClient
            .from("user_house_bridge")
            .select("user_id,display_name,avatar_url")
            .in("user_id", actorIds)
            .eq("house_id", member.house_id)
        : { data: [] };

    setTask(taskData);
    setRoom(roomData ?? null);
    setHistory((historyData ?? []) as HistoryRow[]);
    setMemberProfiles(
      Object.fromEntries((profilesData ?? []).map((p) => [p.user_id, p])) as Record<
        string,
        MemberProfile
      >,
    );
    setEditName(taskData.name);
    setEditDueDate(taskData.next_due_date ?? toDateKey(new Date()));
    setEditFrequencyDays(Math.max(1, taskData.frequency_days));
    setEditEffortPoints(Math.max(10, Math.min(30, taskData.effort_points)));
    setLoading(false);
  }

  useEffect(() => {
    void loadTaskDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  async function handleNadeef() {
    if (!supabaseClient || !task || !userId || completing) return;
    setCompleting(true);
    setError(null);
    const { error: completeError } = await supabaseClient.from("task_history").insert({
      task_id: task.id,
      user_id: userId,
      previous_due_date: task.next_due_date,
      points_awarded: task.effort_points,
    });
    setCompleting(false);
    if (completeError) {
      setError(completeError.message);
      return;
    }
    setMessage("Task completed.");
    await loadTaskDetail();
  }

  async function handleSkip() {
    if (!supabaseClient || !task || !canManageTasks) return;
    const next = new Date();
    next.setDate(next.getDate() + Math.max(1, task.frequency_days));
    const { error: skipError } = await supabaseClient
      .from("task")
      .update({
        next_due_date: toDateKey(next),
        status: "active",
      })
      .eq("id", task.id);
    if (skipError) {
      setError(skipError.message);
      return;
    }
    setMessage("Task skipped.");
    await loadTaskDetail();
  }

  async function handleDelete() {
    if (!supabaseClient || !task || !canManageTasks) return;
    const confirmed = window.confirm(`Delete "${task.name}"?`);
    if (!confirmed) return;
    const { error: deleteError } = await supabaseClient.from("task").delete().eq("id", task.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    router.replace("/tasks");
  }

  async function handleSaveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabaseClient || !task || !canManageTasks) return;
    setSaving(true);
    setError(null);
    const { error: updateError } = await supabaseClient
      .from("task")
      .update({
        name: editName.trim(),
        next_due_date: editDueDate,
        frequency_days: Math.max(1, editFrequencyDays),
        effort_points: Math.max(10, Math.min(30, Math.round(editEffortPoints / 10) * 10)),
      })
      .eq("id", task.id);
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setMessage("Task updated.");
    setShowEditModal(false);
    await loadTaskDetail();
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4">
        <p className="text-sm text-slate-600">Loading task...</p>
      </main>
    );
  }

  if (!task) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-4">
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error ?? "Task not found."}
        </p>
      </main>
    );
  }

  const today = toDateKey(new Date());
  const showNadeefButton =
    task.status === "active" && !!task.next_due_date && task.next_due_date <= today;
  const taskStatusLabel =
    task.status !== "active"
      ? "Paused"
      : showNadeefButton
        ? "Pending"
        : "Done for now";
  const historyByDay = Array.from(
    history.reduce((acc, item) => {
      const key = item.completed_at.slice(0, 10);
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>()),
  )
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-14);
  const maxDayCount = Math.max(1, ...historyByDay.map(([, count]) => count));
  const lineChartPoints =
    historyByDay.length > 1
      ? historyByDay
          .map(([, count], index) => {
            const x = (index / (historyByDay.length - 1)) * 100;
            const y = 80 - (count / maxDayCount) * 80;
            return `${x},${y}`;
          })
          .join(" ")
      : historyByDay.length === 1
        ? "50,40"
        : "";

  return (
    <main className="min-h-screen bg-[#f7f9fb] pb-24 text-[#191c1e]">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-white/90 px-4 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.06)] backdrop-blur-xl sm:px-6">
        <Link href="/tasks" className="text-sm font-semibold text-teal-700">
          ← Tasks
        </Link>
        <p className="truncate px-3 text-sm font-bold">{task.name}</p>
        <span className="w-[54px] text-right text-xs text-slate-500">{room?.name ?? "Room"}</span>
      </header>

      <section className="mx-auto w-full max-w-3xl space-y-5 px-4 pt-6 sm:px-6">
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
        {message ? <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">{message}</p> : null}

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Task Details</h2>
          <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-2">
            <p>
              <span className="font-semibold text-slate-600">Task:</span> {task.name}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Room:</span> {room?.name ?? "Room"}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Due date:</span> {task.next_due_date ?? "-"}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Frequency:</span> Every {task.frequency_days} day(s)
            </p>
            <p>
              <span className="font-semibold text-slate-600">Effort:</span> {task.effort_points} pts
            </p>
            <p>
              <span className="font-semibold text-slate-600">Status:</span> {taskStatusLabel}
            </p>
          </div>

          <div
            className={`grid grid-cols-1 gap-2 pt-2 ${
              showNadeefButton ? "sm:grid-cols-4" : "sm:grid-cols-3"
            }`}
          >
            {showNadeefButton ? (
              <button
                type="button"
                onClick={() => void handleNadeef()}
                disabled={completing}
                className="rounded-xl bg-gradient-to-br from-teal-700 to-teal-400 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {completing ? "Nadeefing..." : "Nadeef"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setShowEditModal(true)}
              disabled={!canManageTasks}
              className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => void handleSkip()}
              disabled={!canManageTasks}
              className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={!canManageTasks}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">Task History</h2>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Completion Events (Last 14 days)</p>
            {!historyByDay.length ? (
              <p className="text-xs text-slate-500">No events yet.</p>
            ) : (
              <div className="space-y-2">
                <svg viewBox="0 0 100 84" className="h-24 w-full">
                  <line x1="0" y1="80" x2="100" y2="80" stroke="#cbd5e1" strokeWidth="1" />
                  {lineChartPoints ? (
                    <polyline
                      fill="none"
                      stroke="#0f766e"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={lineChartPoints}
                    />
                  ) : null}
                  {historyByDay.map(([, count], index) => {
                    const x =
                      historyByDay.length > 1 ? (index / (historyByDay.length - 1)) * 100 : 50;
                    const y = 80 - (count / maxDayCount) * 80;
                    return <circle key={`${index}-${count}`} cx={x} cy={y} r="2.2" fill="#14b8a6" />;
                  })}
                </svg>
                <div className="flex items-center justify-between gap-2">
                  {historyByDay.map(([dateKey]) => (
                    <span key={dateKey} className="flex-1 text-center text-[9px] text-slate-500">
                      {dateKey.slice(5)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Done By</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Points</th>
                  <th className="px-3 py-2">Previous Due</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => {
                  const profile = memberProfiles[item.user_id];
                  const label = profile?.display_name?.trim() || (item.user_id === userId ? "You" : "Member");
                  const completionStatus = getCompletionStatus(
                    item.completed_at,
                    item.previous_due_date,
                  );
                  return (
                    <tr key={item.id} className="border-t border-slate-200">
                      <td className="px-3 py-2">{formatDateTime(item.completed_at)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-slate-200 text-[9px] font-bold text-slate-600"
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
                            {!profile?.avatar_url ? initialsFromName(label) : null}
                          </span>
                          {label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${completionStatus.className}`}
                        >
                          {completionStatus.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-semibold text-teal-700">{item.points_awarded}</td>
                      <td className="px-3 py-2 text-slate-600">{item.previous_due_date ?? "-"}</td>
                    </tr>
                  );
                })}
                {!history.length ? (
                  <tr>
                    <td className="px-3 py-3 text-slate-500" colSpan={5}>
                      No history yet for this task.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {showEditModal ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveEdit}
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-[0_20px_40px_-12px_rgba(25,28,30,0.2)]"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Edit Task</h3>
              <button
                type="button"
                onClick={() => setShowEditModal(false)}
                className="rounded-full px-2 py-1 text-slate-500 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <label className="space-y-1 sm:col-span-2">
              <span className="text-xs font-semibold text-slate-500">Task Name</span>
              <input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-500">Due Date</span>
              <input
                type="date"
                value={editDueDate}
                onChange={(event) => setEditDueDate(event.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-500">Frequency (days)</span>
              <input
                type="number"
                min={1}
                value={editFrequencyDays}
                onChange={(event) => setEditFrequencyDays(Math.max(1, Number(event.target.value) || 1))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-400"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-semibold text-slate-500">Effort Points</span>
              <select
                value={editEffortPoints}
                onChange={(event) => setEditEffortPoints(Number(event.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-400"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={30}>30</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full rounded-xl bg-teal-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </form>
        </div>
      ) : null}

      <BottomNav />
    </main>
  );
}
