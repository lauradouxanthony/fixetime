"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type DashboardData = {
  metrics: {
    emailsTraites: number;
    rdvPris: number;
    heuresSaved: number;
    tempsReponseMoyen: number;
  };
  intentions: { LOCATION: number; INFO: number; HORS_SUJET: number };
  graph7d: { label: string; date: string; emails: number; rdv: number }[];
  recentActivity: {
    id: string;
    sender: string | null;
    subject: string | null;
    decision: string | null;
    category: string | null;
    received_at: string | null;
    is_urgent: boolean | null;
  }[];
  nextMeetings: {
    id: string;
    title: string;
    start_time: string;
    end_time: string;
  }[];
};

/* ── MINI GRAPHIQUE BARRES (CSS pur, pas de lib) ── */
function BarChart({ data }: { data: { label: string; emails: number; rdv: number }[] }) {
  const maxVal = Math.max(...data.flatMap((d) => [d.emails, d.rdv]), 1);
  return (
    <div className="flex items-end gap-1 h-28">
      {data.map((day, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
          <div className="w-full flex flex-col items-center gap-0.5" style={{ height: "96px" }}>
            {/* Emails bar */}
            <div className="w-full flex items-end justify-center" style={{ height: "48px" }}>
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${Math.round((day.emails / maxVal) * 44)}px`,
                  background: "rgb(199 210 254)", // indigo-200
                  minHeight: day.emails > 0 ? "2px" : "0",
                }}
                title={`${day.emails} emails`}
              />
            </div>
            {/* RDV bar */}
            <div className="w-full flex items-end justify-center" style={{ height: "48px" }}>
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${Math.round((day.rdv / maxVal) * 44)}px`,
                  background: "rgb(79 70 229)", // indigo-600
                  minHeight: day.rdv > 0 ? "2px" : "0",
                }}
                title={`${day.rdv} RDV`}
              />
            </div>
          </div>
          <div className="text-[10px] text-center" style={{ color: "rgb(148 163 184)" }}>
            {day.label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── DONUT INTENTIONS (SVG pur) ── */
function DonutChart({ data }: { data: { LOCATION: number; INFO: number; HORS_SUJET: number } }) {
  const total = data.LOCATION + data.INFO + data.HORS_SUJET;
  if (total === 0) return (
    <div className="text-xs text-center" style={{ color: "rgb(148 163 184)" }}>Aucune donnée</div>
  );

  const segments = [
    { label: "Location", value: data.LOCATION, color: "rgb(59 130 246)" },
    { label: "Info", value: data.INFO, color: "rgb(100 116 139)" },
    { label: "Hors sujet", value: data.HORS_SUJET, color: "rgb(203 213 225)" },
  ];

  // SVG donut simple
  const r = 40;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgb(241 245 249)" strokeWidth="18" />
        {segments.map((seg, i) => {
          const frac = seg.value / total;
          const dash = frac * circumference;
          const gap = circumference - dash;
          const thisOffset = -offset * circumference + circumference * 0.25;
          offset += frac;
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="18"
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={thisOffset}
              style={{ transition: "stroke-dasharray 0.5s" }}
            />
          );
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="600" fill="rgb(30 41 59)">{total}</text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="9" fill="rgb(100 116 139)">emails</text>
      </svg>
      <div className="space-y-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: seg.color }} />
            <div className="text-xs" style={{ color: "rgb(71 85 105)" }}>
              {seg.label}
              <span className="ml-1.5 font-semibold" style={{ color: "rgb(30 41 59)" }}>{seg.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── STAT CARD ── */
function MetricCard({
  label,
  value,
  unit,
  accent,
  sub,
}: {
  label: string;
  value: string | number;
  unit?: string;
  accent: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl border p-4 bg-white"
      style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
    >
      <div className="text-xs font-medium mb-2" style={{ color: "rgb(100 116 139)" }}>{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold" style={{ color: accent }}>{value}</span>
        {unit && <span className="text-sm" style={{ color: "rgb(100 116 139)" }}>{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-xs" style={{ color: "rgb(148 163 184)" }}>{sub}</div>}
    </div>
  );
}

/* ── MAIN COMPONENT ── */
export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/dashboard/summary", { cache: "no-store" })
      .then((r) => r.json())
      .then((json) => { setData(json); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "rgb(241 245 249)" }} />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-sm" style={{ color: "rgb(100 116 139)" }}>
        Impossible de charger le dashboard.
      </div>
    );
  }

  const { metrics, intentions, graph7d, recentActivity, nextMeetings } = data;

  const intentionDecision = (cat: string | null) => {
    const c = (cat || "").toUpperCase();
    if (c === "LOCATION") return { label: "Location", color: "rgb(37 99 235)", bg: "rgba(59,130,246,0.1)" };
    if (c === "INFO") return { label: "Info", color: "rgb(71 85 105)", bg: "rgba(100,116,139,0.1)" };
    return { label: "Hors sujet", color: "rgb(51 65 85)", bg: "rgba(15,23,42,0.08)" };
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">

      {/* ── TITRE ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "rgb(30 41 59)" }}>Tableau de bord</h1>
          <p className="text-sm mt-0.5" style={{ color: "rgb(100 116 139)" }}>
            7 derniers jours · Mis à jour automatiquement
          </p>
        </div>
        <Link
          href="/emails"
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ background: "rgb(79 70 229)" }}
        >
          Voir le pipeline →
        </Link>
      </div>

      {/* ── MÉTRIQUES ROI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Emails traités"
          value={metrics.emailsTraites}
          accent="rgb(79 70 229)"
          sub="7 derniers jours"
        />
        <MetricCard
          label="RDV générés"
          value={metrics.rdvPris}
          accent="rgb(22 163 74)"
          sub="visites confirmées"
        />
        <MetricCard
          label="Heures économisées"
          value={metrics.heuresSaved}
          unit="h"
          accent="rgb(234 88 12)"
          sub="temps traitement IA"
        />
        <MetricCard
          label="Temps réponse moyen"
          value={metrics.tempsReponseMoyen}
          unit="min"
          accent="rgb(100 116 139)"
          sub="vs 2h manuellement"
        />
      </div>

      {/* ── GRAPHIQUE + DONUT ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Graphique 7 jours */}
        <div
          className="lg:col-span-2 rounded-xl border p-4 bg-white"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
              Emails reçus vs RDV générés
            </div>
            <div className="flex items-center gap-3 text-xs" style={{ color: "rgb(100 116 139)" }}>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "rgb(199 210 254)" }} />
                Emails
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: "rgb(79 70 229)" }} />
                RDV
              </span>
            </div>
          </div>
          <BarChart data={graph7d} />
        </div>

        {/* Donut répartition intentions */}
        <div
          className="rounded-xl border p-4 bg-white"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        >
          <div className="text-sm font-medium mb-4" style={{ color: "rgb(30 41 59)" }}>
            Répartition intentions
          </div>
          <DonutChart data={intentions} />
        </div>
      </div>

      {/* ── ACTIVITÉ RÉCENTE + RDV ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Feed activité */}
        <div
          className="rounded-xl border bg-white"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgb(226 232 240)" }}>
            <span className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>Activité récente</span>
            <Link href="/emails" className="text-xs" style={{ color: "rgb(79 70 229)" }}>Voir tout</Link>
          </div>
          <div className="divide-y" style={{ borderColor: "rgb(226 232 240)" }}>
            {recentActivity.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm" style={{ color: "rgb(148 163 184)" }}>
                Aucune activité récente
              </div>
            ) : (
              recentActivity.map((e) => {
                const intStyle = intentionDecision(e.category);
                return (
                  <div key={e.id} className="px-4 py-3 flex items-start gap-3">
                    <div
                      className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                      style={{ background: intStyle.color }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                        {e.subject || "(Sans objet)"}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                          {e.sender?.split("@")[0]}
                        </span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{ background: intStyle.bg, color: intStyle.color }}
                        >
                          {intStyle.label}
                        </span>
                        {e.is_urgent && (
                          <span className="text-xs" style={{ color: "rgb(220 38 38)" }}>Urgent</span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs flex-shrink-0" style={{ color: "rgb(148 163 184)" }}>
                      {e.received_at
                        ? new Date(e.received_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
                        : ""}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RDV du jour */}
        <div
          className="rounded-xl border bg-white"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgb(226 232 240)" }}>
            <span className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>RDV d'aujourd'hui</span>
            <Link href="/calendar" className="text-xs" style={{ color: "rgb(79 70 229)" }}>Calendrier</Link>
          </div>
          <div className="divide-y" style={{ borderColor: "rgb(226 232 240)" }}>
            {nextMeetings.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm" style={{ color: "rgb(148 163 184)" }}>
                Aucun RDV aujourd'hui
              </div>
            ) : (
              nextMeetings.map((m) => {
                const start = new Date(m.start_time);
                const end = new Date(m.end_time);
                return (
                  <div key={m.id} className="px-4 py-3 flex items-center gap-3">
                    <div className="w-1 h-8 rounded-full flex-shrink-0" style={{ background: "rgb(79 70 229)" }} />
                    <div>
                      <div className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>{m.title}</div>
                      <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                        {start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} –{" "}
                        {end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
