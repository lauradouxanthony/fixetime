import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    return NextResponse.json({ error: "NO_USER_ID" }, { status: 401 });
  }

  const userId = data.user.id;

  // 1) Email fake (avec gmail_id obligatoire)
  const emailInsert = await supabase.from("emails").insert({
    user_id: userId,
    gmail_id: "test-gmail-id-123",
    sender: "client@test.com",
    subject: "Urgent — Réunion à déplacer",
    summary: "Le client demande de déplacer la réunion.",
    is_urgent: true,
    is_important: true,
    received_at: new Date().toISOString(),
  });

  // 2) Event fake (avec google_event_id obligatoire)
  const eventInsert = await supabase.from("calendar_events").insert({
    user_id: userId,
    google_event_id: "test-google-event-456",
    title: "Réunion client",
    start_time: new Date().toISOString(),
    end_time: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    is_conflict: false,
    calendar_name: "Google Calendar",
  });

  return NextResponse.json({
    success: true,
    emailInsertError: emailInsert.error ?? null,
    eventInsertError: eventInsert.error ?? null,
  });
}
