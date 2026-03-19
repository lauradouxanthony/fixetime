import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const { id } = await params;
    const { attachmentIndex, docType } = await req.json();

    if (attachmentIndex === undefined || docType === undefined) {
      return NextResponse.json({ error: "attachmentIndex and docType are required" }, { status: 400 });
    }

    // 1. Charger l'email
    const { data: email, error } = await supabaseAdmin
      .from("emails")
      .select("id, attachments")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (error || !email) {
      return NextResponse.json({ error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    // 2. Mettre à jour attachments[attachmentIndex].docType
    const attachments = Array.isArray(email.attachments) ? [...(email.attachments as any[])] : [];

    if (attachmentIndex < 0 || attachmentIndex >= attachments.length) {
      return NextResponse.json({ error: "ATTACHMENT_INDEX_OUT_OF_RANGE" }, { status: 400 });
    }

    const att = { ...attachments[attachmentIndex] };

    // Mettre à jour docTypes : effacer l'ancien, ajouter le nouveau
    const oldDocTypes = (att.docTypes as Record<string, boolean>) ?? {};
    const newDocTypes: Record<string, boolean> = {};
    // On reset tous les flags existants à false et on active le nouveau
    for (const k of Object.keys(oldDocTypes)) {
      newDocTypes[k] = false;
    }
    if (docType && docType !== "autre") {
      newDocTypes[docType] = true;
    }
    att.docTypes = newDocTypes;
    att.docType = docType; // champ pratique pour le front

    attachments[attachmentIndex] = att;

    // 3. Sauvegarder le JSONB
    const { error: updateError } = await supabaseAdmin
      .from("emails")
      .update({ attachments })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, attachment: att });
  } catch (err) {
    console.error("[update-attachment]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
