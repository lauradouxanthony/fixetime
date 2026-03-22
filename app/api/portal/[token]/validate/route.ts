/**
 * POST /api/portal/[token]/validate
 * Route AUTHENTIFIÉE (agent) — valide ou rejette un document déposé via le portail.
 * Le token sert à identifier l'email ; l'agent doit être connecté.
 *
 * Input  : { storagePath: string, validated: boolean }
 * Output : { success: true, storagePath, validated }
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { token } = await params;
    const { storagePath, validated } = await req.json() as {
      storagePath: string;
      validated: boolean;
    };
    if (!storagePath || typeof validated !== "boolean") {
      return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
    }

    // ── 1. Résoudre le token → email_id ───────────────────────────────────────
    const { data: tokenRow } = await supabaseAdmin
      .from("document_portal_tokens")
      .select("email_id, user_id")
      .eq("token", token)
      .maybeSingle();

    if (!tokenRow) return NextResponse.json({ error: "TOKEN_NOT_FOUND" }, { status: 404 });
    if (tokenRow.user_id !== user.id) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
    }

    // ── 2. Charger les attachments ────────────────────────────────────────────
    const { data: emailRow } = await supabaseAdmin
      .from("emails")
      .select("attachments")
      .eq("id", tokenRow.email_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!emailRow) return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });

    const atts = (emailRow.attachments ?? []) as Record<string, unknown>[];
    const idx = atts.findIndex((a) => a.storage_path === storagePath);
    if (idx === -1) {
      return NextResponse.json({ error: "ATTACHMENT_NOT_FOUND" }, { status: 404 });
    }

    // ── 3. Mettre à jour validated_by_human ──────────────────────────────────
    const updated = [...atts];
    updated[idx] = {
      ...updated[idx],
      validated_by_human: validated,
      status: validated ? "VALIDE" : "REJETE",
    };

    await supabaseAdmin
      .from("emails")
      .update({ attachments: updated })
      .eq("id", tokenRow.email_id);

    return NextResponse.json({ success: true, storagePath, validated });
  } catch (err) {
    console.error("[portal/validate]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
