import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { logTime, type TimeEventType } from "@/lib/time/logTime";

const allowedTypes: TimeEventType[] = [
  "email_analyzed",
  "email_ignored",
  "email_classified",
  "ai_reply_generated",
  "reply_planned",
];

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const type = body?.type as unknown;
    const emailId = body?.emailId ?? null;

    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NO_USER" }, { status: 401 });
    }

    if (
      typeof type !== "string" ||
      !allowedTypes.includes(type as TimeEventType)
    ) {
      return NextResponse.json({ error: "BAD_TYPE" }, { status: 400 });
    }

    const safeType = type as TimeEventType;

    await logTime({
      userId: user.id,
      type: safeType,
      emailId,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("TIME_LOG_ERROR", e);
    return NextResponse.json({ error: "TIME_LOG_FAILED" }, { status: 500 });
  }
}
