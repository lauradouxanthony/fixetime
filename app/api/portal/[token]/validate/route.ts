import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { token } = await params;
    const { storagePath, validated } = await req.json();

    if (!storagePath || validated === undefined) {
      return NextResponse.json({ error: "MISSING_PARAMS" }, { status: 400 });
    }

    // Verify token belongs to this agent
    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("email_id, user_id")
      .eq("token", token)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!tokenRow) {
      return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
    }

    // Fetch and update attachments JSONB
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("attachments")
      .eq("id", tokenRow.email_id)
      .single();

    const attachments = (emailRow?.attachments ?? []) as Array<
      Record<string, unknown>
    >;

    const updated = attachments.map((a) =>
      a.storagePath === storagePath
        ? { ...a, validated_by_human: validated }
        : a
    );

    const { error } = await supabaseAdmin
      .from("emails")
      .update({ attachments: updated })
      .eq("id", tokenRow.email_id);

    if (error) {
      console.error("[PORTAL VALIDATE] Update error:", error);
      return NextResponse.json({ error: "UPDATE_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[PORTAL VALIDATE] Fatal:", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
