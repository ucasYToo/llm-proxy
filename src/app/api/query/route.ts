import { NextRequest, NextResponse } from "next/server";
import { readConfig } from "@/lib/config";
import { queryLogs, clearLogs } from "@/lib/logger";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");

  if (type === "config") {
    return NextResponse.json(readConfig());
  }

  if (type === "logs") {
    const limit = Number(searchParams.get("limit") ?? "50");
    const offset = Number(searchParams.get("offset") ?? "0");
    const targetId = searchParams.get("targetId") ?? undefined;
    const result = queryLogs({ limit, offset, targetId });
    return NextResponse.json(result);
  }

  return NextResponse.json({ error: "type must be config or logs" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type");

  if (type === "logs") {
    clearLogs();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "type must be logs" }, { status: 400 });
}
