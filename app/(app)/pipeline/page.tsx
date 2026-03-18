"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import type { ProspectKanbanRow } from "@/app/api/pipeline/list/route";

// ── Types ─────────────────────────────────────────────────────────────────────

type Property = { id: string; title: string | null; name: string | null };

// ── Constants ─────────────────────────────────────────────────────────────────

const ETAPES: { key: string; label: string; color: string; bg: string; border: string }[] = [
  { key: "NEW",              label: "Nouveau",         color: "#6366f1", bg: "#eef2ff", border: "#c7d2fe" },
  { key: "QUALIFICATION",    label: "Qualification",   color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  { key: "VISITE_PROPOSEE",  label: "Visite proposée", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  { key: "VISITE_CONFIRMEE", label: "Visite confirmée",color: "#2563eb", bg: "#dbeafe", border: "#93c5fd" },
  { key: "DOSSIER_DEMANDE",  label: "Dossier demandé", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  { key: "DOSSIER_RECU",     label: "Dossier reçu",   color: "#16a34a", bg: "#f0fdf4", border: "#86efac" },
  { key: "VALIDE",           label: "Validé ✓",        color: "#15803d", bg: "#dcfce7", border: "#4ade80" },
  { key: "REFUSE",           label: "Refusé",          color: "#dc2626", bg: "#fee2e2", border: "#fca5a5" },
];

const ETAPE_MAP = Object.fromEntries(ETAPES.map((e) => [e.key, e]));

// ── Helpers ───────────────────────────────────────────────────────────────────

const fetcherJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text); } catch { json = {}; }
  if (!res.ok || json?.error) throw new Error(json?.error || "Erreur réseau");
  return json as T;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `Il y a ${mins}min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Il y a ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `Il y a ${days}j`;
}

function ratioLabel(ratio: number | null): { text: string; color: string } | null {
  if (ratio === null || ratio === undefined) return null;
  if (ratio >= 3) return { text: `${ratio.toFixed(1)}x ✓`, color: "#16a34a" };
  if (ratio >= 2) return { text: `${ratio.toFixed(1)}x ⚠`, color: "#d97706" };
  return { text: `${ratio.toFixed(1)}x ✗`, color: "#dc2626" };
}

function situationBadge(sit: string | null): string | null {
  if (!sit) return null;
  const s = sit.toLowerCase();
  if (s.includes("cdi")) return "CDI";
  if (s.includes("cdd")) return "CDD";
  if (s.includes("etud") || s.includes("étud")) return "Étudiant";
  if (s.includes("independ") || s.includes("indépend") || s.includes("auto")) return "Indépendant";
  if (s.includes("retraite") || s.includes("retraité")) return "Retraité";
  return null;
}

// ── ProspectCard ──────────────────────────────────────────────────────────────

function ProspectCard({
  prospect,
  onClick,
}: {
  prospect: ProspectKanbanRow;
  onClick: (id: string) => void;
}) {
  const displayName = prospect.nom
    ? [prospect.nom, prospect.prenom].filter(Boolean).join(" ")
    : prospect.email;

  const ratioInfo = ratioLabel(prospect.ratio);
  const badge = situationBadge(prospect.situation_pro);
  const etape = ETAPE_MAP[prospect.etape_process];

  return (
    <button
      onClick={() => onClick(prospect.last_email_id ?? prospect.id)}
      className="w-full text-left bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all duration-150 group"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-1 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-700">
            {displayName}
          </p>
          {prospect.nom && (
            <p className="text-xs text-slate-400 truncate">{prospect.email}</p>
          )}
        </div>
        {prospect.is_urgent && (
          <span title="Sans réponse &gt;48h" className="text-base leading-none flex-shrink-0">🔴</span>
        )}
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap gap-1 mb-2">
        {badge && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
            {badge}
          </span>
        )}
        {ratioInfo && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
            style={{ backgroundColor: ratioInfo.color + "18", color: ratioInfo.color }}
          >
            {ratioInfo.text}
          </span>
        )}
        {prospect.garant && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">
            Garant
          </span>
        )}
        {prospect.dossier_complet && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-50 text-green-700">
            Dossier complet
          </span>
        )}
      </div>

      {/* Bien visé */}
      {prospect.property_title && (
        <p className="text-xs text-slate-500 mb-1 truncate">
          🏠 {prospect.property_title}
          {prospect.property_rent && (
            <span className="ml-1 text-slate-400">
              — {prospect.property_rent.toLocaleString("fr-FR")} €/mois
            </span>
          )}
        </p>
      )}

      {/* Footer row */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-100">
        <span className="text-[10px] text-slate-400">
          {timeAgo(prospect.last_email_at)}
        </span>
        <span className="text-[10px] text-slate-400">
          {prospect.email_count} email{prospect.email_count !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

function KanbanColumn({
  etape,
  prospects,
  onCardClick,
}: {
  etape: (typeof ETAPES)[0];
  prospects: ProspectKanbanRow[];
  onCardClick: (id: string) => void;
}) {
  return (
    <div className="flex-shrink-0 w-64 flex flex-col">
      {/* Column header */}
      <div
        className="flex items-center justify-between px-3 py-2 rounded-t-xl mb-2"
        style={{ backgroundColor: etape.bg, borderBottom: `2px solid ${etape.border}` }}
      >
        <span className="text-xs font-bold" style={{ color: etape.color }}>
          {etape.label}
        </span>
        <span
          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
          style={{ backgroundColor: etape.color, color: "#fff" }}
        >
          {prospects.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 min-h-[80px]">
        {prospects.length === 0 ? (
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center">
            <p className="text-xs text-slate-300">Aucun prospect</p>
          </div>
        ) : (
          prospects.map((p) => (
            <ProspectCard key={p.id} prospect={p} onClick={onCardClick} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  // Filters state
  const [filterPropertyId, setFilterPropertyId] = useState("");
  const [filterEtapes, setFilterEtapes] = useState<string[]>([]);
  const [filterMinRatio, setFilterMinRatio] = useState(0);
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [etapeDropdownOpen, setEtapeDropdownOpen] = useState(false);
  const etapeDropdownRef = useRef<HTMLDivElement>(null);

  // Build API URL
  const apiUrl = useMemo(() => {
    const params = new URLSearchParams({ view: "kanban" });
    if (filterPropertyId) params.set("propertyId", filterPropertyId);
    if (filterEtapes.length === 1) params.set("status", filterEtapes[0]);
    return `/api/pipeline/list?${params.toString()}`;
  }, [filterPropertyId, filterEtapes]);

  // Fetch prospects
  const { data, isLoading, mutate } = useSWR<{ prospects: ProspectKanbanRow[]; total: number }>(
    apiUrl,
    fetcherJson,
    { refreshInterval: 30000 }
  );

  // Fetch properties for filter dropdown
  const { data: propertiesData } = useSWR<{ properties: Property[] }>(
    "/api/properties",
    fetcherJson
  );

  // Close etape dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (etapeDropdownRef.current && !etapeDropdownRef.current.contains(e.target as Node)) {
        setEtapeDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Navigate to email detail
  const handleCardClick = (emailId: string) => {
    window.location.href = `/pipeline?emailId=${emailId}`;
  };

  // Client-side filter: multiple etapes + minRatio + urgentOnly
  const allProspects = data?.prospects ?? [];

  const filteredProspects = useMemo(() => {
    return allProspects.filter((p) => {
      if (filterEtapes.length > 1 && !filterEtapes.includes(p.etape_process)) return false;
      if (filterMinRatio > 0 && (p.ratio === null || p.ratio < filterMinRatio)) return false;
      if (filterUrgentOnly && !p.is_urgent) return false;
      return true;
    });
  }, [allProspects, filterEtapes, filterMinRatio, filterUrgentOnly]);

  // Group by etape
  const byEtape = useMemo(() => {
    const map = new Map<string, ProspectKanbanRow[]>();
    ETAPES.forEach((e) => map.set(e.key, []));
    filteredProspects.forEach((p) => {
      const key = p.etape_process ?? "NEW";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    });
    return map;
  }, [filteredProspects]);

  const urgentCount = allProspects.filter((p) => p.is_urgent).length;
  const properties = propertiesData?.properties ?? [];

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Pipeline locatif</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {filteredProspects.length} prospect{filteredProspects.length !== 1 ? "s" : ""}
              {urgentCount > 0 && (
                <span className="ml-2 text-red-500 font-medium">
                  · {urgentCount} urgent{urgentCount !== 1 ? "s" : ""} 🔴
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => mutate()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Actualiser
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Bien */}
          <select
            value={filterPropertyId}
            onChange={(e) => setFilterPropertyId(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">Tous les biens</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title ?? p.name ?? p.id}
              </option>
            ))}
          </select>

          {/* Étapes multiselect */}
          <div className="relative" ref={etapeDropdownRef}>
            <button
              onClick={() => setEtapeDropdownOpen((v) => !v)}
              className="flex items-center gap-1.5 text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white text-slate-700 hover:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              {filterEtapes.length === 0
                ? "Toutes les étapes"
                : `${filterEtapes.length} étape${filterEtapes.length > 1 ? "s" : ""}`}
              <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {etapeDropdownOpen && (
              <div className="absolute top-full mt-1 left-0 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[200px]">
                {ETAPES.map((e) => (
                  <label
                    key={e.key}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filterEtapes.includes(e.key)}
                      onChange={() =>
                        setFilterEtapes((prev) =>
                          prev.includes(e.key)
                            ? prev.filter((k) => k !== e.key)
                            : [...prev, e.key]
                        )
                      }
                      className="rounded"
                    />
                    <span className="text-xs text-slate-700">{e.label}</span>
                  </label>
                ))}
                {filterEtapes.length > 0 && (
                  <button
                    onClick={() => setFilterEtapes([])}
                    className="w-full text-left px-3 py-1.5 text-xs text-indigo-500 hover:bg-indigo-50 border-t border-slate-100 mt-1"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Solvabilité minimum */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Solvabilité min :</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.5}
              value={filterMinRatio}
              onChange={(e) => setFilterMinRatio(parseFloat(e.target.value))}
              className="w-24 accent-indigo-600"
            />
            <span className="text-xs font-medium text-slate-700 w-8">
              {filterMinRatio === 0 ? "—" : `${filterMinRatio}x`}
            </span>
          </div>

          {/* Urgents toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setFilterUrgentOnly((v) => !v)}
              className={`relative w-8 h-4 rounded-full transition-colors ${
                filterUrgentOnly ? "bg-red-500" : "bg-slate-300"
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${
                  filterUrgentOnly ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
            <span className="text-xs text-slate-600">Urgents seulement 🔴</span>
          </label>
        </div>
      </div>

      {/* ── Kanban Board ── */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Chargement des prospects…</p>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 px-6 py-4 min-w-max">
            {ETAPES.map((etape) => (
              <KanbanColumn
                key={etape.key}
                etape={etape}
                prospects={byEtape.get(etape.key) ?? []}
                onCardClick={handleCardClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
