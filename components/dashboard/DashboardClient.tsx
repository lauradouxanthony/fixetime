"use client";

import { useEffect, useState } from "react";

type DashboardData = {
  stats: {
    emailsToday: number;
    urgentToday: number;
  };
  importantEmails: {
    id: string;
    sender: string | null;
    subject: string | null;
  }[];
  nextMeetings: {
    id: string;
    title: string;
    start_time: string;
    end_time: string;
  }[];
};

function formatHoursSaved(emailsCount: number) {
  const minutes = emailsCount * 2;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours === 0) return `${remainingMinutes} min`;
  return remainingMinutes === 0
    ? `${hours}h`
    : `${hours}h${remainingMinutes.toString().padStart(2, "0")}`;
}

export default function DashboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);

  async function loadDashboard() {
    const res = await fetch("/api/dashboard/summary", {
      cache: "no-store",
    });
    const json = await res.json();
    setData(json);
  }

  async function refreshNow() {
    try {
      setLoading(true);
  
      const res = await fetch("/api/sync/all", {
        method: "POST",
      });
  
      if (!res.ok) {
        const text = await res.text();
        console.error("❌ SYNC ALL FAILED:", text);
        alert("Erreur lors de la synchronisation. Regarde la console.");
        return;
      }
  
      await loadDashboard();
    } catch (error) {
      console.error("❌ SYNC ALL ERROR:", error);
      alert("Erreur serveur ou réseau.");
    } finally {
      setLoading(false);
    }
  }
  

  useEffect(() => {
    loadDashboard();
  }, []);

  if (!data) {
    return (
      <p className="text-sm text-slate-400">
        Chargement du dashboard…
      </p>
    );
  }

  const emailsToday = data.stats.emailsToday ?? 0;
  const urgentEmails = data.stats.urgentToday ?? 0;
  const meetingsToday = data.nextMeetings.length;
  const hoursSaved = formatHoursSaved(emailsToday);

  return (
    <div className="space-y-6">

      {/* 🔥 PRIORITÉ DU JOUR */}
<section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/30 p-5">
  <p className="text-xs uppercase tracking-wide text-emerald-400">
    Aujourd’hui, FixTime recommande
  </p>

  <p className="mt-2 text-lg font-semibold text-white">
    Traiter vos emails prioritaires
  </p>

  <p className="mt-1 text-sm text-emerald-200">
    ⏱️ 5 à 10 minutes · Impact élevé sur votre charge mentale
  </p>

  <a
    href="/emails"
    className="inline-block mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400"
  >
    Voir l’action recommandée →
  </a>
</section>


      {/* HEADER */}
      <section className="flex items-center justify-between">
  <div>
    <p className="text-sm text-slate-400">
      Voici votre journée optimisée.
    </p>
    <p className="text-xs text-slate-500">
      Mise à jour basée sur vos emails et votre calendrier synchronisés.
    </p>
  </div>

  <p className="text-xs text-slate-500">
    Dernière analyse automatique en arrière-plan
  </p>
</section>

      {/* STATS */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <Stat
    title="Emails à traiter aujourd’hui"
    value={urgentEmails}
    accent="rose"
    subtitle="prioritaires selon FixTime"
  />

  <Stat
    title="Temps libéré aujourd’hui"
    value={hoursSaved}
    accent="emerald"
    subtitle="grâce aux décisions automatiques"
  />
</section>

      {/* CONTENT */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* EMAILS */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
  <p className="text-xs uppercase tracking-wide text-slate-400">
    Email prioritaire du jour
  </p>

  {data.importantEmails.length > 0 ? (
    <>
      <p className="mt-3 text-sm text-slate-400">
        De : {data.importantEmails[0].sender || "Expéditeur inconnu"}
      </p>

      <p className="mt-1 text-lg font-semibold text-white">
        {data.importantEmails[0].subject || "Sans objet"}
      </p>

      <a
        href="/emails"
        className="inline-block mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
      >
        Traiter cet email →
      </a>
    </>
  ) : (
    <p className="mt-3 text-sm text-slate-500">
      Aucun email prioritaire détecté aujourd’hui.
    </p>
  )}
</div>

        {/* PLANNING */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Planning du jour</h3>
            <a
              href="/calendar"
              className="text-xs text-sky-400 hover:underline"
            >
              Ouvrir le calendrier
            </a>
          </div>

          <div className="space-y-2 text-xs">
            {data.nextMeetings.length > 0 ? (
              data.nextMeetings.map((ev) => {
                const start = new Date(ev.start_time);
                const end = new Date(ev.end_time);

                return (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2"
                  >
                    <p className="font-medium">
                      {start.toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {end.toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {ev.title}
                    </p>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-slate-500">
                Aucune réunion prévue aujourd’hui.
              </p>
            )}
          </div>
        </div>

      </section>
    </div>
  );
}

function Stat({
  title,
  value,
  subtitle,
  accent,
}: {
  title: string;
  value: any;
  subtitle?: string;
  accent?: "rose" | "emerald" | "amber";
}) {
  const accentMap: any = {
    rose: "border-rose-500/40 bg-rose-950/40 text-rose-100",
    emerald: "border-emerald-500/40 bg-emerald-950/40 text-emerald-100",
    amber: "border-amber-500/40 bg-amber-950/40 text-amber-100",
  };

  return (
    <div
      className={`rounded-2xl border bg-slate-900/60 px-4 py-3 ${
        accent ? accentMap[accent] : "border-slate-800"
      }`}
    >
      <p className="text-xs text-slate-400">{title}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      {subtitle && (
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      )}
    </div>
  );
}
