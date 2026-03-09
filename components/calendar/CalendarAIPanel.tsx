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
import { useToast } from "@/components/ui/Toast";

type DayEvent = CalendarEvent & { start: Date; end: Date };

function minsLabel(n: number) {
  const m = Math.max(0, Math.round(n));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h <= 0) return `${m} min`;
  if (r === 0) return `${h}h`;
  return `${h}h${String(r).padStart(2, "0")}`;
}

function Card({ children, title, right }: { children: React.ReactNode; title?: string; right?: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border bg-white p-4 space-y-3"
      style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
    >
      {(title || right) && (
        <div className="flex items-center justify-between gap-3">
          {title && (
            <div className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>
              {title}
            </div>
          )}
          {right}
        </div>
      )}
      {children}
    </div>
  );
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
  const { toast: showToast } = useToast();

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
      if (!res.ok) { showToast("Erreur lors de la création de la tâche.", "error"); return; }
      showToast("Tâche créée ✅", "success");
    } catch {
      showToast("Erreur lors de la création de la tâche.", "error");
    } finally {
      setBusy(false);
    }
  };

  const dateLabel = date.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  // Load badge color in light theme
  const loadBadgeStyle = (): { background: string; color: string } => {
    const l = load.label?.toLowerCase() ?? "";
    if (l.includes("chargée") || l.includes("saturée")) return { background: "rgba(220,38,38,0.08)", color: "rgb(220,38,38)" };
    if (l.includes("moyenne")) return { background: "rgba(234,88,12,0.08)", color: "rgb(234,88,12)" };
    return { background: "rgba(22,163,74,0.08)", color: "rgb(22,163,74)" };
  };

  return (
    <div className="space-y-3">

      {/* Résumé exécutif */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium mb-0.5" style={{ color: "rgb(100 116 139)" }}>
              Résumé exécutif
            </div>
            <div className="text-base font-semibold capitalize" style={{ color: "rgb(30 41 59)" }}>
              {dateLabel}
            </div>
          </div>
          <span
            className="text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0"
            style={loadBadgeStyle()}
          >
            {load.label}
          </span>
        </div>

        <div className="flex items-center gap-2 text-sm" style={{ color: "rgb(71 85 105)" }}>
          <span>⏱️</span>
          <span>
            Réunions 08h–18h :{" "}
            <span className="font-semibold" style={{ color: "rgb(30 41 59)" }}>
              {minsLabel(meetingMins)}
            </span>
          </span>
        </div>

        <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
          Objectif : protéger du temps "deep work" et éviter les journées saturées.
        </div>
      </Card>

      {/* Conflits détectés */}
      <Card title="⚠️ Conflits détectés">
        {conflicts.length === 0 ? (
          <div className="text-sm" style={{ color: "rgb(22,163,74)" }}>
            ✅ Aucun chevauchement.
          </div>
        ) : (
          <div className="space-y-2">
            {conflicts.slice(0, 5).map((c, idx) => (
              <div
                key={idx}
                className="text-sm rounded-lg p-2.5"
                style={{
                  background: "rgba(220,38,38,0.05)",
                  color: "rgb(185,28,28)",
                  border: "1px solid rgba(220,38,38,0.15)",
                }}
              >
                ❗ {c.reason}
              </div>
            ))}
            {conflicts.length > 5 && (
              <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                +{conflicts.length - 5} autres conflits…
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Créneaux libres */}
      <Card
        title="🟢 Créneaux libres"
        right={<span className="text-xs" style={{ color: "rgb(148 163 184)" }}>08:00–18:00</span>}
      >
        {slots.length === 0 ? (
          <div className="text-sm" style={{ color: "rgb(100 116 139)" }}>
            Aucun créneau libre exploitable.
          </div>
        ) : (
          <div className="space-y-2">
            {slots.slice(0, 6).map((s, idx) => {
              const label = `${formatHM(s.start)}–${formatHM(s.end)} (${s.minutes} min)`;
              return (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg p-2.5"
                  style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}
                >
                  <div className="text-sm" style={{ color: "rgb(51 65 85)" }}>
                    {label}
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      createTask(
                        `Deep Work (${s.minutes} min) — ${dateLabel} ${formatHM(s.start)}`,
                        s.start.toISOString()
                      )
                    }
                    className="px-2.5 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-50"
                    style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)" }}
                  >
                    {busy ? "…" : "+ Tâche"}
                  </button>
                </div>
              );
            })}
            {slots.length > 6 && (
              <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                +{slots.length - 6} autres créneaux…
              </div>
            )}
          </div>
        )}
        <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
          FixTime peut réserver ces créneaux pour du temps de focus.
        </div>
      </Card>

      {/* IA Insights */}
      <Card
        title="✨ Insights IA"
        right={
          <button
            onClick={onGenerateAI}
            disabled={loadingAI}
            className="px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all disabled:opacity-50"
            style={{ background: "rgb(79 70 229)" }}
          >
            {loadingAI ? "Analyse…" : "Générer"}
          </button>
        }
      >
        {/* Résumé IA */}
        <div
          className="rounded-lg p-3"
          style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}
        >
          <div className="text-xs font-medium mb-1" style={{ color: "rgb(100 116 139)" }}>
            Résumé
          </div>
          <div className="text-sm leading-relaxed" style={{ color: "rgb(51 65 85)" }}>
            {ai?.summary?.trim()
              ? ai.summary
              : "Cliquez sur « Générer » pour obtenir un résumé exécutif et des recommandations."}
          </div>
        </div>

        {/* Recommandations */}
        <div
          className="rounded-lg p-3 space-y-2"
          style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}
        >
          <div className="text-xs font-medium" style={{ color: "rgb(100 116 139)" }}>
            Recommandations
          </div>

          {ai?.recommendations?.length ? (
            <div className="space-y-2">
              {ai.recommendations.slice(0, 6).map((r, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between gap-3 rounded-lg p-2.5"
                  style={{ background: "white", border: "1px solid rgb(226 232 240)" }}
                >
                  <div className="text-sm" style={{ color: "rgb(51 65 85)" }}>
                    {r}
                  </div>
                  <button
                    disabled={busy}
                    onClick={() => createTask(`Action recommandée — ${dateLabel}`, null)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium transition-all disabled:opacity-50 flex-shrink-0"
                    style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)" }}
                  >
                    {busy ? "…" : "+ Tâche"}
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>
              Aucune recommandation générée pour l'instant.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
