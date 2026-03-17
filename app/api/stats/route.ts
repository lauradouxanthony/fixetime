/**
 * GET /api/stats?period=7d|30d
 * Métriques bandeau Pipeline depuis emails_cache.
 * rdv_taken, emails_analyzed, hours_saved, avg_response_time (minutes)
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const ZERO_STATS = {
  rdv_taken: 0,
  hours_saved: 0,
  avg_response_time: null,
  avg_response_time_min: null,
  emails_analyzed: 0,
};

export async function GET(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const url = new URL(req.url);
    const period = url.searchParams.get("period") === "30d" ? "30d" : "7d";
    const fromIso = period === "30d" ? isoDaysAgo(30) : isoDaysAgo(7);

    const result = await supabase
      .from("emails_cache")
      .select("id, received_at, analyzed_at, ai_reply_sent_at, lead_status")
      .eq("user_id", user.id)
      .gte("received_at", fromIso);

    if (result.error) {
      return NextResponse.json(ZERO_STATS);
    }

    const list = (result.data ?? []) as {
      received_at: string | null;
      analyzed_at: string | null;
      ai_reply_sent_at: string | null;
      lead_status: string | null;
    }[];

    const rdv_taken = list.filter((r) => r.lead_status === "confirmed").length;
    const emails_analyzed = list.filter((r) => r.analyzed_at != null).length;
    const hours_saved = (emails_analyzed * 5) / 60;

    let totalMinutes = 0;
    let responseCount = 0;
    for (const r of list) {
      if (r.ai_reply_sent_at && r.received_at) {
        const received = new Date(r.received_at).getTime();
        const sent = new Date(r.ai_reply_sent_at).getTime();
        if (!Number.isNaN(received) && !Number.isNaN(sent)) {
          totalMinutes += (sent - received) / 60000;
          responseCount += 1;
        }
      }
    }
    const avg_response_time = responseCount > 0 ? totalMinutes / responseCount : null;

    const rounded = avg_response_time != null ? Math.round(avg_response_time) : null;
    return NextResponse.json({
      rdv_taken,
      hours_saved,
      avg_response_time: rounded,
      avg_response_time_min: rounded,
      emails_analyzed,
    });
  } catch {
    return NextResponse.json(ZERO_STATS);
  }
}
