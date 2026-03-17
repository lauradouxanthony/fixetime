import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logActivity } from "@/lib/activity/logActivity";
import { fetchWithTimeout } from "@/lib/http/fetchWithTimeout";
import { getAvailabilitySlots } from "@/lib/calendar/availability";

export const runtime = "nodejs";

const AVAILABILITY_TIMEOUT_MS = 8000;

const EMAIL_SELECT =
  "id, provider, provider_message_id, open_url, gmail_message_id, gmail_thread_id, sender, subject, body, summary, received_at, estimated_time, ai_reply, lead_score, lead_status, lead_json, property_id, candidate_name, monthly_income, employment_type, guarantor_present, income_ratio, lead_profile, lead_property_address, lead_missing_fields, lead_is_qualified, lead_last_action, lead_last_action_at";

function getLocalParts(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  // weekday: "lun.", "mar." ...
  const wd = (map.weekday || "").toLowerCase();
  const hour = Number(map.hour ?? "0");
  const minute = Number(map.minute ?? "0");
  return { wd, hour, minute };
}

function withinWindow(
  d: Date,
  tz: string,
  allowedWeekdays: string[],
  startHour: number,
  endHour: number,
  excludeRanges?: Array<{ start: number; end: number }>
) {
  const { wd, hour, minute } = getLocalParts(d, tz);

  // weekdays attendus : ["lun", "mar", "mer", "jeu", "ven"]
  const wd3 = wd.slice(0, 3); // "lun", "mar"...
  if (!allowedWeekdays.includes(wd3)) return false;

  const t = hour + minute / 60;
  if (t < startHour || t >= endHour) return false;

  if (excludeRanges?.length) {
    for (const r of excludeRanges) {
      if (t >= r.start && t < r.end) return false;
    }
  }

  return true;
}

export async function POST(req: Request) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startMs = Date.now();
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    console.log("GEN_SLOTS_AUTH", {
      ts: new Date().toISOString(),
      requestId,
      hasUser: !!user,
      userId: user?.id ?? null,
    });

    if (!user) {
      return NextResponse.json({ ok: false, error: "NO_USER" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const emailId = (body?.emailId ?? body?.lead_id) as string | undefined;
    const bodyDurationMin = body?.duration_min != null ? Number(body.duration_min) : undefined;

    if (!emailId) {
      return NextResponse.json({ ok: false, error: "MISSING_EMAIL_ID" }, { status: 400 });
    }

    console.log("GEN_SLOTS_START", {
      ts: new Date().toISOString(),
      requestId,
      userId: user.id,
      emailId,
    });

    // 1) Charger l'email d'abord
    const { data: emailRow, error: emailError } = await supabaseAdmin
      .from("emails")
      .select(EMAIL_SELECT)
      .eq("id", emailId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (emailError || !emailRow) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_FOUND" }, { status: 404 });
    }

    console.log("GEN_SLOTS_DB_EMAIL_OK", {
      ts: new Date().toISOString(),
      requestId,
      userId: user.id,
      emailId,
      duration_ms: Date.now() - startMs,
    });

    // 2) Détecter provider calendrier connecté
    const [gmailRes, msRes] = await Promise.all([
      supabaseAdmin.from("gmail_tokens").select("user_id").eq("user_id", user.id).maybeSingle(),
      supabaseAdmin.from("microsoft_tokens").select("user_id").eq("user_id", user.id).maybeSingle(),
    ]);
    const hasGoogle = !!gmailRes?.data;
    const hasMicrosoft = !!msRes?.data;
    const chosen = hasMicrosoft ? "microsoft" : hasGoogle ? "google" : "none";

    console.log("GEN_SLOTS_PROVIDER_DETECTED", {
      ts: new Date().toISOString(),
      requestId,
      hasMicrosoft,
      hasGoogle,
      chosen,
    });

    if (!hasGoogle && !hasMicrosoft) {
      return NextResponse.json(
        { ok: false, error: "NO_CALENDAR_CONNECTED", hint: "Connecte Google ou Outlook Calendar dans l'onboarding" },
        { status: 400 }
      );
    }

    const { data: settingsRow } = await supabaseAdmin
      .from("settings_v1")
      .select("config")
      .eq("user_id", user.id)
      .maybeSingle();

    const sr = (settingsRow as any)?.config?.scheduling_rules ?? {};
    const tz = sr?.timezone || "Europe/Paris";
    const workdays = Array.isArray(sr?.workdays) ? sr.workdays : [1, 2, 3, 4, 5];
    const hoursStart = sr?.hours?.start || "09:00";
    const hoursEnd = sr?.hours?.end || "18:00";
    const excludeLunch = sr?.exclude_lunch !== false;
    const defaultDuration = Math.min(120, Math.max(15, Number(sr?.slot_duration_min ?? 30)));
    const finalDurationMin =
      bodyDurationMin != null && Number.isFinite(bodyDurationMin) && bodyDurationMin >= 15 && bodyDurationMin <= 120
        ? Math.round(bodyDurationMin)
        : defaultDuration;
    const travelBufferMin = Math.min(180, Math.max(0, Number(sr?.travel_buffer_min ?? 30)));
    const proposalCount = Math.min(5, Math.max(1, Number(sr?.proposal_count ?? 3)));
    const daysAhead = Math.min(30, Math.max(1, Number(sr?.days_ahead ?? 7)));
    const spreadMode: "multi_day" | "same_day_ok" =
      sr?.spread_mode === "same_day_ok" ? "same_day_ok" : "multi_day";
    const minNoticeHours = Math.max(0, Number(sr?.min_notice_hours ?? 24));

    console.log("GEN_SLOTS_SETTINGS", {
      ts: new Date().toISOString(),
      requestId,
      timezone: tz,
      workdays,
      hours: { start: hoursStart, end: hoursEnd },
      slot_duration_min: finalDurationMin,
      defaultDuration,
      bodyDurationMin: bodyDurationMin ?? null,
      travel_buffer_min: travelBufferMin,
      proposal_count: proposalCount,
      days_ahead: daysAhead,
      spread_mode: spreadMode,
      exclude_lunch: excludeLunch,
    });

    // ---- SETTINGS (conversion depuis config.scheduling_rules) ----
    const numToWd: Record<number, string> = {
      1: "lun",
      2: "mar",
      3: "mer",
      4: "jeu",
      5: "ven",
      6: "sam",
      7: "dim",
    };

    const allowedWeekdays = workdays.map((n: number) => numToWd[n]).filter(Boolean);

    const parseHHMM = (s: string, fallback: number) => {
      const m = String(s || "").match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return fallback;
      const h = Number(m[1]);
      const min = Number(m[2]);
      if (!Number.isFinite(h) || !Number.isFinite(min)) return fallback;
      return h + min / 60;
    };

    const startHour = parseHHMM(hoursStart, 9);
    const endHour = parseHHMM(hoursEnd, 18);

    const excludeRanges = excludeLunch ? [{ start: 12, end: 14 }] : [];

    console.log("GEN_SLOTS_CALL_AVAILABILITY_START", {
      ts: new Date().toISOString(),
      requestId,
      provider: chosen,
      timeout_ms: AVAILABILITY_TIMEOUT_MS,
    });

    let rawSlots: { start: string; end: string }[] = [];
    const availCallStartedAt = Date.now();
    try {
      const useGoogle = chosen === "google";
      const useMicrosoft = chosen === "microsoft";
      rawSlots = await Promise.race([
        getAvailabilitySlots({
          userId: user.id,
          daysAhead,
          durationMin: finalDurationMin,
          maxSlots: Math.max(proposalCount * 6, proposalCount + 3),
          useGoogle,
          useMicrosoft,
          timezone: tz,
          workDayStartHour: startHour,
          workDayEndHour: endHour,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), AVAILABILITY_TIMEOUT_MS)
        ),
      ]);
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (message === "TIMEOUT") {
        console.error("GEN_SLOTS_ERROR", {
          ts: new Date().toISOString(),
          requestId,
          error: "FREEBUSY_TIMEOUT",
          details: "getAvailabilitySlots timeout",
          duration_ms: Date.now() - availCallStartedAt,
        });
        return NextResponse.json(
          { ok: false, error: "FREEBUSY_TIMEOUT" },
          { status: 500 }
        );
      }
      console.error("GEN_SLOTS_ERROR", {
        ts: new Date().toISOString(),
        requestId,
        error: "FREEBUSY_FAILED",
        details: message,
      });
      const e = new Error(`FREEBUSY_FAILED:${message}`) as Error & { code?: string };
      e.code = "FREEBUSY_FAILED";
      throw e;
    }

    console.log("GEN_SLOTS_CALL_AVAILABILITY_END", {
      ts: new Date().toISOString(),
      requestId,
      provider: chosen,
      duration_ms: Date.now() - availCallStartedAt,
      raw_slots_count: rawSlots.length,
    });

    const candidates = rawSlots
      .map((s: any) => s?.start as string)
      .filter((x: any) => typeof x === "string")
      .map((iso) => {
        const d = new Date(iso);
        const dayKey = new Intl.DateTimeFormat("fr-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
        const { hour, minute } = getLocalParts(d, tz);
        const hourFloat = hour + minute / 60;
        const bucket =
          hourFloat < 12 ? "morning" : hourFloat < 14 ? "midday" : "afternoon";
        return { iso, date: d, dayKey, bucket };
      })
      .filter((c) =>
        withinWindow(c.date, tz, allowedWeekdays, startHour, endHour, excludeRanges) &&
        c.date.getTime() >= Date.now() + minNoticeHours * 60 * 60 * 1000
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const minGapMs = Math.max(0, travelBufferMin) * 60_000;

    const selected: { iso: string; date: Date; dayKey: string; bucket: string }[] = [];

    const isCompatible = (cand: { date: Date }) =>
      selected.every(
        (s) => Math.abs(cand.date.getTime() - s.date.getTime()) >= minGapMs
      );

    if (spreadMode === "multi_day") {
      const usedDays = new Set<string>();
      const usedBuckets = new Set<string>();
      for (const cand of candidates) {
        if (selected.length >= proposalCount) break;
        if (usedDays.has(cand.dayKey)) continue;
        if (!isCompatible(cand)) continue;
        if (
          usedBuckets.has(cand.bucket) &&
          candidates.some((c) => c.bucket !== cand.bucket)
        ) {
          // Si d'autres buckets existent, on essaie de varier les horaires
          continue;
        }
        selected.push(cand);
        usedDays.add(cand.dayKey);
        usedBuckets.add(cand.bucket);
      }
    }

    const usedDays = new Set(selected.map((s) => s.dayKey));
    if (selected.length < proposalCount) {
      for (const cand of candidates) {
        if (selected.length >= proposalCount) break;
        if (selected.some((s) => s.iso === cand.iso)) continue;
        if (!isCompatible(cand)) continue;
        if (spreadMode === "multi_day" && usedDays.has(cand.dayKey)) continue;
        selected.push(cand);
        usedDays.add(cand.dayKey);
      }
    }

    const slots = selected.map((s) => s.iso);

    console.log("GEN_SLOTS_SELECTED", {
      ts: new Date().toISOString(),
      requestId,
      spread_mode: spreadMode,
      count: slots.length,
      slots: selected.map((s) => ({ dayKey: s.dayKey, bucket: s.bucket, iso: s.iso })),
    });

    if (slots.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "NO_SLOTS_AVAILABLE",
          hint: "Aucun créneau libre dans les 5 prochains jours selon tes règles (horaires / calendrier occupé)",
        },
        { status: 400 }
      );
    }

function formatSlotFR(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { timeZone: tz, weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const s1 = slots[0] ? formatSlotFR(slots[0]) : "—";
const s2 = slots[1] ? formatSlotFR(slots[1]) : "—";
const s3 = slots[2] ? formatSlotFR(slots[2]) : "—";
const slotsReplyText =
  slots.length >= 3
    ? `Bonjour,\n\nMerci pour votre message. Voici 3 créneaux disponibles pour la visite :\n\n1) ${s1}\n2) ${s2}\n3) ${s3}\n\nRépondez par 1, 2 ou 3 pour confirmer le créneau qui vous convient.\n\nCordialement.`
    : slots.length > 0
      ? `Créneaux disponibles :\n${slots.map((iso, i) => `${i + 1}) ${formatSlotFR(iso)}`).join("\n")}\n\nRépondez par le numéro pour confirmer.`
      : "";

    const prev = (emailRow as any).lead_json ?? {};
    const nowIso = new Date().toISOString();
    const draftProposal =
      slots.length > 0
        ? { text: slotsReplyText, subject: "Visite — choix du créneau", created_at: nowIso }
        : undefined;

    const nextLeadJson = {
      ...prev,
      slots_proposed: slots,
      // on utilise la durée réellement demandée / utilisée pour générer les créneaux
      slots_duration_min: Number(finalDurationMin),
      slots_timezone: tz,
      slots_rules: {
        workdays,
        hours: { start: hoursStart, end: hoursEnd },
        exclude_lunch: excludeLunch,
        constraints_text: sr?.constraints_text || "",
      },
      slots_generated_at: nowIso,
      last_action: { type: "slots_generated", at: nowIso, label: "Créneaux générés" },
      ...(draftProposal ? { draft_proposal: draftProposal } : {}),
    };

    await supabaseAdmin
      .from("emails")
      .update({
        lead_status: "slots_proposed",
        lead_json: nextLeadJson,
        ...(slotsReplyText ? { ai_reply: slotsReplyText } : {}),
        lead_last_action_source: "human",
        lead_last_action: "slots_generated",
        lead_last_action_at: nowIso,
      })
      .eq("id", emailId)
      .eq("user_id", user.id);

    await logActivity({
      userId: user.id,
      actor: "human",
      type: "slots_generated",
      title: "Créneaux générés (Free/Busy)",
      emailId,
      meta: { count: slots.length, duration_min: nextLeadJson.slots_duration_min, tz },
    });

    const { data: updatedRow } = await supabaseAdmin
      .from("emails")
      .select(EMAIL_SELECT)
      .eq("id", emailId)
      .eq("user_id", user.id)
      .single();

    const slotsPayload = slots.map((start) => ({ start, end: new Date(new Date(start).getTime() + nextLeadJson.slots_duration_min * 60_000).toISOString() }));

    console.log("GEN_SLOTS_END", {
      ts: new Date().toISOString(),
      requestId,
      duration_ms: Date.now() - startMs,
      count: slots.length,
    });
    return NextResponse.json({
      ok: true,
      email: updatedRow ?? emailRow,
      slots: slotsPayload,
      updated: true,
      duration_min: nextLeadJson.slots_duration_min,
      reply_text: slotsReplyText || undefined,
    });
  } catch (e: any) {
    const details = e?.message ?? e;
    console.error("GEN_SLOTS_ERROR", {
      ts: new Date().toISOString(),
      requestId,
      duration_ms: Date.now() - startMs,
      error: details,
      stack: e?.stack,
    });
    return NextResponse.json(
      {
        ok: false,
        error: e?.code === "FREEBUSY_TIMEOUT" ? "FREEBUSY_TIMEOUT" : "FREEBUSY_FAILED",
        details: (e?.message ?? "").replace(/^FREEBUSY_(FAILED|TIMEOUT):?/, "") || "Erreur disponibilités",
      },
      { status: 500 }
    );
  }
}
