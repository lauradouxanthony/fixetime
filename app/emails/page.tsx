"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import { EmailsList } from "@/components/emails/EmailsList";
import { EmailDetailPanel } from "@/components/emails/EmailDetailPanel";
import type { Email } from "@/types/email";
import AppShell from "@/components/layout/AppShell";

type Period = "today" | "7d" | "30d";
type PipelineMode = "DRAFT" | "AUTOPILOTE";
type IntentionFilter = "all" | "LOCATION" | "INFO" | "HORS_SUJET";

function normalizeDecision(decision?: string | null): "traiter" | "planifier" | "ignorer" | null {
  if (!decision) return null;
  const d = decision.toLowerCase();
  if (d === "traiter") return "traiter";
  if (d === "planifier") return "planifier";
  if (d === "ignorer") return "ignorer";
  return null;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `il y a ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes}min`;
  return `il y a ${Math.floor(minutes / 60)}h`;
}

export default function PipelinePage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [intentionFilter, setIntentionFilter] = useState<IntentionFilter>("all");
  const [period, setPeriod] = useState<Period>("7d");
  const [mode, setMode] = useState<PipelineMode>("DRAFT");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [now, setNow] = useState(new Date());

  // Tick toutes les 10s pour mettre à jour "il y a Xs"
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Charger le mode depuis les settings
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data?.pipeline_mode === "AUTOPILOTE") setMode("AUTOPILOTE");
      })
      .catch(() => {});
  }, []);

  // Fetch emails (avec reset loading + selectedEmail = pour changements de filtre)
  const fetchEmails = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/auth/login"; return; }

    const now = new Date();
    let fromDate: Date | null = null;
    if (period === "today") { fromDate = new Date(); fromDate.setHours(0, 0, 0, 0); }
    if (period === "7d") { fromDate = new Date(); fromDate.setDate(now.getDate() - 7); }
    if (period === "30d") { fromDate = new Date(); fromDate.setDate(now.getDate() - 30); }

    let query = supabase
      .from("emails")
      .select("id, gmail_message_id, sender, subject, body, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("received_at", { ascending: false });

    if (fromDate) query = query.gte("received_at", fromDate.toISOString());
    if (intentionFilter !== "all") query = query.eq("category", intentionFilter);

    const { data, error } = await query;
    if (error) { console.error("FETCH_EMAILS_ERROR", error); setLoading(false); return; }

    const normalized: Email[] = (data || []).map((e) => ({
      ...e,
      decision: normalizeDecision(e.decision),
    }));

    setEmails(normalized);
    setLoading(false);
  }, [period, intentionFilter]);

  // Fetch silencieux (sans reset selectedEmail ni loading) — pour polling
  const fetchEmailsSilent = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const now = new Date();
    let fromDate: Date | null = null;
    if (period === "today") { fromDate = new Date(); fromDate.setHours(0, 0, 0, 0); }
    if (period === "7d") { fromDate = new Date(); fromDate.setDate(now.getDate() - 7); }
    if (period === "30d") { fromDate = new Date(); fromDate.setDate(now.getDate() - 30); }

    let query = supabase
      .from("emails")
      .select("id, gmail_message_id, sender, subject, body, summary, received_at, estimated_time, recommended_action, decision, category, is_archived, classification_reason, is_urgent, is_important, ai_reply")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .order("received_at", { ascending: false });

    if (fromDate) query = query.gte("received_at", fromDate.toISOString());
    if (intentionFilter !== "all") query = query.eq("category", intentionFilter);

    const { data } = await query;
    if (!data) return;

    const normalized: Email[] = data.map((e) => ({
      ...e,
      decision: normalizeDecision(e.decision),
    }));

    setEmails(normalized);

    // Mettre à jour l'email sélectionné si nouveau résultat disponible
    setSelectedEmail((prev) => {
      if (!prev) return prev;
      const updated = normalized.find((e) => e.id === prev.id);
      return updated ?? prev;
    });
  }, [period, intentionFilter]);

  // Chargement initial + changement filtre/période
  useEffect(() => {
    setLoading(true);
    setSelectedEmail(null);
    fetchEmails();
  }, [fetchEmails]);

  // Polling toutes les 60s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // 1) Déclenche l'analyse (fire & forget)
        await fetch("/api/emails/analyze-now", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "auto" }),
        });

        // 2) Refresh silencieux après 3s (laisse le temps à l'analyse de démarrer)
        setTimeout(async () => {
          await fetchEmailsSilent();
          setLastSync(new Date());
        }, 3000);
      } catch (e) {
        console.error("POLLING_ERROR", e);
      }
    }, 60_000);

    return () => clearInterval(interval);
  }, [fetchEmailsSilent]);

  // Refresh manuel
  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetch("/api/emails/analyze-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trigger: "manual" }),
      });
      setTimeout(async () => {
        await fetchEmailsSilent();
        setLastSync(new Date());
        setRefreshing(false);
      }, 3000);
    } catch (e) {
      console.error("REFRESH_ERROR", e);
      setRefreshing(false);
    }
  };

  // Toggle mode DRAFT / AUTOPILOTE
  const toggleMode = async () => {
    const newMode: PipelineMode = mode === "DRAFT" ? "AUTOPILOTE" : "DRAFT";
    setMode(newMode);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pipeline_mode: newMode }),
    }).catch(() => {});
  };

  const stats = useMemo(() => {
    const location = emails.filter((e) => e.category === "LOCATION").length;
    const info = emails.filter((e) => e.category === "INFO").length;
    const horssujet = emails.filter((e) => e.category === "HORS_SUJET").length;
    return { location, info, horssujet, total: emails.length };
  }, [emails]);

  return (
    <AppShell>
      <div className="flex flex-col h-full" style={{ background: "rgb(250 250 250)" }}>

        {/* ── HEADER ── */}
        <div className="px-6 py-4 border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center justify-between gap-4">

            {/* Titre + sync */}
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>
                Pipeline emails
              </h1>
              {lastSync && (
                <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                  Dernière sync : {timeAgo(lastSync)}
                </p>
              )}
            </div>

            {/* Switch DRAFT / AUTOPILOTE + refresh */}
            <div className="flex items-center gap-4">
              {/* Switch */}
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-medium"
                  style={{ color: mode === "DRAFT" ? "rgb(79 70 229)" : "rgb(148 163 184)" }}
                >
                  DRAFT
                </span>
                <button
                  onClick={toggleMode}
                  className="relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none"
                  style={{ background: mode === "AUTOPILOTE" ? "rgb(79 70 229)" : "rgb(226 232 240)" }}
                  title={mode === "DRAFT" ? "Passer en AUTOPILOTE" : "Passer en DRAFT"}
                >
                  <span
                    className="absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all duration-200"
                    style={{ left: mode === "AUTOPILOTE" ? "1.375rem" : "0.25rem" }}
                  />
                </button>
                <span
                  className="text-xs font-medium"
                  style={{ color: mode === "AUTOPILOTE" ? "rgb(79 70 229)" : "rgb(148 163 184)" }}
                >
                  AUTOPILOTE
                </span>
              </div>

              {/* Refresh */}
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="p-1.5 rounded-lg transition-colors"
                style={{ color: "rgb(100 116 139)" }}
                title="Rafraîchir"
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className={refreshing ? "animate-spin inline-block" : ""}>🔄</span>
              </button>
            </div>
          </div>

          {/* Mode description */}
          <div className="mt-2 text-xs" style={{ color: "rgb(100 116 139)" }}>
            {mode === "DRAFT"
              ? "Mode DRAFT — l'IA génère des brouillons, vous approuvez avant envoi."
              : "Mode AUTOPILOTE — l'IA gère la conversation jusqu'au RDV confirmé."}
          </div>
        </div>

        {/* ── FILTRES ── */}
        <div
          className="px-6 py-3 flex items-center justify-between gap-4 border-b bg-white"
          style={{ borderColor: "rgb(226 232 240)" }}
        >
          {/* Filtres intention */}
          <div className="flex items-center gap-1.5">
            {(["all", "LOCATION", "INFO", "HORS_SUJET"] as const).map((f) => {
              const labels = { all: "Tous", LOCATION: "Location", INFO: "Info", HORS_SUJET: "Hors sujet" };
              const counts = {
                all: stats.total,
                LOCATION: stats.location,
                INFO: stats.info,
                HORS_SUJET: stats.horssujet,
              };
              const isActive = intentionFilter === f;
              return (
                <button
                  key={f}
                  onClick={() => setIntentionFilter(f)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={isActive ? {
                    background: "rgb(238 242 255)",
                    color: "rgb(79 70 229)",
                  } : {
                    color: "rgb(100 116 139)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  {labels[f]}
                  <span className="ml-1.5 opacity-60">{counts[f]}</span>
                </button>
              );
            })}
          </div>

          {/* Période */}
          <div className="flex items-center gap-1">
            {(["today", "7d", "30d"] as const).map((p) => {
              const labels = { today: "Auj.", "7d": "7j", "30d": "30j" };
              const isActive = period === p;
              return (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className="px-2.5 py-1 rounded-md text-xs transition-all"
                  style={isActive ? {
                    background: "rgb(79 70 229)",
                    color: "white",
                    fontWeight: 500,
                  } : {
                    color: "rgb(100 116 139)",
                  }}
                >
                  {labels[p]}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── CORPS ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* Liste emails */}
          <div
            className="w-80 border-r overflow-y-auto flex-shrink-0"
            style={{ borderColor: "rgb(226 232 240)", background: "white" }}
          >
            <EmailsList
              emails={emails}
              selectedEmailId={selectedEmail?.id || null}
              onSelect={(email) => setSelectedEmail(email as Email)}
              loading={loading}
            />
          </div>

          {/* Détail email */}
          <div className="flex-1 overflow-y-auto">
            <EmailDetailPanel email={selectedEmail} mode={mode} />
          </div>
        </div>

        {/* ── PIED DE PAGE : stats discrets ── */}
        <div
          className="px-6 py-2 border-t flex items-center gap-4"
          style={{ borderColor: "rgb(226 232 240)", background: "white" }}
        >
          <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>
            {stats.total} emails
          </span>
          <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>·</span>
          <span className="text-xs" style={{ color: "rgb(37 99 235)" }}>
            {stats.location} location
          </span>
          <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>·</span>
          <span className="text-xs" style={{ color: "rgb(100 116 139)" }}>
            {stats.info} info
          </span>
          {lastSync && (
            <>
              <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>·</span>
              <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                Sync auto toutes les 60s
              </span>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
