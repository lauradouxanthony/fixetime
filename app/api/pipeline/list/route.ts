import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import type { EtapeProcess } from "@/types/email";

export const runtime = "nodejs";

const STEP_RANK: Record<EtapeProcess, number> = {
  VALIDE: 8,
  REFUSE: 7,
  DOSSIER_RECU: 6,
  DOSSIER_DEMANDE: 5,
  VISITE_CONFIRMEE: 4,
  VISITE_PROPOSEE: 3,
  QUALIFICATION: 2,
  NEW: 1,
};

function getEtapeRank(etape: string | null): number {
  if (!etape) return 1;
  return STEP_RANK[etape as EtapeProcess] ?? 1;
}

const SPAM_SENDERS = [
  "revolut", "facebook", "noreply", "no-reply", "notification",
  "newsletter", "linkedin", "twitter", "instagram", "google",
  "apple", "amazon", "paypal", "stripe",
];

export async function GET() {
  try {
    const supabase = await supabaseServer();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const since = new Date();
    since.setDate(since.getDate() - 60); // 60 jours pour capturer plus de prospects

    // 1. Requête principale — emails LOCATION seulement
    const { data: rows, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, summary, body, received_at, category, is_urgent, is_important, classification_reason, prospect_data, attachments, property_id, ai_reply")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows) return NextResponse.json({ leads: [] });

    // 2. Filtrage côté serveur — exclure les expéditeurs marketing/notifications
    const filtered = rows.filter((row) => {
      const sender = (row.sender ?? "").toLowerCase();
      return !SPAM_SENDERS.some((spam) => sender.includes(spam));
    });

    // 3. Déduplication par sender — garder 1 email par prospect (le plus avancé)
    const bySender = new Map<string, typeof filtered[number]>();

    for (const row of filtered) {
      const senderKey = (row.sender ?? "").toLowerCase().replace(/.*<(.+)>.*/, "$1").trim();
      if (!senderKey) continue;

      const existing = bySender.get(senderKey);
      if (!existing) {
        bySender.set(senderKey, row);
        continue;
      }

      const newEtape = (row.prospect_data as any)?.etape_process ?? null;
      const existingEtape = (existing.prospect_data as any)?.etape_process ?? null;
      const newRank = getEtapeRank(newEtape);
      const existingRank = getEtapeRank(existingEtape);

      // Garder le plus avancé ; si égalité → le plus récent
      if (
        newRank > existingRank ||
        (newRank === existingRank &&
          new Date(row.received_at ?? 0) > new Date(existing.received_at ?? 0))
      ) {
        bySender.set(senderKey, row);
      }
    }

    // 4. Compter le nombre d'emails par sender (thread count)
    const senderCounts = new Map<string, number>();
    for (const row of filtered) {
      const senderKey = (row.sender ?? "").toLowerCase().replace(/.*<(.+)>.*/, "$1").trim();
      senderCounts.set(senderKey, (senderCounts.get(senderKey) ?? 0) + 1);
    }

    // 5. Enrichir chaque lead avec thread_count
    const leads = Array.from(bySender.values()).map((row) => {
      const senderKey = (row.sender ?? "").toLowerCase().replace(/.*<(.+)>.*/, "$1").trim();
      return {
        ...row,
        thread_count: senderCounts.get(senderKey) ?? 1,
      };
    });

    // 6. Tri : étape la plus avancée en premier, puis par date
    leads.sort((a, b) => {
      const ra = getEtapeRank((a.prospect_data as any)?.etape_process ?? null);
      const rb = getEtapeRank((b.prospect_data as any)?.etape_process ?? null);
      if (rb !== ra) return rb - ra;
      return new Date(b.received_at ?? 0).getTime() - new Date(a.received_at ?? 0).getTime();
    });

    return NextResponse.json({ leads });
  } catch (err) {
    console.error("[pipeline/list]", err);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
