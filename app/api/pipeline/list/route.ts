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

    // 1. Requête principale — tous les emails récents (qualification faite côté JS)
    const { data: rows, error } = await supabaseAdmin
      .from("emails")
      .select("id, sender, subject, summary, body, received_at, category, is_urgent, is_important, classification_reason, prospect_data, attachments, property_id, ai_reply")
      .eq("user_id", user.id)
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false })
      .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows) return NextResponse.json({ leads: [] });

    // 2. Filtrage côté serveur — exclure spam + ne garder que les prospects qualifiés
    //    Un email est qualifié si : catégorie LOCATION OU prospect_data.nom non-null
    //    (couvre les emails mal classifiés avant une mise à jour de l'IA)
    const filtered = rows.filter((row) => {
      const sender = (row.sender ?? "").toLowerCase();
      if (SPAM_SENDERS.some((spam) => sender.includes(spam))) return false;
      const pd = (row.prospect_data as Record<string, unknown> | null);
      const hasProspectName = pd?.nom && String(pd.nom) !== "null" && String(pd.nom).trim().length > 0;
      return row.category === "LOCATION" || hasProspectName;
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

    // 4. Grouper tous les emails par sender (pour thread count + fusion de données)
    const senderGroups = new Map<string, typeof filtered>();
    for (const row of filtered) {
      const senderKey = (row.sender ?? "").toLowerCase().replace(/.*<(.+)>.*/, "$1").trim();
      if (!senderKey) continue;
      const grp = senderGroups.get(senderKey) ?? [];
      grp.push(row);
      senderGroups.set(senderKey, grp);
    }

    // 5. Enrichir chaque lead avec thread_count + fusion prospect_data depuis tous les emails du groupe
    const rawLeads = Array.from(bySender.values()).map((row) => {
      const senderKey = (row.sender ?? "").toLowerCase().replace(/.*<(.+)>.*/, "$1").trim();
      const group = senderGroups.get(senderKey) ?? [row];

      // Fusionner prospect_data : pour chaque champ, prendre la première valeur non-null
      // en parcourant le groupe par date DESC (déjà trié)
      const mergedPd: Record<string, unknown> = {};
      for (const email of group) {
        const pd = (email.prospect_data as Record<string, unknown> | null) ?? {};
        for (const [k, v] of Object.entries(pd)) {
          if (v !== null && v !== undefined && mergedPd[k] == null) {
            mergedPd[k] = v;
          }
        }
      }

      // Le spread { ...mergedPd, ...row.prospect_data } propage les nulls et
      // écrase les valeurs reconstruites. On ne garde que les entrées non-null du row.
      const rowPdNonNull = Object.fromEntries(
        Object.entries((row.prospect_data as Record<string, unknown>) ?? {})
          .filter(([, v]) => v !== null && v !== undefined)
      );

      // Merge property_id from group — the winner email may predate auto-assignment
      const mergedPropertyId =
        row.property_id ??
        group.find((e) => e.property_id != null)?.property_id ??
        null;

      return {
        ...row,
        property_id: mergedPropertyId,
        prospect_data: { ...mergedPd, ...rowPdNonNull },
        thread_count: group.length,
      };
    });

    // 5.5. Normaliser les clés revenus/loyer dans prospect_data
    // L'IA peut stocker les données sous différents noms de clés selon le prompt
    const leads = rawLeads.map((row) => {
      const pd = (row.prospect_data as Record<string, unknown>) ?? {};
      const revenus_mensuels =
        (pd.revenus_mensuels as number | null) ??
        (pd.revenus as number | null) ??
        (pd.salary as number | null) ??
        (pd.income as number | null) ??
        null;
      const property = pd.property as Record<string, unknown> | null;
      const loyer_max =
        (pd.loyer_max as number | null) ??
        (pd.loyer as number | null) ??
        (pd.rent as number | null) ??
        (property?.rent as number | null) ??
        null;
      return {
        ...row,
        prospect_data: { ...pd, revenus_mensuels, loyer_max },
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
