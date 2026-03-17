import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DEFAULT_SETTINGS = {
  assistant_enabled: true,
  automation_level: "draft" as "draft" | "autopilot",
  config: {
    ui: {
      theme: "dark" as "dark" | "light",
      density: "comfortable" as "comfortable" | "compact",
    },
    rental_rules: {
      income_multiplier: 3,
      accepted_employment_status: ["CDI", "CDD", "Indépendant", "Étudiant", "Retraite", "Autre"],
      required_documents: ["Pièce d'identité", "3 bulletins de salaire", "Avis d'imposition"],
      allow_guarantor: true,
      guarantor_required_for_status: [] as string[],
    },
    faq_items: [] as Array<{ id: string; question: string; answer: string; updated_at?: string }>,
    scheduling_rules: {
      timezone: "Europe/Paris",
      workdays: [1, 2, 3, 4, 5],
      hours: { start: "09:00", end: "18:00" },
      slot_duration_min: 30,
      days_ahead: 7,
      min_notice_hours: 24,
      travel_buffer_min: 30,
      proposal_count: 3,
      spread_mode: "multi_day" as "multi_day" | "same_day_ok",
      exclude_lunch: true,
      constraints_text: "",
    },
    properties: [],
    agent_persona: {
      agent_name: "Julie de l’Immobilier",
      tone: "friendly",
      signature: "Cordialement,\nService visites",
    },
    snippets: {
      property_info_default: "Nous vous recontacterons avec les informations détaillées sur ce bien.",
      admin_default: "Votre demande a bien été reçue. L'équipe vous répondra sous 48h.",
      application_status_default: "Votre dossier est en cours d'instruction. Nous vous tiendrons informé.",
      out_of_scope_default: "Votre message ne relève pas de notre compétence directe. Merci de contacter le service concerné.",
      missing_docs: "Merci de nous transmettre les documents suivants pour compléter votre dossier : [liste]. À renvoyer à cette adresse.",
      ineligible_guarantor_option: "Malheureusement votre situation ne permet pas de retenir ce bien au regard de nos critères (loyer × 3). Vous pouvez présenter un garant solide ou nous contacter pour un bien à loyer plus adapté.",
      followup_reminder: "Nous n'avons pas eu de retour de votre part. Souhaitez-vous toujours organiser une visite ? Répondez à ce mail pour confirmer.",
    },
    intent_policies: {
      booking_request: { autopilot_allowed: true, required_fields: ["phone", "income", "documents"] },
      property_question: { autopilot_allowed: true, required_fields: [] },
      documents_status: { autopilot_allowed: true, required_fields: [] },
      application_status: { autopilot_allowed: false, required_fields: [] },
      reschedule: { autopilot_allowed: true },
      cancel: { autopilot_allowed: true },
      admin_question: { autopilot_allowed: false, required_fields: [] },
      out_of_scope: { autopilot_allowed: false },
    },
    address_policy: "after_booking" as "after_qualification" | "after_booking" | "always",
    followup_policy: { enabled: true, d1: true, d3: true },
    autopilot_guardrails: {
      require_calendar_connected: true,
      quiet_hours: { start: "20:00", end: "08:00", timezone: "Europe/Paris" },
      max_autopilot_emails_per_hour: 30,
      require_property_match_for_location: true,
      require_faq_match_for_information: false,
    },
  },
};

export function deepMerge(base: any, patch: any) {
  if (!patch || typeof patch !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(patch)) {
    const bv = (base as any)?.[k];
    const pv = (patch as any)?.[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && bv && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, pv);
    } else {
      out[k] = pv;
    }
  }
  return out;
}

export async function GET() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const { data: row, error } = await supabaseAdmin
    .from("settings_v1")
    .select("user_id, assistant_enabled, automation_level, config")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "SETTINGS_FETCH_FAILED" }, { status: 500 });

  const merged = deepMerge(DEFAULT_SETTINGS, {
    assistant_enabled: row?.assistant_enabled,
    automation_level: row?.automation_level,
    config: row?.config,
  });

  return NextResponse.json({ settings: merged });
}

/**
 * Normalise automation_level en acceptant plusieurs variantes
 * "draft", "Draft", "suggest" -> "draft"
 * "autopilot", "Autopilot", "Autopilote" -> "autopilot"
 * 
 * TEST MANUEL:
 * 1) Ouvrir /settings dans le navigateur
 * 2) Cliquer sur le radio "Draft" -> vérifier dans la console serveur (dev):
 *    - Pas d'erreur 400
 *    - Log: "[SETTINGS] automation_level: draft -> draft"
 *    - Réponse JSON avec success: true
 * 3) Cliquer sur le radio "Autopilot" -> vérifier:
 *    - Pas d'erreur 400
 *    - Log: "[SETTINGS] automation_level: autopilot -> autopilot"
 *    - Réponse JSON avec success: true
 * 4) Vérifier que les autres champs (config, assistant_enabled) ne sont pas écrasés
 */
function normalizeAutomationLevel(value: any): "draft" | "autopilot" | null {
  if (typeof value !== "string") return null;
  const normalized = value.toLowerCase().trim();
  if (normalized === "draft" || normalized === "suggest") return "draft";
  if (normalized === "autopilot" || normalized === "autopilote") return "autopilot";
  return null;
}

export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "NO_USER" }, { status: 401 });

  const body = await req.json().catch(() => null);

  if (process.env.NODE_ENV === "development") {
    console.log("[SETTINGS] POST payload received:", JSON.stringify(body, null, 2));
  }

  // On accepte patch partiel: { assistant_enabled?, automation_level?, config? }
  const patch: any = { updated_at: new Date().toISOString() };

  // Validation assistant_enabled
  if (typeof body?.assistant_enabled === "boolean") {
    patch.assistant_enabled = body.assistant_enabled;
    if (process.env.NODE_ENV === "development") {
      console.log("[SETTINGS] assistant_enabled:", body.assistant_enabled);
    }
  }

  // Validation et normalisation automation_level (strict: "draft" ou "autopilot" uniquement)
  if (body?.automation_level !== undefined && body?.automation_level !== null) {
    const normalized = normalizeAutomationLevel(body.automation_level);
    if (normalized === "draft" || normalized === "autopilot") {
      patch.automation_level = normalized;
      if (process.env.NODE_ENV === "development") {
        console.log("[SETTINGS] automation_level:", body.automation_level, "->", normalized);
      }
    } else {
      return NextResponse.json(
        {
          error: "invalid automation_level",
          details: `Valeur invalide: "${body.automation_level}". Valeurs acceptées: "draft" ou "autopilot"`,
        },
        { status: 400 }
      );
    }
  }

  // Validation config (merge profond)
  if (body?.config && typeof body.config === "object") {
    // on fusionne proprement avec l'existant
    const { data: row } = await supabaseAdmin
      .from("settings_v1")
      .select("config")
      .eq("user_id", data.user.id)
      .maybeSingle();

    const current = row?.config ?? DEFAULT_SETTINGS.config;
    patch.config = deepMerge(current, body.config);
    if (process.env.NODE_ENV === "development") {
      console.log("[SETTINGS] config merged");
    }
  }

  // Validation: au moins un champ à mettre à jour (en plus de updated_at)
  if (Object.keys(patch).length <= 1) {
    return NextResponse.json(
      {
        error: "MISSING_FIELDS",
        details: "Au moins un champ doit être fourni: assistant_enabled, automation_level, ou config",
      },
      { status: 400 }
    );
  }

  // Sauvegarde en base
  const { error, data: updatedRow } = await supabaseAdmin
    .from("settings_v1")
    .upsert({ user_id: data.user.id, ...patch }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    console.error("[SETTINGS] UPDATE_FAILED", error);
    return NextResponse.json({ error: "SETTINGS_UPDATE_FAILED", details: error.message }, { status: 500 });
  }

  // Retourner les settings persistés
  const merged = deepMerge(DEFAULT_SETTINGS, {
    assistant_enabled: updatedRow?.assistant_enabled,
    automation_level: updatedRow?.automation_level,
    config: updatedRow?.config,
  });

  return NextResponse.json({ success: true, settings: merged });
}
