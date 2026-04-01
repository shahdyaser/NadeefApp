"use client";

import { type FormEvent, useState } from "react";
import type { Database } from "@/lib/supabase/database.types";

type RoomRow = Database["public"]["Tables"]["room"]["Row"];
type TaskRow = Database["public"]["Tables"]["task"]["Row"];

export type TaskEditorRoomOption = RoomRow;

export type TaskEditorMemberOption = {
  userId: string;
  label: string;
  initials: string;
  avatarUrl: string | null;
};

export type TaskEditorValues = {
  name: string;
  roomId: string;
  nextDueDate: string;
  frequencyDays: number;
  assignedUserIds: string[];
  assignmentMode: "together" | "round_robin";
  effortPoints: 10 | 20 | 30;
};

const ROOM_EMOJI: Record<Database["public"]["Enums"]["room_type"], string> = {
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

function formatDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function frequencyToDays(value: number, unit: "days" | "weeks" | "months") {
  if (unit === "weeks") return value * 7;
  if (unit === "months") return value * 30;
  return value;
}

function normalizeFrequency(days: number) {
  if (days % 30 === 0) {
    return {
      value: Math.max(1, Math.round(days / 30)),
      unit: "months" as const,
    };
  }
  if (days % 7 === 0) {
    return {
      value: Math.max(1, Math.round(days / 7)),
      unit: "weeks" as const,
    };
  }
  return {
    value: Math.max(1, days),
    unit: "days" as const,
  };
}

function getSuggestedDueDate(nextFrequencyValue: number, nextFrequencyUnit: "days" | "weeks" | "months") {
  const nextDue = new Date();
  nextDue.setHours(0, 0, 0, 0);
  nextDue.setDate(nextDue.getDate() + frequencyToDays(nextFrequencyValue, nextFrequencyUnit));
  return formatDateKey(nextDue);
}

function getInitialEditorState(
  task: TaskRow | null,
  rooms: TaskEditorRoomOption[],
  members: TaskEditorMemberOption[],
) {
  if (!task) {
    return {
      taskName: "",
      selectedRoomId: rooms[0]?.id ?? "",
      startingDueDate: getSuggestedDueDate(3, "days"),
      frequencyValue: 3,
      frequencyUnit: "days" as const,
      selectedAssigneeIds: members[0] ? [members[0].userId] : [],
      assignmentMode: "together" as const,
      effortStars: 1 as const,
    };
  }

  const normalizedFrequency = normalizeFrequency(Math.max(1, task.frequency_days));
  const assignees =
    task.assigned_user_ids && task.assigned_user_ids.length > 0
      ? task.assigned_user_ids
      : task.assigned_to
        ? [task.assigned_to]
        : members[0]
          ? [members[0].userId]
          : [];

  return {
    taskName: task.name,
    selectedRoomId: task.room_id || rooms[0]?.id || "",
    startingDueDate:
      task.next_due_date ?? getSuggestedDueDate(normalizedFrequency.value, normalizedFrequency.unit),
    frequencyValue: normalizedFrequency.value,
    frequencyUnit: normalizedFrequency.unit,
    selectedAssigneeIds: assignees,
    assignmentMode: task.assignment_mode === "round_robin" ? ("round_robin" as const) : ("together" as const),
    effortStars: Math.max(1, Math.min(3, Math.round(task.effort_points / 10))) as 1 | 2 | 3,
  };
}

export default function TaskEditorModal({
  open,
  title = "Edit Task",
  task,
  rooms,
  members,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  title?: string;
  task: TaskRow | null;
  rooms: TaskEditorRoomOption[];
  members: TaskEditorMemberOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: TaskEditorValues) => Promise<void> | void;
}) {
  const initialState = getInitialEditorState(task, rooms, members);
  const [taskName, setTaskName] = useState(initialState.taskName);
  const [selectedRoomId, setSelectedRoomId] = useState(initialState.selectedRoomId);
  const [startingDueDate, setStartingDueDate] = useState(initialState.startingDueDate);
  const [frequencyValue, setFrequencyValue] = useState(initialState.frequencyValue);
  const [frequencyUnit, setFrequencyUnit] = useState<"days" | "weeks" | "months">(initialState.frequencyUnit);
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<string[]>(initialState.selectedAssigneeIds);
  const [assignmentMode, setAssignmentMode] = useState<"together" | "round_robin">(initialState.assignmentMode);
  const [showAssigneeMenu, setShowAssigneeMenu] = useState(false);
  const [effortStars, setEffortStars] = useState<1 | 2 | 3>(initialState.effortStars);
  const [formError, setFormError] = useState<string | null>(null);

  if (!open || !task) return null;

  function setFrequencyAndDue(
    nextFrequencyValue: number,
    nextFrequencyUnit: "days" | "weeks" | "months",
  ) {
    setFrequencyValue(nextFrequencyValue);
    setFrequencyUnit(nextFrequencyUnit);
    setStartingDueDate(getSuggestedDueDate(nextFrequencyValue, nextFrequencyUnit));
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = taskName.trim();
    if (!trimmedName) {
      setFormError("Task name is required.");
      return;
    }
    if (!selectedRoomId) {
      setFormError("Please choose a room.");
      return;
    }
    if (!startingDueDate) {
      setFormError("Please choose a due date.");
      return;
    }
    if (!selectedAssigneeIds.length) {
      setFormError("Please choose at least one assignee.");
      return;
    }

    setFormError(null);
    await onSave({
      name: trimmedName,
      roomId: selectedRoomId,
      nextDueDate: startingDueDate,
      frequencyDays: frequencyToDays(frequencyValue, frequencyUnit),
      assignedUserIds: selectedAssigneeIds,
      assignmentMode,
      effortPoints: (effortStars * 10) as 10 | 20 | 30,
    });
  }

  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/10 backdrop-blur-sm" onClick={onClose} />
      <section className="fixed bottom-0 left-0 right-0 z-[80] mx-auto w-full max-w-2xl overflow-hidden rounded-t-[2.5rem] bg-white shadow-[0_-10px_40px_rgba(0,0,0,0.08)]">
        <div className="flex justify-center pb-2 pt-4">
          <div className="h-1.5 w-12 rounded-full bg-slate-300" />
        </div>

        <form
          onSubmit={handleSubmit}
          className="hide-scrollbar max-h-[82vh] space-y-8 overflow-y-auto overflow-x-hidden px-5 pb-10 pt-4 sm:px-8"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>

          {formError ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {formError}
            </p>
          ) : null}

          <div className="space-y-3">
            <label className="ml-1 block text-sm font-semibold uppercase tracking-wide text-slate-500">
              Task Name
            </label>
            <input
              required
              value={taskName}
              onChange={(event) => setTaskName(event.target.value)}
              className="w-full min-w-0 rounded-xl border-none bg-slate-100 px-4 py-3.5 text-sm font-semibold placeholder:text-slate-400 outline-none ring-2 ring-transparent transition-all focus:ring-teal-300"
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
              {rooms.map((room) => {
                const active = room.id === selectedRoomId;
                return (
                  <button
                    type="button"
                    key={room.id}
                    onClick={() => setSelectedRoomId(room.id)}
                    className="flex flex-shrink-0 flex-col items-center gap-2"
                  >
                    <span
                      className={`flex h-16 w-16 items-center justify-center rounded-xl text-2xl ${
                        active ? "bg-teal-200 text-teal-800 shadow-lg" : "bg-slate-100 text-slate-400"
                      }`}
                    >
                      {room.icon_ref || ROOM_EMOJI[room.type]}
                    </span>
                    <span className={`text-xs font-semibold ${active ? "text-teal-700" : "text-slate-500"}`}>
                      {room.name}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              Task will be saved in {rooms.find((entry) => entry.id === selectedRoomId)?.name ?? "this room"}.
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
                    onClick={() => setFrequencyAndDue(Math.max(1, frequencyValue - 1), frequencyUnit)}
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
                    onChange={(event) => {
                      const nextFrequencyValue = Math.max(1, Number(event.target.value) || 1);
                      setFrequencyAndDue(nextFrequencyValue, frequencyUnit);
                    }}
                    className="w-14 bg-transparent p-0 text-center text-base font-bold text-slate-900 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setFrequencyAndDue(frequencyValue + 1, frequencyUnit)}
                    className="h-8 w-8 rounded-full bg-slate-200 text-lg font-bold text-slate-700"
                    aria-label="Increase frequency"
                  >
                    +
                  </button>
                </div>
                <div className="flex-1 px-4 py-3">
                  <span className="mb-1 block text-[11px] font-medium text-slate-500">Unit</span>
                  <select
                    aria-label="Frequency unit"
                    value={frequencyUnit}
                    onChange={(event) => {
                      const nextFrequencyUnit = event.target.value as "days" | "weeks" | "months";
                      setFrequencyAndDue(frequencyValue, nextFrequencyUnit);
                    }}
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
                      className={`text-2xl transition-transform active:scale-90 ${
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
              Frequency updates this suggestion automatically. You can still edit it manually.
            </p>
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
                {selectedAssigneeIds.length > 0 ? `${selectedAssigneeIds.length} selected` : "Select assignees"}
              </span>
              <span className="text-slate-500">{showAssigneeMenu ? "▲" : "▼"}</span>
            </button>

            {showAssigneeMenu ? (
              <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                {members.map((member) => {
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
            ) : null}

            {selectedAssigneeIds.length > 1 ? (
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
            ) : null}
          </div>

          <div className="space-y-5 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-teal-700 to-teal-400 py-3.5 text-sm font-bold text-white shadow-xl shadow-teal-700/20 transition-all active:scale-[0.98] disabled:opacity-60"
            >
              <span>✓</span>
              {saving ? "Saving..." : "Save Task"}
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
