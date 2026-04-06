"use client";

import { useEffect } from "react";

export type PostponeChoice = "tomorrow" | "cycle";

export default function PostponeSkipModal({
  open,
  taskName,
  onChoose,
  onClose,
}: {
  open: boolean;
  taskName: string;
  onChoose: (choice: PostponeChoice) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Postpone task"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <p className="text-sm font-bold text-slate-900">Postpone task</p>
        <p className="mt-1 text-xs text-slate-600">
          What should we do with{" "}
          <span className="font-semibold">&quot;{taskName}&quot;</span>?
        </p>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => onChoose("tomorrow")}
            className="w-full rounded-xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white"
          >
            Postpone to tomorrow
          </button>
          <button
            type="button"
            onClick={() => onChoose("cycle")}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800"
          >
            Skip until next cycle
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-700"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

