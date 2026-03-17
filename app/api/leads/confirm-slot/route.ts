import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidGoogleAccessToken } from "@/lib/google/getValidAccessToken";
import { logActivity } from "@/lib/activity/logActivity";

export const runtime = "nodejs";

function addMinutes(d: Date, min: number) {
  return new Date(d.getTime() + min * 60_000);
}
async function hasMicrosoft(userId: string) {
  const { data } = await supabaseAdmin
    .from("microsoft_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.user_id;
}

async function hasGoogle(userId: string) {
  const { data } = await supabaseAdmin
    .from("gmail_tokens")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.user_id;
}

export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

    const body = await req.json().catch(() => null);
    const trigger =
  body?.trigger === "autopilot" || req.headers.get("x-fix-trigger") === "autopilot"
    ? "autopilot"
    : "manual";

    const emailId = (body?.emailId ?? body?.lead_id) as string | undefined;
    let slotStart = body?.slotStart as string | undefined;

    if (!emailId) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", required: ["emailId"] },
        { status: 400 }
      );
    }

    const { data: emailRow, error } = await supabaseAdmin
      .from("emails")
      .select("id, user_id, sender, lead_profile, lead_json")
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error || !emailRow) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const leadJson = (emailRow as any).lead_json ?? {};
    if (!slotStart && Array.isArray(leadJson?.slots_proposed) && leadJson.slots_proposed.length > 0) {
      slotStart = leadJson.slots_proposed[0];
    }
    if (!slotStart) {
      return NextResponse.json(
        { error: "MISSING_SLOT", required: ["slotStart or slots_proposed in lead_json"] },
        { status: 400 }
      );
    }

    const origin = new URL(req.url).origin;
    const durationMin = Number(leadJson?.slots_duration_min ?? 30);

    const start = new Date(slotStart);
    const end = addMinutes(start, durationMin);

    if (isNaN(start.getTime())) {
      return NextResponse.json({ error: "INVALID_SLOT_START" }, { status: 400 });
    }

    const prospectName =
      (emailRow as any)?.lead_profile?.prospect_name?.trim?.() ||
      (emailRow.sender ? String(emailRow.sender).split("<")[0].trim() : "Candidat");

    const title = `Visite — ${prospectName}`;

    const useMicrosoft = await hasMicrosoft(user.id);
const useGoogle = !useMicrosoft && (await hasGoogle(user.id));

if (!useMicrosoft && !useGoogle) {
  return NextResponse.json({ error: "NO_PROVIDER_TOKEN" }, { status: 400 });
}

let provider: "microsoft" | "google" = useMicrosoft ? "microsoft" : "google";
let providerEventId: string | null = null;

if (useMicrosoft) {
  // OK Outlook event (inchange)
  const calRes = await fetch(`${origin}/api/outlook/calendar/create-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.get("cookie") || "",
    },
    body: JSON.stringify({
      title,
      start: start.toISOString(),
      end: end.toISOString(),
    }),
  });

  const calJson = await calRes.json().catch(() => null);
  if (!calRes.ok) {
    return NextResponse.json(
      { error: "OUTLOOK_CREATE_EVENT_FAILED", details: calJson },
      { status: 400 }
    );
  }

  providerEventId = calJson?.event?.id ?? null;
} else {
  // OK Google Calendar event (nouveau)
  const accessToken = await getValidGoogleAccessToken(user.id);

  const gRes = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: title,
        description: "Visite confirmée depuis FixTime.",
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
      }),
    }
  );

  const gJson = await gRes.json().catch(() => null);

  if (!gRes.ok) {
    return NextResponse.json(
      { error: "GOOGLE_CREATE_EVENT_FAILED", details: gJson },
      { status: 400 }
    );
  }

  providerEventId = gJson?.id ?? null;
}


const nowIso = new Date().toISOString();

const nextLeadJson = {
  ...leadJson,

  // INSTRUMENTATION ROI
  first_action_at: leadJson?.first_action_at ?? nowIso,
  first_action_trigger: leadJson?.first_action_trigger ?? trigger,
  last_action_trigger: trigger,

  booking: {
    start: start.toISOString(),
    end: end.toISOString(),
    provider,
    provider_event_id: providerEventId,
    created_at: nowIso,
    trigger, // important
  },

  attendance: {
    confirmed: true,
    confirmed_at: nowIso,
  },
  last_action: { type: "booked", at: nowIso, label: "Visite confirmée" },
};


    const bookedLabel = "Visite confirmée";
    await supabaseAdmin
      .from("emails")
      .update({
        lead_status: "booked",
        lead_last_action_source: "human",
        lead_json: nextLeadJson,
        lead_last_action: bookedLabel,
        lead_last_action_at: nowIso,
      })
      .eq("id", emailId)
      .eq("user_id", user.id);
      await logActivity({
        userId: user.id,
        actor: "human",
        type: "visit_booked",
        title: "Visite confirmée",
        emailId,
        meta: { slotStart, provider },
      });
      
      
      
    // OK Task relance 2h avant (via endpoint existant pour eviter guessing DB)
    const dueAt = addMinutes(start, -120);

    await fetch(`${origin}/api/tasks/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: req.headers.get("cookie") || "",
      },
      body: JSON.stringify({
        title: `Relance visite — ${prospectName}`,
        emailId,
        dueAt: dueAt.toISOString(),
        estimatedMinutes: 1,
        source: "reminder",
        status: "open",
      }),
    }).catch(() => null);

    console.log("[api] confirm-slot end", { requestId, duration_ms: Date.now() - startMs });
    return NextResponse.json({
      success: true,
      start: start.toISOString(),
      end: end.toISOString(),
      provider_event_id: providerEventId,
    });
  } catch (e: any) {
    console.error("[api] confirm-slot error", { requestId, duration_ms: Date.now() - startMs, error: e?.message ?? e });
    return NextResponse.json({ error: "CONFIRM_SLOT_FAILED" }, { status: 500 });
  }
}
