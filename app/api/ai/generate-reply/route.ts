import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";
import OpenAI from "openai";
import { getAvailabilitySlots } from "@/lib/calendar/availability";
import { matchFaq, type FaqItem } from "@/lib/faq/matchFaq";
import { setLastAction } from "@/lib/lead/lastAction";

export const runtime = "nodejs";
export const maxDuration = 60;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

function safeJsonParse(raw: string): any | null {
  if (!raw) return null;
  const match = raw.match(/\{[\s\S]*\}$/) || raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const x = Number(n);
  if (Number.isNaN(x)) return fallback;
  return Math.min(Math.max(Math.floor(x), min), max);
}

function normalizeTone(t: any) {
  const s = String(t || "").toLowerCase();
  if (s.includes("formel")) return "Très formel";
  if (s.includes("amical")) return "Amical";
  return "Professionnel";
}

function normalizeEmployment(t: any) {
  const s = String(t || "").toLowerCase();
  if (s.includes("cdi")) return "CDI";
  if (s.includes("cdd")) return "CDD";
  if (s.includes("ind")) return "Indé";
  if (s.includes("interim")) return "Interim";
  if (s.includes("étu") || s.includes("etu")) return "Étudiant";
  return "Inconnu";
}

async function getProviders(userId: string) {
  const [g, m] = await Promise.all([
    supabaseAdmin
      .from("gmail_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("microsoft_tokens")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  return {
    google: !!g?.data?.user_id,
    microsoft: !!m?.data?.user_id,
  };
}

export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      console.log("GEN_REPLY_START", { requestId, emailId: undefined, userId: null, error: "UNAUTHORIZED" });
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const emailId = body?.emailId as string | undefined;
    const force = !!body?.force;

    console.log("GEN_REPLY_START", { requestId, emailId: emailId ?? null, userId: user.id });

    if (!emailId || String(emailId).trim() === "") {
      return NextResponse.json({ ok: false, error: "MISSING_EMAIL_ID" }, { status: 400 });
    }

    // 3) Charger email
    const { data: email, error: emailErr } = await supabaseAdmin
      .from("emails")
      .select(
        "id, user_id, sender, subject, body, ai_reply, lead_json, lead_status, lead_score, estimated_time"
      )
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    if (emailErr || !email) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    const EMAIL_SELECT =
      "id, provider, provider_message_id, open_url, gmail_message_id, gmail_thread_id, sender, subject, body, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply, lead_score, lead_status, lead_json, property_id, candidate_name, monthly_income, employment_type, guarantor_present, income_ratio, lead_profile, lead_property_address, lead_missing_fields, lead_is_qualified, lead_last_action, lead_last_action_at";

    // anti-coût: si déjà généré et pas force — on persiste draft_reply et on renvoie l'email
    if (!force && email.ai_reply && String(email.ai_reply).trim().length > 0) {
      const reply = String(email.ai_reply).trim();
      const subject = (email.subject || "Votre demande").trim().slice(0, 80);
      const nowIso = new Date().toISOString();
      const prev = (email.lead_json as any) ?? {};
      const nextLeadJson = {
        ...prev,
        draft_reply: { text: reply, subject: `Re: ${subject}`, created_at: nowIso },
        last_outbound: { type: "draft_reply", at: nowIso },
      };
      await supabaseAdmin
        .from("emails")
        .update({ lead_json: nextLeadJson })
        .eq("id", email.id);

      const { data: updatedRow } = await supabaseAdmin
        .from("emails")
        .select(EMAIL_SELECT)
        .eq("id", email.id)
        .eq("user_id", user.id)
        .single();

      return NextResponse.json({ ok: true, reply, email: updatedRow ?? email });
    }

    const content = (email.body || "").trim();
    if (!content || content.length < 20) {
      return NextResponse.json(
        { ok: false, error: "EMAIL_BODY_MISSING", details: "Corps email vide ou trop court" },
        { status: 400 }
      );
    }

    const leadJson = (email.lead_json as any) ?? {};
    const intent = leadJson?.intent as string | undefined;

    // Intent INFORMATION : réponse basée FAQ uniquement (pas d’hallucination). Si pas de match => demande précision.
    if (intent === "INFORMATION") {
      const { data: settingsRow } = await supabaseAdmin
        .from("settings_v1")
        .select("config")
        .eq("user_id", user.id)
        .maybeSingle();
      const configAny = (settingsRow as any)?.config ?? {};
      const faqItemsRaw = (configAny?.faq_items ?? []) as Array<{ id?: string; question?: string; answer?: string }>;
      const faqItems: FaqItem[] = faqItemsRaw.map((item) => ({
        id: item.id ?? String(Math.random()),
        question: item.question ?? "",
        answer: item.answer ?? "",
      }));
      const questionText = `${(email.subject ?? "").trim()} ${content}`.trim();
      const { match } = matchFaq(faqItems, questionText);
      const aiName = "Julie";
      const signature = `\n\n${aiName}`;
      const reply = match
        ? (match.item.answer + signature).trim()
        : "Je n'ai pas trouvé la règle correspondante dans nos paramètres. Pouvez-vous préciser votre question ? Vous pouvez aussi nous appeler pour une réponse immédiate.";
      const subject = (email.subject || "Votre demande").trim().slice(0, 80);
      const nowIso = new Date().toISOString();
      const nextLeadJson = {
        ...leadJson,
        draft_reply: { text: reply, subject: `Re: ${subject}`, created_at: nowIso },
        last_outbound: { type: "draft_info_reply", at: nowIso },
        info_question: (email.subject ?? "").slice(0, 150),
        info_source: match ? "FAQ" : "MISSING_FAQ",
        ...(match ? { faq_item_id: match.item.id } : {}),
        last_action: setLastAction(leadJson, { type: match ? "draft_info_reply" : "info_missing_faq", label: match ? "Brouillon réponse FAQ" : "Demande de précision (FAQ manquante)" }, nowIso),
      };
      await supabaseAdmin
        .from("emails")
        .update({
          ai_reply: reply,
          lead_json: nextLeadJson,
          lead_last_action: nextLeadJson.last_action?.label ?? "Brouillon réponse FAQ",
          lead_last_action_at: nowIso,
        })
        .eq("id", email.id)
        .eq("user_id", user.id);

      const { data: updatedRow } = await supabaseAdmin
        .from("emails")
        .select(EMAIL_SELECT)
        .eq("id", email.id)
        .eq("user_id", user.id)
        .single();

      return NextResponse.json({ ok: true, reply, email: updatedRow ?? email });
    }

    // 4) Charger business_rules
    const { data: settings } = await supabaseAdmin
      .from("settings_v1")
      .select("business_rules")
      .eq("user_id", user.id)
      .maybeSingle();

    const rules = (settings?.business_rules ?? {}) as any;

    const aiName = String(rules?.aiName || "Julie");
    const aiTone = normalizeTone(rules?.aiTone || "Professionnel");
    const rentMultiplier = Number(rules?.rentMultiplier ?? 3);
    const requiredDocs = Array.isArray(rules?.requiredDocs)
      ? rules.requiredDocs
      : ["Pièce d’identité", "3 bulletins de salaire", "Avis d’imposition"];

    // 5) Charger properties (catalogue)
    const { data: properties } = await supabaseAdmin
      .from("properties")
      .select("id, name, rent, address, city")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    const propertiesContext = (properties ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      rent: p.rent,
      address: p.address,
      city: p.city,
    }));

    // 6) Slots dispo (Google + Outlook si connectés)
    const providers = await getProviders(user.id);
    const hasAnyProvider = providers.google || providers.microsoft;

    const durationMin = clampInt(email.estimated_time ?? 30, 15, 120, 30);

    const slots = hasAnyProvider
      ? await getAvailabilitySlots({
          userId: user.id,
          daysAhead: 5,
          durationMin,
          maxSlots: 3,
          useGoogle: providers.google,
          useMicrosoft: providers.microsoft,
          timezone: "Europe/Paris",
          workDayStartHour: 9,
          workDayEndHour: 18,
        })
      : [];

    // 7) Prompt IMMO JSON strict
    const prompt = `
Tu es ${aiName}, l'Expert en Conversion Locative pour une agence immobilière.
Objectif : filtrer les dossiers non éligibles et verrouiller des RDV pour les profils premium.

### 🏠 CONTEXTE DES BIENS DISPONIBLES :
${JSON.stringify(propertiesContext)}

### ⚙️ RÈGLES DE QUALIFICATION (STRICTES) :
1. SEUIL FINANCIER : revenus NETS mensuels >= (${rentMultiplier} x loyer).
   - Si le prospect donne un salaire ANNUEL, divise-le par 12.
   - Si le prospect parle de revenus du foyer / conjoint, additionne les montants quand c’est explicite.
2. DOCUMENTS : doit mentionner ou être prêt à fournir : ${requiredDocs.join(", ")}.
3. PRIORITÉ : CDI avec ratio >= ${rentMultiplier} => lead_score élevé.

### 🧠 LOGIQUE DE RÉPONSE (TON : ${aiTone}) :
- CAS A (infos manquantes) : ne propose JAMAIS de visite. Demande précisément ce qu'il manque (revenus, statut pro, garant, documents).
- CAS B (inéligible) : refuse avec diplomatie. Suggère garant ou bien moins cher.
- CAS C (éligible) : propose 3 créneaux de visite basés sur les disponibilités fournies.
- RÈGLE D'OR : ne jamais divulguer l'adresse exacte (numéro de rue) avant confirmation d'un créneau précis.

### 🕒 SLOTS DE VISITE DISPONIBLES (RÉELS) :
${JSON.stringify(slots)}

### 📋 SORTIE JSON OBLIGATOIRE :
Retourne UNIQUEMENT un JSON valide :
{
  "is_rental_intent": boolean,
  "property_id": "uuid|null",
  "analysis": {
    "prospect_name": "string",
    "detected_income": number|null,
    "income_ratio": "number|null",
    "employment_type": "CDI|CDD|Indé|Interim|Étudiant|Inconnu",
    "guarantor_present": boolean,
    "urgency_level": "low|medium|high"
  },
  "lead_score": number,
  "lead_status": "new_lead|qualifying|ready_for_visite|rejected|other",
  "missing_elements": ["..."],
  "next_action_logic": "string",
  "email_reply": "string"
}

### 📨 EMAIL À TRAITER :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${content}
`;

    // 8) OpenAI (temp = 0 pour stabilité)
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || "";
    const result = safeJsonParse(raw);

    // 9) fallback safe si JSON foire (ne casse pas ton flow)
    if (!result || !result.email_reply) {
      const fallbackPrompt = `
Rédige une réponse email professionnelle, courte, claire et humaine.
Ton : ${aiTone}. Pas de blabla inutile.
Email reçu :
Expéditeur : ${email.sender}
Sujet : ${email.subject}
Contenu :
${content}

Réponse :
`;
      const fb = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: fallbackPrompt }],
        temperature: 0.4,
      });
      const reply = fb.choices[0]?.message?.content?.trim() || null;

      if (!reply) {
        return NextResponse.json({ ok: false, error: "AI_NO_REPLY" }, { status: 500 });
      }

      const subject = (email.subject || "Votre demande").trim().slice(0, 80);
      const fallbackNow = new Date().toISOString();
      await supabaseAdmin
        .from("emails")
        .update({
          ai_reply: reply,
          lead_status: "other",
          lead_score: null,
          lead_json: {
            draft_reply: { text: reply, subject: `Re: ${subject}`, created_at: fallbackNow },
            last_outbound: { type: "draft_reply", at: fallbackNow },
            classification_reason: "IMMO_FALLBACK_NO_JSON",
          },
          classification_reason: "IMMO_FALLBACK_NO_JSON",
        })
        .eq("id", email.id);

      const { data: updatedRow } = await supabaseAdmin
        .from("emails")
        .select(EMAIL_SELECT)
        .eq("id", email.id)
        .eq("user_id", user.id)
        .single();

      return NextResponse.json({ ok: true, reply, email: updatedRow ?? email });
    }

    // 10) Normalisations + persist DB
    const leadScore = clampInt(result.lead_score, 1, 10, 5);
    const leadStatus = String(result.lead_status || "qualifying");
    const propertyId =
      result.property_id && String(result.property_id).length > 10
        ? String(result.property_id)
        : null;

    const analysis = result.analysis || {};
    const candidateName = String(analysis.prospect_name || "").slice(0, 120) || null;
    const detectedIncome =
      analysis.detected_income !== null && analysis.detected_income !== undefined
        ? clampInt(analysis.detected_income, 0, 1_000_000, 0)
        : null;

    const employmentType = normalizeEmployment(analysis.employment_type);
    const guarantorPresent = !!analysis.guarantor_present;

    const incomeRatio =
      analysis.income_ratio !== null && analysis.income_ratio !== undefined
        ? Number(analysis.income_ratio)
        : null;

    const reply = String(result.email_reply).trim();
    const subject = (email.subject || "Votre demande").trim().slice(0, 80);
    const nowIso = new Date().toISOString();
    const leadJsonWithDraft = {
      ...result,
      draft_reply: {
        text: reply,
        subject: `Re: ${subject}`,
        created_at: nowIso,
      },
      last_outbound: { type: "draft_reply", at: nowIso },
    };

    await supabaseAdmin
      .from("emails")
      .update({
        ai_reply: reply,
        lead_score: leadScore,
        lead_status: leadStatus,
        lead_json: leadJsonWithDraft,
        property_id: propertyId,
        candidate_name: candidateName,
        monthly_income: detectedIncome,
        employment_type: employmentType,
        guarantor_present: guarantorPresent,
        income_ratio: incomeRatio,
        classification_reason: "IMMO_JSON_V1",
      })
      .eq("id", email.id);

    const { data: updatedRow } = await supabaseAdmin
      .from("emails")
      .select(EMAIL_SELECT)
      .eq("id", email.id)
      .eq("user_id", user.id)
      .single();

    console.log("GEN_REPLY_END", { requestId, updated: true, duration_ms: Date.now() - startMs });
    return NextResponse.json({
      ok: true,
      reply,
      email: updatedRow ?? email,
      lead: {
        lead_score: leadScore,
        lead_status: leadStatus,
        property_id: propertyId,
      },
    });
  } catch (err: any) {
    console.error("GEN_REPLY_ERROR", { requestId, duration_ms: Date.now() - startMs, error: err?.message ?? err, stack: err?.stack });
    return NextResponse.json(
      { ok: false, error: "GENERATE_REPLY_FAILED", message: err?.message ?? null },
      { status: 500 }
    );
  }
}
