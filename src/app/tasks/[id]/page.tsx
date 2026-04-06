"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import BottomNav from "@/components/bottom-nav";
import PostponeSkipModal, { type PostponeChoice } from "@/components/postpone-skip-modal";
import TaskEditorModal, {
  type TaskEditorMemberOption,
  type TaskEditorValues,
} from "@/components/task-editor-modal";

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
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [members, setMembers] = useState<TaskEditorMemberOption[]>([]);
  const [memberProfiles, setMemberProfiles] = useState<Record<string, MemberProfile>>({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [postponeResolve, setPostponeResolve] = useState<((choice: PostponeChoice | null) => void) | null>(
    null,
  );
  const [returnRoomId, setReturnRoomId] = useState<string | null>(null);
  const [returnFocusTaskId, setReturnFocusTaskId] = useState<string | null>(null);
  const [returnTasksFocusTaskId, setReturnTasksFocusTaskId] = useState<string | null>(null);

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
      .eq("house_id", member.house_id);

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

    const { data: profilesData } = await supabaseClient
      .from("user_house_bridge")
      .select("user_id,display_name,avatar_url")
      .eq("house_id", member.house_id);

    const roomsInHouse = (roomData ?? []) as RoomRow[];
    const taskRoom = roomsInHouse.find((entry) => entry.id === taskData.room_id) ?? null;
    const memberOptions: TaskEditorMemberOption[] = (profilesData ?? []).map((profile) => {
      const label = profile.display_name?.trim() || "Member";
      return {
        userId: profile.user_id,
        label,
        initials: initialsFromName(label),
        avatarUrl: profile.avatar_url,
      };
    });

    setTask(taskData);
    setRoom(taskRoom);
    setRooms(roomsInHouse);
    setHistory((historyData ?? []) as HistoryRow[]);
    setMembers(memberOptions);
    setMemberProfiles(
      Object.fromEntries((profilesData ?? []).map((p) => [p.user_id, p])) as Record<
        string,
        MemberProfile
      >,
    );
    setLoading(false);
  }

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const from = sp.get("from");
      const roomId = sp.get("roomId");
      const focusTask = sp.get("focusTask");
      if (from === "room" && roomId) {
        setReturnRoomId(roomId);
        setReturnFocusTaskId(focusTask || taskId);
        setReturnTasksFocusTaskId(null);
      } else if (from === "tasks") {
        setReturnRoomId(null);
        setReturnFocusTaskId(null);
        setReturnTasksFocusTaskId(focusTask || taskId);
      } else {
        setReturnRoomId(null);
        setReturnFocusTaskId(null);
        setReturnTasksFocusTaskId(null);
      }
    }
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
    const today = toDateKey(new Date());
    if (!task.next_due_date || task.next_due_date > today) return;
    const choice = await new Promise<PostponeChoice | null>((resolve) => {
      setPostponeResolve(() => resolve);
    });
    if (!choice) return;
    const next = new Date();
    next.setDate(next.getDate() + (choice === "tomorrow" ? 1 : Math.max(1, task.frequency_days)));
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
    setMessage(choice === "tomorrow" ? "Task skipped until tomorrow." : "Task skipped.");
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

  async function handleSaveEdit(values: TaskEditorValues) {
    if (!supabaseClient || !task || !canManageTasks) return;
    setSaving(true);
    setError(null);
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
  const canSkipTask = showNadeefButton;
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
        <Link
          href={
            returnRoomId
              ? `/room/${returnRoomId}${returnFocusTaskId ? `?focusTask=${returnFocusTaskId}` : ""}`
              : returnTasksFocusTaskId
                ? `/tasks?focusTask=${returnTasksFocusTaskId}`
                : "/tasks"
          }
          className="text-sm font-semibold text-teal-700"
        >
          ← Back
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
              disabled={!canManageTasks || !canSkipTask}
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
                      <td className="px-3 py-2" suppressHydrationWarning>
                        {formatDateTime(item.completed_at)}
                      </td>
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

      <TaskEditorModal
        key={showEditModal ? `${task?.id ?? "task"}-open` : "closed"}
        open={showEditModal}
        title="Edit Sanctuary Task"
        task={task}
        rooms={rooms}
        members={members}
        saving={saving}
        onClose={() => setShowEditModal(false)}
        onSave={handleSaveEdit}
      />

      <PostponeSkipModal
        open={!!task && !!postponeResolve}
        taskName={task?.name ?? "this task"}
        onChoose={(choice) => {
          postponeResolve?.(choice);
          setPostponeResolve(null);
        }}
        onClose={() => {
          postponeResolve?.(null);
          setPostponeResolve(null);
        }}
      />

      <BottomNav />
    </main>
  );
}
