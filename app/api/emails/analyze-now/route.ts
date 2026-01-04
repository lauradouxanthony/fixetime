import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // 1) Sync Gmail (on garde ton endpoint inchangé)
    const syncRes = await fetch(`${baseUrl}/api/gmail/sync`, {
      method: "POST",
      headers: {
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });

    const syncJson = await syncRes.json().catch(() => ({}));

    if (!syncRes.ok) {
      return NextResponse.json(
        { error: "SYNC_FAILED", details: syncJson },
        { status: 500 }
      );
    }

    // 2) Analyse IA (même cookie, même user)
    const aiRes = await fetch(`${baseUrl}/api/ai/analyze-inbox`, {
      method: "POST",
      headers: {
        cookie: req.headers.get("cookie") ?? "",
      },
      cache: "no-store",
    });

    const aiJson = await aiRes.json().catch(() => ({}));

    if (!aiRes.ok) {
      return NextResponse.json(
        { error: "AI_ANALYZE_FAILED", details: aiJson, sync: syncJson },
        { status: 500 }
      );
    }

    // 3) OK
    return NextResponse.json({
      success: true,
      sync: syncJson,
      ai: aiJson,
    });
  } catch (e) {
    console.error("ANALYZE_NOW_FATAL", e);
    return NextResponse.json({ error: "ANALYZE_NOW_FAILED" }, { status: 500 });
  }
}
