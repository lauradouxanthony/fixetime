import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getAvailabilitySlots } from "@/lib/calendar/availability";

export const runtime = "nodejs";

const ROUTE_TIMEOUT_MS = 12000;

function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === "TIMEOUT";
}

function isNoToken(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  return m === "NO_GOOGLE_TOKEN" || m === "NO_REFRESH_TOKEN" || m === "NO_MICROSOFT_TOKEN" || m === "NO_MICROSOFT_REFRESH_TOKEN";
}

function isReauth(err: unknown): { provider: "google" | "microsoft" } | null {
  if (!(err instanceof Error)) return null;
  const m = err.message;
  if (m === "GOOGLE_TOKEN_REVOKED") return { provider: "google" };
  if (m === "NO_MICROSOFT_TOKEN" || m === "NO_MICROSOFT_REFRESH_TOKEN") return { provider: "microsoft" };
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const days = Number(body?.days ?? 5); // 5 jours ouvrés par défaut
    const durationMin = Number(body?.durationMin ?? 30); // 30 min par défaut
    const maxSlots = Number(body?.maxSlots ?? 3); // 3 créneaux à proposer

    // Garde-fous
    const safeDays = Math.min(Math.max(days, 1), 10);
    const safeDuration = Math.min(Math.max(durationMin, 15), 120);
    const safeMax = Math.min(Math.max(maxSlots, 1), 10);

    // Détecter providers connectés
    const [googleTok, msTok] = await Promise.all([
      supabaseAdmin
        .from("gmail_tokens")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabaseAdmin
        .from("microsoft_tokens")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);

    const hasGoogle = !!googleTok?.data?.user_id;
    const hasMicrosoft = !!msTok?.data?.user_id;

    if (!hasGoogle && !hasMicrosoft) {
      return NextResponse.json({ ok: true, skipped: true, reason: "NO_TOKEN" }, { status: 200 });
    }

    let timeoutId: ReturnType<typeof setTimeout>;
    const slots = await Promise.race([
      getAvailabilitySlots({
        userId: user.id,
        daysAhead: safeDays,
        durationMin: safeDuration,
        maxSlots: safeMax,
        useGoogle: hasGoogle,
        useMicrosoft: hasMicrosoft,
        timezone: "Europe/Paris",
        workDayStartHour: 9,
        workDayEndHour: 18,
      }).then((s) => {
        clearTimeout(timeoutId);
        return s;
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("ROUTE_TIMEOUT")), ROUTE_TIMEOUT_MS);
      }),
    ]);

    return NextResponse.json({
      success: true,
      providers: {
        google: hasGoogle,
        microsoft: hasMicrosoft,
      },
      slots,
    });
  } catch (e: unknown) {
    if (isTimeout(e) || (e instanceof Error && e.message === "ROUTE_TIMEOUT")) {
      return NextResponse.json({ ok: false, error: "TIMEOUT" }, { status: 200 });
    }
    if (isNoToken(e)) {
      return NextResponse.json({ ok: true, skipped: true, reason: "NO_TOKEN" }, { status: 200 });
    }
    const reauth = isReauth(e);
    if (reauth) {
      return NextResponse.json({ ok: true, skipped: true, needs_reauth: true, provider: reauth.provider }, { status: 200 });
    }
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 200 });
  }
}
