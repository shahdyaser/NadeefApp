import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";

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

type ParsedSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function parseSubscription(body: unknown): ParsedSubscription | null {
  if (!body || typeof body !== "object") return null;
  const value = body as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  if (!value.endpoint || !value.keys?.p256dh || !value.keys?.auth) return null;
  return {
    endpoint: value.endpoint,
    keys: {
      p256dh: value.keys.p256dh,
      auth: value.keys.auth,
    },
  };
}

export async function POST(request: Request) {
  const client = getAuthedClient(request);
  if (!client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  const { data: bridgeData, error: bridgeError } = await client
    .from("user_house_bridge")
    .select("house_id")
    .eq("user_id", userId)
    .limit(1);
  if (bridgeError || !bridgeData?.[0]?.house_id) {
    return NextResponse.json({ error: bridgeError?.message ?? "House not found" }, { status: 400 });
  }
  const houseId = bridgeData[0].house_id;

  const body = await request.json();
  const subscription = parseSubscription(body?.subscription);
  if (!subscription) {
    return NextResponse.json({ error: "Invalid subscription payload" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await client.from("push_subscription").upsert(
    {
      user_id: userId,
      house_id: houseId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      subscription: subscription as unknown as Json,
      user_agent: request.headers.get("user-agent"),
      updated_at: nowIso,
      last_seen_at: nowIso,
    },
    { onConflict: "endpoint" },
  );

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const client = getAuthedClient(request);
  if (!client) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json();
  const endpoint = body?.endpoint as string | undefined;
  if (!endpoint) {
    return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
  }

  const { error: deleteError } = await client
    .from("push_subscription")
    .delete()
    .eq("user_id", userData.user.id)
    .eq("endpoint", endpoint);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
