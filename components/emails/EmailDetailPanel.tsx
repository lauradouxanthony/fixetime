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

type TrafficLight = "AUTOPILOTE" | "DRAFT" | "ALERTE";

const TL_CFG: Record<TrafficLight, { color: string; bg: string; label: string; dot: string }> = {
  AUTOPILOTE: { color: "rgb(22 163 74)",  bg: "rgba(22,163,74,0.1)",  label: "Autopilote", dot: "#16a34a" },
  DRAFT:      { color: "rgb(234 88 12)",  bg: "rgba(234,88,12,0.1)",  label: "À valider",  dot: "#ea580c" },
  ALERTE:     { color: "rgb(220 38 38)",  bg: "rgba(220,38,38,0.1)",  label: "Alerte",     dot: "#dc2626" },
};

function computeTrafficLight(email: Email | null, mode: PipelineMode = "DRAFT"): TrafficLight {
  if (!email) return "DRAFT";
  if (email.is_urgent) return "ALERTE";
  // Le badge reflète le vrai mode pipeline de l'utilisateur, pas seulement la présence d'une réponse IA
  if (mode === "AUTOPILOTE") return "AUTOPILOTE";
  return "DRAFT";
}

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

function SolvabiliteWidget({ body, prospectData, propertyId }: {
  body: string | null | undefined;
  prospectData?: ProspectData | null;
  propertyId?: string | null;
}) {
  const [revenus, setRevenus] = useState<string>("");
  const [loyer, setLoyer] = useState<string>("");

  useEffect(() => {
    // Revenus : priorité prospect_data IA, sinon extraction corps
    if (prospectData?.revenus_mensuels) {
      setRevenus(String(prospectData.revenus_mensuels));
    } else {
      const extracted = extractSolvabilite(body);
      setRevenus(extracted.revenus ? String(extracted.revenus) : "");
    }

    // Loyer : 1) prospect_data.loyer_max  2) property.rent  3) vide (jamais les revenus)
    if (prospectData?.loyer_max) {
      setLoyer(String(prospectData.loyer_max));
    } else if (propertyId) {
      // Chercher le loyer du bien associé
      fetch("/api/properties")
        .then((r) => r.json())
        .then((data) => {
          const props: Array<{ id: string; rent: number }> = data.properties ?? [];
          const found = props.find((p) => p.id === propertyId);
          if (found?.rent) setLoyer(String(found.rent));
        })
        .catch(() => {});
    } else {
      // Fallback extraction corps — uniquement si mention explicite de loyer
      const extracted = extractSolvabilite(body);
      // N'utiliser que si la valeur vient d'une ligne avec mot-clé loyer (pas juste le 1er montant)
      setLoyer(extracted.loyer && extracted.loyer !== extracted.revenus ? String(extracted.loyer) : "");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, JSON.stringify(prospectData), propertyId]);

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
type DocValidationStatus = "pending" | "validated" | "rejected";
type AttachmentInfo = { filename: string; mimeType: string; attachmentId: string; size: number };

const REJECTION_REASONS = [
  "Document illisible",
  "Document expiré",
  "Mauvais document",
  "Document incomplet",
  "Signature manquante",
  "Autre",
];

const DOCS = [
  { key: "fiches_paie", label: "Fiches de paie (3 derniers mois)" },
  { key: "contrat", label: "Contrat de travail" },
  { key: "avis_imposition", label: "Avis d'imposition" },
  { key: "piece_identite", label: "Pièce d'identité" },
];

const DOC_TYPE_OPTIONS = [
  { value: "fiches_paie", label: "Fiches de paie" },
  { value: "contrat", label: "Contrat de travail" },
  { value: "avis_imposition", label: "Avis d'imposition" },
  { value: "piece_identite", label: "Pièce d'identité" },
  { value: "kbis", label: "Kbis" },
  { value: "bilan", label: "Bilan comptable" },
  { value: "releves", label: "Relevés bancaires" },
  { value: "carte_etudiant", label: "Carte étudiante" },
  { value: "scolarite", label: "Certificat de scolarité" },
  { value: "garant_id", label: "Garant : pièce d'identité" },
  { value: "garant_paie", label: "Garant : fiches de paie" },
  { value: "garant_impos", label: "Garant : avis d'imposition" },
  { value: "pension", label: "Relevés de pension" },
  { value: "autre", label: "Autre document" },
];

function DocPreviewModal({ att, gmailMessageId, emailId, onClose, onValidate, onReject, validationStatus, validating, docTypeOverrides, onChangeType, attIndex }: {
  att: AttachmentInfo & Record<string, unknown>;
  gmailMessageId: string;
  emailId: string;
  onClose: () => void;
  onValidate: (att: AttachmentInfo) => void;
  onReject: (att: AttachmentInfo) => void;
  validationStatus: Record<string, DocValidationStatus>;
  validating: string | null;
  docTypeOverrides: Record<number, string>;
  onChangeType: (idx: number, type: string) => void;
  attIndex: number;
}) {
  const linkUrl: string | null = (att as any).gmailLink ?? (att as any).storage_url ?? null;
  const vStatus = validationStatus[att.attachmentId] ?? "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold truncate" style={{ color: "rgb(30 41 59)" }}>{att.filename}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl ml-2">✕</button>
        </div>

        {/* Sélect type */}
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "rgb(100 116 139)" }}>Type de document</label>
          <select
            value={docTypeOverrides[attIndex] ?? ""}
            onChange={(e) => onChangeType(attIndex, e.target.value)}
            className="w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none"
            style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
          >
            <option value="">— Identifier le type —</option>
            {DOC_TYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Lien aperçu */}
        {linkUrl && (
          <a href={linkUrl} target="_blank" rel="noopener noreferrer"
            className="block text-center text-sm font-medium px-4 py-2 rounded-xl"
            style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
            Ouvrir le document →
          </a>
        )}

        {/* Actions */}
        {vStatus === "pending" && (
          <div className="flex gap-2">
            <button
              disabled={!!validating}
              onClick={() => { onValidate(att); onClose(); }}
              className="flex-1 text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
              style={{ background: "rgba(22,163,74,0.1)", color: "rgb(22 163 74)" }}>
              ✅ Valider
            </button>
            <button
              disabled={!!validating}
              onClick={() => { onReject(att); onClose(); }}
              className="flex-1 text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-50"
              style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}>
              ❌ Rejeter
            </button>
          </div>
        )}
        {vStatus !== "pending" && (
          <p className="text-center text-sm font-medium" style={{ color: vStatus === "validated" ? "rgb(22 163 74)" : "rgb(220 38 38)" }}>
            {vStatus === "validated" ? "✅ Validé" : "❌ Rejeté"}
          </p>
        )}
      </div>
    </div>
  );
}

function DossierWidget({ emailId }: {
  body?: string | null | undefined;
  attachments?: AttachmentInfo[];
  gmailMessageId?: string | null;
  emailId?: string;
  portalHasToken?: boolean;
}) {
  // Version simplifiée : renvoi vers la fiche prospect complète
  return (
    <Section title="Dossier locataire">
      <a
        href={emailId ? `/leads?email=${emailId}` : "/leads"}
        className="flex items-center gap-2 w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-colors"
        style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)", border: "1px solid rgba(79,70,229,0.15)" }}
      >
        📋 Voir le dossier complet →
      </a>
    </Section>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _DossierWidgetFull_UNUSED({ body, attachments, gmailMessageId, emailId, portalHasToken }: {
  body: string | null | undefined;
  attachments?: AttachmentInfo[];
  gmailMessageId?: string | null;
  emailId?: string;
  portalHasToken?: boolean;
}) {
  const { toast: notify } = useToast();
  const [docs, setDocs] = useState<Record<string, DocStatus>>(
    Object.fromEntries(DOCS.map((d) => [d.key, "unknown"]))
  );
  const [validationStatus, setValidationStatus] = useState<Record<string, DocValidationStatus>>({});
  const [validating, setValidating] = useState<string | null>(null);
  // Rejection modal state
  const [rejectModal, setRejectModal] = useState<{ attachmentId: string; filename: string; docType: string | null } | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECTION_REASONS[0]);
  // docType overrides per attachment index
  const [docTypeOverrides, setDocTypeOverrides] = useState<Record<number, string>>({});
  // Preview modal state
  const [previewModal, setPreviewModal] = useState<{ att: AttachmentInfo; idx: number } | null>(null);

  // BLOC 3 : auto-marquer depuis les noms de fichiers des pièces jointes
  // Priorité : att.docType (nouveau, string) > att.docTypes (ancien, Record) > détection locale
  useEffect(() => {
    if (!attachments || attachments.length === 0) return;
    // Map nouveau docType string → clé DOCS
    const toDocsKey = (dt: string): string | null => {
      if (dt === "fiche_paie" || dt === "fiches_paie") return "fiches_paie";
      if (dt === "contrat_travail" || dt === "contrat") return "contrat";
      if (dt === "avis_imposition") return "avis_imposition";
      if (dt === "piece_identite") return "piece_identite";
      return null;
    };
    const updates: Record<string, DocStatus> = {};
    for (const att of attachments) {
      // Nouveau format : docType string
      const docType = (att as any).docType as string | undefined;
      if (docType && docType !== "autre") {
        const key = toDocsKey(docType);
        if (key) updates[key] = "recu";
        continue;
      }
      // Ancien format : docTypes Record<string, boolean>
      const docTypes = (att as any).docTypes as Record<string, boolean> | undefined;
      if (docTypes) {
        for (const [key, val] of Object.entries(docTypes)) {
          if (val) { const k = toDocsKey(key) ?? key; updates[k] = "recu"; }
        }
        continue;
      }
      // Fallback : détection locale par nom de fichier
      const fname = att.filename.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (fname.includes("fiche") || fname.includes("paie") || fname.includes("bulletin"))
        updates.fiches_paie = "recu";
      if (fname.includes("contrat") || fname.includes("cdi") || fname.includes("cdd"))
        updates.contrat = "recu";
      if (fname.includes("imposition") || fname.includes("avis") || fname.includes("impot"))
        updates.avis_imposition = "recu";
      if (fname.includes("identite") || fname.includes("cni") || fname.includes("passeport") || fname.includes("carte"))
        updates.piece_identite = "recu";
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

  // ── BLOC 3 : Validation / Rejet ─────────────────────────────────────────

  // Détermine le docType d'une attachment — supporte nouveau format (string) et ancien (Record)
  function getAttDocType(att: AttachmentInfo): string | null {
    // Nouveau format : docType string direct
    const docType = (att as any).docType as string | undefined;
    if (docType && docType !== "autre") return docType;
    // Ancien format : docTypes Record<string, boolean>
    const dt = (att as any).docTypes as Record<string, boolean> | undefined;
    if (dt) {
      for (const [k, v] of Object.entries(dt)) { if (v) return k; }
    }
    // Fallback par nom de fichier
    const fname = att.filename.toLowerCase();
    if (fname.includes("paie") || fname.includes("bulletin")) return "fiche_paie";
    if (fname.includes("contrat")) return "contrat_travail";
    if (fname.includes("imposition") || fname.includes("impot")) return "avis_imposition";
    if (fname.includes("identite") || fname.includes("cni") || fname.includes("passeport") || fname.includes("carte")) return "piece_identite";
    return null;
  }

  const handleValidateDoc = async (att: AttachmentInfo) => {
    if (!emailId || validating) return;
    const docType = getAttDocType(att);
    setValidating(att.attachmentId);

    // Calculer si le dossier sera complet après validation de ce doc
    const newValidated = { ...validationStatus, [att.attachmentId]: "validated" as DocValidationStatus };
    const validatedDocTypes = new Set(
      (attachments ?? [])
        .filter(a => newValidated[a.attachmentId] === "validated")
        .map(a => getAttDocType(a))
        .filter(Boolean)
    );
    // Map docType variants to DOCS keys (supporte nouveau format fiche_paie/contrat_travail et ancien)
    const normalize = (k: string | null) => {
      if (k === "contrat_travail") return "contrat";
      if (k === "fiche_paie" || k === "fiches_paie") return "fiches_paie";
      return k;
    };
    const docsComplet = DOCS.every(d => {
      const normalized = normalize(d.key);
      return validatedDocTypes.has(d.key) || validatedDocTypes.has(normalized ?? d.key)
        || (d.key === "contrat" && validatedDocTypes.has("contrat_travail"))
        || (d.key === "fiches_paie" && validatedDocTypes.has("fiche_paie"));
    });

    try {
      const res = await fetch("/api/emails/validate-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId,
          attachmentId: att.attachmentId,
          filename: att.filename,
          docType,
          action: "validate",
          dossierComplet: docsComplet,
        }),
      });
      if (res.ok) {
        setValidationStatus(prev => ({ ...prev, [att.attachmentId]: "validated" }));
        // Auto-check doc in checklist
        if (docType) {
          const checkKey = normalize(docType) ?? docType;
          setDocs(prev => ({ ...prev, [checkKey]: "recu" }));
        }
        if (docsComplet) {
          notify("🎉 Dossier complet ! Email envoyé au prospect.", "success");
        } else {
          notify(`✅ ${att.filename} validé`, "success");
        }
      } else {
        notify("Erreur lors de la validation", "error");
      }
    } catch {
      notify("Erreur réseau", "error");
    } finally {
      setValidating(null);
    }
  };

  const handleRejectConfirm = async () => {
    if (!emailId || !rejectModal || validating) return;
    const { attachmentId, filename, docType } = rejectModal;
    setValidating(attachmentId);
    try {
      const res = await fetch("/api/emails/validate-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailId,
          attachmentId,
          filename,
          docType,
          action: "reject",
          rejectionReason: rejectReason,
        }),
      });
      if (res.ok) {
        setValidationStatus(prev => ({ ...prev, [attachmentId]: "rejected" }));
        notify(`❌ Rejet envoyé pour ${filename}`, "success");
      } else {
        notify("Erreur lors du rejet", "error");
      }
    } catch {
      notify("Erreur réseau", "error");
    } finally {
      setValidating(null);
      setRejectModal(null);
      setRejectReason(REJECTION_REASONS[0]);
    }
  };

  const gmailUrl = gmailMessageId
    ? `https://mail.google.com/mail/u/0/#inbox/${gmailMessageId}`
    : null;

  // Mettre à jour docType d'une PJ via l'API
  const updateDocType = async (attIndex: number, newDocType: string) => {
    if (!emailId) return;
    setDocTypeOverrides(prev => ({ ...prev, [attIndex]: newDocType }));
    try {
      await fetch(`/api/emails/${emailId}/update-attachment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attachmentIndex: attIndex, docType: newDocType }),
      });
    } catch { /* graceful */ }
  };

  // Comptage documents validés (validated_by_human)
  const validatedDocTypes = new Set<string>();
  (attachments ?? []).forEach((att: any) => {
    if (att.validated_by_human) {
      // Nouveau format docType string
      if (att.docType && att.docType !== "autre") validatedDocTypes.add(att.docType);
      // Ancien format docTypes Record
      const dt = att.docTypes as Record<string, boolean> | undefined;
      if (dt) Object.entries(dt).forEach(([k, v]) => { if (v) validatedDocTypes.add(k); });
    }
  });
  const validatedCount = DOCS.filter(d => validatedDocTypes.has(d.key) ||
    (d.key === "fiches_paie" && validatedDocTypes.has("fiche_paie")) ||
    (d.key === "contrat" && validatedDocTypes.has("contrat_travail"))).length;

  // Construire une map docKey → meilleure AI confidence parmi les pièces jointes
  const docAiConfidence = new Map<string, number>();
  (attachments ?? []).forEach((att: any) => {
    const conf = typeof att.ai_confidence === "number" ? att.ai_confidence as number : null;
    if (conf === null) return;
    const docTypeStr = (att.docType as string | undefined) ?? null;
    if (!docTypeStr || docTypeStr === "autre") return;
    const normalize = (t: string) => {
      if (t === "fiche_paie" || t === "fiches_paie") return "fiches_paie";
      if (t === "contrat_travail" || t === "contrat") return "contrat";
      return t;
    };
    const key = normalize(docTypeStr);
    if ((docAiConfidence.get(key) ?? -1) < conf) docAiConfidence.set(key, conf);
  });

  return (
    <Section title="Dossier locataire">
      {/* Barre de progression validés */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs mb-1" style={{ color: "rgb(100 116 139)" }}>
          <span>{validatedCount}/{DOCS.length} documents validés</span>
          <span>{Math.round((validatedCount / DOCS.length) * 100)}%</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
          <div className="h-full rounded-full transition-all duration-500" style={{
            width: `${Math.round((validatedCount / DOCS.length) * 100)}%`,
            background: validatedCount >= DOCS.length ? "rgb(22,163,74)" : validatedCount > 0 ? "rgb(234,88,12)" : "rgb(220,38,38)",
          }} />
        </div>
      </div>

      {/* Checklist documents avec statuts IA */}
      <div className="space-y-1.5 mb-4">
        {DOCS.map((doc) => {
          const status = docs[doc.key];
          const isValidated = validatedDocTypes.has(doc.key) ||
            (doc.key === "fiches_paie" && validatedDocTypes.has("fiche_paie")) ||
            (doc.key === "contrat" && validatedDocTypes.has("contrat_travail"));
          const isRecu = status === "recu" || isValidated;
          const aiConf = docAiConfidence.get(doc.key) ?? null;
          // Statuts : ✓ Validé | 🤖 IA (≥70%) | ⚠️ Doute IA (<70%) | ✗ Manquant
          let statusLabel: string;
          let statusColor: string;
          let statusBg: string;
          let borderColor: string;
          if (isValidated) {
            statusLabel = "✓ Validé"; statusColor = "rgb(22 163 74)";
            statusBg = "rgba(22,163,74,0.06)"; borderColor = "rgba(22,163,74,0.15)";
          } else if (isRecu && aiConf !== null && aiConf >= 0.7) {
            statusLabel = "🤖 Classifié IA"; statusColor = "rgb(2 132 199)";
            statusBg = "rgba(2,132,199,0.06)"; borderColor = "rgba(2,132,199,0.15)";
          } else if (isRecu && aiConf !== null && aiConf < 0.7) {
            statusLabel = "⚠️ Doute IA"; statusColor = "rgb(234 88 12)";
            statusBg = "rgba(234,88,12,0.06)"; borderColor = "rgba(234,88,12,0.15)";
          } else if (isRecu) {
            statusLabel = "⏳ Reçu"; statusColor = "rgb(234 88 12)";
            statusBg = "rgba(234,88,12,0.06)"; borderColor = "rgba(234,88,12,0.15)";
          } else {
            statusLabel = "✗ Manquant"; statusColor = "rgb(220 38 38)";
            statusBg = "rgba(226,232,240,0.4)"; borderColor = "rgb(226 232 240)";
          }
          return (
            <div
              key={doc.key}
              onClick={() => toggle(doc.key)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors"
              style={{ background: statusBg, border: `1px solid ${borderColor}` }}
            >
              <span className="text-xs font-medium flex-shrink-0" style={{ color: statusColor, minWidth: 72 }}>{statusLabel}</span>
              <span className="text-sm" style={{ color: "rgb(30 41 59)" }}>{doc.label}</span>
            </div>
          );
        })}
      </div>

      {/* ── BLOC 2 + 3 : Documents reçus avec validation manuelle ── */}
      {portalHasToken ? (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg"
            style={{ background: "rgba(79,70,229,0.06)", border: "1px solid rgba(79,70,229,0.15)" }}>
            <span className="text-base">📎</span>
            <div>
              <p className="text-sm font-medium" style={{ color: "rgb(79 70 229)" }}>
                Dossier sur portail
              </p>
              <p className="text-xs" style={{ color: "rgb(100 116 139)" }}>
                Gérez les documents depuis la fiche prospect
              </p>
            </div>
          </div>
        </div>
      ) : attachments && attachments.length > 0 && (
        <div className="mt-4 pt-3 border-t" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>
              📎 Documents reçus
            </span>
            <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>
              (vérification manuelle requise)
            </span>
          </div>
          <div className="space-y-2">
            {attachments.map((att, i) => {
              const linkUrl: string | null = (att as any).gmailLink ?? (att as any).storage_url ?? gmailUrl;
              const isPdf = att.mimeType?.includes("pdf");
              const isImage = att.mimeType?.startsWith("image/");
              const icon = isPdf ? "📄" : isImage ? "🖼️" : "📎";
              const vStatus = validationStatus[att.attachmentId] ?? "pending";
              const isValidatingThis = validating === att.attachmentId;
              const detectedType = docTypeOverrides[i] ?? getAttDocType(att);
              const typeIsUnknown = !detectedType || detectedType === "autre";
              const attAiConf = (att as any).ai_confidence as number | null | undefined;

              const statusBadge =
                vStatus === "validated" ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                    style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}>
                    ✓ Validé
                  </span>
                ) : vStatus === "rejected" ? (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                    style={{ background: "rgba(220,38,38,0.1)", color: "rgb(220,38,38)" }}>
                    ✗ Rejeté
                  </span>
                ) : attAiConf !== null && attAiConf !== undefined ? (
                  attAiConf >= 0.7 ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                      style={{ background: "rgba(2,132,199,0.1)", color: "rgb(2,132,199)" }}>
                      🤖 IA {Math.round(attAiConf * 100)}%
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                      style={{ background: "rgba(234,88,12,0.08)", color: "rgb(234,88,12)" }}>
                      ⚠️ Doute {Math.round(attAiConf * 100)}%
                    </span>
                  )
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
                    style={{ background: "rgba(234,88,12,0.08)", color: "rgb(234,88,12)" }}>
                    ⏳ Reçu
                  </span>
                );

              return (
                <div key={i} className="rounded-lg border p-3"
                  style={{
                    borderColor: vStatus === "validated" ? "rgba(22,163,74,0.25)"
                      : vStatus === "rejected" ? "rgba(220,38,38,0.2)"
                      : "rgb(226 232 240)",
                    background: vStatus === "validated" ? "rgba(22,163,74,0.03)"
                      : vStatus === "rejected" ? "rgba(220,38,38,0.03)"
                      : "rgb(250 250 252)",
                  }}>
                  {/* Ligne 1: icône + nom + taille + lien */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base flex-shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }} title={att.filename}>
                        {att.filename}
                      </p>
                      <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                        {att.size > 0 ? `${Math.round(att.size / 1024)} Ko` : "—"}
                        {!typeIsUnknown && (
                          <> · <span style={{ color: "rgb(79 70 229)" }}>
                            {DOC_TYPE_OPTIONS.find(o => o.value === detectedType)?.label ?? detectedType}
                          </span></>
                        )}
                      </p>
                    </div>
                    {/* Bouton Aperçu */}
                    {att.attachmentId && gmailMessageId && (
                      <button
                        onClick={() => setPreviewModal({ att, idx: i })}
                        className="text-xs px-2 py-1 rounded-lg font-medium flex-shrink-0"
                        style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}
                        title="Ouvrir l'aperçu"
                      >
                        👁 Aperçu
                      </button>
                    )}
                    {linkUrl && (
                      <a href={linkUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2 py-1 rounded-lg font-medium flex-shrink-0"
                        style={{ background: "rgba(79,70,229,0.06)", color: "rgb(100 116 139)" }}>
                        Gmail →
                      </a>
                    )}
                    {att.attachmentId && gmailMessageId && (
                      <a
                        href={`/api/emails/download-attachment?gmailMessageId=${encodeURIComponent(gmailMessageId)}&attachmentId=${encodeURIComponent(att.attachmentId)}&filename=${encodeURIComponent(att.filename)}&mimeType=${encodeURIComponent(att.mimeType ?? "")}`}
                        download={att.filename}
                        className="text-xs px-2 py-1 rounded-lg font-medium flex-shrink-0"
                        style={{ background: "rgba(100,116,139,0.08)", color: "rgb(71 85 105)" }}
                      >
                        ⬇️
                      </a>
                    )}
                  </div>

                  {/* Sélect type si inconnu */}
                  {typeIsUnknown && (
                    <div className="mb-2">
                      <select
                        value={docTypeOverrides[i] ?? ""}
                        onChange={(e) => updateDocType(i, e.target.value)}
                        className="w-full rounded-lg border px-2 py-1.5 text-xs focus:outline-none"
                        style={{ borderColor: "rgb(234 88 12)", color: "rgb(30 41 59)", background: "rgba(234,88,12,0.04)" }}
                      >
                        <option value="">— Identifier le type de document —</option>
                        {DOC_TYPE_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Ligne 2: statut + boutons */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {statusBadge}
                    {vStatus === "pending" && (
                      <>
                        <button
                          disabled={!!validating}
                          onClick={() => handleValidateDoc(att)}
                          className="text-xs px-2 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
                          style={{ background: "rgba(22,163,74,0.1)", color: "rgb(22,163,74)" }}
                        >
                          {isValidatingThis ? "…" : "✓ Valider"}
                        </button>
                        <button
                          disabled={!!validating}
                          onClick={() => {
                            setRejectModal({ attachmentId: att.attachmentId, filename: att.filename, docType: detectedType });
                            setRejectReason(REJECTION_REASONS[0]);
                          }}
                          className="text-xs px-2 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
                          style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220,38,38)" }}
                        >
                          ✗ Rejeter
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal aperçu document ── */}
      {previewModal && gmailMessageId && emailId && (
        <DocPreviewModal
          att={previewModal.att as AttachmentInfo & Record<string, unknown>}
          gmailMessageId={gmailMessageId}
          emailId={emailId}
          onClose={() => setPreviewModal(null)}
          onValidate={(a) => { handleValidateDoc(a); }}
          onReject={(a) => {
            setRejectModal({ attachmentId: a.attachmentId, filename: a.filename, docType: getAttDocType(a) });
            setRejectReason(REJECTION_REASONS[0]);
          }}
          validationStatus={validationStatus}
          validating={validating}
          docTypeOverrides={docTypeOverrides}
          onChangeType={updateDocType}
          attIndex={previewModal.idx}
        />
      )}

      {/* ── Modal rejet ── */}
      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.4)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setRejectModal(null); }}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="text-base font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
              Rejeter le document
            </h3>
            <p className="text-xs mb-4" style={{ color: "rgb(100 116 139)" }}>
              {rejectModal.filename}
            </p>
            <div className="mb-3">
              <label className="text-xs font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Raison du rejet
              </label>
              <select
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              >
                {REJECTION_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <p className="text-xs mb-4" style={{ color: "rgb(148 163 184)" }}>
              Un email sera envoyé automatiquement au prospect avec cette raison.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setRejectModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
              >
                Annuler
              </button>
              <button
                onClick={handleRejectConfirm}
                disabled={!!validating}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "rgb(220 38 38)" }}
              >
                {validating ? "Envoi…" : "Confirmer le rejet"}
              </button>
            </div>
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
      {/* Créneaux issus de l'agenda local (Google Calendar synchronisé) */}
      <p className="text-xs mb-2" style={{ color: "rgb(148 163 184)" }}>
        📅 Créneaux libres depuis votre agenda Google Calendar
      </p>
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

/* ===================== BLOC 6 : NOTES INTERNES ===================== */

function NotesWidget({ emailId }: { emailId: string }) {
  const [notes, setNotes] = useState<Array<{ id: string; description: string | null; created_at: string }>>([]);
  const [newNote, setNewNote] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast: showToast } = useToast();

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${emailId}/timeline`);
      if (!res.ok) {
        console.warn("[NotesWidget] GET timeline failed:", res.status);
        return;
      }
      const data = await res.json();
      setNotes((data.timeline ?? []).filter((e: any) => e.action_type === "NOTE_INTERNE"));
    } catch (e) {
      console.warn("[NotesWidget] Fetch error:", e);
    }
  }, [emailId]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);

  const saveNote = async () => {
    if (!newNote.trim() || saving) return;
    setSaving(true);
    console.log("[NotesWidget] Saving note — emailId:", emailId, "text:", newNote.trim().substring(0, 50));
    try {
      const res = await fetch(`/api/leads/${emailId}/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action_type: "NOTE_INTERNE",
          description: newNote.trim(),
          metadata: { internal: true },
        }),
      });
      if (res.ok) {
        setNewNote("");
        showToast("Note sauvegardée ✅", "success");
        console.log("[NotesWidget] ✅ Note saved");
        fetchNotes();
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("[NotesWidget] ❌ Save failed:", res.status, errData);
        const msg = (errData as any)?.error ?? "";
        if (msg.includes("does not exist") || res.status === 500) {
          showToast("Table prospect_timeline introuvable — lancez /api/admin/migrate", "error");
        } else {
          showToast("Erreur lors de la sauvegarde de la note", "error");
        }
      }
    } catch (e) {
      console.error("[NotesWidget] ❌ Network error:", e);
      showToast("Erreur réseau — note non sauvegardée", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "rgb(226 232 240)" }}>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
          📝 Notes internes
        </div>
      </div>
      <div className="p-4 space-y-3">
        {/* Existing notes */}
        {notes.length > 0 && (
          <div className="space-y-2">
            {notes.map((note) => (
              <div key={note.id} className="rounded-lg p-3" style={{ background: "rgb(250 250 252)", border: "1px solid rgb(226 232 240)" }}>
                <div className="text-sm" style={{ color: "rgb(30 41 59)" }}>{note.description}</div>
                <div className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>
                  {new Date(note.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                  {" "}
                  {new Date(note.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
          </div>
        )}
        {/* New note */}
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Ajouter une note interne (visible uniquement par vous)…"
          rows={3}
          className="w-full rounded-lg border px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-indigo-300"
          style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
        />
        <button
          onClick={saveNote}
          disabled={saving || !newNote.trim()}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-50"
          style={{ background: "rgb(79 70 229)" }}
        >
          {saving ? "Sauvegarde…" : "💾 Sauvegarder"}
        </button>
      </div>
    </div>
  );
}

/* ===================== BLOC 2 : TIMELINE ===================== */

const ACTION_ICONS: Record<string, string> = {
  EMAIL_RECU: "📧",
  IA_REPONDU: "🤖",
  PROSPECT_REPONDU: "📧",
  VISITE_PROPOSEE: "📅",
  VISITE_CONFIRMEE: "✅",
  VISITE_EFFECTUEE: "🏠",
  DOSSIER_DEMANDE: "📋",
  DOCUMENT_RECU: "📎",
  VALIDE: "🎉",
  REFUSE: "❌",
  RELANCE: "🔁",
  NOTE_INTERNE: "📝",
};

function TimelineWidget({ emailId, emailReceivedAt }: { emailId: string; emailReceivedAt?: string | null }) {
  const [timeline, setTimeline] = useState<Array<{
    id: string;
    action_type: string;
    description: string | null;
    created_at: string;
    metadata: Record<string, unknown>;
  }>>([]);
  const [loading, setLoading] = useState(true);

  const loadTimeline = useCallback(async () => {
    if (!emailId) return;
    try {
      const res = await fetch(`/api/leads/${emailId}/timeline`);
      const data = await res.json();
      const tl: typeof timeline = data.timeline ?? [];
      if (tl.length === 0 && emailId) {
        // Auto-créer l'entrée EMAIL_RECU si timeline vide
        try {
          await fetch(`/api/leads/${emailId}/timeline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action_type: "EMAIL_RECU",
              description: "Email reçu",
              metadata: { auto_created: true, email_received_at: emailReceivedAt ?? null },
            }),
          });
          const res2 = await fetch(`/api/leads/${emailId}/timeline`);
          const data2 = await res2.json();
          setTimeline(data2.timeline ?? []);
        } catch {
          setTimeline([]);
        }
      } else {
        setTimeline(tl);
      }
    } catch {
      setTimeline([]);
    } finally {
      setLoading(false);
    }
  }, [emailId, emailReceivedAt]);

  useEffect(() => { loadTimeline(); }, [loadTimeline]);

  if (loading) return null;

  return (
    <div className="rounded-xl border bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
      <div className="px-4 py-3 border-b" style={{ borderColor: "rgb(226 232 240)" }}>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
          🕐 Historique
        </div>
      </div>
      <div className="divide-y" style={{ borderColor: "rgb(241 245 249)" }}>
        {timeline.map((entry) => {
          const icon = ACTION_ICONS[entry.action_type] ?? "•";
          const date = new Date(entry.created_at);
          const dateStr = date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
          const timeStr = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
          return (
            <div key={entry.id} className="px-4 py-2.5 flex items-start gap-3">
              <span className="text-sm flex-shrink-0 mt-0.5">{icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium" style={{ color: "rgb(30 41 59)" }}>
                  {entry.description ?? entry.action_type}
                </div>
              </div>
              <div className="text-xs flex-shrink-0" style={{ color: "rgb(148 163 184)" }}>
                {dateStr} {timeStr}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===================== BLOC 7 : BIEN CONCERNÉ ===================== */

function BienConcerneWidget({ propertyId }: { propertyId: string | null }) {
  const [property, setProperty] = useState<{ title: string; rent: number; type: string | null } | null>(null);

  useEffect(() => {
    if (!propertyId) { setProperty(null); return; }
    fetch("/api/properties")
      .then((r) => r.json())
      .then((data) => {
        const props: Array<{ id: string; title: string; rent: number; type: string | null }> = data.properties ?? [];
        const found = props.find((p) => p.id === propertyId);
        setProperty(found ?? null);
      })
      .catch(() => {});
  }, [propertyId]);

  if (!propertyId) return null;

  return (
    <div
      className="rounded-xl border p-3 bg-white animate-fade-in"
      style={{ borderColor: "rgba(79,70,229,0.25)", background: "rgba(79,70,229,0.03)" }}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm">🏠</span>
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
          Bien concerné
        </div>
      </div>
      {property ? (
        <div className="mt-2 flex items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold" style={{ color: "rgb(30 41 59)" }}>
              {property.title}
            </div>
            {property.type && (
              <span className="text-xs px-1.5 py-0.5 rounded mt-0.5 inline-block"
                style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79,70,229)" }}>
                {property.type}
              </span>
            )}
          </div>
          <div className="text-right">
            <div className="text-base font-bold" style={{ color: "rgb(79 70 229)" }}>
              {property.rent.toLocaleString("fr-FR")} €
            </div>
            <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>/mois</div>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs" style={{ color: "rgb(148 163 184)" }}>
          Chargement…
        </div>
      )}
    </div>
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
  const [exportingPdf, setExportingPdf] = useState(false);
  const [portalHasToken, setPortalHasToken] = useState(false);

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
    setPortalHasToken(false);
    if (email?.id) {
      fetch(`/api/portal/status?emailId=${email.id}`)
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d?.hasToken) setPortalHasToken(true); })
        .catch(() => {});
    }
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

  const exportPdf = async () => {
    if (!email || exportingPdf) return;
    setExportingPdf(true);
    try {
      const res = await fetch(`/api/prospects/${email.id}/export-pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const today = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `Dossier_${today}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      notify("PDF exporté ✅", "success");
    } catch (e) {
      console.error("[exportPdf] erreur:", e);
      notify("Erreur lors de la génération du PDF", "error");
    } finally {
      setExportingPdf(false);
    }
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
      {(() => {
        const tl = computeTrafficLight(email, mode);
        const tlCfg = TL_CFG[tl];
        return (
          <div className="rounded-xl border p-4 bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
            <div className="flex items-start justify-between gap-4 mb-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span title={tlCfg.label} style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: tlCfg.dot, flexShrink: 0 }} />
                <h2 className="text-base font-semibold truncate" style={{ color: "rgb(30 41 59)" }}>
                  {email.subject || "(Sans objet)"}
                </h2>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {/* Badge feu tricolore */}
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ background: tlCfg.bg, color: tlCfg.color }}>
                  {tl === "AUTOPILOTE" ? "🟢" : tl === "DRAFT" ? "🟡" : "🔴"} {tlCfg.label}
                </span>
                {/* Badge intention */}
                {intention && (
                  <span className="text-xs px-2 py-1 rounded-full font-medium"
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
            </div>
            {(() => {
              const senderStr = email.sender ?? "";
              const pdNom = ((email as any).prospect_data as Record<string, unknown> | null)?.nom as string | null ?? null;
              // Nom : priorité prospect_data.nom (si pas un email), sinon extraire du format Gmail
              const nameFromSender = senderStr.match(/^(.+?)\s*<[^>]+>$/)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
              const displayName =
                pdNom && String(pdNom) !== "null" && !pdNom.includes("@")
                  ? pdNom
                  : nameFromSender && nameFromSender.length >= 2 && !nameFromSender.includes("@")
                  ? nameFromSender
                  : null;
              // Email : extraire l'adresse entre <> ou utiliser le sender brut s'il est déjà une adresse
              const emailAddr =
                senderStr.match(/<([^>]+)>/)?.[1] ??
                (senderStr.includes("@") ? senderStr.trim() : null);
              return (
                <>
                  {displayName && (
                    <div className="text-sm font-medium mb-0.5" style={{ color: "rgb(30 41 59)" }}>
                      {displayName}
                    </div>
                  )}
                  <div className="text-sm mb-0.5" style={{ color: "rgb(100 116 139)" }}>
                    {emailAddr ? (
                      <a href={`mailto:${emailAddr}`} className="hover:underline">{emailAddr}</a>
                    ) : (
                      senderStr || "Expéditeur inconnu"
                    )}
                  </div>
                </>
              );
            })()}
            <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
              {email.received_at ? new Date(email.received_at).toLocaleString("fr-FR") : ""}
            </div>
          </div>
        );
      })()}

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
          {/* BLOC 7 : Bien concerné */}
          <BienConcerneWidget
            propertyId={(email as any).property_id ?? (email as any).prospect_data?.property_id ?? null}
          />
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
          <SolvabiliteWidget
            body={body || email.body}
            prospectData={(email as any).prospect_data ?? null}
            propertyId={(email as any).property_id ?? null}
          />
          <DossierWidget
            body={body || email.body}
            attachments={(email as any).attachments ?? []}
            gmailMessageId={email.gmail_message_id}
            emailId={email.id}
            portalHasToken={portalHasToken}
          />
          <DocumentsTemplateWidget email={email} mode={mode} />
          <BookingWidget email={email} mode={mode} onApprove={handleBookingApprove} />
          <TimelineWidget emailId={email.id} emailReceivedAt={email.received_at} />
          <NotesWidget emailId={email.id} />

          {/* BLOC 4 — Export dossier PDF (visible si au moins 1 document reçu) */}
          {((email as any).attachments ?? []).length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={exportPdf}
                disabled={exportingPdf}
                className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-opacity disabled:opacity-60"
                style={{
                  background: "rgb(79 70 229)",
                  color: "white",
                }}
              >
                {exportingPdf ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Génération en cours…
                  </>
                ) : (
                  <>
                    📄 Exporter dossier PDF
                  </>
                )}
              </button>
            </div>
          )}
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
