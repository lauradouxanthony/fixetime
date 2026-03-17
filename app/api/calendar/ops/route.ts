import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ConfirmedItem = {
  email_id: string;
  prospect_name: string | null;
  start: string | null;
  property_address: string | null;
  score: number | null;
  provider: "google" | "microsoft" | null;
  at: string;
};

type ProposedItem = {
  email_id: string;
  prospect_name: string | null;
  property_address: string | null;
  slots: string[];
  score: number | null;
  at: string;
};

function safeJson(val: unknown): Record<string, unknown> | null {
  if (val == null) return null;
  if (typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  return null;
}

function safeArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((x): x is string => typeof x === "string");
}

function extractProspectName(profile: Record<string, unknown> | null, sender: string | null): string | null {
  const fromProfile = (profile?.prospect_name as string)?.trim();
  if (fromProfile) return fromProfile;
  if (sender && typeof sender === "string") {
    const beforeAt = sender.split("<")[0].trim();
    if (beforeAt) return beforeAt;
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const periodParam = searchParams.get("period");
    const period = periodParam === "30d" ? "30d" : "7d";

    const now = new Date();
    const since = new Date(now);
    since.setDate(since.getDate() - (period === "30d" ? 30 : 7));
    const sinceISO = since.toISOString();

    // 1) Confirmed (booked)
    const { data: bookedRows, error: bookedError } = await supabaseAdmin
      .from("emails")
      .select("id, received_at, sender, lead_profile, lead_property_address, lead_json, lead_score, provider")
      .eq("user_id", user.id)
      .eq("lead_status", "booked")
      .gte("received_at", sinceISO)
      .order("received_at", { ascending: false })
      .limit(50);

    if (bookedError) {
      console.error("CALENDAR_OPS_BOOKED_ERROR", bookedError);
      return NextResponse.json({ error: "OPS_FAILED" }, { status: 500 });
    }

    const confirmed: ConfirmedItem[] = ((bookedRows ?? []) as Record<string, unknown>[]).map((row) => {
      const leadProfile = safeJson(row.lead_profile);
      const leadJson = safeJson(row.lead_json);
      const prospectName = extractProspectName(leadProfile ?? {}, row.sender as string | null);
      const start = (leadJson?.confirmed_slot as string) ?? null;
      const propertyAddress =
        (row.lead_property_address as string) ??
        (leadProfile?.property_address as string) ??
        null;
      const score = typeof row.lead_score === "number" ? row.lead_score : null;
      const provider = row.provider === "microsoft" ? "microsoft" : row.provider === "google" ? "google" : null;
      return {
        email_id: String(row.id ?? ""),
        prospect_name: prospectName,
        start: start ? String(start) : null,
        property_address: propertyAddress ? String(propertyAddress) : null,
        score,
        provider,
        at: String(row.received_at ?? ""),
      };
    });

    // 2) Proposed (slots_proposed)
    const { data: proposedRows, error: proposedError } = await supabaseAdmin
      .from("emails")
      .select("id, received_at, sender, lead_profile, lead_property_address, lead_json, lead_score")
      .eq("user_id", user.id)
      .eq("lead_status", "slots_proposed")
      .gte("received_at", sinceISO)
      .order("received_at", { ascending: false })
      .limit(50);

    if (proposedError) {
      console.error("CALENDAR_OPS_PROPOSED_ERROR", proposedError);
      return NextResponse.json({ error: "OPS_FAILED" }, { status: 500 });
    }

    const proposed: ProposedItem[] = ((proposedRows ?? []) as Record<string, unknown>[]).map((row) => {
      const leadProfile = safeJson(row.lead_profile);
      const leadJson = safeJson(row.lead_json);
      const prospectName = extractProspectName(leadProfile ?? {}, row.sender as string | null);
      const slots = safeArray(leadJson?.slots_proposed);
      const propertyAddress =
        (row.lead_property_address as string) ??
        (leadProfile?.property_address as string) ??
        null;
      const score = typeof row.lead_score === "number" ? row.lead_score : null;
      return {
        email_id: String(row.id ?? ""),
        prospect_name: prospectName,
        property_address: propertyAddress ? String(propertyAddress) : null,
        slots,
        score,
        at: String(row.received_at ?? ""),
      };
    });

    // 3) Availability: désactivé pour éviter blocage navigation (appel /api/availability/slots)
    const availabilitySlots: { start: string; end: string }[] = [];

    return NextResponse.json({
      period,
      confirmed,
      proposed,
      availability: { slots: availabilitySlots },
    });
  } catch (e: unknown) {
    if (e instanceof Error && e.message === "TIMEOUT") {
      const period = new URL(req.url).searchParams.get("period") === "30d" ? "30d" : "7d";
      return NextResponse.json({
        period,
        confirmed: [],
        proposed: [],
        availability: { slots: [] },
        error: "TIMEOUT",
      }, { status: 200 });
    }
    console.error("CALENDAR_OPS_FATAL", e);
    return NextResponse.json({ period: "7d", confirmed: [], proposed: [], availability: { slots: [] }, error: "SERVER_ERROR" }, { status: 200 });
  }
}
