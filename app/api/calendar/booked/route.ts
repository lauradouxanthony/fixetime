import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type BookedItem = {
  id: string;
  at: string;
  prospect_name: string | null;
  property_address: string | null;
  confirmed_slot: string | null;
  source: "google" | "microsoft" | null;
};

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
      .eq("lead_status", "booked")
      .gte("received_at", sinceISO)
      .order("received_at", { ascending: false });

    if (error) {
      console.error("CALENDAR_BOOKED_ERROR", error);
      return NextResponse.json({ error: "BOOKED_FAILED" }, { status: 500 });
    }

    const list = (rows ?? []) as Record<string, unknown>[];
    const nowTime = now.getTime();

    const booked: BookedItem[] = list.map((row) => {
      const leadProfile = (row.lead_profile as Record<string, unknown> | null) ?? {};
      const leadJson = (row.lead_json as Record<string, unknown> | null) ?? {};
      const receivedAt = (row.received_at as string) ?? "";
      const confirmedSlot = (leadJson.confirmed_slot as string) ?? null;
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
        confirmed_slot: confirmedSlot ? String(confirmedSlot) : null,
        source,
      };
    });

    let next_visits = 0;
    for (const b of booked) {
      const slotOrAt = b.confirmed_slot ?? b.at;
      if (slotOrAt && new Date(slotOrAt).getTime() >= nowTime) {
        next_visits += 1;
      }
    }

    return NextResponse.json({
      period,
      total_booked: booked.length,
      next_visits,
      booked,
    });
  } catch (e) {
    console.error("CALENDAR_BOOKED_FATAL", e);
    return NextResponse.json({ error: "BOOKED_FAILED" }, { status: 500 });
  }
}
