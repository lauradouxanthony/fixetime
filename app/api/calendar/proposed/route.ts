import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ProposedItem = {
  id: string;
  at: string;
  prospect_name: string | null;
  property_address: string | null;
  slots: string[];
  source: "google" | "microsoft" | null;
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

    const { data: rows, error } = await supabaseAdmin
      .from("emails")
      .select(
        "id, received_at, sender, subject, lead_status, lead_profile, lead_property_address, lead_json, property_id, provider"
      )
      .eq("user_id", user.id)
      .eq("lead_status", "slots_proposed")
      .gte("received_at", sinceISO)
      .order("received_at", { ascending: false });

    if (error) {
      console.error("CALENDAR_PROPOSED_ERROR", error);
      return NextResponse.json({ error: "PROPOSED_FAILED" }, { status: 500 });
    }

    const list = (rows ?? []) as Record<string, unknown>[];

    const proposed: ProposedItem[] = list.map((row) => {
      const leadProfile = safeJson(row.lead_profile) ?? {};
      const leadJson = safeJson(row.lead_json) ?? {};
      const receivedAt = (row.received_at as string) ?? "";
      const slots = safeArray(leadJson.slots_proposed);
      const provider = row.provider as string | null;
      const source =
        provider === "microsoft"
          ? ("microsoft" as const)
          : provider === "google"
            ? ("google" as const)
            : null;
      const prospectName = (leadProfile.prospect_name as string) ?? null;
      const propertyAddress =
        (row.lead_property_address as string) ??
        (leadProfile.property_address as string) ??
        null;

      return {
        id: String(row.id ?? ""),
        at: receivedAt,
        prospect_name: prospectName ? String(prospectName) : null,
        property_address: propertyAddress ? String(propertyAddress) : null,
        slots,
        source,
      };
    });

    return NextResponse.json({
      period,
      total_proposed: proposed.length,
      proposed,
    });
  } catch (e) {
    console.error("CALENDAR_PROPOSED_FATAL", e);
    return NextResponse.json({ error: "PROPOSED_FAILED" }, { status: 500 });
  }
}
