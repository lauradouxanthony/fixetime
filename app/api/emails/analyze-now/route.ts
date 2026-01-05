import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // ⚠️ IMPORTANT
    // Le sync Gmail est volontairement retiré ici
    // pour éviter les timeouts en prod (Vercel).
    // Le sync doit être fait via cron / job backend.

    // 1) Analyse IA uniquement
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
        { error: "AI_ANALYZE_FAILED", details: aiJson },
        { status: 500 }
      );
    }

    // 2) OK
    return NextResponse.json({
      success: true,
      ai: aiJson,
    });
  } catch (e) {
    console.error("ANALYZE_NOW_FATAL", e);
    return NextResponse.json(
      { error: "ANALYZE_NOW_FAILED" },
      { status: 500 }
    );
  }
}
