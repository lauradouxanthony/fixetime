/**
 * upsertProspect — Fonction centrale de création/mise à jour d'un prospect.
 * Règles :
 * - Déduplication par (user_id, email)
 * - Les données s'accumulent, ne se perdent jamais (merge non-destructif)
 * - etape_process ne régresse jamais (sauf NEW → tout)
 * - Lie l'email courant au prospect via emails.prospect_id
 */
import { supabaseAdmin } from "@/lib/supabaseAdmin";

/** Ordre de progression des étapes (index = niveau) */
const STEP_ORDER = [
  "NEW",
  "QUALIFICATION",
  "VISITE_PROPOSEE",
  "VISITE_CONFIRMEE",
  "DOSSIER_DEMANDE",
  "DOSSIER_RECU",
  "VALIDE",
  "REFUSE",
] as const;

type EtapeProcess = (typeof STEP_ORDER)[number];

function isValidEtape(s: unknown): s is EtapeProcess {
  return typeof s === "string" && STEP_ORDER.includes(s as EtapeProcess);
}

/** Retourne l'étape la plus avancée entre les deux. REFUSE est terminal. */
function advanceEtape(current: string | null, incoming: string | null): string {
  const fallback = "NEW";
  if (!incoming || !isValidEtape(incoming)) return current ?? fallback;
  if (!current || !isValidEtape(current)) return incoming;
  // REFUSE est terminal — ne peut être écrasé que par VALIDE (décision finale)
  if (current === "REFUSE" && incoming !== "VALIDE") return current;
  const curIdx = STEP_ORDER.indexOf(current as EtapeProcess);
  const incIdx = STEP_ORDER.indexOf(incoming as EtapeProcess);
  return incIdx >= curIdx ? incoming : current;
}

export interface UpsertProspectInput {
  email: string;
  nom?: string | null;
  prenom?: string | null;
  telephone?: string | null;
  situation_pro?: string | null;
  revenus_mensuels?: number | null;
  garant?: boolean | null;
  garant_revenus?: number | null;
  nb_personnes?: number | null;
  animaux?: boolean | null;
  property_id?: string | null;
  etape_process?: string | null;
  lead_score?: number | null;
  visite_date?: string | null;
  visite_status?: string | null;
  dossier_complet?: boolean | null;
}

/**
 * Crée ou met à jour un prospect, lie l'email courant au prospect.
 * @returns prospect_id (UUID string)
 */
export async function upsertProspect(
  userId: string,
  emailId: string,
  data: UpsertProspectInput
): Promise<string> {
  const { email: prospectEmail, ...fields } = data;

  if (!prospectEmail || !prospectEmail.includes("@")) {
    throw new Error(`upsertProspect: invalid email "${prospectEmail}"`);
  }

  // ── 1. Chercher si un prospect existe déjà ────────────────────────────────
  const { data: existing } = await supabaseAdmin
    .from("prospects")
    .select("id, etape_process, revenus_mensuels, situation_pro, nom, prenom, telephone, property_id, lead_score, animaux, garant, nb_personnes")
    .eq("user_id", userId)
    .eq("email", prospectEmail)
    .maybeSingle();

  if (existing) {
    // ── 2. Mise à jour non-destructive (ne jamais écraser avec null) ──────
    const update: Record<string, unknown> = {};

    // Scalaires : on n'écrase que si la valeur existante est null/undefined
    const nullableFields: (keyof typeof fields)[] = [
      "nom", "prenom", "telephone", "situation_pro",
      "revenus_mensuels", "garant_revenus", "nb_personnes",
      "animaux", "garant", "visite_date", "visite_status",
    ];
    for (const k of nullableFields) {
      const newVal = fields[k];
      const existingVal = (existing as Record<string, unknown>)[k];
      const existingIsEmpty = existingVal === null || existingVal === undefined;
      const newHasValue = newVal !== null && newVal !== undefined;
      if (existingIsEmpty && newHasValue) {
        update[k] = newVal;
      }
    }

    // etape_process : avancement seulement
    const advancedEtape = advanceEtape(existing.etape_process, fields.etape_process ?? null);
    if (advancedEtape !== existing.etape_process) {
      update.etape_process = advancedEtape;
    }

    // property_id : ne mettre à jour que si non défini
    if (!existing.property_id && fields.property_id) {
      update.property_id = fields.property_id;
    }

    // lead_score : prendre le max
    if (typeof fields.lead_score === "number" && fields.lead_score > (existing.lead_score ?? 0)) {
      update.lead_score = fields.lead_score;
    }

    // dossier_complet : si devient true, ne jamais repasser à false
    if (fields.dossier_complet === true) {
      update.dossier_complet = true;
      update.dossier_validated_at = new Date().toISOString();
    }

    if (Object.keys(update).length > 0) {
      await supabaseAdmin
        .from("prospects")
        .update(update)
        .eq("id", existing.id);
    }

    // ── 4. Lier l'email au prospect ───────────────────────────────────────
    await supabaseAdmin
      .from("emails")
      .update({ prospect_id: existing.id })
      .eq("id", emailId);

    return existing.id;
  }

  // ── 3. Insertion d'un nouveau prospect ───────────────────────────────────
  const insert: Record<string, unknown> = {
    user_id: userId,
    email: prospectEmail,
    etape_process: isValidEtape(fields.etape_process ?? null) ? fields.etape_process : "NEW",
  };

  // Ajouter tous les champs non-null
  const allFields: (keyof typeof fields)[] = [
    "nom", "prenom", "telephone", "situation_pro",
    "revenus_mensuels", "garant_revenus", "nb_personnes",
    "animaux", "garant", "property_id", "lead_score",
    "visite_date", "visite_status", "dossier_complet",
  ];
  for (const k of allFields) {
    const v = fields[k];
    if (v !== null && v !== undefined) {
      insert[k] = v;
    }
  }

  const { data: inserted, error } = await supabaseAdmin
    .from("prospects")
    .insert(insert)
    .select("id")
    .single();

  if (error || !inserted) {
    // En cas de race condition UNIQUE : re-fetch
    if (error?.code === "23505") {
      const { data: reFetched } = await supabaseAdmin
        .from("prospects")
        .select("id")
        .eq("user_id", userId)
        .eq("email", prospectEmail)
        .maybeSingle();
      if (reFetched) {
        await supabaseAdmin.from("emails").update({ prospect_id: reFetched.id }).eq("id", emailId);
        return reFetched.id;
      }
    }
    throw new Error(`upsertProspect INSERT failed: ${error?.message ?? "unknown"}`);
  }

  // ── 4. Lier l'email au prospect ─────────────────────────────────────────
  await supabaseAdmin
    .from("emails")
    .update({ prospect_id: inserted.id })
    .eq("id", emailId);

  return inserted.id;
}
