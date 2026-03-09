"use client";

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  type ReactNode,
} from "react";

export type ToastType = "success" | "error" | "info" | "warning";

type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

type Action =
  | { type: "ADD"; toast: Toast }
  | { type: "REMOVE"; id: string };

const ToastContext = createContext<{
  toast: (message: string, type?: ToastType, duration?: number) => void;
  dismiss: (id: string) => void;
} | null>(null);

const ToastListContext = createContext<Toast[]>([]);

function reducer(state: Toast[], action: Action): Toast[] {
  switch (action.type) {
    case "ADD": return [...state, action.toast];
    case "REMOVE": return state.filter((t) => t.id !== action.id);
    default: return state;
  }
}

const STYLES: Record<ToastType, { bg: string; border: string; icon: string; iconColor: string }> = {
  success: { bg: "rgb(240 253 244)", border: "rgb(187 247 208)", icon: "✓", iconColor: "rgb(22 163 74)" },
  error:   { bg: "rgb(254 242 242)", border: "rgb(254 202 202)", icon: "✕", iconColor: "rgb(220 38 38)" },
  warning: { bg: "rgb(255 251 235)", border: "rgb(253 230 138)", icon: "⚠", iconColor: "rgb(217 119 6)" },
  info:    { bg: "rgb(239 246 255)", border: "rgb(191 219 254)", icon: "ℹ", iconColor: "rgb(37 99 235)" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, dispatch] = useReducer(reducer, []);

  const toast = useCallback(
    (message: string, type: ToastType = "success", duration = 3500) => {
      const id = Math.random().toString(36).slice(2);
      dispatch({ type: "ADD", toast: { id, message, type } });
      setTimeout(() => dispatch({ type: "REMOVE", id }), duration);
    },
    []
  );

  const dismiss = useCallback((id: string) => {
    dispatch({ type: "REMOVE", id });
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      <ToastListContext.Provider value={toasts}>
        {children}
        <ToastContainer />
      </ToastListContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}

function ToastContainer() {
  const toasts = useContext(ToastListContext);
  const { dismiss } = useContext(ToastContext)!;

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const s = STYLES[t.type];
        return (
          <div
            key={t.id}
            className="toast-enter flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg pointer-events-auto cursor-pointer"
            style={{
              background: s.bg,
              borderColor: s.border,
              minWidth: "260px",
              maxWidth: "380px",
            }}
            onClick={() => dismiss(t.id)}
          >
            <span
              className="text-sm font-bold flex-shrink-0 h-5 w-5 flex items-center justify-center rounded-full"
              style={{ color: s.iconColor }}
            >
              {s.icon}
            </span>
            <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>
              {t.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
