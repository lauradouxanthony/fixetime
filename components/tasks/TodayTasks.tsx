"use client";

import { useEffect, useState } from "react";

type Task = {
  id: string;
  title: string;
  due_at: string | null;
};

export function TodayTasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/tasks/today");
      const json = await res.json();
      setTasks(json.tasks ?? []);
    } catch (e) {
      console.error("FETCH TASKS ERROR", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, []);

  const completeTask = async (taskId: string) => {
    setBusyId(taskId);

    await fetch("/api/tasks/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId }),
    });

    setBusyId(null);
    fetchTasks();
  };

  if (loading) {
    return (
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-400">
        Chargement des actions…
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="p-4 rounded-xl bg-gray-900 border border-gray-800 text-sm text-gray-400">
        🎉 Aucune action en attente
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl bg-gray-900 border border-gray-800">
      <div className="text-sm font-semibold mb-3">🧠 À faire</div>

      <ul className="space-y-2">
        {tasks.map((t) => (
          <li
            key={t.id}
            className="text-sm text-gray-200 flex items-center justify-between gap-2"
          >
            <div className="flex-1">
              <div>{t.title}</div>
              {t.due_at && (
                <div className="text-xs text-gray-400">
                  {new Date(t.due_at).toLocaleDateString()}{" "}
                  {new Date(t.due_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              )}
            </div>

            <button
              onClick={() => completeTask(t.id)}
              disabled={busyId === t.id}
              className="px-2 py-1 rounded-md bg-green-600 text-xs hover:bg-green-500 disabled:opacity-50"
            >
              {busyId === t.id ? "…" : "✔ Terminé"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
