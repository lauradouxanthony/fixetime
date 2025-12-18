import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

function startOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
}

function endOfTodayUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = authData.user.id;
  const todayStart = startOfTodayUTC().toISOString();
  const todayEnd = endOfTodayUTC().toISOString();

  const [{ count: emailsTotal }, { count: emailsToday }, { count: urgentToday }] =
    await Promise.all([
      supabase.from("emails").select("id", { count: "exact", head: true }).eq("user_id", userId),
      supabase
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("received_at", todayStart)
        .lte("received_at", todayEnd),
      supabase
        .from("emails")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_urgent", true)
        .gte("received_at", todayStart)
        .lte("received_at", todayEnd),
    ]);

  const { data: importantEmails } = await supabase
    .from("emails")
    .select("id,sender,subject,received_at")
    .eq("user_id", userId)
    .eq("is_important", true)
    .order("received_at", { ascending: false })
    .limit(5);

  const { count: meetingsToday } = await supabase
    .from("calendar_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("start_time", todayStart)
    .lte("start_time", todayEnd);

  const { data: nextMeetings } = await supabase
    .from("calendar_events")
    .select("id,title,start_time,end_time")
    .eq("user_id", userId)
    .gte("start_time", todayStart)
    .order("start_time", { ascending: true })
    .limit(5);

  return NextResponse.json({
    stats: {
      emailsTotal,
      emailsToday,
      urgentToday,
      meetingsToday,
      hoursSaved: emailsToday ? emailsToday * 2 : 0,
    },
    importantEmails,
    nextMeetings,
  });
}
