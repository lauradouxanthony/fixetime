import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DEFAULT_SETTINGS, deepMerge } from "@/app/api/settings/route";
import { isInQuietHours } from "@/lib/autopilot/guardrails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Check = { name: string; ok: boolean; details?: unknown };

async function run(name: string, fn: () => Promise<{ ok: boolean; details?: unknown }>): Promise<Check> {
  try {
    const r = await fn();
    return { name, ok: r.ok, details: r.details };
  } catch (e: any) {
    return { name, ok: false, details: e?.message ?? String(e) };
  }
}

export async function GET(req: Request) {
  const startedAt = new Date().toISOString();
  const startMs = Date.now();

  try {
  const cronKey = req.headers.get("x-fixetime-cron-key") ?? req.headers.get("x-cron-key");
  const expected = process.env.FIXETIME_INTERNAL_CRON_KEY || process.env.CRON_SECRET || "dev123";
  if (cronKey !== expected) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", started_at: startedAt, duration_ms: Date.now() - startMs, checks: [] },
      { status: 401 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (() => {
      try {
        const u = new URL(req.url);
        return `${u.protocol}//${u.host}`;
      } catch {
        return "http://localhost:3000";
      }
    })();

  const checks: Check[] = await Promise.all([
    run("env_openai", async () => ({ ok: !!process.env.OPENAI_API_KEY, details: process.env.OPENAI_API_KEY ? "set" : "missing" })),
    run("env_cron_key", async () => ({
      ok: !!process.env.FIXETIME_INTERNAL_CRON_KEY || !!process.env.CRON_SECRET,
      details: process.env.FIXETIME_INTERNAL_CRON_KEY ? "FIXETIME set" : process.env.CRON_SECRET ? "CRON_SECRET set" : "missing",
    })),
    run("env_site_url", async () => ({
      ok: !!(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL),
      details: process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "missing (using request origin)",
    })),

    run("db_emails", async () => {
      const { error } = await supabaseAdmin.from("emails").select("id").limit(1);
      return { ok: !error, details: error?.message ?? "ok" };
    }),
    run("db_settings_v1", async () => {
      const { error } = await supabaseAdmin.from("settings_v1").select("user_id").limit(1);
      return { ok: !error, details: error?.message ?? "ok" };
    }),
    run("db_activity_log", async () => {
      const { error } = await supabaseAdmin.from("activity_log").select("id").limit(1);
      return { ok: !error, details: error?.message ?? "ok" };
    }),
    run("db_properties", async () => {
      const { error } = await supabaseAdmin.from("properties").select("id").limit(1);
      return { ok: !error, details: error?.message ?? "ok" };
    }),
    run("db_gmail_tokens", async () => {
      const { error } = await supabaseAdmin.from("gmail_tokens").select("user_id").limit(1);
      return { ok: !error, details: error?.message ?? "ok" };
    }),
    run("db_microsoft_tokens", async () => {
      const { error } = await supabaseAdmin.from("microsoft_tokens").select("user_id").limit(1);
      return { ok: !error, details: error?.message ?? "ok" };
    }),

    run("settings_merge", async () => {
      const merged = deepMerge(DEFAULT_SETTINGS, { config: {} });
      const cfg = (merged as any)?.config ?? {};
      const guard = cfg.autopilot_guardrails ?? {};
      const keys = ["require_calendar_connected", "quiet_hours", "max_autopilot_emails_per_hour", "require_property_match_for_location", "require_faq_match_for_information"];
      const hasGuard = keys.every((k) => guard[k] !== undefined);
      const hasMinNotice = cfg.scheduling_rules?.min_notice_hours !== undefined;
      const faqArray = Array.isArray(cfg.faq_items);
      const ok = hasGuard && hasMinNotice && faqArray;
      return { ok, details: { autopilot_guardrails_keys: hasGuard ? keys.length : 0, min_notice_hours: hasMinNotice, faq_items_is_array: faqArray } };
    }),

    run("route_setup_status", async () => {
      const res = await fetch(`${baseUrl}/api/setup/status`, { cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const ok = res.status !== 500 && (res.status === 401 || (res.status === 200 && json && typeof json.ready_for_autopilot === "boolean"));
      return { ok, details: { status: res.status, has_ready: json && typeof json.ready_for_autopilot === "boolean" } };
    }),
    run("route_activity_recent", async () => {
      const res = await fetch(`${baseUrl}/api/activity/recent?limit=1`, { cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const ok = res.status !== 500 && (res.status === 401 || (res.status === 200 && json && Array.isArray(json.items)));
      return { ok, details: { status: res.status, items_array: Array.isArray(json?.items) } };
    }),
    run("route_pipeline_list", async () => {
      const res = await fetch(`${baseUrl}/api/pipeline/list?period=7d`, { cache: "no-store" });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const ok = res.status !== 500 && (res.status === 401 || (res.status === 200 && json && Array.isArray(json.pipelineRows)));
      return { ok, details: { status: res.status, pipelineRows_array: Array.isArray(json?.pipelineRows) } };
    }),

    run("guardrails_quiet_hours", async () => {
      const quiet = { start: "20:00", end: "08:00", timezone: "Europe/Paris" };
      const inQuiet = new Date("2025-02-24T22:00:00.000Z");
      const outQuiet = new Date("2025-02-24T14:00:00.000Z");
      const inResult = isInQuietHours(quiet, inQuiet);
      const outResult = isInQuietHours(quiet, outQuiet);
      const ok = inResult === true && outResult === false;
      return { ok, details: { in_quiet_22h: inResult, out_quiet_14h: outResult } };
    }),

    run("activity_log_insert_read", async () => {
      const { data: first } = await supabaseAdmin.from("settings_v1").select("user_id").limit(1).maybeSingle();
      const userId = (first as any)?.user_id ?? null;
      if (!userId) return { ok: false, details: "no user for test insert" };
      const id = crypto.randomUUID?.() ?? `smoke-${Date.now()}`;
      const { error: insErr } = await supabaseAdmin.from("activity_log").insert({
        id,
        user_id: userId,
        actor: "system",
        type: "smoke_test",
        title: "Smoke test",
        meta: { test: true },
      });
      if (insErr) return { ok: false, details: insErr.message };
      const { data: row, error: selErr } = await supabaseAdmin.from("activity_log").select("id, type").eq("id", id).single();
      const ok = !selErr && row?.type === "smoke_test";
      await supabaseAdmin.from("activity_log").delete().eq("id", id);
      return { ok, details: ok ? "insert+read+delete ok" : selErr?.message };
    }),

    run("autopilot_dry_run", async () => {
      const res = await fetch(`${baseUrl}/api/cron/autopilot-dispatch?dry=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-fixetime-cron-key": cronKey! },
        cache: "no-store",
      });
      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      const ok = res.status === 200 && json && (json.dryRun === true || json.dry_run === true);
      return { ok, details: ok ? json : { status: res.status, body: json } };
    }),
  ]);

  const durationMs = Date.now() - startMs;
  const allOk = checks.every((c) => c.ok);
  return NextResponse.json({
    ok: allOk,
    started_at: startedAt,
    duration_ms: durationMs,
    checks,
  });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        started_at: startedAt,
        duration_ms: Date.now() - startMs,
        checks: [],
        error: "SMOKE_THREW",
        details: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}
