"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

type StatsResponse = {
  rdv_taken: number;
  hours_saved: number;
  avg_response_time: number;
} | null;

type AgencySettings = {
  required_documents?: string[];
};

type ToastState = {
  message: string;
  variant: "success" | "error";
} | null;

type AutomationMode = "draft" | "autopilot";
type EmailRow = {
  id: string;
  subject: string | null;
  from_name?: string | null;
  from_email?: string | null;
  sender?: string | null;
  intent: string | null;
  lead_score: number | null;
  lead_status: string | null;
  lead_json: Record<string, unknown> | null;
  snippet?: string | null;
  summary?: string | null;
  received_at: string | null;
  analyzed_at: string | null;
  ai_reply: string | null;
  decision?: string | null;
  // Canonical UI contract (computed by /api/pipeline/list)
  ui_bucket?: "principal" | "ignored" | null;
  ui_intent?: "LOCATION_REQUEST" | "FAQ_QUESTION" | "IGNORED" | "ADMIN" | null;
  ui_status?: "new" | "qualifying" | "slots_proposed" | "confirmed" | "rejected" | "ignored" | null;
  ui_panel?: "unanalyzed" | "out_of_scope" | "faq" | "location" | "none" | null;
  ui_next_action?: "ask_income" | "ask_documents" | "generate_draft" | "propose_slots" | null;
};
const INTENT_OUT_OF_SCOPE = ["ADMIN", "IGNORED"];

const fetcherJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const text = await res.text();
  let json: any = {};
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
  }
  if (!res.ok || json?.error) {
    const msg = json?.error || json?.detail || "Erreur réseau";
    throw new Error(msg);
  }
  return json as T;
};

const postJson = async (url: string, body: object) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const patchJson = async (url: string, body: object) => {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ json: any; aborted: boolean }> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    clearTimeout(timerId);
    const text = await res.text();
    let json: any = {};
    if (text) { try { json = JSON.parse(text); } catch { json = {}; } }
    return { json, aborted: false };
  } catch (e: any) {
    clearTimeout(timerId);
    if (e?.name === "AbortError") return { json: {}, aborted: true };
    throw e;
  }
}

function formatTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h}h`;
  return `il y a ${Math.floor(h / 24)}j`;
}

function statusBadge(status: string | null): { label: string; className: string } {
  switch (status) {
    case "new":
      return { label: "Nouveau", className: "bg-blue-500/20 text-blue-200 border border-blue-500/40" };
    case "qualifying":
      return { label: "En qualification", className: "bg-amber-500/20 text-amber-200 border border-amber-500/40" };
    case "slots_proposed":
      return { label: "RDV proposé", className: "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40" };
    case "confirmed":
      return { label: "✓ Confirmé", className: "bg-zinc-900 text-emerald-300 border border-emerald-500/40" };
    case "rejected":
    case "ignored":
      return { label: "Non éligible", className: "bg-red-500/20 text-red-200 border border-red-500/40" };
    default:
      return { label: status || "—", className: "bg-slate-700 text-slate-200 border border-slate-600" };
  }
}

function intentMeta(intent: string | null): { label: string; icon: string; className: string } {
  if (intent === "LOCATION_REQUEST") {
    return {
      label: "LOCATION",
      icon: "🔵",
      className: "bg-blue-500/20 text-blue-200 border border-blue-500/50",
    };
  }
  if (intent === "FAQ_QUESTION") {
    return {
      label: "INFO",
      icon: "⚪",
      className: "bg-slate-500/20 text-slate-200 border border-slate-500/50",
    };
  }
  if (intent && INTENT_OUT_OF_SCOPE.includes(intent)) {
    return {
      label: "HORS SCOPE",
      icon: "✖",
      className: "bg-slate-800/70 text-slate-400 border border-slate-700 line-through",
    };
  }
  return {
    label: "—",
    icon: "●",
    className: "bg-slate-700/70 text-slate-300 border border-slate-600",
  };
}

export default function PipelinePage() {
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const [intentFilter, setIntentFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [tab, setTab] = useState<"principal" | "ignored">("principal");
  const [syncLoading, setSyncLoading] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [toast, setToast] = useState<ToastState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [globalMode, setGlobalMode] = useState<AutomationMode>("draft");
  const [isClient, setIsClient] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);

  // Guard single-flight : empêche les actualisations concurrentes
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== "undefined") {
      const mq = window.matchMedia("(max-width: 1024px)");
      const update = () => setIsMobile(mq.matches);
      update();
      mq.addEventListener("change", update);
      return () => mq.removeEventListener("change", update);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const listKey = useMemo(
    () =>
      `/api/pipeline/list?period=${period}&intent=${intentFilter}&status=${statusFilter}&search=${encodeURIComponent(
        searchDebounced,
      )}`,
    [period, intentFilter, statusFilter, searchDebounced],
  );

  const {
    data: listData,
    error: listError,
    isValidating: listValidating,
    mutate,
  } = useSWR<{ ok: boolean; emails: EmailRow[]; total?: number }>(listKey, fetcherJson, {
    revalidateOnFocus: true,
    dedupingInterval: 2000,
    refreshInterval: syncLoading ? 0 : (autoSync ? 30000 : 0),
  });

  const { data: statsData, error: statsError } = useSWR<StatsResponse>(
    `/api/stats?period=${period}`,
    fetcherJson,
    { dedupingInterval: 15000 },
  );

  const { data: agencySettings } = useSWR<AgencySettings>(
    "/api/settings/agency",
    fetcherJson,
    { revalidateOnFocus: false },
  );

  const rows: EmailRow[] = listData?.emails ?? [];
  const principalRows = rows.filter((r) => r.ui_bucket !== "ignored");
  const ignoredRows = rows.filter((r) => r.ui_bucket === "ignored");
  const displayRows = tab === "principal" ? principalRows : ignoredRows;
  const ignoredCount = ignoredRows.length;
  const selectedRow = rows.find((r) => r.id === selectedId) ?? null;

  const showToast = useCallback((message: string, variant: "success" | "error" = "success") => {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // Flux de refresh unifié : utilisé par le bouton manuel ET par l'auto-sync
  const runRefreshFlow = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;

    // Single-flight guard : une seule actualisation à la fois
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    if (!silent) setSyncLoading(true);

    try {
      // — Étape 1 : sync inbox (15s max) —
      let syncResult: { json: any; aborted: boolean };
      try {
        syncResult = await fetchJsonWithTimeout(
          "/api/emails/sync",
          { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({}) },
          15000,
        );
      } catch {
        if (!silent) showToast("Erreur réseau lors de la synchronisation.", "error");
        return;
      }

      if (syncResult.aborted) {
        if (!silent) showToast("Actualisation trop longue. Réessayez.", "error");
        return;
      }

      if (!syncResult.json?.ok) {
        if (!silent) showToast(syncResult.json?.error || "Erreur lors de la synchronisation.", "error");
        return;
      }

      // — Étape 2 : petite analyse courte (10s max) —
      let analyzed = 0;
      try {
        const analyzeResult = await fetchJsonWithTimeout(
          "/api/ai/analyze-backlog",
          { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ limit: 3 }) },
          10000,
        );
        if (analyzeResult.aborted) {
          mutate();
          if (!silent) showToast("Boîte actualisée. Analyse partielle en cours.", "success");
          return;
        }
        analyzed = analyzeResult.json?.analyzed ?? 0;
      } catch {
        mutate();
        if (!silent) showToast("Boîte actualisée.", "success");
        return;
      }

      // — Étape 3 : refresh pipeline —
      mutate();
      if (!silent) {
        if (analyzed > 0) {
          showToast(`Boîte actualisée : ${analyzed} email(s) analysé(s).`, "success");
        } else {
          showToast("Boîte actualisée.", "success");
        }
      }
    } catch {
      if (!silent) showToast("Erreur réseau lors de la mise à jour.", "error");
    } finally {
      refreshInFlightRef.current = false;
      if (!silent) setSyncLoading(false);
    }
  }, [mutate, showToast]);

  useEffect(() => {
    if (!autoSync) return;
    const id = setInterval(() => {
      // Ne pas lancer si une actualisation est déjà en cours
      if (syncLoading || refreshInFlightRef.current) return;
      void runRefreshFlow({ silent: true });
    }, 120000);
    return () => clearInterval(id);
  }, [autoSync, syncLoading, runRefreshFlow]);

  const handleSelectRow = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (isMobile) {
        setMobileDetailOpen(true);
      }
    },
    [isMobile],
  );

  const stats = statsData;

  return (
    <div className="px-4 py-6 lg:px-8 lg:py-8 max-w-6xl mx-auto text-slate-100">
      {toast && (
        <div
          className={`fixed right-4 top-20 z-50 flex items-center gap-3 rounded-lg px-4 py-2 shadow-lg text-sm border ${
            toast.variant === "success"
              ? "bg-emerald-900/90 border-emerald-500/70 text-emerald-50"
              : "bg-red-900/90 border-red-500/70 text-red-50"
          }`}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            className="ml-2 text-xs text-slate-200 hover:text-white"
          >
            Fermer
          </button>
        </div>
      )}

      {/* SECTION 1 — BANDEAU STATS */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">
            Vue d&apos;ensemble
          </h2>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {statsError && <span>Impossible de charger les statistiques</span>}
            {!statsError && (
              <span className="rounded-full border border-slate-700/80 bg-slate-900/60 px-3 py-1">
                Période&nbsp;:{" "}
                <span className="font-medium text-slate-200">
                  {period === "7d" ? "7 jours" : "30 jours"}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard
            icon="🗓"
            label="RDV confirmés"
            value={
              stats
                ? typeof stats.rdv_taken === "number"
                  ? stats.rdv_taken.toString()
                  : "0"
                : "—"
            }
            loading={!stats && !statsError}
          />
          <StatsCard
            icon="⏱"
            label="Heures économisées"
            value={
              stats && typeof stats.hours_saved === "number"
                ? `${stats.hours_saved.toFixed(1)}h`
                : "0.0h"
            }
            loading={!stats && !statsError}
          />
          <StatsCard
            icon="⚡"
            label="Réactivité moyenne"
            value={
              stats && typeof stats.avg_response_time === "number"
                ? `< ${Math.max(1, stats.avg_response_time)} min`
                : "< 2 min"
            }
            loading={!stats && !statsError}
          />
        </div>
      </section>

      {/* SECTION 2 — BARRE DE CONTRÔLE */}
      <section className="mb-6 space-y-3 rounded-xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950/95 to-slate-900/95 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.55)]">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-50">Boîte de réception IA</h1>
            <p className="text-xs text-slate-400">
              Centralisez les demandes entrantes, qualifiez vos leads et laissez l&apos;IA automatiser les
              réponses.
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              setGlobalMode((m) => (m === "draft" ? "autopilot" : "draft"))
            }
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-colors ${
              globalMode === "draft"
                ? "border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
                : "border-emerald-500/70 bg-emerald-600/90 text-emerald-50 shadow-[0_0_20px_rgba(16,185,129,0.4)] hover:bg-emerald-500"
            }`}
          >
            <span>{globalMode === "draft" ? "📝" : "🚀"}</span>
            <span>
              Mode&nbsp;
              {globalMode === "draft" ? "Brouillon" : "Autopilote"}
            </span>
          </button>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-full border border-slate-700 bg-slate-900/70 text-xs">
              <button
                type="button"
                onClick={() => setPeriod("7d")}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  period === "7d"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-300 hover:bg-slate-800/80"
                }`}
              >
                7j
              </button>
              <button
                type="button"
                onClick={() => setPeriod("30d")}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  period === "30d"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-300 hover:bg-slate-800/80"
                }`}
              >
                30j
              </button>
            </div>

            <select
              value={intentFilter}
              onChange={(e) => setIntentFilter(e.target.value)}
              className="h-9 rounded-full border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 shadow-inner outline-none ring-0 focus:border-slate-400 focus:ring-1 focus:ring-slate-500/60"
            >
              <option value="">Intent : Tous</option>
              <option value="LOCATION_REQUEST">Location</option>
              <option value="FAQ_QUESTION">Info</option>
              <option value="IGNORED">Ignorés</option>
              <option value="ADMIN">Admin</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-full border border-slate-700 bg-slate-950 px-3 text-xs text-slate-100 shadow-inner outline-none ring-0 focus:border-slate-400 focus:ring-1 focus:ring-slate-500/60"
            >
              <option value="">Statut : Tous</option>
              <option value="new">Nouveau</option>
              <option value="qualifying">En qualification</option>
              <option value="slots_proposed">RDV proposé</option>
              <option value="confirmed">Confirmé</option>
              <option value="rejected">Non éligible</option>
            </select>

            <div className="relative">
              <input
                type="text"
                placeholder="Rechercher (nom, sujet)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-48 rounded-full border border-slate-700 bg-slate-950 pl-8 pr-3 text-xs text-slate-100 placeholder:text-slate-500 shadow-inner outline-none ring-0 focus:border-slate-400 focus:ring-1 focus:ring-slate-500/60 md:w-64"
              />
              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                🔍
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void runRefreshFlow({ silent: false })}
              disabled={syncLoading}
              className="inline-flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-4 py-1.5 text-xs font-semibold text-slate-100 shadow-sm hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {syncLoading ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" />
                  <span>Actualisation…</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>Actualiser</span>
                </>
              )}
            </button>

            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => setAutoSync(e.target.checked)}
                className="h-3 w-3 rounded border-slate-600 bg-slate-900 accent-emerald-500"
              />
              <span>Auto</span>
            </label>
          </div>
        </div>

        {(listError || statsError) && (
          <p className="mt-2 text-xs text-red-300">
            Une erreur est survenue lors du chargement des données. La page reste utilisable, mais
            certaines informations peuvent être incomplètes.
          </p>
        )}
      </section>

      {/* SECTION 3 — LAYOUT PRINCIPAL (2 colonnes) */}
      <section className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* Colonne gauche : liste */}
        <div className="flex h-[min(70vh,32rem)] flex-1 flex-col rounded-xl border border-slate-800 bg-slate-950/80 shadow-[0_18px_40px_rgba(0,0,0,0.65)] lg:max-w-sm">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2 text-xs text-slate-300">
            <div className="inline-flex overflow-hidden rounded-full border border-slate-700 bg-slate-900/80 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  setTab("principal");
                  if (!rows.find((r) => r.ui_bucket !== "ignored" && r.id === selectedId)) {
                    setSelectedId(null);
                  }
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  tab === "principal"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-300 hover:bg-slate-800/80"
                }`}
              >
                Principal ({principalRows.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("ignored");
                  if (!rows.find((r) => r.ui_bucket === "ignored" && r.id === selectedId)) {
                    setSelectedId(null);
                  }
                }}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  tab === "ignored"
                    ? "bg-slate-100 text-slate-900"
                    : "text-slate-300 hover:bg-slate-800/80"
                }`}
              >
                Ignorés ({ignoredCount})
              </button>
            </div>
            <span className="text-[11px] text-slate-500">
              {rows.length} email{rows.length > 1 ? "s" : ""}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {listValidating && !listData ? (
              <ul className="divide-y divide-slate-800/80">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <li key={idx} className="px-3 py-3">
                    <div className="mb-2 h-3 w-32 animate-pulse rounded bg-slate-800" />
                    <div className="mb-1 flex gap-2">
                      <div className="h-4 w-16 animate-pulse rounded-full bg-slate-800" />
                      <div className="h-4 w-20 animate-pulse rounded-full bg-slate-800" />
                    </div>
                    <div className="h-2.5 w-24 animate-pulse rounded bg-slate-800" />
                  </li>
                ))}
              </ul>
            ) : displayRows.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-6 text-center text-xs text-slate-400">
                <span className="text-lg">📬</span>
                <p>Aucun email à afficher pour les filtres sélectionnés.</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/80">
                {displayRows.map((row) => (
                  <EmailListItem
                    key={row.id}
                    row={row}
                    isSelected={selectedId === row.id}
                    onSelect={() => handleSelectRow(row.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Colonne droite : panneau détail */}
        {!isClient || !isMobile ? (
          <div className="flex min-h-[260px] flex-1 rounded-xl border border-slate-800 bg-slate-950/80 p-4 shadow-[0_18px_40px_rgba(0,0,0,0.65)]">
            {selectedRow ? (
              <PipelineDetailPanel
                selectedRow={selectedRow}
                onRefresh={mutate}
                agencySettings={agencySettings}
                globalMode={globalMode}
                showToast={showToast}
              />
            ) : (
              <EmptyDetailState />
            )}
          </div>
        ) : (
          <>
            <div className="h-0 flex-1 lg:hidden" />
            {selectedRow && mobileDetailOpen && (
              <div className="fixed inset-0 z-40 flex items-end bg-black/60 backdrop-blur-sm">
                <div className="max-h-[80vh] w-full rounded-t-2xl border border-slate-800 bg-slate-950/95 p-4 shadow-[0_-18px_40px_rgba(0,0,0,0.75)]">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      Détail de l&apos;email
                    </p>
                    <button
                      type="button"
                      onClick={() => setMobileDetailOpen(false)}
                      className="rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      Fermer
                    </button>
                  </div>
                  <div className="max-h-[70vh] overflow-y-auto">
                    <PipelineDetailPanel
                      selectedRow={selectedRow}
                      onRefresh={mutate}
                      agencySettings={agencySettings}
                      globalMode={globalMode}
                      showToast={showToast}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function StatsCard(props: { icon: string; label: string; value: string; loading?: boolean }) {
  const { icon, label, value, loading } = props;
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950/95 to-slate-900 px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.7)]">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          {label}
        </span>
        {loading ? (
          <div className="mt-1 h-6 w-16 animate-pulse rounded bg-slate-800" />
        ) : (
          <span className="text-2xl font-semibold text-slate-50">{value}</span>
        )}
      </div>
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-xl">
        <span>{icon}</span>
      </div>
    </div>
  );
}

function EmailListItem({
  row,
  isSelected,
  onSelect,
}: {
  row: EmailRow;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const displayName =
    (row.from_name ?? row.subject ?? "Sans nom").trim() || "Sans nom";
  const meta = intentMeta(row.ui_intent ?? null);

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect()}
      className={`cursor-pointer px-3 py-3 text-xs transition-colors ${
        isSelected
          ? "bg-slate-900 ring-1 ring-inset ring-sky-500/70"
          : "hover:bg-slate-900/80"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base leading-none">{meta.icon}</span>
          <p className="max-w-[11rem] truncate font-medium text-slate-100">
            {displayName}
          </p>
        </div>
        <span className="whitespace-nowrap text-[11px] text-slate-400">
          {formatTimeAgo(row.received_at)}
        </span>
      </div>
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${meta.className}`}
        >
          <span>{meta.label}</span>
          {row.lead_score != null && meta.label === "LOCATION" && (
            <span className="text-[9px] text-slate-100/80">
              {row.lead_score}/10
            </span>
          )}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge(row.ui_status ?? null).className}`}
        >
          {statusBadge(row.ui_status ?? null).label}
        </span>
        {row.ai_reply && (
          <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
            ✓ IA a répondu
          </span>
        )}
      </div>
      {row.subject && (
        <p className="line-clamp-1 text-[11px] text-slate-400">
          {row.subject}
        </p>
      )}
      {!row.subject && row.snippet && (
        <p className="line-clamp-1 text-[11px] text-slate-400">
          {row.snippet}
        </p>
      )}
    </li>
  );
}

function EmptyDetailState() {
  return (
    <div className="flex w-full flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-2xl">
        📬
      </div>
      <div>
        <p className="text-sm font-medium text-slate-100">
          Sélectionnez un email
        </p>
        <p className="text-xs text-slate-400">
          Choisissez une carte à gauche pour afficher la qualification, la
          solvabilité et les actions proposées par l&apos;IA.
        </p>
      </div>
    </div>
  );
}

function PipelineDetailPanel({
  selectedRow,
  onRefresh,
  agencySettings,
  globalMode,
  showToast,
}: {
  selectedRow: EmailRow | null;
  onRefresh: () => void;
  agencySettings?: AgencySettings;
  globalMode: AutomationMode;
  showToast: (message: string, variant?: "success" | "error") => void;
}) {
  if (!selectedRow) {
    return <EmptyDetailState />;
  }

  return (
    <div className="w-full space-y-4 text-xs text-slate-100">
      <DetailContent
        row={selectedRow}
        onRefresh={onRefresh}
        agencySettings={agencySettings}
        globalMode={globalMode}
        showToast={showToast}
      />
    </div>
  );
}

function DetailContent({
  row,
  onRefresh,
  agencySettings,
  globalMode,
  showToast,
}: {
  row: EmailRow;
  onRefresh: () => void;
  agencySettings?: AgencySettings;
  globalMode: AutomationMode;
  showToast: (message: string, variant?: "success" | "error") => void;
}) {
  const lead = (row.lead_json ?? {}) as Record<string, unknown>;
  // Use canonical ui_panel from API; fallback for legacy rows without it
  const panel =
    row.ui_panel ??
    (row.analyzed_at == null
      ? "unanalyzed"
      : INTENT_OUT_OF_SCOPE.includes(row.intent ?? "")
      ? "out_of_scope"
      : row.intent === "FAQ_QUESTION"
      ? "faq"
      : row.intent === "LOCATION_REQUEST"
      ? "location"
      : "none");

  if (panel === "unanalyzed") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4">
          <p className="mb-2 text-sm font-medium text-slate-100">
            ⏳ Cet email n&apos;a pas encore été analysé
          </p>
          <p className="mb-3 text-xs text-slate-400">
            Lancez une analyse pour détecter automatiquement l&apos;intent, calculer la solvabilité
            et générer une réponse.
          </p>
          <button
            type="button"
            onClick={async () => {
              try {
                const json = await postJson("/api/ai/analyze-backlog", {
                  email_id: row.id,
                  limit: 1,
                });
                if (!json?.success) {
                  showToast(
                    json?.error || "Impossible de lancer l'analyse de cet email.",
                    "error",
                  );
                  return;
                }
                showToast("Analyse terminée pour cet email.", "success");
                onRefresh();
              } catch {
                showToast("Erreur réseau pendant l'analyse de l'email.", "error");
              }
            }}
            className="inline-flex items-center gap-2 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-amber-400"
          >
            <span>⚡</span>
            <span>Analyser maintenant</span>
          </button>
        </div>
        <EmailSourceCard row={row} />
      </div>
    );
  }

  if (panel === "out_of_scope") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4 text-sm">
          <p className="mb-1 text-base">📭 Email hors scope</p>
          <p className="mb-3 text-xs text-slate-400">
            Newsletter, confirmation de commande, spam ou notification système.
          </p>
          <p className="mb-3 text-[11px] text-slate-500">
            Type détecté&nbsp;:{" "}
            <span className="font-mono text-slate-300">{row.ui_intent ?? row.intent}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-900"
            >
              Archiver
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-900"
            >
              Reclassifier
            </button>
          </div>
        </div>
        <EmailSourceCard row={row} />
      </div>
    );
  }

  if (panel === "faq") {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4">
          <h3 className="mb-1 text-sm font-semibold text-slate-100">
            ❓ Question détectée
          </h3>
          <p className="mb-3 text-xs text-slate-300">
            {row.snippet || row.subject || "Question non extraite."}
          </p>
          <div className="mb-3 rounded-lg border border-slate-800 bg-slate-900/80 p-3 text-xs text-slate-300">
            <p className="mb-1 font-medium text-slate-100">
              Réponse IA basée sur votre FAQ
            </p>
            <p className="text-[11px] text-slate-400">
              Source&nbsp;: paramètres FAQ de l&apos;agence.
            </p>
          </div>
          {!row.ai_reply && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-900"
            >
              <span>➕</span>
              <span>Ajouter à la FAQ</span>
            </button>
          )}
        </div>
        <EmailSourceCard row={row} />
      </div>
    );
  }

  if (panel === "location") {
    const monthlyIncome = (lead.monthly_income as number | null | undefined) ?? null;
    const rent = (lead.rent as number | null | undefined) ?? null;
    const ratio =
      monthlyIncome != null && rent != null && rent > 0
        ? monthlyIncome / rent
        : null;
    const eligible = ratio != null ? ratio >= 3 : null;
    const docs =
      agencySettings?.required_documents ?? [
        "Pièce d'identité",
        "3 dernières fiches de paie",
        "Avis d'imposition",
      ];
    const missingInfo = (lead.missing_info as string[] | undefined) ?? [];

    const nextActionLabel: string = (() => {
      switch (row.ui_next_action) {
        case "ask_income":     return "📋 Demander les revenus";
        case "ask_documents":  return "📎 Demander les documents";
        case "propose_slots":  return "📅 Proposer des créneaux";
        case "generate_draft":
        default:               return "✍️ Générer un brouillon";
      }
    })();

    const solvableBg =
      eligible === true
        ? "border-emerald-500/70 bg-emerald-900/40"
        : eligible === false
        ? "border-red-500/70 bg-red-900/40"
        : "border-slate-700 bg-slate-900/80";

    const solvableAccent =
      eligible === true
        ? "text-emerald-200"
        : eligible === false
        ? "text-red-200"
        : "text-slate-200";

    const [automationMode, setAutomationMode] = useState<AutomationMode>(
      globalMode,
    );

    const toggleAutomation = async (mode: AutomationMode) => {
      setAutomationMode(mode);
      try {
        const json = await patchJson("/api/emails/automation-level", {
          email_id: row.id,
          mode,
        });
        if (!json?.ok) {
          showToast(
            json?.error ||
              "Impossible de mettre à jour le niveau d'automatisation.",
            "error",
          );
          return;
        }
        showToast(
          mode === "draft"
            ? "Email repassé en mode brouillon."
            : "Email confié à l'autopilote.",
          "success",
        );
        onRefresh();
      } catch {
        showToast(
          "Erreur réseau en mettant à jour le niveau d'automatisation.",
          "error",
        );
      }
    };

    const handleNextAction = async () => {
      if (nextActionLabel.includes("revenus")) {
        showToast("Demande de revenus générée (simulation).", "success");
        return;
      }
      if (nextActionLabel.includes("documents")) {
        showToast("Demande de documents générée (simulation).", "success");
        return;
      }
      if (nextActionLabel.includes("brouillon")) {
        try {
          const json = await postJson("/api/emails/generate-draft", {
            email_id: row.id,
          });
          if (!json?.ok) {
            showToast(
              json?.error ||
                "Impossible de générer un brouillon pour cet email.",
              "error",
            );
            return;
          }
          showToast("Brouillon généré avec succès.", "success");
          onRefresh();
        } catch {
          showToast(
            "Erreur réseau pendant la génération du brouillon.",
            "error",
          );
        }
        return;
      }
      if (nextActionLabel.includes("créneaux")) {
        try {
          const json = await postJson("/api/leads/generate-slots", {
            email_id: row.id,
          });
          if (!json?.ok) {
            showToast(
              json?.error || "Impossible de générer les créneaux de visite.",
              "error",
            );
            return;
          }
          showToast("Créneaux générés.", "success");
          onRefresh();
        } catch {
          showToast(
            "Erreur réseau pendant la génération des créneaux.",
            "error",
          );
        }
      }
    };

    const handleSendDraft = async () => {
      try {
        const previousStatus = row.lead_status;
        await mutateOptimisticLeadStatus(row.id, "qualifying");
        const json = await postJson("/api/emails/send-draft", {
          email_id: row.id,
        });
        if (!json?.ok) {
          await mutateOptimisticLeadStatus(row.id, previousStatus ?? null);
          showToast(
            json?.error || "Impossible d'envoyer cet email.",
            "error",
          );
          return;
        }
        showToast("Email envoyé. Statut mis à jour.", "success");
        onRefresh();
      } catch {
        showToast(
          "Erreur réseau pendant l'envoi de l'email.",
          "error",
        );
      }
    };

    const mutateOptimisticLeadStatus = async (
      emailId: string,
      newStatus: string | null,
    ) => {
      await new Promise<void>((resolve) => {
        resolve();
      });
      return newStatus;
    };

    return (
      <div className="space-y-4">
        {/* 1. Header prospect — identité uniquement, sans toggle */}
        <div className="flex flex-wrap items-start gap-3">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-100">
                {String(lead.prospect_name ?? row.from_name ?? "Prospect")}
              </p>
              <span className="rounded-full border border-blue-500/60 bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-100">
                LOCATION
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge(row.ui_status ?? null).className}`}
              >
                {statusBadge(row.ui_status ?? null).label}
              </span>
              {row.lead_score != null && (
                <span className="rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[10px] font-medium text-slate-100">
                  Score {row.lead_score}/10
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              {row.from_email ?? "Email inconnu"}
            </p>
          </div>
        </div>

        {/* 2. Prochaine action — décision immédiate */}
        <section className="rounded-lg border border-sky-500/60 bg-sky-950/40 px-4 py-3 text-xs">
          <h3 className="mb-1 text-sm font-semibold text-slate-50">
            Prochaine action
          </h3>
          <p className="mb-2 text-[11px] text-slate-200">
            {nextActionLabel.includes("revenus") &&
              "L'IA n'a pas détecté de revenus. Demandez les informations nécessaires pour évaluer la solvabilité."}
            {nextActionLabel.includes("documents") &&
              "Certains documents sont manquants. Demandez automatiquement les pièces restantes au prospect."}
            {nextActionLabel.includes("brouillon") &&
              "Générez un brouillon d'email personnalisé pour ce prospect à partir des informations collectées."}
            {nextActionLabel.includes("créneaux") &&
              "Tous les prérequis sont réunis. Proposez directement des créneaux de visite au prospect."}
          </p>
          <button
            type="button"
            onClick={handleNextAction}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold shadow ${
              nextActionLabel.includes("Proposer")
                ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                : "bg-sky-500 text-slate-950 hover:bg-sky-400"
            }`}
          >
            <span>{nextActionLabel.split(" ")[0]}</span>
            <span>{nextActionLabel.split(" ").slice(1).join(" ")}</span>
          </button>
        </section>

        {/* 3. Réponse IA — avec toggle Brouillon/Autopilote déplacé ici */}
        <section className="rounded-lg border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">
              Réponse IA
            </h3>
            <div className="rounded-full border border-slate-700 bg-slate-900/80 p-0.5 text-[10px]">
              <div className="flex h-7 overflow-hidden rounded-full">
                <button
                  type="button"
                  onClick={() => toggleAutomation("draft")}
                  className={`flex-1 px-2.5 text-[10px] font-medium ${
                    automationMode === "draft"
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-200 hover:bg-slate-800/80"
                  }`}
                >
                  📝 Brouillon
                </button>
                <button
                  type="button"
                  onClick={() => toggleAutomation("autopilot")}
                  className={`flex-1 px-2.5 text-[10px] font-medium ${
                    automationMode === "autopilot"
                      ? "bg-emerald-500 text-slate-950"
                      : "text-slate-200 hover:bg-slate-800/80"
                  }`}
                >
                  🚀 Autopilote
                </button>
              </div>
            </div>
          </div>
          {row.ai_reply ? (
            <>
              <div className="mb-2 max-h-56 overflow-y-auto rounded-md border border-slate-800 bg-slate-950/90 p-3 text-xs text-slate-100">
                <p className="whitespace-pre-wrap">{row.ai_reply}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSendDraft}
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow hover:bg-emerald-400"
                >
                  <span>✓</span>
                  <span>Approuver &amp; envoyer</span>
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-900"
                >
                  <span>✏️</span>
                  <span>Modifier le brouillon</span>
                </button>
                {automationMode === "autopilot" && (
                  <span className="inline-flex items-center rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-[10px] text-emerald-100">
                    Envoyé automatiquement en mode Autopilote
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              Aucun brouillon disponible. Cliquez sur{" "}
              <span className="font-semibold">Générer un brouillon</span> dans la carte
              &quot;Prochaine action&quot; pour pré-rédiger la réponse.
            </p>
          )}
        </section>

        {/* 4. Solvabilité */}
        <section
          className={`rounded-lg border px-4 py-3 text-xs shadow-inner ${solvableBg}`}
        >
          <div className="mb-2 flex items-center justify-between">
            <p className={`text-sm font-semibold ${solvableAccent}`}>
              💰 Solvabilité
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <span className="text-slate-400">Revenus</span>
            <span className="text-slate-100">
              {monthlyIncome != null ? `${monthlyIncome.toLocaleString()} € / mois` : "—"}
            </span>
            <span className="text-slate-400">Loyer estimé</span>
            <span className="text-slate-100">
              {rent != null
                ? `${rent.toLocaleString()} € × 3 = ${(rent * 3).toLocaleString()} €`
                : "—"}
            </span>
            <span className="text-slate-400">Ratio</span>
            <span className="text-slate-100">
              {ratio != null ? ratio.toFixed(1) : "—"}x{" "}
              <span className="text-slate-400">(règle agence : 3x)</span>
            </span>
          </div>
          <div className="mt-2">
            {eligible === true && (
              <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
                ✅ ÉLIGIBLE
              </span>
            )}
            {eligible === false && (
              <span className="inline-flex items-center rounded-full bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-100">
                ❌ NON ÉLIGIBLE
              </span>
            )}
            {eligible == null && (
              <span className="text-[11px] text-slate-400">
                Informations incomplètes pour évaluer la solvabilité.
              </span>
            )}
          </div>
        </section>

        {/* 5. Fiche prospect — sans email (déjà dans le header) */}
        <section className="rounded-lg border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs">
          <h3 className="mb-2 text-sm font-semibold text-slate-100">
            Fiche prospect
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <span className="text-slate-400">Téléphone</span>
            <span className="text-slate-100">
              {String(lead.prospect_phone ?? "—")}
            </span>
            <span className="text-slate-400">Statut pro</span>
            <span className="text-slate-100">
              {String(lead.employment_status ?? "—")}
            </span>
            <span className="text-slate-400">Garant</span>
            <span className="text-slate-100">
              {(lead.has_guarantor ? "Oui" : "Non") as string}
            </span>
          </div>
        </section>

        {/* 6. Documents requis — masqués si revenus pas encore connus */}
        {row.ui_next_action !== "ask_income" && (
          <section className="rounded-lg border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">
              Documents requis
            </h3>
            <ul className="space-y-1">
              {docs.map((doc) => {
                const isMissing = missingInfo.some((m) =>
                  m.toLowerCase().includes(String(doc).toLowerCase().slice(0, 4)),
                );
                const label = isMissing ? "Manquant" : "Reçu";
                const icon = isMissing ? "❌" : "✅";
                const color = isMissing ? "text-red-200" : "text-emerald-200";
                return (
                  <li
                    key={doc}
                    className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/80 px-3 py-1.5"
                  >
                    <span className="text-slate-200">{doc}</span>
                    <span className={`inline-flex items-center gap-1 text-[11px] ${color}`}>
                      <span>{icon}</span>
                      <span>{label}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 7. Créneaux de visite — visible uniquement quand c'est la prochaine étape */}
        {row.ui_next_action === "propose_slots" && (
          <section className="rounded-lg border border-slate-800 bg-slate-950/80 px-4 py-3 text-xs">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">
              Créneaux de visite
            </h3>
            <p className="mb-2 text-[11px] text-slate-400">
              Proposez automatiquement des créneaux optimisés en fonction de votre disponibilité.
            </p>
            <button
              type="button"
              onClick={async () => {
                try {
                  const json = await postJson("/api/leads/generate-slots", {
                    email_id: row.id,
                  });
                  if (!json?.ok) {
                    showToast(
                      json?.error || "Impossible de générer les créneaux de visite.",
                      "error",
                    );
                    return;
                  }
                  showToast("Créneaux générés.", "success");
                  onRefresh();
                } catch {
                  showToast(
                    "Erreur réseau pendant la génération des créneaux.",
                    "error",
                  );
                }
              }}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-900 shadow hover:bg-white"
            >
              <span>📅</span>
              <span>Générer des créneaux</span>
            </button>
            <p className="mt-2 text-[11px] text-slate-500">
              Une fois les créneaux générés, ils apparaîtront ici. Vous pourrez ajuster les
              horaires puis envoyer la proposition par email.
            </p>
            <button
              type="button"
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-900"
            >
              <span>📨</span>
              <span>Envoyer la proposition</span>
            </button>
          </section>
        )}

        {/* 8. Email source */}
        <EmailSourceCard row={row} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        Ce type d&apos;email n&apos;a pas encore de panneau dédié. Le contenu source est
        disponible ci-dessous.
      </p>
      <EmailSourceCard row={row} />
    </div>
  );
}

function EmailSourceCard({ row }: { row: EmailRow }) {
  const [open, setOpen] = useState(false);
  const hasContent = !!(row.snippet?.trim() || row.subject?.trim());

  return (
    <section className="rounded-lg border border-slate-800 bg-slate-950/80">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-2 text-xs font-medium text-slate-100"
      >
        <span>Email source</span>
        <span className="text-[11px] text-slate-400">
          {open ? "Afficher moins ▲" : "Afficher le contenu ▼"}
        </span>
      </button>
      {open && (
        <div className="border-t border-slate-800 px-4 py-3 text-xs text-slate-100">
          <div className="mb-2">
            <span className="font-semibold text-slate-300">Sujet&nbsp;:</span>{" "}
            <span className="text-slate-100">{row.subject ?? "—"}</span>
          </div>
          <p className="mb-2 text-[11px] text-slate-300">
            {row.snippet ?? "Aucun aperçu disponible."}
          </p>
          {!hasContent && (
            <div className="mt-3 rounded-md border border-amber-500/60 bg-amber-900/40 p-3 text-xs text-amber-50">
              <p className="font-semibold">
                🟠 Token expiré — Reconnectez votre boîte mail
              </p>
              <p className="mt-1 text-[11px]">
                Pour récupérer le corps complet de l&apos;email, reconnectez votre compte depuis
                les paramètres.
              </p>
              <a
                href="/settings"
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-amber-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 hover:bg-amber-300"
              >
                <span>Ouvrir les paramètres</span>
              </a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}