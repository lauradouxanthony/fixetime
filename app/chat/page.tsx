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
  "Combien de prospects LOCATION ai-je reçus ce mois-ci ?",
  "Quels emails sont urgents aujourd'hui ?",
  "Quel est mon taux de conversion RDV ?",
  "Montre-moi les dossiers incomplets",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "0",
      role: "assistant",
      content: "Bonjour ! Je suis votre assistant IA FixTime. Posez-moi des questions sur vos prospects, emails, paramètres ou statistiques.",
      ts: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        <div className="px-6 py-4 border-b bg-white flex items-center gap-3"
          style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="h-8 w-8 rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0"
            style={{ background: "rgb(79 70 229)" }}>
            IA
          </div>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "rgb(30 41 59)" }}>Chat IA</h1>
            <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
              Posez des questions sur vos prospects, emails et statistiques
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
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
                }}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                <div
                  className="text-xs mt-1.5"
                  style={{ color: msg.role === "user" ? "rgba(255,255,255,0.6)" : "rgb(148 163 184)" }}
                >
                  {msg.ts.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 text-sm border"
                style={{ background: "white", borderColor: "rgb(226 232 240)", borderBottomLeftRadius: "4px" }}>
                <div className="flex gap-1 items-center" style={{ color: "rgb(148 163 184)" }}>
                  <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
                  <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
                  <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Suggestions */}
        {messages.length === 1 && (
          <div className="px-6 pb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="text-xs px-3 py-1.5 rounded-full border transition-colors"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)", background: "white" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(238 242 255)"; (e.currentTarget as HTMLElement).style.color = "rgb(79 70 229)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "white"; (e.currentTarget as HTMLElement).style.color = "rgb(71 85 105)"; }}
              >
                {s}
              </button>
            ))}
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
              placeholder="Posez une question… (Entrée pour envoyer)"
              disabled={loading}
              className="flex-1 resize-none rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
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
              Envoyer
            </button>
          </div>
          <p className="text-xs mt-2" style={{ color: "rgb(148 163 184)" }}>
            Shift+Entrée pour nouvelle ligne · Entrée pour envoyer
          </p>
        </div>
      </div>
    </AppShell>
  );
}
