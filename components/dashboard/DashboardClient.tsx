"use client";

import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

type RoiData = {
  period: "7d" | "30d";
  funnel: {
    prospects: number;
    qualified: number;
    slotsProposed: number;
    booked: number;
  };
  roi: {
    humanMinutes?: number;
    savedMinutes: number;
    savedEuros?: number;
    hourlyCost?: number;
    autopilotRate?: number;
    avgResponseMin?: number;
    prospects_traites?: number;
    visites_organisees?: number;
    heures_economisees?: number;
    valeur_pipeline?: number;
  };
  feed: { id: string; at: string | null; text: string; status: string; actor?: string }[];
  health?: {
    providers?: { google?: boolean; microsoft?: boolean };
    backlog?: { remaining_to_analyze?: number };
    lastActivityAt?: string | null;
    errorsLast24h?: number;
  };
  anomalies?: Array<{ key: string; count: number; sample_ids?: string[] }>;
};

type TimeseriesData = {
  points: Array<{
    date: string;
    prospects: number;
    qualified: number;
    booked: number;
    avgResponseMin: number;
  }>;
};


function fmtMin(min: number) {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${r} min`;
  if (r === 0) return `${h}h`;
  return `${h}h${String(r).padStart(2, "0")}`;
}

function formatDateTimeFR(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

function BadgePill({ label, tone }: { label: string; tone?: "neutral" | "success" | "warn" | "error" | "yellow" | "orange" }) {
  const cls =
    tone === "success"
      ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40"
      : tone === "yellow"
      ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/40"
      : tone === "orange" || tone === "warn"
      ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
      : tone === "error"
      ? "bg-red-500/20 text-red-400 border-red-500/40"
      : "bg-slate-500/20 text-slate-400 border-slate-500/40";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

const ANOMALY_LABELS: Record<string, string> = {
  booked_no_property_id: "Visites confirmées sans bien",
  slots_no_slots: "Créneaux proposés sans 3 slots",
  analyzed_no_decision: "Analysés sans décision",
  ai_reply_missing: "Réponse IA manquante",
};

const ANOMALY_FILTERS: Record<string, string> = {
  booked_no_property_id: "booked",
  slots_no_slots: "slots_proposed",
  analyzed_no_decision: "all",
  ai_reply_missing: "qualifying",
};

function anomalyLabel(key: string): string {
  return ANOMALY_LABELS[key] ?? key;
}

function anomalyFilter(key: string): string {
  return ANOMALY_FILTERS[key] ?? "all";
}

export default function DashboardPage() {
  const [period, setPeriod] = useState<"7d" | "30d">("30d");
  const [data, setData] = useState<RoiData | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTimeseries, setLoadingTimeseries] = useState(false);

  const [activity, setActivity] = useState<any[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/dashboard/roi?period=${period}`, { cache: "no-store" });
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Dashboard load error", e);
    } finally {
      setLoading(false);
    }
  };

  const loadTimeseries = async () => {
    setLoadingTimeseries(true);
    try {
      const res = await fetch(`/api/dashboard/timeseries?period=${period}`, { cache: "no-store" });
      const json = await res.json();
      setTimeseries(json);
    } catch (e) {
      console.error("Timeseries load error", e);
    } finally {
      setLoadingTimeseries(false);
    }
  };

  const loadActivity = async (cursor?: string) => {
    try {
      setLoadingActivity(true);
      const url = cursor
        ? `/api/activity?limit=20&cursor=${encodeURIComponent(cursor)}`
        : `/api/activity?limit=20`;

      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();

      if (!cursor) {
        setActivity(json.items || []);
      } else {
        setActivity((prev) => [...prev, ...(json.items || [])]);
      }

      setActivityCursor(json.nextCursor || null);
    } catch (e) {
      console.error("Activity load error", e);
    } finally {
      setLoadingActivity(false);
    }
  };

  useEffect(() => {
    load();
    loadTimeseries();
    loadActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  const pct = useMemo(() => {
    if (!data) return { q: 0, s: 0, b: 0 };
    const p = Math.max(1, data.funnel.prospects);
    return {
      q: Math.round((data.funnel.qualified / p) * 100),
      s: Math.round((data.funnel.slotsProposed / p) * 100),
      b: Math.round((data.funnel.booked / p) * 100),
    };
  }, [data]);
  const conversionRate = useMemo(() => {
    if (!data) return 0;
    if (data.funnel.prospects === 0) return 0;
    return Math.round((data.funnel.booked / data.funnel.prospects) * 100);
  }, [data]);

  const valeurPipeline = data?.roi.valeur_pipeline ?? 0;
  
  const autopilotRate = data?.roi.autopilotRate ?? 0;
  const avgResponse = data?.roi.avgResponseMin ?? 0;
  
  const refreshNow = async () => {
    await load();
    await loadTimeseries();
  };

  // Format dates pour les charts
  const chartData = useMemo(() => {
    if (!timeseries?.points) return [];
    return timeseries.points.map((p) => ({
      date: new Date(p.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      prospects: p.prospects,
      qualified: p.qualified,
      booked: p.booked,
      avgResponseMin: p.avgResponseMin,
    }));
  }, [timeseries]);


  const formatDuration = fmtMin;

  return (
    <div className="space-y-6 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 -m-6 p-6 rounded-2xl">
      {/* HERO / KPI STRIP */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              Centre de commandement
            </p>
            <h2 className="mt-2 text-xl font-semibold text-white">
              Votre pipeline locatif en temps réel
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Basé sur les emails + calendrier synchronisés ({period === "7d" ? "7" : "30"} jours).
            </p>
          </div>
  
          <button
            onClick={refreshNow}
            disabled={loading}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-60"
          >
            {loading ? "Synchronisation..." : (data?.funnel?.prospects === 0 ? "Lancer la première sync" : "Synchroniser maintenant")}
          </button>
        </div>
  
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <KpiCard
            label="Prospects reçus"
            value={data?.funnel.prospects ?? 0}
            sub="sur la période"
            icon="📊"
            accentColor="blue"
          />
          <KpiCard
            label="Prospects traités"
            value={data?.roi.prospects_traites ?? 0}
            sub="lead_status défini"
            icon="✅"
            accentColor="green"
          />
          <KpiCard
            label="Visites organisées"
            value={data?.roi.visites_organisees ?? data?.funnel.booked ?? 0}
            sub={`${conversionRate}% conversion`}
            icon="📅"
            accentColor="purple"
          />
          <KpiCard
            label="Valeur pipeline"
            value={`${valeurPipeline.toLocaleString("fr-FR")} €`}
            sub="loyers biens qualifiés"
            icon="💰"
            accentColor="green"
          />
          <KpiCard
            label="Taux conversion"
            value={`${conversionRate}%`}
            sub="prospects → visites"
            icon="📈"
            accentColor="orange"
          />
          <KpiCard
            label="Autopilot"
            value={`${autopilotRate}%`}
            sub="actions automatiques"
            icon="🤖"
            accentColor="pink"
          />
          <KpiCard
            label="Heures économisées"
            value={data?.roi?.heures_economisees != null ? `${Number(data.roi.heures_economisees).toFixed(1)} h` : (data?.roi?.savedMinutes != null ? `${(data.roi.savedMinutes / 60).toFixed(1)} h` : "—")}
            sub="temps gagné"
            icon="⏱️"
            accentColor="blue"
          />
          <KpiCard
            label="€ économisés"
            value={data?.roi?.savedEuros != null ? `${Number(data.roi.savedEuros).toLocaleString("fr-FR")} €` : "—"}
            sub="coût évité"
            icon="💵"
            accentColor="green"
          />
        </div>

      </section>

      {/* HEALTH SYSTÈME */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Health système</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Providers</p>
            <div className="mt-1 flex flex-wrap gap-2">
              <span className="text-sm text-slate-300">
                Google {data?.health?.providers?.google === true ? "✅" : "❌"}
              </span>
              <span className="text-sm text-slate-300">
                Microsoft {data?.health?.providers?.microsoft === true ? "✅" : "❌"}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Backlog analyse</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {data?.health?.backlog?.remaining_to_analyze != null ? data.health.backlog.remaining_to_analyze : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Erreurs (24h)</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {data?.health?.errorsLast24h ?? 0}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">Dernière activité</p>
            <p className="mt-1 text-sm text-white">
              {formatDateTimeFR(data?.health?.lastActivityAt)}
            </p>
          </div>
        </div>
        {(data?.health?.backlog?.remaining_to_analyze ?? 0) > 0 && (
          <div className="mt-4">
            <a
              href="/emails"
              className="inline-flex items-center rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500"
            >
              Aller traiter →
            </a>
          </div>
        )}
      </section>
  
      {/* EMPTY STATE ou CHARTS + FUNNEL + FEED */}
      {data?.funnel?.prospects === 0 ? (
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

        {/* Bar chart: Booked par jour */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Visites confirmées par jour</h3>
          {loadingTimeseries ? (
            <div className="h-64 flex items-center justify-center text-slate-500 text-sm">Chargement...</div>
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData}>
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
                />
                <Bar dataKey="booked" fill="#10B981" name="Visites" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-slate-500 text-sm">Aucune donnée disponible</div>
          )}
        </div>
      </section>

      {/* FUNNEL + ANOMALIES + LIVE FEED */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Funnel conversion */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-white">Tunnel de conversion</h3>

          <div className="mt-6 space-y-4">
            <FunnelStep label="Prospects" value={data?.funnel.prospects ?? 0} />
            <FunnelStep label="Qualifiés" value={data?.funnel.qualified ?? 0} />
            <FunnelStep label="Créneaux proposés" value={data?.funnel.slotsProposed ?? 0} />
            <FunnelStep label="Visites confirmées" value={data?.funnel.booked ?? 0} />
          </div>

          <div className="mt-6 rounded-xl bg-emerald-900/30 border border-emerald-500/30 p-4">
            <p className="text-xs text-emerald-400 uppercase tracking-wide">
              Taux de conversion
            </p>
            <p className="text-2xl font-semibold text-white mt-1">
              {conversionRate}%
            </p>
          </div>
        </div>

        {/* Anomalies à corriger */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h3 className="text-sm font-semibold text-white">Anomalies à corriger</h3>
          {!data?.anomalies?.length ? (
            <p className="mt-4 text-sm text-slate-400">Aucune anomalie détectée ✅</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {(data.anomalies.slice(0, 5)).map((a) => {
                const tone = a.count >= 10 ? "error" : a.count >= 3 ? "orange" : a.count >= 1 ? "yellow" : "success";
                const bg = a.count >= 10 ? "bg-red-500/10 border-red-500/30" : a.count >= 3 ? "bg-amber-500/10 border-amber-500/30" : "bg-yellow-500/10 border-yellow-500/30";
                return (
                  <li key={a.key} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${bg}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">{anomalyLabel(a.key)}</span>
                      <BadgePill label={String(a.count)} tone={tone} />
                    </div>
                    <a
                      href={`/emails?filter=${anomalyFilter(a.key)}`}
                      className="text-xs font-medium text-sky-400 hover:text-sky-300"
                    >
                      Voir
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6">
        {/* Live feed amélioré */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Live feed</h3>
            <span className="text-xs text-slate-500">dernières actions</span>
          </div>
  
          <div className="mt-4 space-y-2 max-h-96 overflow-y-auto">
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500">
                {loadingActivity ? "Chargement..." : "Aucune activité récente."}
              </p>
            ) : (
              activity.map((x) => {
                const actor = x.actor || "system";
                const actorConfig = actor === "ai"
                  ? { bg: "bg-blue-500/20", border: "border-blue-500/40", text: "text-blue-300", label: "IA", icon: "🤖" }
                  : actor === "human"
                  ? { bg: "bg-green-500/20", border: "border-green-500/40", text: "text-green-300", label: "Humain", icon: "👤" }
                  : { bg: "bg-purple-500/20", border: "border-purple-500/40", text: "text-purple-300", label: "Système", icon: "⚙️" };
                return (
                  <div
                    key={x.id}
                    className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 hover:bg-slate-950/60 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm text-white font-medium">{x.title}</p>
                        <p className="text-xs text-slate-500 mt-1">
                          {x.created_at ? new Date(x.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}
                        </p>
                      </div>
                      <span className={`text-xs px-2.5 py-1 rounded-full ${actorConfig.bg} ${actorConfig.border} border ${actorConfig.text} font-medium shrink-0 flex items-center gap-1.5`}>
                        <span>{actorConfig.icon}</span>
                        <span>{actorConfig.label}</span>
                      </span>
                    </div>
                  </div>
                );
              })
            )}
            {activityCursor && (
              <button
                onClick={() => loadActivity(activityCursor)}
                disabled={loadingActivity}
                className="w-full mt-3 text-xs text-slate-400 hover:text-white disabled:opacity-50"
              >
                Charger plus
              </button>
            )}
          </div>
        </div>
      </section>
        </>
      )}
  
      {/* NEXT ACTION */}
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-5">
        <p className="text-xs uppercase tracking-wide text-emerald-400">
          Action recommandée
        </p>
        <p className="mt-2 text-lg font-semibold text-white">
          Traiter les emails prioritaires
        </p>
        <p className="mt-1 text-sm text-emerald-200">
          {(data?.health?.backlog?.remaining_to_analyze ?? 0) > 0
            ? `⏱️ backlog: ${data?.health?.backlog?.remaining_to_analyze ?? 0} emails à analyser`
            : "⏱️ système à jour"}
        </p>
        <a
          href="/emails"
          className="inline-block mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
        >
          Aller au pipeline →
        </a>
      </section>
    </div>
  );
}

function Step({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="p-4 rounded-xl bg-black/30 border border-gray-800">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{sub}</div>
    </div>
  );
}
function KpiCard({
  label,
  value,
  sub,
  icon,
  accentColor = "blue",
}: {
  label: string;
  value: string | number;
  sub: string;
  icon?: string;
  accentColor?: "blue" | "green" | "orange" | "purple" | "pink";
}) {
  const colorMap = {
    blue: { border: "border-blue-500/30", iconBg: "bg-blue-500/20", text: "text-blue-400", hover: "hover:border-blue-500/50" },
    green: { border: "border-green-500/30", iconBg: "bg-green-500/20", text: "text-green-400", hover: "hover:border-green-500/50" },
    orange: { border: "border-orange-500/30", iconBg: "bg-orange-500/20", text: "text-orange-400", hover: "hover:border-orange-500/50" },
    purple: { border: "border-purple-500/30", iconBg: "bg-purple-500/20", text: "text-purple-400", hover: "hover:border-purple-500/50" },
    pink: { border: "border-pink-500/30", iconBg: "bg-pink-500/20", text: "text-pink-400", hover: "hover:border-pink-500/50" },
  };
  const colors = colorMap[accentColor];

  return (
    <div className={`rounded-xl border ${colors.border} bg-slate-950/40 p-4 transition-all duration-200 ${colors.hover} group`}>
      <div className="flex items-center gap-2 mb-2">
        {icon && (
          <div className={`${colors.iconBg} ${colors.text} p-1.5 rounded-lg`}>
            <span className="text-sm">{icon}</span>
          </div>
        )}
        <p className={`text-xs font-medium ${colors.text}`}>{label}</p>
      </div>
      <p className="mt-1 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{sub}</p>
    </div>
  );
}
function FunnelStep({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3">
      <span className="text-slate-300">{label}</span>
      <span className="text-white font-semibold text-lg">{value}</span>
    </div>
  );
}
function FunnelRow({
  label,
  value,
  suffix,
}: {
  label: string;
  value: number;
  suffix?: string;
}) {
  const v = Number.isFinite(value) ? value : 0;

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <span className="text-slate-300">{label}</span>
      <span className="text-white font-semibold">
        {v}
        {suffix || ""}
      </span>
    </div>
  );
}
