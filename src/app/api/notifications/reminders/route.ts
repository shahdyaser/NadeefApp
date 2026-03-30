import { NextResponse } from "next/server";
import type { PushSubscription } from "web-push";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWebPush, initWebPush } from "@/lib/notifications/web-push";

type ReminderSlot = "morning" | "evening";
const SLOT_HOURS: Record<ReminderSlot, number> = {
  morning: 8,
  evening: 20,
};

function formatDateInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function hourInTimezone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

function getSlotForHour(hour: number): ReminderSlot | null {
  if (hour === SLOT_HOURS.morning) return "morning";
  if (hour === SLOT_HOURS.evening) return "evening";
  return null;
}

function reminderMessage(slot: ReminderSlot, pendingCount: number) {
  if (slot === "morning") {
    return {
      title: "Good Morning from Nadeef ☀️",
      body: `🌿 A fresh home starts with one small win. You have ${pendingCount} task${pendingCount === 1 ? "" : "s"} today — you got this!`,
    };
  }
  return {
    title: "Nadeef Evening Boost 🌙",
    body: `✨ You are close! Finish the remaining ${pendingCount} task${pendingCount === 1 ? "" : "s"} and end the day proud.`,
  };
}

function isAuthorized(request: Request) {
  const configuredSecret = process.env.CRON_SECRET;
  if (!configuredSecret) return true;
  const providedSecret =
    request.headers.get("x-cron-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return providedSecret === configuredSecret;
}

function getForcedSlot(request: Request): ReminderSlot | null {
  const url = new URL(request.url);
  const value = url.searchParams.get("slot");
  return value === "morning" || value === "evening" ? value : null;
}

export async function POST(request: Request) {
  return runReminders(request);
}

export async function GET(request: Request) {
  return runReminders(request);
}

async function runReminders(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!initWebPush()) {
    return NextResponse.json({ error: "VAPID env vars are missing" }, { status: 500 });
  }
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase service role is missing" }, { status: 500 });
  }

  const now = new Date();
  const forcedSlot = getForcedSlot(request);
  const { data: houses, error: houseError } = await supabase.from("house").select("id,timezone");
  if (houseError) {
    return NextResponse.json({ error: houseError.message }, { status: 500 });
  }

  let sent = 0;
  let removed = 0;

  for (const house of houses ?? []) {
    const timeZone = house.timezone || "UTC";
    const localHour = hourInTimezone(now, timeZone);
    const slot = forcedSlot ?? getSlotForHour(localHour);
    if (!slot) continue;
    const localDate = formatDateInTimezone(now, timeZone);

    const { count: pendingCount, error: pendingError } = await supabase
      .from("task")
      .select("id", { count: "exact", head: true })
      .eq("house_id", house.id)
      .eq("status", "active")
      .not("next_due_date", "is", null)
      .lte("next_due_date", localDate);
    if (pendingError || !pendingCount || pendingCount <= 0) continue;

    const { data: members, error: memberError } = await supabase
      .from("user_house_bridge")
      .select("user_id")
      .eq("house_id", house.id)
      .eq("notifications_enabled", true);
    if (memberError || !members?.length) continue;

    const memberIds = members.map((m) => m.user_id);
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscription")
      .select("id,user_id,endpoint,subscription")
      .eq("house_id", house.id)
      .in("user_id", memberIds);
    if (subError || !subscriptions?.length) continue;

    const { data: sentLogs } = await supabase
      .from("push_reminder_log")
      .select("user_id")
      .eq("house_id", house.id)
      .eq("slot", slot)
      .eq("local_date", localDate);
    const sentUserIds = new Set((sentLogs ?? []).map((log) => log.user_id));

    const payload = reminderMessage(slot, Number(pendingCount));
    for (const sub of subscriptions) {
      if (sentUserIds.has(sub.user_id)) continue;
      try {
        await getWebPush().sendNotification(sub.subscription as unknown as PushSubscription, JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: "/tasks/due-today?window=today",
          icon: "/nadeef-logo.png",
          badge: "/nadeef-logo.png",
        }));
        sent += 1;
        await supabase.from("push_reminder_log").insert({
          user_id: sub.user_id,
          house_id: house.id,
          slot,
          local_date: localDate,
        });
      } catch (error: unknown) {
        const statusCode =
          typeof error === "object" && error && "statusCode" in error
            ? Number((error as { statusCode?: number }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          removed += 1;
          await supabase.from("push_subscription").delete().eq("id", sub.id);
        }
      }
    }
  }

  return NextResponse.json({ ok: true, sent, removed });
}
