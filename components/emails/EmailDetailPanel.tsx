"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabaseClient";
import type { Email } from "@/types/email";
import {
  getOptimalSlotForEmail,
  getSuggestedSlotsForEmail,
} from "@/components/calendar/getOptimalSlotForEmail";

type PipelineMode = "DRAFT" | "AUTOPILOTE";

/* ===================== HELPERS ===================== */

function getIntention(email: Email | null): "LOCATION" | "INFO" | "HORS_SUJET" | null {
  if (!email) return null;
  const c = (email.category || "").toUpperCase();
  if (c === "LOCATION") return "LOCATION";
  if (c === "INFO") return "INFO";
  if (c === "HORS_SUJET") return "HORS_SUJET";
  return null;
}

function fallbackDecision(email: Email | null): "traiter" | "ignorer" | "planifier" | null {
  if (!email) return null;
  const s = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();
  if (s.includes("urgent") || s.includes("demain")) return "traiter";
  if (s.includes("réunion") || s.includes("rdv") || s.includes("visite")) return "traiter";
  if (sender.includes("newsletter") || sender.includes("no-reply")) return "ignorer";
  return null;
}

function fallbackTime(email: Email | null): number {
  if (!email) return 5;
  const d = email.decision ?? fallbackDecision(email);
  if (d === "ignorer") return 1;
  if (d === "planifier") return 2;
  return 5;
}

// Extraction heuristique revenus/loyer depuis le corps de l'email
function extractSolvabilite(body: string | null | undefined): { revenus: number | null; loyer: number | null } {
  if (!body) return { revenus: null, loyer: null };
  const text = body.toLowerCase();

  // Cherche des patterns: "3000 euros", "3 000 €", "3000€/mois"
  const moneyPattern = /(\d[\d\s]*(?:[,\.]\d+)?)\s*(?:€|euros?|eur)/gi;
  const matches = [...text.matchAll(moneyPattern)].map((m) => parseFloat(m[1].replace(/\s/g, "").replace(",", ".")));

  // Heuristique : loyer = montant mentionné avec "loyer" | "appartement" | "bien"
  let loyer: number | null = null;
  let revenus: number | null = null;

  const lLines = body.split("\n");
  for (const line of lLines) {
    const l = line.toLowerCase();
    const m = line.match(/(\d[\d\s]*)\s*€/);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/\s/g, ""));
    if (!val || val < 100) continue;

    if (l.includes("loyer") || l.includes("loue") || l.includes("appartement") || l.includes("mensuel")) {
      if (!loyer) loyer = val;
    } else if (l.includes("revenu") || l.includes("salaire") || l.includes("gagne") || l.includes("revenu")) {
      if (!revenus) revenus = val;
    }
  }

  // Fallback : prendre les 2 premiers montants si rien trouvé
  if (!loyer && matches.length >= 1) loyer = matches[0];
  if (!revenus && matches.length >= 2) revenus = matches[1];

  return { revenus, loyer };
}

/* ===================== SOUS-COMPOSANTS ===================== */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "rgb(226 232 240)", background: "white" }}>
      <div className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "rgb(100 116 139)" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function SolvabiliteWidget({ body }: { body: string | null | undefined }) {
  const [revenus, setRevenus] = useState<string>("");
  const [loyer, setLoyer] = useState<string>("");

  useEffect(() => {
    const extracted = extractSolvabilite(body);
    if (extracted.revenus) setRevenus(String(extracted.revenus));
    if (extracted.loyer) setLoyer(String(extracted.loyer));
  }, [body]);

  const ratio = revenus && loyer ? parseFloat(revenus) / parseFloat(loyer) : null;
  const solvable = ratio !== null && ratio >= 3;

  return (
    <Section title="Solvabilité">
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-xs mb-1 block" style={{ color: "rgb(100 116 139)" }}>Revenus mensuels (€)</label>
          <input
            type="number"
            value={revenus}
            onChange={(e) => setRevenus(e.target.value)}
            placeholder="ex: 3000"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{
              borderColor: "rgb(226 232 240)",
              color: "rgb(30 41 59)",
            }}
          />
        </div>
        <div>
          <label className="text-xs mb-1 block" style={{ color: "rgb(100 116 139)" }}>Loyer demandé (€/mois)</label>
          <input
            type="number"
            value={loyer}
            onChange={(e) => setLoyer(e.target.value)}
            placeholder="ex: 900"
            className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2"
            style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
          />
        </div>
      </div>

      {ratio !== null && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium"
          style={{
            background: solvable ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)",
            color: solvable ? "rgb(22,163,74)" : "rgb(220,38,38)",
          }}
        >
          <span>{solvable ? "✅" : "❌"}</span>
          <span>Ratio {ratio.toFixed(1)}x — {solvable ? "Dossier solvable" : "Solvabilité insuffisante (< 3x)"}</span>
        </div>
      )}
    </Section>
  );
}

type DocStatus = "recu" | "manquant" | "unknown";
const DOCS = [
  { key: "fiches_paie", label: "Fiches de paie (3 derniers mois)" },
  { key: "contrat", label: "Contrat de travail" },
  { key: "avis_imposition", label: "Avis d'imposition" },
  { key: "piece_identite", label: "Pièce d'identité" },
];

function DossierWidget({ body }: { body: string | null | undefined }) {
  const [docs, setDocs] = useState<Record<string, DocStatus>>(
    Object.fromEntries(DOCS.map((d) => [d.key, "unknown"]))
  );

  useEffect(() => {
    if (!body) return;
    const text = body.toLowerCase();
    const updates: Record<string, DocStatus> = {};
    if (text.includes("fiche de paie") || text.includes("bulletins") || text.includes("salaire")) {
      updates.fiches_paie = "recu";
    }
    if (text.includes("contrat") || text.includes("cdi") || text.includes("cdd")) {
      updates.contrat = "recu";
    }
    if (text.includes("avis d'imposition") || text.includes("impôt") || text.includes("fiscal")) {
      updates.avis_imposition = "recu";
    }
    if (text.includes("carte d'identité") || text.includes("passeport") || text.includes("identité")) {
      updates.piece_identite = "recu";
    }
    if (Object.keys(updates).length > 0) {
      setDocs((prev) => ({ ...prev, ...updates }));
    }
  }, [body]);

  const toggle = (key: string) => {
    setDocs((prev) => ({
      ...prev,
      [key]: prev[key] === "recu" ? "manquant" : "recu",
    }));
  };

  return (
    <Section title="Dossier locataire">
      <div className="space-y-2">
        {DOCS.map((doc) => {
          const status = docs[doc.key];
          const isRecu = status === "recu";
          return (
            <div
              key={doc.key}
              onClick={() => toggle(doc.key)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{ background: isRecu ? "rgba(22,163,74,0.06)" : "rgba(226,232,240,0.5)" }}
            >
              <span>{isRecu ? "✅" : "❌"}</span>
              <span className="text-sm" style={{ color: isRecu ? "rgb(22,163,74)" : "rgb(100,116,139)" }}>
                {doc.label}
              </span>
              <span className="ml-auto text-xs" style={{ color: "rgb(148,163,184)" }}>
                {isRecu ? "Reçu" : "Manquant"}
              </span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function BookingWidget({
  email,
  mode,
  onApprove,
}: {
  email: Email;
  mode: PipelineMode;
  onApprove: (slot: { start: Date; end: Date }) => void;
}) {
  const [slots, setSlots] = useState<{ start: Date; end: Date; minutes: number }[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [approved, setApproved] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const run = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const day = new Date();
      day.setHours(0, 0, 0, 0);
      const dayStart = new Date(day); dayStart.setHours(9, 0, 0, 0);
      const dayEnd = new Date(day); dayEnd.setHours(18, 0, 0, 0);

      const { data } = await supabase
        .from("calendar_events")
        .select("id, title, description, start_time, end_time")
        .eq("user_id", user.id)
        .gte("start_time", dayStart.toISOString())
        .lte("end_time", dayEnd.toISOString())
        .order("start_time", { ascending: true });

      const minMin = Math.max(30, email.estimated_time ?? 60);
      const suggested = getSuggestedSlotsForEmail(data || [], day, minMin, { daysAhead: 5 });
      setSlots(suggested.slice(0, 3));
    };
    run();
  }, [email.id, email.estimated_time]);

  const handleApprove = async () => {
    if (!slots[selectedSlot]) return;
    setSending(true);
    await onApprove(slots[selectedSlot]);
    setApproved(true);
    setSending(false);
  };

  const formatSlot = (slot: { start: Date; end: Date }) => {
    const day = slot.start.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    const h1 = slot.start.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const h2 = slot.end.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${day} · ${h1}–${h2}`;
  };

  if (approved) {
    return (
      <Section title="Réservation visite">
        <div className="text-sm font-medium" style={{ color: "rgb(22,163,74)" }}>
          ✅ Confirmation envoyée — RDV confirmé
        </div>
      </Section>
    );
  }

  return (
    <Section title="Proposer une visite">
      <div className="space-y-2 mb-3">
        {slots.length === 0 && (
          <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>Calcul des créneaux…</p>
        )}
        {slots.map((slot, i) => (
          <label
            key={i}
            className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-all"
            style={{
              borderColor: selectedSlot === i ? "rgb(79 70 229)" : "rgb(226 232 240)",
              background: selectedSlot === i ? "rgb(238 242 255)" : "white",
            }}
          >
            <input
              type="radio"
              name="slot"
              checked={selectedSlot === i}
              onChange={() => setSelectedSlot(i)}
              className="accent-indigo-600"
            />
            <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>
              {formatSlot(slot)}
            </span>
            {i === 0 && (
              <span className="ml-auto text-xs px-1.5 py-0.5 rounded" style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)" }}>
                Optimal
              </span>
            )}
          </label>
        ))}
      </div>

      <button
        onClick={handleApprove}
        disabled={sending || slots.length === 0}
        className="w-full py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
        style={{ background: "rgb(79 70 229)" }}
      >
        {mode === "DRAFT"
          ? sending ? "Envoi en cours…" : "✅ Approuver & Envoyer"
          : sending ? "Envoi en cours…" : "📤 Envoyer la proposition (Autopilote)"}
      </button>
    </Section>
  );
}

/* ===================== COMPONENT PRINCIPAL ===================== */

export function EmailDetailPanel({ email, mode = "DRAFT" }: { email: Email | null; mode?: PipelineMode }) {
  const [body, setBody] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [busy, setBusy] = useState<null | "archive" | "task">(null);
  const [showFullBody, setShowFullBody] = useState(false);

  const intention = getIntention(email);
  const decision = email?.decision ?? fallbackDecision(email);
  const minutes = email?.estimated_time ?? fallbackTime(email);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  };

  useEffect(() => {
    setBody(email?.body ?? null);
    setAiReply((email as any)?.ai_reply ?? null);
    setReplyOpen(false);
    setShowFullBody(false);
  }, [email?.id]);

  // Fetch body à la demande
  useEffect(() => {
    if (!email || email.body || !email.gmail_message_id) return;
    fetch("/api/gmail/fetch-body", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emailId: email.id, gmailMessageId: email.gmail_message_id }),
    })
      .then((r) => r.json())
      .then((json) => { if (json?.body) setBody(json.body); })
      .catch(() => {});
  }, [email]);

  const generateReply = async () => {
    if (!email || replyLoading) return;
    setReplyLoading(true);
    try {
      const res = await fetch("/api/ai/generate-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id }),
      });
      const json = await res.json();
      if (json?.reply) { setAiReply(json.reply); setReplyOpen(true); }
    } catch (e) { console.error("GENERATE_REPLY_ERROR", e); }
    finally { setReplyLoading(false); }
  };

  const archive = async () => {
    if (!email?.gmail_message_id) { notify("gmail_message_id manquant"); return; }
    setBusy("archive");
    const res = await fetch("/api/gmail/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailMessageId: email.gmail_message_id, emailId: email.id }),
    });
    setBusy(null);
    if (!res.ok) { notify("Erreur archivage"); return; }
    notify("Email archivé ✅");
  };

  const handleBookingApprove = async (slot: { start: Date; end: Date }) => {
    if (!email) return;
    const res = await fetch("/api/calendar/create-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Visite : ${email.subject || "Bien immobilier"}`,
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
      }),
    });
    if (!res.ok) { notify("Erreur création RDV"); return; }
    notify("RDV créé dans Google Calendar ✅");
  };

  if (!email) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8" style={{ color: "rgb(148 163 184)" }}>
        <div className="text-4xl">📧</div>
        <div className="text-sm">Sélectionnez un email pour voir le détail</div>
      </div>
    );
  }

  const gmailUrl = email.gmail_message_id
    ? `https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}`
    : null;

  return (
    <div className="p-5 space-y-4 max-w-2xl mx-auto">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg"
          style={{ background: "rgb(30 41 59)", color: "white" }}>
          {toast}
        </div>
      )}

      {/* ── En-tête email ── */}
      <div className="rounded-xl border p-4 bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
        <div className="flex items-start justify-between gap-4 mb-2">
          <h2 className="text-base font-semibold" style={{ color: "rgb(30 41 59)" }}>
            {email.subject || "(Sans objet)"}
          </h2>
          {/* Badge intention */}
          {intention && (
            <span className="text-xs px-2 py-1 rounded-full font-medium flex-shrink-0"
              style={{
                background: intention === "LOCATION" ? "rgba(59,130,246,0.1)" :
                  intention === "INFO" ? "rgba(100,116,139,0.1)" : "rgba(15,23,42,0.08)",
                color: intention === "LOCATION" ? "rgb(37,99,235)" :
                  intention === "INFO" ? "rgb(71,85,105)" : "rgb(51,65,85)",
              }}>
              {intention === "LOCATION" ? "🏠 Location" : intention === "INFO" ? "ℹ️ Info" : "🚫 Hors sujet"}
            </span>
          )}
        </div>

        <div className="text-sm mb-0.5" style={{ color: "rgb(100 116 139)" }}>
          {email.sender || "Expéditeur inconnu"}
        </div>
        <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
          {email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : ""}
        </div>
      </div>

      {/* ── Résumé IA ── */}
      <Section title="Résumé IA">
        <p className="text-sm leading-relaxed" style={{ color: "rgb(51 65 85)" }}>
          {email.summary?.trim() ||
            (decision === "traiter" ? "Action requise — réponse attendue." :
             decision === "planifier" ? "À planifier — réponse non urgente." :
             decision === "ignorer" ? "Email non prioritaire, peut être ignoré." :
             "Analyse en cours…")}
        </p>
        {minutes > 0 && (
          <div className="mt-2 text-xs" style={{ color: "rgb(148 163 184)" }}>
            ⏱️ Temps estimé : {minutes} min
          </div>
        )}
      </Section>

      {/* ── Widgets LOCATION ── */}
      {intention === "LOCATION" && (
        <>
          <SolvabiliteWidget body={body || email.body} />
          <DossierWidget body={body || email.body} />
          <BookingWidget email={email} mode={mode} onApprove={handleBookingApprove} />
        </>
      )}

      {/* ── Widget INFO ── */}
      {intention === "INFO" && (
        <Section title="Réponse IA — Source FAQ">
          <p className="text-sm mb-3" style={{ color: "rgb(51 65 85)" }}>
            {email.classification_reason || "L'IA a répondu selon vos paramètres FAQ agence."}
          </p>
          <a
            href="/settings#faq"
            className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
            style={{ background: "rgb(248 250 252)", color: "rgb(79 70 229)", border: "1px solid rgb(226 232 240)" }}
          >
            ✏️ Mettre à jour la FAQ
          </a>
        </Section>
      )}

      {/* ── Réponse IA générée ── */}
      <Section title="Réponse générée par l'IA">
        <button
          onClick={() => { if (!aiReply) { generateReply(); } else { setReplyOpen((v) => !v); } }}
          className="flex items-center justify-between w-full text-left"
        >
          <span className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
            Brouillon de réponse
          </span>
          <span className="text-xs px-2 py-1 rounded-md" style={{ background: "rgb(248 250 252)", color: "rgb(100 116 139)" }}>
            {replyLoading ? "Génération…" : replyOpen ? "Masquer" : aiReply ? "Afficher" : "Générer"}
          </span>
        </button>

        {replyOpen && aiReply && (
          <div className="mt-3 space-y-2">
            <div
              className="text-sm whitespace-pre-line rounded-lg p-3"
              style={{ background: "rgb(248 250 252)", color: "rgb(51 65 85)", border: "1px solid rgb(226 232 240)" }}
            >
              {aiReply}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(aiReply); notify("Copié ✅"); }}
                className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
              >
                Copier
              </button>
              {gmailUrl && (
                <a
                  href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email.sender ?? "")}&su=${encodeURIComponent("Re: " + (email.subject ?? ""))}&body=${encodeURIComponent(aiReply)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-colors"
                  style={{ background: "rgb(79 70 229)" }}
                >
                  ✉️ Ouvrir dans Gmail
                </a>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* ── Corps de l'email ── */}
      {(body || email.body) && (
        <Section title="Contenu de l'email">
          <p
            className="text-sm whitespace-pre-wrap"
            style={{
              color: "rgb(71 85 105)",
              overflow: "hidden",
              maxHeight: showFullBody ? "none" : "120px",
            }}
          >
            {(body || email.body || "").replace(/<[^>]*>/g, "")}
          </p>
          <button
            onClick={() => setShowFullBody((v) => !v)}
            className="mt-2 text-xs font-medium"
            style={{ color: "rgb(79 70 229)" }}
          >
            {showFullBody ? "Réduire" : "Voir tout"}
          </button>
        </Section>
      )}

      {/* ── Actions ── */}
      <div className="flex flex-wrap gap-2 pb-6">
        {gmailUrl && (
          <a
            href={gmailUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: "rgb(79 70 229)" }}
          >
            📩 Ouvrir dans Gmail
          </a>
        )}
        <button
          onClick={archive}
          disabled={busy !== null}
          className="px-3 py-2 rounded-lg text-sm transition-colors disabled:opacity-50"
          style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
        >
          {busy === "archive" ? "Archivage…" : "Archiver"}
        </button>
      </div>
    </div>
  );
}
