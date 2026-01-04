"use client";

import { useMemo, useState } from "react";
import {
  detectConflicts,
  freeSlots,
  loadLabel,
  totalMeetingMinutes,
  formatHM,
  type CalendarEvent,
} from "@/components/calendar/calendarUtils";

type DayEvent = CalendarEvent & { start: Date; end: Date };

function minsLabel(n: number) {
  const m = Math.max(0, Math.round(n));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${m} min`;
  if (r === 0) return `${h}h`;
  return `${h}h${String(r).padStart(2, "0")}`;
}

export function CalendarAIPanel({
  date,
  events,
  ai,
  loadingAI,
  onGenerateAI,
}: {
  date: Date;
  events: DayEvent[];
  ai: null | { summary: string; recommendations: string[] };
  loadingAI: boolean;
  onGenerateAI: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  const conflicts = useMemo(() => detectConflicts(events), [events]);
  const slots = useMemo(() => freeSlots(events, date, 8, 18), [events, date]);

  const meetingMins = useMemo(
    () => totalMeetingMinutes(events, date, 8, 18),
    [events, date]
  );
  const load = useMemo(() => loadLabel(meetingMins), [meetingMins]);

  const createTask = async (title: string, dueAt: string | null) => {
    try {
      setBusy(true);

      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, dueAt }),
      });

      if (!res.ok) {
        notify("Erreur lors de la création de la tâche.");
        return;
      }

      notify("Tâche créée ✅");
    } catch {
      notify("Erreur lors de la création de la tâche.");
    } finally {
      setBusy(false);
    }
  };

  const dateLabel = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  return (
    <div className="space-y-3">
      {toast && (
        <div className="p-3 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-200">
          {toast}
        </div>
      )}

      {/* Carte charge */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400">Résumé exécutif</div>
            <div className="text-lg font-semibold text-white">Journée — {dateLabel}</div>
          </div>

          <div className={`text-xs px-3 py-1 rounded-full border ${load.cls}`}>
            {load.label}
          </div>
        </div>

        <div className="text-sm text-gray-300">
          ⏱️ Temps en réunions (08:00–18:00) :{" "}
          <span className="text-white font-semibold">{minsLabel(meetingMins)}</span>
        </div>

        <div className="text-xs text-gray-500">
          Objectif : protéger du temps “deep work” et éviter les journées saturées.
        </div>
      </div>

      {/* Conflits */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2">
        <div className="text-sm text-white font-semibold">Conflits détectés</div>

        {conflicts.length === 0 ? (
          <div className="text-sm text-gray-400">✅ Aucun chevauchement.</div>
        ) : (
          <div className="space-y-2">
            {conflicts.slice(0, 5).map((c, idx) => (
              <div
                key={idx}
                className="text-sm text-red-300 border border-red-800/60 bg-red-900/20 rounded-lg p-2"
              >
                ❗ {c.reason}
              </div>
            ))}
            {conflicts.length > 5 && (
              <div className="text-xs text-gray-500">
                +{conflicts.length - 5} autres conflits…
              </div>
            )}
          </div>
        )}
      </div>

      {/* Créneaux libres */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-white font-semibold">Créneaux libres</div>
          <div className="text-xs text-gray-400">08:00–18:00</div>
        </div>

        {slots.length === 0 ? (
          <div className="text-sm text-gray-400">Aucun créneau libre exploitable.</div>
        ) : (
          <div className="space-y-2">
            {slots.slice(0, 6).map((s, idx) => {
              const label = `${formatHM(s.start)}–${formatHM(s.end)} (${s.minutes} min)`;
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-950 p-2"
                >
                  <div className="text-sm text-gray-200">{label}</div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      createTask(
                        `Deep Work (${s.minutes} min) — ${dateLabel} ${formatHM(s.start)}`,
                        s.start.toISOString()
                      )
                    }
                    className="px-3 py-1.5 rounded-md bg-gray-800 text-xs hover:bg-gray-700 disabled:opacity-50"
                  >
                    {busy ? "..." : "Créer une tâche"}
                  </button>
                </div>
              );
            })}
            {slots.length > 6 && (
              <div className="text-xs text-gray-500">
                +{slots.length - 6} autres créneaux…
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-500">
          Astuce : FixTime propose des tâches “deep work” pour protéger du temps de focus.
        </div>
      </div>

      {/* IA */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-400">Assistant IA</div>
            <div className="text-sm text-white font-semibold">Insights & recommandations</div>
          </div>

          <button
            onClick={onGenerateAI}
            disabled={loadingAI}
            className="px-3 py-2 rounded-md bg-blue-600 text-sm disabled:opacity-50"
          >
            {loadingAI ? "Analyse…" : "Générer"}
          </button>
        </div>

        {/* Résumé */}
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-3">
          <div className="text-xs text-gray-400 mb-1">Résumé IA</div>
          <div className="text-sm text-gray-200 leading-relaxed">
            {ai?.summary?.trim()
              ? ai.summary
              : "Cliquez sur “Générer” pour obtenir un résumé exécutif et des recommandations."}
          </div>
        </div>

        {/* Recos actionnables */}
        <div className="rounded-lg border border-gray-800 bg-gray-950 p-3 space-y-2">
          <div className="text-xs text-gray-400">Recommandations</div>

          {ai?.recommendations?.length ? (
            <div className="space-y-2">
              {ai.recommendations.slice(0, 6).map((r, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-800 bg-gray-900 p-2"
                >
                  <div className="text-sm text-gray-200">{r}</div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      createTask(`Action recommandée — ${dateLabel}`, null)
                    }
                    className="px-3 py-1.5 rounded-md bg-gray-800 text-xs hover:bg-gray-700 disabled:opacity-50"
                  >
                    {busy ? "..." : "Créer tâche"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">
              Aucune recommandation générée pour l’instant.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
