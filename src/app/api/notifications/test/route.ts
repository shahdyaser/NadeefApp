import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import type { PushSubscription } from "web-push";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWebPush, initWebPush } from "@/lib/notifications/web-push";

type TestSlot = "test" | "morning" | "evening";

function getAuthedClient(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authHeader = request.headers.get("authorization");
  if (!supabaseUrl || !supabaseAnonKey || !authHeader) {
    return null;
  }
  return createClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: authHeader,
      },
    },
  });
}

function parseSlot(request: Request): TestSlot {
  const url = new URL(request.url);
  const raw = url.searchParams.get("slot");
  if (raw === "morning" || raw === "evening") {
    return raw;
  }
  return "test";
}

function payloadForSlot(slot: TestSlot) {
  if (slot === "morning") {
    return {
      title: "Good Morning from Nadeef ☀️",
      body: "🌿 A fresh home starts with one small win. You have 5 tasks today — you got this!",
    };
  }
  if (slot === "evening") {
    return {
      title: "Nadeef Evening Boost 🌙",
      body: "✨ You are close! Finish the remaining 5 tasks and end the day proud.",
    };
  }
  return {
    title: "Nadeef Test Notification",
    body: "Push notifications are working on this device 🎉",
  };
}

export async function POST(request: Request) {
  const client = getAuthedClient(request);
  if (!client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = getSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Missing service role key" }, { status: 500 });
  }
  if (!initWebPush()) {
    return NextResponse.json({ error: "Missing VAPID env vars" }, { status: 500 });
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  const { data: bridgeData, error: bridgeError } = await client
    .from("user_house_bridge")
    .select("house_id,notifications_enabled")
    .eq("user_id", userId)
    .limit(1);
  if (bridgeError || !bridgeData?.[0]?.house_id) {
    return NextResponse.json({ error: "No house linked to this account" }, { status: 400 });
  }
  if (!bridgeData[0].notifications_enabled) {
    return NextResponse.json(
      { error: "Notifications are disabled in your profile settings" },
      { status: 400 },
    );
  }

  const { data: subscriptions, error: subError } = await admin
    .from("push_subscription")
    .select("id,subscription")
    .eq("user_id", userId);
  if (subError) {
    return NextResponse.json({ error: subError.message }, { status: 500 });
  }
  if (!subscriptions?.length) {
    return NextResponse.json(
      { error: "No push subscription found on this device yet." },
      { status: 400 },
    );
  }

  const slot = parseSlot(request);
  const payload = payloadForSlot(slot);

  let sent = 0;
  let removed = 0;
  for (const sub of subscriptions) {
    try {
      await getWebPush().sendNotification(
        sub.subscription as unknown as PushSubscription,
        JSON.stringify({
          title: payload.title,
          body: payload.body,
          url: "/tasks/due-today?window=today",
          icon: "/nadeef-logo.png",
          badge: "/nadeef-logo.png",
        } satisfies Json),
      );
      sent += 1;
    } catch (error: unknown) {
      const statusCode =
        typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: number }).statusCode)
          : 0;
      if (statusCode === 404 || statusCode === 410) {
        removed += 1;
        await admin.from("push_subscription").delete().eq("id", sub.id);
      }
    }
  }

  if (!sent) {
    return NextResponse.json(
      { error: "Unable to deliver test notification to any subscription." },
      { status: 400 },
    );
  }
  return NextResponse.json({ ok: true, sent, removed });
}
