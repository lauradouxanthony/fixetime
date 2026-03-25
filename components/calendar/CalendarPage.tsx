"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
const supabase = supabaseBrowser();

import { CalendarHeader } from "@/components/calendar/CalendarHeader";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { CalendarAIPanel } from "@/components/calendar/CalendarAIPanel";
import type { CalendarEvent } from "@/components/calendar/calendarUtils";
import { normalizeEventsForDay, sameDay, freeSlots, formatHM } from "@/components/calendar/calendarUtils";


/* ── MODAL BLOQUER CRÉNEAU ── */
function BlockSlotModal({
  slot,
  onClose,
  onConfirm,
}: {
  slot: { start: Date; end: Date; minutes: number };
  onClose: () => void;
  onConfirm: (title: string, notes: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("FixTime — Créneau bloqué");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const fmt = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const dayLabel = slot.start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

  const handleConfirm = async () => {
    if (!title.trim() || sending) return;
    setSending(true);
    await onConfirm(title.trim(), notes.trim());
    setDone(true);
    setSending(false);
    setTimeout(onClose, 1200);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-sm mx-4 rounded-2xl p-6 space-y-4 animate-fade-in"
        style={{ background: "white", boxShadow: "0 20px 60px rgba(0,0,0,0.18)" }}
      >
        {done ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-sm font-semibold" style={{ color: "rgb(22 163 74)" }}>Créneau bloqué avec succès !</div>
          </div>
        ) : (
          <>
            <div>
              <h3 className="text-base font-bold mb-1" style={{ color: "rgb(30 41 59)" }}>Bloquer ce créneau</h3>
              <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
                {dayLabel} · {fmt(slot.start)} – {fmt(slot.end)} ({slot.minutes} min)
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: "rgb(71 85 105)" }}>Titre</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                />
              </div>
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: "rgb(71 85 105)" }}>Notes (optionnel)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Visite appartement T2…"
                  className="w-full rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                  style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
              >
                Annuler
              </button>
              <button
                onClick={handleConfirm}
                disabled={!title.trim() || sending}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: "rgb(79 70 229)" }}
              >
                {sending ? "Création…" : "✅ Bloquer"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type ViewMode = "day" | "week";

/* ── WEEK VIEW ── */
function WeekView({
  date,
  events,
  loading,
  onSelectDay,
}: {
  date: Date;
  events: CalendarEvent[];
  loading: boolean;
  onSelectDay: (d: Date) => void;
}) {
  // Monday of current week
  const monday = new Date(date);
  const dow = monday.getDay();
  monday.setDate(monday.getDate() - (dow === 0 ? 6 : dow - 1));
  monday.setHours(0, 0, 0, 0);

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (loading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map((_, i) => (
            <div key={i} className="rounded-xl animate-pulse" style={{ background: "rgb(226 232 240)", height: "160px" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-7 gap-3">
        {weekDays.map((day) => {
          const dayEvents = normalizeEventsForDay(events, day);
          const isToday = sameDay(day, today);
          const slots = freeSlots(dayEvents, day, 9, 18);
          const freeMinutes = slots.reduce((s, sl) => s + sl.minutes, 0);

          return (
            <div
              key={day.toISOString()}
              className="flex flex-col gap-2 rounded-xl border p-3 cursor-pointer transition-all hover-lift"
              style={{
                background: isToday ? "rgb(238 242 255)" : "white",
                borderColor: isToday ? "rgb(199 210 254)" : "rgb(226 232 240)",
              }}
              onClick={() => onSelectDay(day)}
            >
              {/* Day header */}
              <div className="text-center">
                <div className="text-xs font-medium uppercase" style={{ color: "rgb(148 163 184)" }}>
                  {day.toLocaleDateString("fr-FR", { weekday: "short" })}
                </div>
                <div
                  className="text-lg font-bold"
                  style={{ color: isToday ? "rgb(79 70 229)" : "rgb(30 41 59)" }}
                >
                  {day.getDate()}
                </div>
                {isToday && (
                  <div className="text-xs font-semibold" style={{ color: "rgb(79 70 229)" }}>
                    Auj.
                  </div>
                )}
              </div>

              {/* Events */}
              <div className="space-y-1 flex-1">
                {dayEvents.length === 0 ? (
                  <div className="text-center py-2">
                    {freeMinutes > 0 && (
                      <div className="text-xs rounded px-1 py-0.5" style={{ background: "rgba(22,163,74,0.08)", color: "rgb(22 163 74)" }}>
                        {Math.round(freeMinutes / 60)}h libre
                      </div>
                    )}
                  </div>
                ) : (
                  dayEvents.slice(0, 3).map((ev) => (
                    <div
                      key={ev.id}
                      className="rounded px-2 py-1 text-xs truncate"
                      style={{
                        background: "rgb(238 242 255)",
                        color: "rgb(79 70 229)",
                        fontSize: "10px",
                      }}
                    >
                      {formatHM(ev.start)} {ev.title || "RDV"}
                    </div>
                  ))
                )}
                {dayEvents.length > 3 && (
                  <div className="text-xs text-center" style={{ color: "rgb(148 163 184)" }}>
                    +{dayEvents.length - 3} autre{dayEvents.length - 3 > 1 ? "s" : ""}
                  </div>
                )}
              </div>

              {/* Free slot indicator */}
              {dayEvents.length > 0 && freeMinutes > 30 && (
                <div
                  className="text-center text-xs rounded px-1 py-0.5"
                  style={{ background: "rgba(22,163,74,0.08)", color: "rgb(22 163 74)", fontSize: "10px" }}
                >
                  🟢 {Math.round(freeMinutes / 60)}h libre
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [mode, setMode] = useState<ViewMode>("week");
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

  const [blockSlot, setBlockSlot] = useState<{ start: Date; end: Date; minutes: number } | null>(null);

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
    d.setDate(d.getDate() - (mode === "week" ? 7 : 1));
    setDate(d);
    setAI(null);
  };

  const onNext = () => {
    const d = new Date(date);
    d.setDate(d.getDate() + (mode === "week" ? 7 : 1));
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

  /* ---------------- BLOCK SLOT ---------------- */

  const handleBlockSlotConfirm = async (title: string, notes: string) => {
    if (!blockSlot) return;
    try {
      const res = await fetch("/api/calendar/block-slot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          notes,
          start: blockSlot.start.toISOString(),
          end: blockSlot.end.toISOString(),
        }),
      });
      if (res.ok) {
        await fetchEvents();
      } else {
        console.error("BLOCK_SLOT_ERROR", await res.json());
      }
    } catch (e) {
      console.error("BLOCK_SLOT_ERROR", e);
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
    <>
      {blockSlot && (
        <BlockSlotModal
          slot={blockSlot}
          onClose={() => setBlockSlot(null)}
          onConfirm={handleBlockSlotConfirm}
        />
      )}
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

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
        <div className="flex-1 overflow-y-auto">
          {mode === "week" ? (
            /* ── VUE SEMAINE ── */
            <WeekView
              date={date}
              events={events}
              loading={loading}
              onSelectDay={(d) => { setDate(d); setMode("day"); }}
            />
          ) : (
            /* ── VUE JOUR ── */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-6 h-full min-h-0">
              <div className="lg:col-span-2 flex flex-col gap-3 min-h-0 overflow-y-auto">
                {loading ? (
                  <div className="rounded-xl border p-4 text-sm animate-pulse"
                    style={{ borderColor: "rgb(226 232 240)", background: "white", color: "rgb(100 116 139)" }}>
                    Chargement…
                  </div>
                ) : (
                  <DayTimeline events={dayEvents} onSelect={setSelected} date={date} onBlockSlot={setBlockSlot} />
                )}

                {selected && (
                  <div className="rounded-xl border p-4 animate-fade-in" style={{ borderColor: "rgb(226 232 240)", background: "white" }}>
                    <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "rgb(100 116 139)" }}>
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
                      <div className="text-sm mt-2" style={{ color: "rgb(148 163 184)" }}>Aucune description.</div>
                    )}
                  </div>
                )}
              </div>

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
          )}
        </div>
      </div>
    </>
  );
}
