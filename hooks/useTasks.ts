"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const TASKS_FETCH_TIMEOUT_MS = 8000;

export type Task = {
  id: string;
  user_id: string;
  title: string;
  priority?: string | null;
  due_at?: string | null;
  estimated_minutes?: number | null;
  status: string | null;
  created_at?: string | null;
  email_id?: string | null;
  related_email_id?: string | null;
  related_event_id?: string | null;
  source?: string | null;
};

export function useTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflightRef.current?.abort();
    const ctrl = new AbortController();
    inflightRef.current = ctrl;

    setLoading(true);
    setError(null);

    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, TASKS_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch("/api/tasks/list", {
        cache: "no-store",
        signal: ctrl.signal,
      });

      clearTimeout(timeoutId);
      if (ctrl.signal.aborted) return;
      inflightRef.current = null;

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setTasks([]);
        setError("Impossible de charger les tâches.");
        setLoading(false);
        return;
      }

      setTasks((json?.tasks ?? []) as Task[]);
      setLoading(false);
    } catch (e) {
      clearTimeout(timeoutId);
      if (ctrl.signal.aborted && !timedOut) return; // external cancel (unmount)
      inflightRef.current = null;

      const isTimeout = e instanceof DOMException && e.name === "AbortError";
      setTasks([]);
      setError(isTimeout ? "Le chargement a pris trop de temps." : "Impossible de charger les tâches.");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => {
      inflightRef.current?.abort();
      inflightRef.current = null;
    };
  }, [refresh]);

  const closeTask = async (taskId: string) => {
    // optimistic
    setTasks((prev) => prev.filter((t) => t.id !== taskId));

    await fetch("/api/tasks/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, status: "done" }),
    }).catch(() => {});
  };

  const markScheduled = async (taskId: string, payload: { due_at?: string; estimated_minutes?: number }) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, due_at: payload.due_at ?? t.due_at, estimated_minutes: payload.estimated_minutes ?? t.estimated_minutes } : t))
    );

    await fetch("/api/tasks/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        status: "scheduled",
        due_at: payload.due_at ?? null,
        estimated_minutes: payload.estimated_minutes ?? null,
      }),
    }).catch(() => {});
  };

  return { tasks, loading, error, refresh, closeTask, markScheduled };
}
