import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Bucket date YYYY-MM-DD en UTC */
function toUtcDateKey(iso: string): string {
  return iso.split("T")[0];
}

export async function GET(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const url = new URL(req.url);
  const period = (url.searchParams.get("period") || "7d") as "7d" | "30d";
  const days = period === "30d" ? 30 : 7;
  const fromIso = isoDaysAgo(days);

  // 1 query: tous les emails de la période
  const { data: rows, error } = await supabaseAdmin
    .from("emails")
    .select("id, received_at, lead_status, lead_json, lead_score, lead_is_qualified")
    .eq("user_id", user.id)
    .gte("received_at", fromIso)
    .order("received_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "TIMESERIES_FETCH_FAILED" }, { status: 500 });
  }

  const emails = rows ?? [];

  const byDate: Record<string, {
    prospects: number;
    qualified: number;
    booked: number;
    responseTimes: number[];
  }> = {};

  for (const e of emails) {
    if (!e.received_at) continue;
    const date = toUtcDateKey(e.received_at);
    if (!byDate[date]) {
      byDate[date] = { prospects: 0, qualified: 0, booked: 0, responseTimes: [] };
    }

    byDate[date].prospects++;

    const status = e.lead_status ?? null;
    const score = typeof e.lead_score === "number" ? e.lead_score : null;
    const isQualified = e.lead_is_qualified === true;
    const isQualifiedByRule =
      status === "slots_proposed" ||
      status === "booked" ||
      (score !== null && score >= 8) ||
      isQualified;
    if (isQualifiedByRule) {
      byDate[date].qualified++;
    }
    if (status === "booked") {
      byDate[date].booked++;
    }

    const received = new Date(e.received_at).getTime();
    const lob = (e.lead_json as { last_outbound?: { at?: string; sent_at?: string } } | null)?.last_outbound;
    const outAtIso = lob?.at ?? lob?.sent_at ?? null;
    if (outAtIso) {
      const outAt = new Date(outAtIso).getTime();
      if (outAt >= received) {
        byDate[date].responseTimes.push((outAt - received) / (60 * 1000));
      }
    }
  }

  const points: Array<{
    date: string;
    prospects: number;
    qualified: number;
    booked: number;
    avgResponseMin: number;
  }> = [];

  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - (days - 1 - i),
      0, 0, 0, 0
    ));
    const date = d.toISOString().slice(0, 10);
    const dayData = byDate[date] ?? { prospects: 0, qualified: 0, booked: 0, responseTimes: [] };
    const avgResponseMin =
      dayData.responseTimes.length > 0
        ? Math.round(
            dayData.responseTimes.reduce((a, b) => a + b, 0) / dayData.responseTimes.length
          )
        : 0;

    points.push({
      date,
      prospects: dayData.prospects,
      qualified: dayData.qualified,
      booked: dayData.booked,
      avgResponseMin,
    });
  }

  return NextResponse.json({ points });
}
