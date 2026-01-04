"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import { CalendarHeader } from "@/components/calendar/CalendarHeader";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { CalendarAIPanel } from "@/components/calendar/CalendarAIPanel";
import type { CalendarEvent } from "@/components/calendar/calendarUtils";
import { normalizeEventsForDay } from "@/components/calendar/calendarUtils";

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

      // ✅ TA ROUTE RÉELLE (confirmée)
      const res = await fetch("/api/calendar/sync", { method: "GET" });
      const json = await res.json();

      if (!res.ok) {
        console.error("CALENDAR SYNC ERROR", json);
        if (json?.error === "NO_GOOGLE_TOKEN") {
          setConnected(false);
        }
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

      if (!res.ok) {
        console.error("AI CALENDAR ERROR", json);
        return;
      }

      setAI(json.result);
    } catch (e) {
      console.error("AI CALENDAR ERROR", e);
    } finally {
      setLoadingAI(false);
    }
  };

  /* ---------------- RENDER ---------------- */

  return (
    <div className="h-full flex flex-col p-6 gap-4">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1">
        {/* Colonne gauche */}
        <div className="lg:col-span-2 space-y-3">
          <div className="text-sm text-gray-400">
            Vue {mode === "day" ? "Jour" : "Semaine"} — focus dirigeant.
          </div>

          {loading ? (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4 text-sm text-gray-400">
              Chargement…
            </div>
          ) : (
            <DayTimeline events={dayEvents} onSelect={setSelected} />
          )}

          {selected && (
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
              <div className="text-xs text-gray-400">Détail</div>
              <div className="text-white font-semibold mt-1">
                {selected.title || "Sans titre"}
              </div>

              {selected.description ? (
                <div className="text-sm text-gray-300 mt-2 whitespace-pre-wrap">
                  {selected.description}
                </div>
              ) : (
                <div className="text-sm text-gray-500 mt-2">
                  Aucune description.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Colonne droite IA */}
        <div className="lg:col-span-1">
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
  );
}
