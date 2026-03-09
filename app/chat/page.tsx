"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/layout/AppShell";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: Date;
};

const SUGGESTIONS = [
  "📊 Combien de prospects ce mois-ci ?",
  "🔴 Quels emails sont urgents ?",
  "📅 Quels créneaux sont disponibles demain ?",
  "📈 Quel est mon taux de conversion RDV ?",
  "📋 Montre-moi les dossiers incomplets",
  "⚙️ Comment fonctionne l'autopilote ?",
];

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "À l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function IAAvatar() {
  return (
    <div
      className="h-7 w-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0 self-end"
      style={{ background: "rgb(79 70 229)" }}
    >
      IA
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start gap-2 items-end animate-fade-in">
      <IAAvatar />
      <div
        className="rounded-2xl px-4 py-3 border"
        style={{ background: "white", borderColor: "rgb(226 232 240)", borderBottomLeftRadius: "4px" }}
      >
        <div className="flex gap-1 items-center h-4">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{ background: "rgb(148 163 184)", animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "0",
      role: "assistant",
      content: "Bonjour ! Je suis votre assistant IA FixTime.\n\nJe connais vos emails, prospects, statistiques et paramètres d'agence. Posez-moi n'importe quelle question.",
      ts: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content: text.trim(),
      ts: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text.trim(),
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const json = await res.json();
      const reply = json?.reply ?? "Désolé, je n'ai pas pu répondre.";

      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant", content: reply, ts: new Date() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: (Date.now() + 1).toString(), role: "assistant", content: "Erreur de connexion. Veuillez réessayer.", ts: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div
          className="px-6 py-4 border-b bg-white flex items-center justify-between"
          style={{ borderColor: "rgb(226 232 240)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="h-9 w-9 rounded-xl flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
              style={{ background: "rgb(79 70 229)" }}
            >
              IA
            </div>
            <div>
              <h1 className="text-base font-semibold" style={{ color: "rgb(30 41 59)" }}>
                Assistant FixTime
              </h1>
              <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                Emails · Prospects · Calendrier · Statistiques
              </p>
            </div>
          </div>
          <div
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: "rgb(240 253 244)", color: "rgb(22 163 74)" }}
          >
            ● En ligne
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex items-end gap-2 animate-slide-up ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && <IAAvatar />}

              <div
                className="max-w-xl rounded-2xl px-4 py-3 text-sm leading-relaxed"
                style={msg.role === "user" ? {
                  background: "rgb(79 70 229)",
                  color: "white",
                  borderBottomRightRadius: "4px",
                } : {
                  background: "white",
                  color: "rgb(30 41 59)",
                  border: "1px solid rgb(226 232 240)",
                  borderBottomLeftRadius: "4px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                }}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div
                  className="text-xs mt-1.5"
                  style={{ color: msg.role === "user" ? "rgba(255,255,255,0.55)" : "rgb(148 163 184)" }}
                >
                  {timeAgo(msg.ts)}
                </div>
              </div>
            </div>
          ))}

          {loading && <TypingIndicator />}

          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length === 1 && !loading && (
          <div className="px-6 pb-3">
            <p className="text-xs mb-2 font-medium" style={{ color: "rgb(100 116 139)" }}>
              Suggestions
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s.replace(/^[^\s]+ /, ""))}
                  className="text-xs px-3 py-1.5 rounded-full border transition-all hover-lift"
                  style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)", background: "white" }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "rgb(238 242 255)";
                    (e.currentTarget as HTMLElement).style.color = "rgb(79 70 229)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgb(199 210 254)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "white";
                    (e.currentTarget as HTMLElement).style.color = "rgb(71 85 105)";
                    (e.currentTarget as HTMLElement).style.borderColor = "rgb(226 232 240)";
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-6 py-4 border-t bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex gap-3 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="Posez une question…"
              disabled={loading}
              className="flex-1 resize-none rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 transition-shadow"
              style={{
                borderColor: "rgb(226 232 240)",
                color: "rgb(30 41 59)",
                maxHeight: "120px",
                overflow: "auto",
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = Math.min(el.scrollHeight, 120) + "px";
              }}
            />
            <button
              onClick={() => send(input)}
              disabled={loading || !input.trim()}
              className="px-4 py-3 rounded-xl text-sm font-medium text-white transition-all disabled:opacity-40"
              style={{ background: "rgb(79 70 229)", flexShrink: 0 }}
            >
              ↑
            </button>
          </div>
          <p className="text-xs mt-1.5" style={{ color: "rgb(148 163 184)" }}>
            ⏎ Envoyer · ⇧⏎ Nouvelle ligne
          </p>
        </div>
      </div>
    </AppShell>
  );
}
