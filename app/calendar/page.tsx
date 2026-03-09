"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
const supabase = supabaseBrowser();

import { CalendarHeader } from "@/components/calendar/CalendarHeader";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { CalendarAIPanel } from "@/components/calendar/CalendarAIPanel";
import type { CalendarEvent } from "@/components/calendar/calendarUtils";
import { normalizeEventsForDay } from "@/components/calendar/calendarUtils";
import AppShell from "@/components/layout/AppShell";

type ViewMode = "day" | "week";

export default function CalendarPage() {
  const [mode, setMode] = useState<ViewMode>("day");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [selected, setSelected] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);
  const [connected, setConnected] = useState(true);

  const [ai, setAI] = useState<null | {
    summary: string;
    recommendations: string[];
  }>(null);
  const [loadingAI, setLoadingAI] = useState(false);

  /* ---------------- FETCH EVENTS ---------------- */

  const fetchEvents = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      window.location.href = "/auth/login";
      return;
    }

    setLoading(true);

    const from = new Date(date);
    from.setDate(from.getDate() - 7);

    const to = new Date(date);
    to.setDate(to.getDate() + 30);

    const { data, error } = await supabase
      .from("calendar_events")
      .select("id, title, description, start_time, end_time, calendar_name")
      .eq("user_id", user.id)
      .gte("start_time", from.toISOString())
      .lte("start_time", to.toISOString())
      .order("start_time", { ascending: true });

    if (error) {
      console.error("FETCH CALENDAR_EVENTS ERROR", error);
    }

    setEvents((data || []) as CalendarEvent[]);
    setLoading(false);
  };

  useEffect(() => {
    fetchEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const dayEvents = useMemo(
    () => normalizeEventsForDay(events, date),
    [events, date]
  );

  /* ---------------- NAV ---------------- */

  const onPrev = () => {
    const d = new Date(date);
    d.setDate(d.getDate() - 1);
    setDate(d);
    setAI(null);
  };

  const onNext = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + 1);
    setDate(d);
    setAI(null);
  };

  const onToday = () => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    setDate(d);
    setAI(null);
  };

  /* ---------------- SYNC CALENDAR ---------------- */

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      const res = await fetch("/api/calendar/sync", { method: "GET" });
      const json = await res.json();

      if (!res.ok) {
        console.error("CALENDAR SYNC ERROR", json);
        if (json?.error === "NO_GOOGLE_TOKEN") setConnected(false);
      } else {
        setConnected(true);
      }

      await fetchEvents();
    } catch (e) {
      console.error("CALENDAR REFRESH ERROR", e);
    } finally {
      setRefreshing(false);
    }
  };

  /* ---------------- AI ---------------- */

  const generateAI = async () => {
    try {
      setLoadingAI(true);

      const dateLabel = date.toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      const res = await fetch("/api/ai/calendar-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateLabel,
          events: dayEvents.map((e) => ({
            title: e.title,
            start_time: e.start_time,
            end_time: e.end_time,
            calendar_name: e.calendar_name,
          })),
        }),
      });

      const json = await res.json();
      if (!res.ok) { console.error("AI CALENDAR ERROR", json); return; }
      setAI(json.result);
    } catch (e) {
      console.error("AI CALENDAR ERROR", e);
    } finally {
      setLoadingAI(false);
    }
  };

  /* ---------------- RENDER ---------------- */

  return (
    <AppShell>
      <div className="h-full flex flex-col p-6 gap-4" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <CalendarHeader
          date={date}
          mode={mode}
          onPrev={onPrev}
          onNext={onNext}
          onToday={onToday}
          onChangeMode={setMode}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          connected={connected}
        />

        {/* Corps */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0">

          {/* Colonne gauche : timeline */}
          <div className="lg:col-span-2 flex flex-col gap-3 min-h-0 overflow-y-auto">
            <div className="text-sm" style={{ color: "rgb(100 116 139)" }}>
              Vue {mode === "day" ? "Jour" : "Semaine"} — créneaux disponibles mis en évidence
            </div>

            {loading ? (
              <div className="rounded-xl border p-4 text-sm animate-pulse"
                style={{ borderColor: "rgb(226 232 240)", background: "white", color: "rgb(100 116 139)" }}>
                Chargement…
              </div>
            ) : (
              <DayTimeline events={dayEvents} onSelect={setSelected} />
            )}

            {selected && (
              <div className="rounded-xl border p-4" style={{ borderColor: "rgb(226 232 240)", background: "white" }}>
                <div className="text-xs font-semibold uppercase tracking-wide mb-2"
                  style={{ color: "rgb(100 116 139)" }}>
                  Détail RDV
                </div>
                <div className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>
                  {selected.title || "Sans titre"}
                </div>
                {selected.description ? (
                  <div className="text-sm mt-2 whitespace-pre-wrap" style={{ color: "rgb(71 85 105)" }}>
                    {selected.description}
                  </div>
                ) : (
                  <div className="text-sm mt-2" style={{ color: "rgb(148 163 184)" }}>
                    Aucune description.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Colonne droite : IA */}
          <div className="lg:col-span-1 overflow-y-auto">
            <CalendarAIPanel
              date={date}
              events={dayEvents}
              ai={ai}
              loadingAI={loadingAI}
              onGenerateAI={generateAI}
            />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
