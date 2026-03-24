import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "DISABLED_ENDPOINT",
      detail:
        "This endpoint was disabled because it referenced missing internal modules. Use /api/ai/analyze-start and /api/ai/analyze-tick instead.",
    },
    { status: 410 }
  );
}
