import { NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const client = getSupabaseServerClient();

  if (!client) {
    return NextResponse.json(
      {
        configured: false,
        message:
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable Supabase.",
      },
      { status: 200 },
    );
  }

  const { error } = await client.auth.getSession();

  if (error) {
    return NextResponse.json(
      {
        configured: true,
        reachable: false,
        message: error.message,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    configured: true,
    reachable: true,
  });
}
