/**
 * POST /api/ai/analyze-tick
 * Traite un batch de 5 emails en processing (emails_cache).
 * Body: { job_id }
 * Retourne: { ok: true, processed: N, remaining: X }
 */

import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const BATCH_SIZE = 5;

const SYSTEM_PROMPT = `Tu es un assistant immobilier. Analyse cet email et retourne UNIQUEMENT ce JSON sans commentaire :
{
  "intent": "LOCATION_REQUEST|FAQ_QUESTION|ADMIN|IGNORED",
  "confidence": 0.0-1.0,
  "prospect_name": null,
  "prospect_phone": null,
  "property_address": null,
  "monthly_income": null,
  "employment_status": null,
  "lead_score": 1-10,
  "missing_info": []
}
LOCATION_REQUEST = demande explicite de visite
FAQ_QUESTION = question sur un bien/agence
ADMIN = newsletter/promo/confirmation commande/spam
IGNORED = hors sujet total`;

export async function POST(req: Request) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const jobId = body?.job_id;
    if (!jobId) {
      return NextResponse.json({ error: "MISSING_JOB_ID" }, { status: 400 });
    }

    const { data: job, error: jobErr } = await supabaseAdmin
      .from("analyze_jobs")
      .select("id, user_id, status, total, remaining, processed")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (jobErr) {
      return NextResponse.json({ error: "JOB_FETCH_FAILED" }, { status: 500 });
    }
    if (!job) {
      return NextResponse.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
    }

    const jobRow = job as { remaining: number; processed: number };
    const remainingBefore = jobRow.remaining ?? 0;
    if (remainingBefore <= 0) {
      return NextResponse.json({
        ok: true,
        processed: 0,
        remaining: 0,
      });
    }

    const { data: batch, error: listErr } = await supabaseAdmin
      .from("emails_cache")
      .select("id, subject, from_name, from_email, snippet, gmail_message_id, outlook_message_id")
      .eq("user_id", user.id)
      .eq("processing", true)
      .order("received_at", { ascending: false })
      .limit(BATCH_SIZE);

    if (listErr) {
      return NextResponse.json({ error: "BATCH_FETCH_FAILED" }, { status: 500 });
    }
    if (!batch?.length) {
      // recalcul réel : combien d'emails sont encore en processing pour ce user
      const { count: processingCount } = await supabaseAdmin
        .from("emails_cache")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("processing", true);

      const realRemaining = Math.max(0, Number(processingCount || 0));

      await supabaseAdmin
        .from("analyze_jobs")
        .update({
          remaining: realRemaining,
          ...(realRemaining <= 0 ? { status: "completed", completed_at: new Date().toISOString() } : {}),
        })
        .eq("id", jobId)
        .eq("user_id", user.id);

      return NextResponse.json({
        ok: true,
        processed: 0,
        remaining: realRemaining,
      });
    }

    const OpenAI = (await import("openai")).default;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_NOT_CONFIGURED" }, { status: 500 });
    }
    const openai = new OpenAI({ apiKey });

    const nowIso = new Date().toISOString();
    let processed = 0;

    for (const email of batch) {
      const e = email as {
        id: string;
        subject: string | null;
        from_name: string | null;
        from_email: string | null;
        snippet: string | null;
        gmail_message_id: string | null;
        outlook_message_id: string | null;
      };
      const userContent = `Sujet: ${e.subject ?? ""}\nDe: ${e.from_name ?? ""}\nContenu: ${(e.snippet ?? "").slice(0, 2000)}`;

      let parsed: {
        intent?: string;
        confidence?: number;
        prospect_name?: string | null;
        prospect_phone?: string | null;
        property_address?: string | null;
        monthly_income?: number | null;
        employment_status?: string | null;
        lead_score?: number;
        missing_info?: string[];
      };
      try {
        const completion = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          temperature: 0,
        });
        const raw = (completion.choices[0]?.message?.content ?? "").trim();
        parsed = JSON.parse(raw) as typeof parsed;
      } catch (err) {
        await supabaseAdmin
          .from("emails_cache")
          .update({
            intent: "IGNORED",
            lead_score: 1,
            lead_status: "ignored",
            lead_json: { error: "AI_FAILED" },
            analyzed_at: nowIso,
            processing: false,
          })
          .eq("id", e.id)
          .eq("user_id", user.id);

        // Propager aussi vers emails en cas d'échec OpenAI
        const gmailId = e.gmail_message_id;
        const outlookId = e.outlook_message_id;
        const updatePayload: any = {
          lead_status: "ignored",
          lead_score: 1,
          lead_json: { error: "AI_FAILED" },
          analyzed_at: nowIso,
        };
        try {
          if (gmailId) {
            await supabaseAdmin
              .from("emails")
              .update(updatePayload)
              .eq("user_id", user.id)
              .eq("gmail_message_id", gmailId);
          } else if (outlookId) {
            await supabaseAdmin
              .from("emails")
              .update(updatePayload)
              .eq("user_id", user.id)
              .eq("provider", "microsoft")
              .eq("provider_message_id", outlookId);
          }
        } catch (e2: any) {
          console.warn("[ANALYZE_TICK] propagate AI_FAILED to emails error", {
            user_id: user.id,
            gmailId,
            outlookId,
            error: e2?.message ?? String(e2),
          });
        }

        processed += 1;
        continue;
      }

      const intent = (parsed?.intent ?? "IGNORED").toUpperCase().replace(/-/g, "_");
      const validIntent = ["LOCATION_REQUEST", "FAQ_QUESTION", "ADMIN", "IGNORED"].includes(intent)
        ? intent
        : "IGNORED";
      const lead_score = Math.min(10, Math.max(1, Number(parsed?.lead_score) || 5));
      const lead_status = validIntent === "LOCATION_REQUEST" ? "new" : "ignored";
      const lead_json = {
        intent: validIntent,
        confidence: parsed?.confidence ?? 0,
        prospect_name: parsed?.prospect_name ?? null,
        prospect_phone: parsed?.prospect_phone ?? null,
        property_address: parsed?.property_address ?? null,
        monthly_income: parsed?.monthly_income ?? null,
        employment_status: parsed?.employment_status ?? null,
        lead_score,
        missing_info: Array.isArray(parsed?.missing_info) ? parsed.missing_info : [],
      };

      const { error: updateErr } = await supabaseAdmin
        .from("emails_cache")
        .update({
          intent: validIntent,
          lead_score,
          lead_json,
          lead_status,
          analyzed_at: nowIso,
          processing: false,
        })
        .eq("id", e.id)
        .eq("user_id", user.id);

      if (updateErr) {
        await supabaseAdmin
          .from("emails_cache")
          .update({ processing: false, analyzed_at: nowIso })
          .eq("id", e.id)
          .eq("user_id", user.id);

        processed += 1;
        continue;
      }

      // Propager immédiatement les champs analysés vers la table principale emails
      const gmailId = e.gmail_message_id;
      const outlookId = e.outlook_message_id;
      if (gmailId || outlookId) {
        const updatePayload: any = {
          lead_status,
          lead_score,
          lead_json,
          analyzed_at: nowIso,
        };
        try {
          if (gmailId) {
            await supabaseAdmin
              .from("emails")
              .update(updatePayload)
              .eq("user_id", user.id)
              .eq("gmail_message_id", gmailId);
          } else if (outlookId) {
            await supabaseAdmin
              .from("emails")
              .update(updatePayload)
              .eq("user_id", user.id)
              .eq("provider", "microsoft")
              .eq("provider_message_id", outlookId);
          }
        } catch (e2: any) {
          console.warn("[ANALYZE_TICK] propagate analyze result to emails error", {
            user_id: user.id,
            gmailId,
            outlookId,
            error: e2?.message ?? String(e2),
          });
        }
      }

      processed += 1;
    }

    const newProcessed = (jobRow.processed ?? 0) + processed;
    const newRemaining = Math.max(0, (jobRow.remaining ?? 0) - processed);

    await supabaseAdmin
      .from("analyze_jobs")
      .update({
        remaining: newRemaining,
        processed: newProcessed,
        ...(newRemaining <= 0 ? { status: "completed", completed_at: nowIso } : {}),
      })
      .eq("id", jobId)
      .eq("user_id", user.id);

    return NextResponse.json({
      ok: true,
      processed,
      remaining: newRemaining,
    });
  } catch (e) {
    console.error("ANALYZE_TICK_FATAL", e);
    return NextResponse.json({ error: "ANALYZE_TICK_FATAL" }, { status: 500 });
  }
}
