import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export async function POST(req: Request) {
  try {
    const { emailId, action, minutes } = await req.json();

    if (!emailId || !action) {
      return NextResponse.json(
        { error: "emailId et action sont requis" },
        { status: 400 }
      );
    }

    // récup user connecté
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { error } = await supabase.from("time_events").insert({
      user_id: user.id,
      email_id: emailId,
      action, // ex: "copy_reply"
      minutes_saved: minutes ?? 0,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Erreur serveur" },
      { status: 500 }
    );
  }
}
