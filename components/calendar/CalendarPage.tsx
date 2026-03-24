"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const FETCH_TIMEOUT_MS = 12000;

async function safeFetchJSON<T>(
  url: string,
  opts?: { method?: string; body?: unknown; timeoutMs?: number; signal?: AbortSignal }
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const timeoutMs = opts?.timeoutMs ?? FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;

  const onAbort = (): void => controller.abort();

  if (opts?.signal) {
    if (opts.signal.aborted) return { ok: false, error: "ABORTED" };
    opts.signal.addEventListener("abort", onAbort);
  }

  timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      method: opts?.method ?? "GET",
      headers: opts?.body != null ? { "Content-Type": "application/json" } : undefined,
      body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    if (timeoutId != null) clearTimeout(timeoutId);
    timeoutId = null;
    opts?.signal?.removeEventListener("abort", onAbort);

    if (res.status === 401) return { ok: false, error: "SESSION_EXPIRED", status: 401 };

    const text = await res.text();
    if (!res.ok) return { ok: false, error: "HTTP_ERROR", status: res.status };

    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      return { ok: false, error: "BAD_JSON" };
    }

    return { ok: true, data };
  } catch (e) {
    if (timeoutId != null) clearTimeout(timeoutId);
    opts?.signal?.removeEventListener("abort", onAbort);
    if (e instanceof DOMException && e.name === "AbortError") {
      return { ok: false, error: timedOut ? "TIMEOUT" : "ABORTED" };
    }
    return { ok: false, error: "NETWORK" };
  }
}

type TabId = "booked" | "proposed" | "availability";

type ConfirmedItem = {
  email_id: string;
  prospect_name: string | null;
  start: string | null;
  property_address: string | null;
  score: number | null;
  provider: "google" | "microsoft" | null;
  at: string;
};

type ProposedItem = {
  email_id: string;
  prospect_name: string | null;
  property_address: string | null;
  slots: string[];
  score: number | null;
  at: string;
};

type AvailabilitySlot = { start: string; end: string };

type OpsData = {
  period: string;
  confirmed: ConfirmedItem[];
  proposed: ProposedItem[];
  availability: { slots: AvailabilitySlot[] };
};

function safeJson(val: unknown): Record<string, unknown> | null {
  if (val == null) return null;
  if (typeof val === "object" && !Array.isArray(val)) return val as Record<string, unknown>;
  return null;
}

function safeArray<T>(val: unknown, guard: (x: unknown) => x is T): T[] {
  if (!Array.isArray(val)) return [];
  return val.filter(guard);
}

function formatDateFR(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatHourFR(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatSlotFR(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function groupByDayBooked(items: ConfirmedItem[]): Map<string, ConfirmedItem[]> {
  const map = new Map<string, ConfirmedItem[]>();
  for (const item of items) {
    const ref = item.start ?? item.at;
    if (!ref) continue;
    const d = new Date(ref);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  const sortedKeys = Array.from(map.keys()).sort();
  const out = new Map<string, ConfirmedItem[]>();
  for (const k of sortedKeys) {
    const list = map.get(k) ?? [];
    list.sort((a, b) => {
      const ta = new Date(a.start ?? a.at).getTime();
      const tb = new Date(b.start ?? b.at).getTime();
      return ta - tb;
    });
    out.set(k, list);
  }
  return out;
}

function groupByDayProposed(items: ProposedItem[]): Map<string, ProposedItem[]> {
  const map = new Map<string, ProposedItem[]>();
  for (const item of items) {
    const ref = item.slots?.[0] ?? item.at;
    if (!ref) continue;
    const d = new Date(ref);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  const sortedKeys = Array.from(map.keys()).sort();
  const out = new Map<string, ProposedItem[]>();
  for (const k of sortedKeys) {
    out.set(k, map.get(k) ?? []);
  }
  return out;
}

type OpsResponse = {
  period?: string;
  confirmed?: unknown[];
  proposed?: unknown[];
  availability?: { slots?: { start: string; end: string }[] };
};

export default function CalendarPage() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [tab, setTab] = useState<TabId>("booked");
  const [period, setPeriod] = useState<"7d" | "30d">("7d");
  const periodRef = useRef(period);
  const tabRef = useRef(tab);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);
  useEffect(() => {
    tabRef.current = tab;
  }, [tab]);
  const [loading, setLoading] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [opsData, setOpsData] = useState<OpsData | null>(null);
  const [blockingSlot, setBlockingSlot] = useState<string | null>(null);

  const inflightRef = useRef<AbortController | null>(null);
  const blockSlotRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const abortAll = useCallback(() => {
    inflightRef.current?.abort();
    inflightRef.current = null;
    blockSlotRef.current?.abort();
    blockSlotRef.current = null;
  }, []);

  const showToast = useCallback((msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(msg);
    toastTimeoutRef.current = setTimeout(() => {
      toastTimeoutRef.current = null;
      setToast(null);
    }, 2500);
  }, []);

  const fetchOps = useCallback(async () => {
    if (pathnameRef.current !== "/calendar") return;

    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;

    if (isMountedRef.current) {
      setLoading(true);
      setError(null);
      setSessionExpired(false);
    }

    try {
      const p = periodRef.current;
      const result = await safeFetchJSON<OpsResponse>(`/api/calendar/ops?period=${p}`, {
        timeoutMs: FETCH_TIMEOUT_MS,
        signal: ctrl.signal,
      });

      if (ctrl.signal.aborted || !isMountedRef.current) return;
      inflightRef.current = null;

      if (!result.ok) {
        const err = (!result.ok && "error" in result) ? result.error : null;
        if (err === "ABORTED") return;
        if (err === "TIMEOUT" || err === "NETWORK") {
          if (isMountedRef.current) {
            setError("Calendrier indisponible");
            setOpsData(null);
          }
          return;
        }
        if (err === "SESSION_EXPIRED") {
          if (isMountedRef.current) {
            setSessionExpired(true);
            setOpsData(null);
          }
          return;
        }
        const msg =
          err === "BAD_JSON"
              ? "Réponse invalide du serveur."
              : err === "HTTP_ERROR"
                ? "Le serveur a renvoyé une erreur."
                : "Calendrier indisponible";
        if (isMountedRef.current) {
          setError(msg);
          setOpsData(null);
        }
        return;
      }

      const raw = safeJson(result.data);
      if (raw && (raw as { error?: string }).error === "TIMEOUT") {
        if (isMountedRef.current) {
          setError("Calendrier indisponible");
          setOpsData(null);
        }
        return;
      }
      const confirmed = safeArray(raw?.confirmed, (x): x is ConfirmedItem => typeof x === "object" && x !== null && typeof (x as ConfirmedItem).email_id === "string");
      const proposed = safeArray(raw?.proposed, (x): x is ProposedItem => typeof x === "object" && x !== null && typeof (x as ProposedItem).email_id === "string");
      const avail = raw?.availability as { slots?: { start: string; end: string }[] } | null;
      const slots = Array.isArray(avail?.slots) ? avail.slots : [];

      if (isMountedRef.current) {
        setOpsData({
          period: (result.data?.period as string) ?? p,
          confirmed,
          proposed,
          availability: { slots },
        });
      }
    } finally {
      if (isMountedRef.current && !ctrl.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (pathname !== "/calendar") return;
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      abortAll();
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/calendar") {
      abortAll();
      setLoading(false);
      setBlockingSlot(null);
      return;
    }
    fetchOps();
  }, [pathname]);

  const blockSlot = useCallback(async (slot: AvailabilitySlot) => {
    if (pathnameRef.current !== "/calendar") return;
    blockSlotRef.current?.abort();
    const ctrl = new AbortController();
    blockSlotRef.current = ctrl;

    const key = `${slot.start}-${slot.end}`;
    if (isMountedRef.current) setBlockingSlot(key);

    try {
      const result = await safeFetchJSON<unknown>("/api/calendar/block-slot", {
        method: "POST",
        body: { start: slot.start, end: slot.end, title: "Indisponible (Fixetime)" },
        timeoutMs: FETCH_TIMEOUT_MS,
        signal: ctrl.signal,
      });

      if (ctrl.signal.aborted || !isMountedRef.current) return;
      blockSlotRef.current = null;

      const err2 = (!result.ok && "error" in result) ? result.error : null;
      if (err2 === "ABORTED") return;
      if (!result.ok) {
        if (isMountedRef.current) showToast("Erreur blocage");
        return;
      }
      if (isMountedRef.current) {
        showToast("Créneau bloqué");
        fetchOps();
      }
    } finally {
      if (isMountedRef.current && !ctrl.signal.aborted) setBlockingSlot(null);
    }
  }, []);

  const confirmedList = opsData?.confirmed ?? [];
  const proposedList = opsData?.proposed ?? [];
  const availabilitySlots = (opsData?.availability?.slots ?? []).slice(0, 12);
  const groupedBooked = groupByDayBooked(confirmedList);
  const groupedProposed = groupByDayProposed(proposedList);
  const hasBooked = confirmedList.length > 0;
  const hasProposed = proposedList.length > 0;
  const hasAvailability = availabilitySlots.length > 0;

  if (sessionExpired) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <p className="text-slate-300 font-medium">Session expirée</p>
          <p className="mt-1 text-sm text-slate-500">Reconnectez-vous pour accéder au calendrier.</p>
          <a
            href="/auth/login"
            className="mt-4 inline-block rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Se connecter
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      {/* Header sticky */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sticky top-0 z-10">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-white">Calendrier — Centre Ops</h1>
              <p className="mt-1 text-sm text-slate-400">
                Visites confirmées, créneaux proposés et disponibilités
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setPeriod("7d");
                  periodRef.current = "7d";
                  fetchOps();
                }}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  period === "7d"
                    ? "bg-sky-600 text-white"
                    : "border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                7j
              </button>
              <button
                type="button"
                onClick={() => {
                  setPeriod("30d");
                  periodRef.current = "30d";
                  fetchOps();
                }}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  period === "30d"
                    ? "bg-sky-600 text-white"
                    : "border border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                30j
              </button>
              <button
                type="button"
                onClick={() => fetchOps()}
                disabled={loading}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Rafraîchir
                  </>
                ) : (
                  "Rafraîchir"
                )}
              </button>
            </div>
          </div>

          {/* KPI mini-cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Confirmées</p>
              <p className="mt-1 text-xl font-semibold text-white">{loading ? "—" : confirmedList.length}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Proposées</p>
              <p className="mt-1 text-xl font-semibold text-white">{loading ? "—" : proposedList.length}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3">
              <p className="text-xs text-slate-500 uppercase tracking-wide">Slots dispo</p>
              <p className="mt-1 text-xl font-semibold text-white">{loading ? "—" : availabilitySlots.length}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-700 pb-0">
            <button
              type="button"
              onClick={() => setTab("booked")}
              className={`rounded-t-lg px-4 py-2.5 text-sm font-medium ${
                tab === "booked"
                  ? "bg-slate-800 text-white border border-b-0 border-slate-700"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              Confirmées
            </button>
            <button
              type="button"
              onClick={() => setTab("proposed")}
              className={`rounded-t-lg px-4 py-2.5 text-sm font-medium ${
                tab === "proposed"
                  ? "bg-slate-800 text-white border border-b-0 border-slate-700"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              Proposées
            </button>
            <button
              type="button"
              onClick={() => setTab("availability")}
              className={`rounded-t-lg px-4 py-2.5 text-sm font-medium ${
                tab === "availability"
                  ? "bg-slate-800 text-white border border-b-0 border-slate-700"
                  : "text-slate-400 hover:text-white hover:bg-slate-800/50"
              }`}
            >
              Disponibilités
            </button>
          </div>
        </div>
      </section>

      {/* Bannière info */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <p className="text-sm text-slate-400">
          Quand un prospect répond 1/2/3, la visite passe automatiquement en confirmée.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Astuce : les visites confirmées apparaissent ici automatiquement.
        </p>
      </section>

      {/* Tab: Confirmées */}
      {tab === "booked" && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            Visites confirmées
            {opsData && (
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                {confirmedList.length}
              </span>
            )}
          </h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 rounded-xl bg-slate-800/50 animate-pulse" />
              ))}
            </div>
          ) : error != null ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-sm text-slate-400">{error}</p>
              <button
                type="button"
                onClick={() => fetchOps()}
                className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
              >
                Réessayer
              </button>
            </div>
          ) : !hasBooked ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-sm font-medium text-slate-300">Aucune visite confirmée sur la période</p>
              <p className="mt-1 text-xs text-slate-500">Les visites confirmées s'afficheront ici automatiquement.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(groupedBooked.entries()).map(([dateKey, items]) => {
                const firstAt = items[0]?.start ?? items[0]?.at ?? "";
                return (
                  <div key={dateKey}>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                      {formatDateFR(firstAt)}
                    </p>
                    <ul className="space-y-2">
                      {items.map((item) => (
                        <li
                          key={item.email_id}
                          className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 flex flex-wrap items-center gap-2"
                        >
                          <span className="text-sm font-medium text-white">
                            {item.prospect_name ?? "Prospect"}
                          </span>
                          <span className="text-slate-500">·</span>
                          <span className="text-sm text-slate-400 truncate">
                            {item.property_address ?? "Bien non identifié"}
                          </span>
                          {item.start && (
                            <>
                              <span className="text-slate-500">·</span>
                              <span className="text-xs text-slate-400">
                                {formatHourFR(item.start)}
                              </span>
                            </>
                          )}
                          {item.score != null && (
                            <span className="rounded-full bg-slate-600/60 px-2 py-0.5 text-xs text-slate-300">
                              {item.score}/10
                            </span>
                          )}
                          <span className="ml-auto rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                            Confirmée
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Tab: Proposées */}
      {tab === "proposed" && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            Créneaux proposés
            {opsData && (
              <span className="rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                {proposedList.length}
              </span>
            )}
          </h2>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-slate-800/50 animate-pulse" />
              ))}
            </div>
          ) : error != null ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-sm text-slate-400">{error}</p>
              <button
                type="button"
                onClick={() => fetchOps()}
                className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
              >
                Réessayer
              </button>
            </div>
          ) : !hasProposed ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-sm font-medium text-slate-300">Aucun créneau proposé sur la période</p>
              <p className="mt-1 text-xs text-slate-500">Analysez et synchronisez pour faire apparaître des créneaux.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(groupedProposed.entries()).map(([dateKey, items]) => {
                const firstRef = items[0]?.slots?.[0] ?? items[0]?.at ?? "";
                return (
                  <div key={dateKey}>
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
                      {formatDateFR(firstRef)}
                    </p>
                    <ul className="space-y-3">
                      {items.map((item) => {
                        const slotsOk = item.slots && item.slots.length > 0;
                        return (
                          <li
                            key={item.email_id}
                            className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 space-y-2"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-white">
                                {item.prospect_name ?? "Prospect"}
                              </span>
                              <span className="text-slate-500">·</span>
                              <span className="text-sm text-slate-400 truncate">
                                {item.property_address ?? "Bien non identifié"}
                              </span>
                              {item.score != null && (
                                <span className="rounded-full bg-slate-600/60 px-2 py-0.5 text-xs text-slate-300">
                                  {item.score}/10
                                </span>
                              )}
                              {!slotsOk && (
                                <span className="rounded-full border border-red-500/40 bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                                  Slots manquants
                                </span>
                              )}
                              <span className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
                                Slots proposés
                              </span>
                            </div>
                            {slotsOk ? (
                              <div className="flex flex-wrap gap-2 text-xs text-slate-400">
                                {item.slots.slice(0, 3).map((s, i) => (
                                  <span key={i}>{formatSlotFR(s)}</span>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500">Relancer la synchronisation pour obtenir des slots.</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Tab: Disponibilités */}
      {tab === "availability" && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center justify-between gap-4">
            <span className="flex items-center gap-2">
              Prochains créneaux disponibles
              {opsData?.availability?.slots && opsData.availability.slots.length > 0 && (
                <span className="rounded-full border border-slate-500/40 bg-slate-500/20 px-2 py-0.5 text-xs font-medium text-slate-400">
                  {availabilitySlots.length}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => fetchOps()}
              disabled={loading}
              className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-600 disabled:opacity-50"
            >
              Rafraîchir
            </button>
          </h2>
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-slate-800/50 animate-pulse" />
              ))}
            </div>
          ) : error != null ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-sm text-slate-400">{error}</p>
              <button
                type="button"
                onClick={() => fetchOps()}
                className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
              >
                Réessayer
              </button>
            </div>
          ) : !hasAvailability ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-sm font-medium text-slate-300">Aucun élément sur la période</p>
              <p className="mt-1 text-xs text-slate-500">
                Calendrier saturé ou provider non connecté. Vérifiez que Google ou Microsoft est connecté.
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <a href="/onboarding" className="inline-block rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700">
                  Configurer le calendrier
                </a>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {availabilitySlots.map((slot) => {
                const key = `${slot.start}-${slot.end}`;
                const isBlocking = blockingSlot === key;
                return (
                  <div
                    key={key}
                    className="rounded-xl border border-slate-700 bg-slate-800/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="text-sm text-slate-300">
                      {formatSlotFR(slot.start)} → {formatHourFR(slot.end)}
                    </span>
                    <button
                      type="button"
                      onClick={() => blockSlot(slot)}
                      disabled={isBlocking}
                      className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 disabled:opacity-50"
                    >
                      {isBlocking ? "Blocage…" : "Bloquer"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
