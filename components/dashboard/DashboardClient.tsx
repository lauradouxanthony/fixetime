"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from "recharts";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type DashboardData = {
  metrics: {
    // Legacy
    leadsActifs: number;
    rdvSemaine: number;
    dossierComplets: number;
    tauxReponseIA: number;
    // BLOC 6 — ROI KPIs
    emailsRecusMois: number;
    leadsQualifies: number;
    visitesConfirmees: number;
    tauxEmailVisite: number;
    // Métriques IA
    tempsMoyenReponseIA: number;
    relancesAuto: number;
    heuresEconomisees: number;
    emailsTraitesIA: number;
  };
  intentions: { LOCATION: number; INFO: number; HORS_SUJET: number };
  graph30: { label: string; date: string; leads: number; rdv: number }[];
  actionsRequises: {
    id: string;
    sender: string | null;
    subject: string | null;
    received_at: string | null;
    is_urgent: boolean | null;
    summary: string | null;
  }[];
  prochainRdv: {
    id: string;
    title: string;
    start_time: string;
    end_time: string;
  }[];
  recentActivity: {
    id: string;
    sender: string | null;
    subject: string | null;
    decision: string | null;
    category: string | null;
    received_at: string | null;
    is_urgent: boolean | null;
  }[];
};

/* ── ANIMATED COUNTER ── */
function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (target === 0) { setValue(0); return; }
    cancelAnimationFrame(rafRef.current);
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return value;
}

/* ── METRIC CARD ── */
function MetricCard({
  label, target, unit, accent, sub, icon,
}: {
  label: string;
  target: number;
  unit?: string;
  accent: string;
  sub?: string;
  icon: string;
}) {
  const value = useCountUp(target);
  return (
    <div
      className="rounded-xl border p-4 bg-white animate-fade-in hover-lift"
      style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium" style={{ color: "rgb(100 116 139)" }}>{label}</span>
        <span className="text-base">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-3xl font-bold tabular-nums" style={{ color: accent }}>{value}</span>
        {unit && <span className="text-sm font-medium" style={{ color: "rgb(100 116 139)" }}>{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-xs" style={{ color: "rgb(148 163 184)" }}>{sub}</div>}
    </div>
  );
}

/* ── DONUT ── */
const DONUT_COLORS = ["rgb(59 130 246)", "rgb(100 116 139)", "rgb(203 213 225)"];
const DONUT_LABELS = ["Location", "Info", "Hors sujet"];

/* ── CUSTOM TOOLTIP ── */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border px-3 py-2 text-xs shadow-lg" style={{ background: "white", borderColor: "rgb(226 232 240)" }}>
      <p className="font-medium mb-1" style={{ color: "rgb(30 41 59)" }}>{label}</p>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.dataKey === "leads" ? "Leads" : "RDV"}: <strong>{p.value}</strong>
        </p>
      ))}
    </div>
  );
}

/* ── AVATAR ── */
function Avatar({ name }: { name: string | null }) {
  const clean = (name || "").replace(/<.*>/, "").trim();
  const initials = clean.split(/[\s@.]+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  const hue = [...clean].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 text-white" style={{ background: `hsl(${hue},55%,52%)` }}>
      {initials}
    </div>
  );
}

/* ── MAIN COMPONENT ── */
export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [period, setPeriod] = useState<"7d" | "30d">("30d");
  const [loadingTimeseries, setLoadingTimeseries] = useState(false);
  const [chartData, setChartData] = useState<{ date: string; prospects: number; qualified: number; booked: number }[]>([]);
  const { toast } = useToast();

  const fetchData = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard/summary", { cache: "no-store" });
      if (!r.ok) throw new Error("fetch error");
      const json = await r.json();
      setData(json);
      setLastUpdated(new Date());
    } catch {
      toast("Impossible de rafraîchir le dashboard", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  /* ── LOADING STATE ── */
  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="p-6 space-y-6 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border p-4 bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
                <SkeletonCard className="border-0 p-0 shadow-none" />
              </div>
            ))}
          </div>
          <div className="rounded-xl border bg-white p-4" style={{ borderColor: "rgb(226 232 240)" }}>
            <div className="h-16 animate-pulse rounded-lg" style={{ background: "rgb(241 245 249)" }} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-xl border bg-white p-4" style={{ borderColor: "rgb(226 232 240)" }}>
              <div className="h-48 animate-pulse rounded-lg" style={{ background: "rgb(241 245 249)" }} />
            </div>
            <div className="rounded-xl border bg-white p-4" style={{ borderColor: "rgb(226 232 240)" }}>
              <div className="h-48 animate-pulse rounded-lg" style={{ background: "rgb(241 245 249)" }} />
            </div>
          </div>
        </div>
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

  const { metrics, intentions, graph30, actionsRequises, prochainRdv, recentActivity } = data;

  const donutData = [
    { name: "Location", value: intentions.LOCATION },
    { name: "Info", value: intentions.INFO },
    { name: "Hors sujet", value: intentions.HORS_SUJET },
  ];
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-6 space-y-6 max-w-5xl mx-auto">

        {/* ── HEADER ── */}
        <div className="flex items-center justify-between animate-fade-in">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "rgb(30 41 59)" }}>Tableau de bord</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgb(100 116 139)" }}>
              30 derniers jours
              {lastUpdated && (
                <span className="ml-2" style={{ color: "rgb(148 163 184)" }}>
                  · Mis à jour {lastUpdated.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
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

        {/* ── LIGNE 1 : KPIs ROI ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 stagger-children">
          <MetricCard
            label="Emails reçus ce mois"
            target={metrics.emailsRecusMois}
            icon="📬"
            accent="rgb(79 70 229)"
            sub="tous types confondus"
          />
          <MetricCard
            label="Leads qualifiés"
            target={metrics.leadsQualifies}
            icon="✅"
            accent="rgb(22 163 74)"
            sub="situation + revenus renseignés"
          />
          <MetricCard
            label="Visites confirmées"
            target={metrics.visitesConfirmees}
            icon="🏠"
            accent="rgb(2 132 199)"
            sub="30 derniers jours"
          />
          <MetricCard
            label="Taux email → visite"
            target={metrics.tauxEmailVisite}
            unit="%"
            icon="📈"
            accent="rgb(234 88 12)"
            sub={`sur ${metrics.emailsRecusMois > 0 ? metrics.emailsRecusMois : "—"} emails LOCATION`}
          />
        </div>

        {/* ── LIGNE 2 : Métriques IA ── */}
        <div
          className="rounded-xl border p-4 bg-white animate-fade-in"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
        >
          <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "rgb(100 116 139)" }}>
            🤖 Performance IA
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Temps moyen réponse */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                style={{ background: "rgba(79,70,229,0.1)" }}
              >
                ⚡
              </div>
              <div>
                <div className="text-xs" style={{ color: "rgb(100 116 139)" }}>Temps moyen réponse IA</div>
                <div className="text-xl font-bold tabular-nums" style={{ color: "rgb(79 70 229)" }}>
                  {metrics.tempsMoyenReponseIA}
                  <span className="text-sm font-medium ml-1" style={{ color: "rgb(100 116 139)" }}>min</span>
                </div>
                <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>cron toutes les 5 min</div>
              </div>
            </div>
            {/* Relances auto */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                style={{ background: "rgba(22,163,74,0.1)" }}
              >
                🔁
              </div>
              <div>
                <div className="text-xs" style={{ color: "rgb(100 116 139)" }}>Relances automatiques</div>
                <div className="text-xl font-bold tabular-nums" style={{ color: "rgb(22 163 74)" }}>
                  {metrics.relancesAuto}
                  <span className="text-sm font-medium ml-1" style={{ color: "rgb(100 116 139)" }}>envoyées</span>
                </div>
                <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>30 derniers jours</div>
              </div>
            </div>
            {/* Heures économisées */}
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
                style={{ background: "rgba(234,88,12,0.1)" }}
              >
                🕐
              </div>
              <div>
                <div className="text-xs" style={{ color: "rgb(100 116 139)" }}>Heures économisées</div>
                <div className="text-xl font-bold tabular-nums" style={{ color: "rgb(234 88 12)" }}>
                  {metrics.heuresEconomisees}
                  <span className="text-sm font-medium ml-1" style={{ color: "rgb(100 116 139)" }}>h</span>
                </div>
                <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                  {metrics.emailsTraitesIA} emails traités × 5 min
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── GRAPHIQUE + DONUT ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Area Chart 30j LOCATION */}
          <div
            className="lg:col-span-2 rounded-xl border p-5 bg-white animate-slide-up"
            style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>
                  Leads Location — 30 jours
                </div>
                <div className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                  Demandes reçues vs RDV générés
                </div>
              </div>
              <div className="flex items-center gap-4 text-xs" style={{ color: "rgb(100 116 139)" }}>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-1.5 rounded-full inline-block" style={{ background: "rgb(199 210 254)" }} />
                  Leads
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-1.5 rounded-full inline-block" style={{ background: "rgb(79 70 229)" }} />
                  RDV
                </span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={graph30} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(199 210 254)" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="rgb(199 210 254)" stopOpacity={0.0} />
                  </linearGradient>
                  <linearGradient id="rdvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="rgb(79 70 229)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="rgb(79 70 229)" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(241 245 249)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "rgb(148 163 184)" }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "rgb(148 163 184)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="leads"
                  stroke="rgb(165 180 252)"
                  strokeWidth={2}
                  fill="url(#leadsGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "rgb(165 180 252)" }}
                />
                <Area
                  type="monotone"
                  dataKey="rdv"
                  stroke="rgb(79 70 229)"
                  strokeWidth={2}
                  fill="url(#rdvGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "rgb(79 70 229)" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

      {/* EMPTY STATE ou CHARTS + FUNNEL + FEED */}
      {(data?.metrics?.leadsActifs ?? 0) === 0 && (data?.metrics?.emailsRecusMois ?? 0) === 0 ? (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8">
          <h3 className="text-lg font-semibold text-white">Aucune donnée sur la période</h3>
          <p className="mt-2 text-sm text-slate-400">
            Connectez Gmail/Outlook puis cliquez sur Synchroniser.
          </p>
          <a
            href="/emails"
            className="inline-block mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Aller aux emails →
          </a>
        </section>
      ) : (
        <>
      {/* CHARTS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Line chart: Prospects vs Qualified vs Booked */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-white">Évolution quotidienne</h3>
            <div className="flex gap-2">
              <button
                onClick={() => setPeriod("7d")}
                className={`px-2 py-1 rounded text-xs ${period === "7d" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
              >
                7j
              </button>
              <button
                onClick={() => setPeriod("30d")}
                className={`px-2 py-1 rounded text-xs ${period === "30d" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
              >
                30j
              </button>
            </div>
          </div>
          {loadingTimeseries ? (
            <div className="h-64 flex items-center justify-center text-slate-500 text-sm">Chargement...</div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0F172A", border: "1px solid #334155", borderRadius: "8px", padding: "12px" }}
                  labelStyle={{ color: "#F3F4F6", fontWeight: 600, marginBottom: "8px" }}
                  itemStyle={{ color: "#E2E8F0", padding: "4px 0" }}
                />
                <Legend 
                  wrapperStyle={{ paddingTop: "20px" }}
                  iconType="line"
                  iconSize={12}
                />
                <Line type="monotone" dataKey="prospects" stroke="#60A5FA" strokeWidth={2} name="Prospects" />
                <Line type="monotone" dataKey="qualified" stroke="#FBBF24" strokeWidth={2} name="Qualifiés" />
                <Line type="monotone" dataKey="booked" stroke="#10B981" strokeWidth={2} name="Visites" />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-500 text-sm">Aucune donnée disponible</div>
          )}
        </div>

          {/* Donut intentions 7j */}
          <div
            className="rounded-xl border p-5 bg-white animate-slide-up"
            style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", animationDelay: "80ms" }}
          >
            <div className="text-sm font-semibold mb-4" style={{ color: "rgb(30 41 59)" }}>
              Intentions — 7 jours
            </div>
            {donutTotal === 0 ? (
              <div className="h-40 flex items-center justify-center text-sm" style={{ color: "rgb(148 163 184)" }}>
                Aucune donnée
              </div>
            ) : (
              <>
                <div className="flex justify-center">
                  <div className="relative">
                    <ResponsiveContainer width={120} height={120}>
                      <PieChart>
                        <Pie
                          data={donutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={36}
                          outerRadius={52}
                          dataKey="value"
                          strokeWidth={0}
                          paddingAngle={2}
                        >
                          {donutData.map((_, i) => (
                            <Cell key={i} fill={DONUT_COLORS[i]} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-lg font-bold" style={{ color: "rgb(30 41 59)" }}>{donutTotal}</span>
                      <span className="text-[9px]" style={{ color: "rgb(148 163 184)" }}>emails</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-2 mt-3">
                  {donutData.map((d, i) => (
                    <div key={d.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i] }} />
                        <span className="text-xs" style={{ color: "rgb(71 85 105)" }}>{DONUT_LABELS[i]}</span>
                      </div>
                      <span className="text-xs font-semibold" style={{ color: "rgb(30 41 59)" }}>{d.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── ACTIONS REQUISES + PROCHAINS RDV ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Actions requises */}
          <div
            className="rounded-xl border bg-white animate-slide-up"
            style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", animationDelay: "120ms" }}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgb(226 232 240)" }}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>⚡ Actions requises</span>
                {actionsRequises.length > 0 && (
                  <span
                    className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                    style={{ background: "rgba(220,38,38,0.1)", color: "rgb(220 38 38)" }}
                  >
                    {actionsRequises.length}
                  </span>
                )}
              </div>
              <Link href="/emails" className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>
                Traiter →
              </Link>
            </div>
            <div className="divide-y" style={{ borderColor: "rgb(226 232 240)" }}>
              {actionsRequises.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-2xl mb-1">✅</div>
                  <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Aucune action requise</div>
                </div>
              ) : (
                actionsRequises.map((e) => {
                  const hoursAgo = e.received_at
                    ? Math.round((Date.now() - new Date(e.received_at).getTime()) / 3_600_000)
                    : null;
                  return (
                    <Link
                      key={e.id}
                      href="/emails"
                      className="px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors"
                    >
                      <Avatar name={e.sender} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                          {e.subject || "(Sans objet)"}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          {e.is_urgent && (
                            <span className="text-xs font-medium" style={{ color: "rgb(220 38 38)" }}>🔴 Urgent</span>
                          )}
                          {hoursAgo !== null && (
                            <span
                              className="text-xs"
                              style={{ color: hoursAgo > 24 ? "rgb(220 38 38)" : "rgb(148 163 184)" }}
                            >
                              {hoursAgo > 24
                                ? `⚠️ ${Math.floor(hoursAgo / 24)}j sans réponse`
                                : `Il y a ${hoursAgo}h`}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                        style={{ background: "rgba(234,88,12,0.1)", color: "rgb(194 65 12)" }}
                      >
                        À traiter
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>

          {/* Prochains RDV */}
          <div
            className="rounded-xl border bg-white animate-slide-up"
            style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", animationDelay: "160ms" }}
          >
            <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgb(226 232 240)" }}>
              <span className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>📅 Prochains RDV</span>
              <Link href="/calendar" className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>Calendrier →</Link>
            </div>
            <div>
              {prochainRdv.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <div className="text-2xl mb-2">📅</div>
                  <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Aucun RDV à venir</div>
                </div>
              ) : (
                prochainRdv.map((m) => {
                  const start = new Date(m.start_time);
                  const end = new Date(m.end_time);
                  const now = new Date();
                  const isNow = start <= now && now <= end;
                  const isToday = start.toDateString() === now.toDateString();
                  return (
                    <div
                      key={m.id}
                      className="px-4 py-3 flex items-center gap-3 border-b last:border-b-0"
                      style={{ borderColor: "rgb(226 232 240)" }}
                    >
                      <div
                        className="w-1 h-10 rounded-full flex-shrink-0"
                        style={{
                          background: isNow ? "rgb(22 163 74)" : isToday ? "rgb(79 70 229)" : "rgb(148 163 184)",
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                          {m.title}
                        </div>
                        <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                          {isToday
                            ? "Aujourd'hui"
                            : start.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
                          {" · "}
                          {start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                          {" – "}
                          {end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                      {isNow && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "rgb(240 253 244)", color: "rgb(22 163 74)" }}
                        >
                          En cours
                        </span>
                      )}
                      {isToday && !isNow && (
                        <span
                          className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                          style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)" }}
                        >
                          Aujourd&apos;hui
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* ── ACTIVITÉ RÉCENTE ── */}
        <div
          className="rounded-xl border bg-white animate-slide-up"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)", animationDelay: "200ms" }}
        >
          <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "rgb(226 232 240)" }}>
            <span className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>Activité récente</span>
            <Link href="/emails" className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>Voir tout →</Link>
          </div>
          <div className="divide-y" style={{ borderColor: "rgb(226 232 240)" }}>
            {recentActivity.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: "rgb(148 163 184)" }}>
                Aucune activité récente
              </div>
            ) : (
              recentActivity.map((e) => {
                const cat = (e.category || "").toUpperCase();
                const catStyle = cat === "LOCATION"
                  ? { label: "Location", color: "rgb(37 99 235)", bg: "rgba(59,130,246,0.1)" }
                  : cat === "INFO"
                  ? { label: "Info", color: "rgb(71 85 105)", bg: "rgba(100,116,139,0.1)" }
                  : { label: "Hors sujet", color: "rgb(148 163 184)", bg: "rgba(148,163,184,0.1)" };
                return (
                  <div key={e.id} className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors">
                    <Avatar name={e.sender} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                        {e.subject || "(Sans objet)"}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: catStyle.bg, color: catStyle.color }}
                        >
                          {catStyle.label}
                        </span>
                        {e.is_urgent && (
                          <span className="text-xs font-medium" style={{ color: "rgb(220 38 38)" }}>
                            🔴 Urgent
                          </span>
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

        </>
      )}

      </div>
    </div>
  );
}
