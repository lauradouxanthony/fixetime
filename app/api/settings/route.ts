import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET() {
  try {
    const supabase = await supabaseServer();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 }
      );
    }

    const { data, error } = await supabase
      .from("settings_v1")
      .select("theme, automation_level, assistant_enabled, email_rules")
      .eq("user_id", user.id)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "settings_not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("GET_SETTINGS_ERROR", e);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { error: "unauthenticated" },
        { status: 401 }
      );
    }

    const body = await req.json();

    // ✅ construction SAFE (aucun champ écrasé)
    const updates: any = {
      updated_at: new Date().toISOString(),
    };

    if (body.theme !== undefined) {
      updates.theme = body.theme;
    }

    if (body.automation_level !== undefined) {
      updates.automation_level = body.automation_level;
    }

    if (body.assistant_enabled !== undefined) {
      updates.assistant_enabled = body.assistant_enabled;
    }

    if (body.email_rules !== undefined) {
      updates.email_rules = body.email_rules;
    }

    const { error } = await supabase
      .from("settings_v1")
      .update(updates)
      .eq("user_id", user.id);

    if (error) {
      console.error("SETTINGS_UPDATE_ERROR", error);
      return NextResponse.json(
        { error: "update_failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("SETTINGS_POST_ERROR", e);
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 }
    );
  }
}
