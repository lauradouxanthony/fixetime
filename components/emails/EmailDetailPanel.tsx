"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useToast } from "@/components/ui/Toast";
const supabase = supabaseBrowser();
import type { Email } from "@/types/email";
import {
  getOptimalSlotForEmail,
  getSuggestedSlotsForEmail,
} from "@/components/calendar/getOptimalSlotForEmail";
import ProspectFiche from "@/components/emails/ProspectFiche";
import type { ProspectData } from "@/types/email";

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

function SolvabiliteWidget({ body, prospectData }: { body: string | null | undefined; prospectData?: ProspectData | null }) {
  const [revenus, setRevenus] = useState<string>("");
  const [loyer, setLoyer] = useState<string>("");

  useEffect(() => {
    // BUG #1 FIX : priorité aux données IA (prospect_data), fallback corps email
    if (prospectData?.revenus_mensuels) {
      setRevenus(String(prospectData.revenus_mensuels));
    } else {
      const extracted = extractSolvabilite(body);
      setRevenus(extracted.revenus ? String(extracted.revenus) : "");
    }

    if (prospectData?.loyer_max) {
      setLoyer(String(prospectData.loyer_max));
    } else {
      const extracted = extractSolvabilite(body);
      setLoyer(extracted.loyer ? String(extracted.loyer) : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, JSON.stringify(prospectData)]);

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
        <div className="space-y-2">
          {/* Barre de ratio visuelle */}
          <div>
            <div className="flex justify-between text-xs mb-1" style={{ color: "rgb(100 116 139)" }}>
              <span>Ratio revenus / loyer</span>
              <span style={{ color: solvable ? "rgb(22,163,74)" : "rgb(220,38,38)", fontWeight: 600 }}>
                {ratio.toFixed(1)}x
              </span>
            </div>
            <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min((ratio / 5) * 100, 100)}%`,
                  background: solvable ? "rgb(22,163,74)" : "rgb(220,38,38)",
                }}
              />
              {/* Marqueur seuil 3x = 60% */}
              <div
                className="absolute top-0 h-full w-0.5"
                style={{ left: "60%", background: "rgb(79 70 229)", opacity: 0.6 }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
              <span>0x</span>
              <span style={{ color: "rgb(79 70 229)" }}>Seuil 3x</span>
              <span>5x+</span>
            </div>
          </div>
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
        </div>
      )}
    </Section>
  );
}

type DocStatus = "recu" | "manquant" | "unknown";
type AttachmentInfo = { filename: string; mimeType: string; attachmentId: string; size: number };

const DOCS = [
  { key: "fiches_paie", label: "Fiches de paie (3 derniers mois)" },
  { key: "contrat", label: "Contrat de travail" },
  { key: "avis_imposition", label: "Avis d'imposition" },
  { key: "piece_identite", label: "Pièce d'identité" },
];

function DossierWidget({ body, attachments, gmailMessageId }: {
  body: string | null | undefined;
  attachments?: AttachmentInfo[];
  gmailMessageId?: string | null;
}) {
  const [docs, setDocs] = useState<Record<string, DocStatus>>(
    Object.fromEntries(DOCS.map((d) => [d.key, "unknown"]))
  );

  // BLOC 3 : auto-marquer depuis les noms de fichiers des pièces jointes
  useEffect(() => {
    if (!attachments || attachments.length === 0) return;
    const updates: Record<string, DocStatus> = {};
    for (const att of attachments) {
      const fname = att.filename.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); // remove accents
      if (fname.includes("fiche") || fname.includes("paie") || fname.includes("bulletin")) {
        updates.fiches_paie = "recu";
      }
      if (fname.includes("contrat")) {
        updates.contrat = "recu";
      }
      if (fname.includes("imposition") || fname.includes("avis") || fname.includes("impot")) {
        updates.avis_imposition = "recu";
      }
      if (fname.includes("identite") || fname.includes("identity") || fname.includes("cni")
        || fname.includes("passeport") || fname.includes("carte")) {
        updates.piece_identite = "recu";
      }
    }
    if (Object.keys(updates).length > 0) {
      setDocs((prev) => ({ ...prev, ...updates }));
    }
  }, [attachments]);

  // BUG #2 FIX : ne marquer "Reçu" depuis le corps QUE si mention explicite d'envoi
  useEffect(() => {
    if (!body) return;
    const text = body.toLowerCase();

    const sentKeywords = [
      "ci-joint", "ci joint", "pièce jointe", "pièces jointes",
      "vous trouverez", "je vous envoie", "je vous joins", "je joins",
      "j'envoie", "j'ai joint", "en annexe", "en pièce", "vous faire parvenir",
      "je vous transmets", "je vous fais parvenir",
    ];
    const hasSentContext = sentKeywords.some(k => text.includes(k));

    if (!hasSentContext) return;

    const updates: Record<string, DocStatus> = {};
    if (text.includes("fiche de paie") || text.includes("bulletin de salaire") || text.includes("bulletins de salaire")) {
      updates.fiches_paie = "recu";
    }
    if (text.includes("contrat de travail")) {
      updates.contrat = "recu";
    }
    if (text.includes("avis d'imposition") || text.includes("avis d imposition")) {
      updates.avis_imposition = "recu";
    }
    if (text.includes("carte d'identité") || text.includes("passeport") || text.includes("pièce d'identité")) {
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

  const gmailUrl = gmailMessageId
    ? `https://mail.google.com/mail/u/0/#inbox/${gmailMessageId}`
    : null;

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

      {/* BLOC 3 : pièces jointes détectées */}
      {attachments && attachments.length > 0 && (
        <div className="mt-3 pt-3 border-t" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "rgb(100 116 139)" }}>
            📎 Pièces jointes détectées ({attachments.length})
          </div>
          <div className="space-y-1.5">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ background: "rgba(79,70,229,0.04)", border: "1px solid rgba(79,70,229,0.12)" }}
              >
                <span className="text-sm">📄</span>
                <span className="text-xs flex-1 truncate" style={{ color: "rgb(51 65 85)" }} title={att.filename}>
                  {att.filename}
                </span>
                <span className="text-xs flex-shrink-0" style={{ color: "rgb(148 163 184)" }}>
                  {att.size > 0 ? `${Math.round(att.size / 1024)} Ko` : ""}
                </span>
                {gmailUrl && (
                  <a
                    href={gmailUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-0.5 rounded font-medium flex-shrink-0"
                    style={{ background: "rgba(79,70,229,0.1)", color: "rgb(79 70 229)" }}
                  >
                    Voir
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function DocumentsTemplateWidget({ email, mode }: { email: Email; mode: PipelineMode }) {
  const { toast: showToast } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const docsRequired = [
    "3 dernières fiches de paie",
    "Contrat de travail (CDI / CDD / indépendant)",
    "Dernier avis d'imposition",
    "Pièce d'identité en cours de validité",
    "2 derniers relevés bancaires",
  ];
  const guarantorDocs = [
    "Pièce d'identité du garant",
    "3 dernières fiches de paie du garant",
    "Dernier avis d'imposition du garant",
  ];

  const template = `Bonjour,\n\nMerci pour votre candidature à la location. Afin de constituer votre dossier, merci de nous faire parvenir les documents suivants :\n\n📄 Dossier candidat :\n${docsRequired.map((d) => `• ${d}`).join("\n")}\n\n👥 Dossier garant (si applicable) :\n${guarantorDocs.map((d) => `• ${d}`).join("\n")}\n\nMerci de nous transmettre ces documents dès que possible afin de traiter votre candidature dans les meilleurs délais.\n\nCordialement,\nL'équipe de l'agence`;

  const handleSendTemplate = async () => {
    if (sending || sent) return;
    setSending(true);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id, reply: template }),
      });
      if (!res.ok) throw new Error("Envoi échoué");
      setSent(true);
      showToast("Template envoyé ✅", "success");
    } catch {
      showToast("Erreur lors de l'envoi du template", "error");
    } finally {
      setSending(false);
    }
  };

  return (
    <Section title="📄 Documents requis — Template">
      <div
        className="text-sm whitespace-pre-line rounded-lg p-3 mb-3"
        style={{
          background: "rgb(248 250 252)",
          color: "rgb(51 65 85)",
          border: "1px solid rgb(226 232 240)",
          maxHeight: "180px",
          overflowY: "auto",
        }}
      >
        {template}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(template);
            showToast("Template copié ✅", "success");
          }}
          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
        >
          📋 Copier ce template
        </button>
        {/* BLOC 2 : bouton envoi direct — visible en mode DRAFT uniquement */}
        {mode === "DRAFT" && (
          <button
            onClick={handleSendTemplate}
            disabled={sending || sent}
            className="text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-60"
            style={{ background: sent ? "rgb(22 163 74)" : "rgb(79 70 229)" }}
          >
            {sent ? "✅ Envoyé" : sending ? "Envoi…" : "✉️ Envoyer ce template"}
          </button>
        )}
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
  const { toast: showToast } = useToast();
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyLoading, setReplyLoading] = useState(false);
  const [busy, setBusy] = useState<null | "archive" | "task">(null);
  const [showFullBody, setShowFullBody] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);

  const intention = getIntention(email);
  const decision = email?.decision ?? fallbackDecision(email);
  const minutes = email?.estimated_time ?? fallbackTime(email);

  const notify = (msg: string, type: "success" | "error" | "info" = "success") => {
    showToast(msg, type);
  };

  useEffect(() => {
    setBody(email?.body ?? null);
    setAiReply((email as any)?.ai_reply ?? null);
    setReplyOpen(false);
    setShowFullBody(false);
    setEmailSent(false);
    setSending(false);
    setReclassifyOpen(false);
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
    if (!email?.gmail_message_id) { notify("gmail_message_id manquant", "error"); return; }
    setBusy("archive");
    const res = await fetch("/api/gmail/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gmailMessageId: email.gmail_message_id, emailId: email.id }),
    });
    setBusy(null);
    if (!res.ok) { notify("Erreur archivage", "error"); return; }
    notify("Email archivé ✅", "success");
  };

  const sendNow = async () => {
    if (!email || !aiReply || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailId: email.id, reply: aiReply }),
      });
      if (!res.ok) throw new Error("Envoi échoué");
      setEmailSent(true);
      notify("Email envoyé ✅", "success");
    } catch {
      notify("Erreur lors de l'envoi", "error");
    } finally {
      setSending(false);
    }
  };

  const reclassify = async (newCategory: string) => {
    if (!email) return;
    await supabase.from("emails").update({ category: newCategory }).eq("id", email.id);
    notify(`Reclassifié → ${newCategory} ✅`, "success");
    setReclassifyOpen(false);
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
    if (!res.ok) { notify("Erreur création RDV", "error"); return; }
    notify("RDV créé dans Google Calendar ✅", "success");
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
    <div className="p-5 space-y-4 max-w-2xl mx-auto animate-fade-in">

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
          <ProspectFiche
            key={email.id}
            body={body || email.body}
            prospectData={(email as any).prospect_data ?? null}
            emailId={email.id}
            isAI={!!(email as any).prospect_data}
            onSave={async (data: ProspectData) => {
              const res = await fetch(`/api/leads/${email.id}/prospect`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prospect_data: data }),
              });
              if (!res.ok) {
                notify("Erreur sauvegarde fiche prospect", "error");
              } else {
                notify("Fiche prospect sauvegardée ✅", "success");
              }
            }}
          />
          <SolvabiliteWidget body={body || email.body} prospectData={(email as any).prospect_data ?? null} />
          <DossierWidget
            body={body || email.body}
            attachments={(email as any).attachments ?? []}
            gmailMessageId={email.gmail_message_id}
          />
          <DocumentsTemplateWidget email={email} mode={mode} />
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

      {/* ── Réponse IA générée / Email ignoré ── */}
      {intention === "HORS_SUJET" ? (
        <Section title="Email ignoré par l'IA">
          <p className="text-sm mb-3" style={{ color: "rgb(71 85 105)" }}>
            🚫 Cet email a été identifié comme hors sujet — aucun brouillon n'a été généré automatiquement.
          </p>
          {!reclassifyOpen ? (
            <button
              onClick={() => setReclassifyOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
            >
              🔄 Reclassifier cet email
            </button>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => reclassify("LOCATION")}
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: "rgba(59,130,246,0.1)", color: "rgb(37,99,235)" }}
              >
                🏠 LOCATION
              </button>
              <button
                onClick={() => reclassify("INFO")}
                className="text-xs px-3 py-1.5 rounded-lg font-medium"
                style={{ background: "rgba(100,116,139,0.1)", color: "rgb(71,85,105)" }}
              >
                ℹ️ INFO
              </button>
              <button
                onClick={() => setReclassifyOpen(false)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ color: "rgb(148 163 184)" }}
              >
                Annuler
              </button>
            </div>
          )}
        </Section>
      ) : (
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
              {emailSent ? (
                <div
                  className="text-sm font-medium px-3 py-2 rounded-lg"
                  style={{ background: "rgba(22,163,74,0.08)", color: "rgb(22,163,74)" }}
                >
                  ✅ Email envoyé avec succès
                </div>
              ) : (
                <>
                  <div
                    className="text-sm whitespace-pre-line rounded-lg p-3"
                    style={{ background: "rgb(248 250 252)", color: "rgb(51 65 85)", border: "1px solid rgb(226 232 240)" }}
                  >
                    {aiReply}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => { navigator.clipboard.writeText(aiReply); notify("Copié dans le presse-papiers", "success"); }}
                      className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                      style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
                    >
                      📋 Copier
                    </button>
                    <button
                      onClick={sendNow}
                      disabled={sending}
                      className="text-xs px-3 py-1.5 rounded-lg font-medium text-white transition-opacity disabled:opacity-50"
                      style={{ background: "rgb(79 70 229)" }}
                    >
                      {sending ? "Envoi…" : "✉️ Envoyer maintenant"}
                    </button>
                    {gmailUrl && (
                      <a
                        href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email.sender ?? "")}&su=${encodeURIComponent("Re: " + (email.subject ?? ""))}&body=${encodeURIComponent(aiReply)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                        style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)", border: "1px solid rgb(226 232 240)" }}
                      >
                        🔗 Ouvrir dans Gmail
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </Section>
      )}

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
