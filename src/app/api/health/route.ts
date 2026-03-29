import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    app: "nadeef",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
