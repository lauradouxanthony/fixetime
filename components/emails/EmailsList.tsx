"use client";

type Email = {
  id: string;
  sender: string | null;
  subject: string | null;
  received_at: string | null;
  decision?: string | null;
  estimated_time?: number | null;
  recommended_action?: string | null;
  summary?: string | null;
  is_urgent?: boolean | null;
  is_important?: boolean | null;
  category?: string | null;
  classification_reason?: string | null;
  prospect_data?: Record<string, unknown> | null;
  attachments?: unknown[] | null;
};

/* ────────────────────────── HELPERS ────────────────────────── */

function normalizeDecision(decision?: string | null): "traiter" | "ignorer" | "planifier" | null {
  if (!decision) return null;
  const d = String(decision).trim().toLowerCase();
  if (d.includes("trait")) return "traiter";
  if (d.includes("ignor")) return "ignorer";
  if (d.includes("deleg") || d.includes("planif")) return "planifier";
  return null;
}

function getIntentionFromCategory(category?: string | null) {
  const c = (category || "").toUpperCase();
  if (c === "LOCATION") return "LOCATION";
  if (c === "INFO") return "INFO";
  if (c === "HORS_SUJET") return "HORS_SUJET";
  return null;
}

function computeScore(email: Email): number {
  const cat = (email.category || "").toUpperCase();

  if (email.classification_reason === "RDV_CONFIRMÉ") return 10;

  if (cat === "LOCATION") {
    if (email.is_urgent) return 9;
    if (email.is_important) return 8;
    if (email.decision === "traiter") return 7;
    if (email.decision === "planifier") return 6;
    return 5;
  }

  if (cat === "INFO") {
    if (email.is_urgent) return 6;
    if (email.is_important) return 5;
    if (email.decision === "traiter") return 4;
    if (email.decision === "planifier") return 3;
    return 3;
  }

  if (cat === "HORS_SUJET") return 1;

  // Non analysé
  if (!email.decision && !email.category) return 4;

  if (email.is_important) return 5;
  if (email.decision === "traiter") return 4;
  return 2;
}

/**
 * Tri groupé :
 *   Groupe 0 — LOCATION score ≥ 8 (leads chauds)
 *   Groupe 1 — LOCATION score < 8 (leads qualifiés)
 *   Groupe 2 — Non encore analysés (apparaissent dès le sync)
 *   Groupe 3 — INFO
 *   Groupe 4 — HORS_SUJET (grisés en bas)
 *
 * À score égal → plus récent en premier.
 */
function hasProspectQualification(email: Email): boolean {
  const pd = (email as any).prospect_data as Record<string, unknown> | null;
  if (!pd) return false;
  const nom = pd.nom as string | null | undefined;
  return !!(
    (nom && String(nom) !== "null" && nom.trim().length > 0) ||
    pd.situation_pro ||
    pd.revenus_mensuels
  );
}

function sortEmails(emails: Email[]): Email[] {
  const getGroup = (email: Email): number => {
    const cat = (email.category || "").toUpperCase();
    if (!cat && !email.decision) return 2;          // non analysé
    // Leads chauds : LOCATION score ≥ 8 ET données prospect qualifiantes
    // (évite que pubs/webinaires marqués is_important remontent en groupe 0)
    if (cat === "LOCATION" && computeScore(email) >= 8 && hasProspectQualification(email)) return 0;
    if (cat === "LOCATION") return 1;
    if (cat === "INFO") return 3;
    if (cat === "HORS_SUJET") return 4;
    return 2;
  };

  return [...emails].sort((a, b) => {
    const ga = getGroup(a);
    const gb = getGroup(b);
    if (ga !== gb) return ga - gb;
    const sa = computeScore(a);
    const sb = computeScore(b);
    if (sa !== sb) return sb - sa;
    const ta = new Date(a.received_at || 0).getTime();
    const tb = new Date(b.received_at || 0).getTime();
    return tb - ta;
  });
}

function getEmailPreview(email: Email) {
  if (email.summary) return email.summary;
  const d = normalizeDecision(email.decision);
  if (d === "traiter") return "Action requise — réponse attendue";
  if (d === "planifier") return "À planifier — réponse ultérieure";
  if (d === "ignorer") return "Email ignoré automatiquement";
  return "Analyse en cours…";
}

/* ────────────────── AVATAR (couleur = score) ─────────────────── */

function Avatar({ name, score }: { name: string | null; score: number }) {
  const clean = (name || "").replace(/<.*>/, "").trim();
  const initials =
    clean
      .split(/[\s@.]+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "?";

  // Rouge = chaud (≥8), Orange = tiède (6-7), Ardoise = neutre (4-5), Gris = froid (<4)
  const bg =
    score >= 8 ? "rgb(220,38,38)" :
    score >= 6 ? "rgb(234,88,12)" :
    score >= 4 ? "rgb(100,116,139)" :
    "rgb(203,213,225)";

  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
      style={{ background: bg }}
      title={clean}
    >
      {initials}
    </div>
  );
}

/* ────────────────── STAGE DOT ──────────────────── */

function StageDot({ decision }: { decision?: string | null }) {
  const d = (decision || "").toLowerCase();
  if (d === "traiter")   return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgb(234 88 12)" }} />;
  if (d === "planifier") return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgb(37 99 235)" }} />;
  if (d === "ignorer")   return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgb(203 213 225)" }} />;
  return <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: "rgb(148 163 184)" }} />;
}

/* ────────────────── SCORE CIRCLE ──────────────────── */

function ScoreCircle({ score }: { score: number }) {
  const color =
    score >= 8 ? "rgb(220,38,38)" :
    score >= 6 ? "rgb(234,88,12)" :
    score >= 4 ? "rgb(100,116,139)" :
    "rgb(203,213,225)";

  return (
    <div
      className="w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0"
      style={{ borderColor: color }}
      title={`Score : ${score}/10`}
    >
      <span className="text-xs font-bold leading-none" style={{ color }}>
        {score}
      </span>
    </div>
  );
}

/* ────────────────── DOSSIER STATUS BADGE ──────────────────── */

const DOSSIER_ETAPES_REQUIS = ["DOSSIER_DEMANDE", "DOSSIER_RECU", "VALIDE", "REFUSE"];

function computeDossierStatus(email: Email): { label: string; bg: string; color: string } | null {
  const etape = email.prospect_data?.etape_process as string | null | undefined;
  if (!etape || !DOSSIER_ETAPES_REQUIS.includes(etape)) return null;

  const atts = (email.attachments ?? []) as any[];
  const total = 4; // fiches_paie, contrat, avis_imposition, piece_identite
  const docsDetected = new Set<string>();
  for (const att of atts) {
    const dt = att.docTypes as Record<string, boolean> | undefined;
    if (dt) { for (const [k, v] of Object.entries(dt)) { if (v) docsDetected.add(k); } }
  }
  // Normalize contrat_travail → contrat
  if (docsDetected.has("contrat_travail")) docsDetected.add("contrat");
  const count = Math.min(docsDetected.size, total);

  if (count >= total || etape === "VALIDE") {
    return { label: "📂 Complet", bg: "rgba(22,163,74,0.1)", color: "rgb(22,163,74)" };
  } else if (count >= 2) {
    return { label: `📂 Partiel (${count}/${total})`, bg: "rgba(234,88,12,0.1)", color: "rgb(194,65,12)" };
  } else {
    return { label: "📂 Incomplet", bg: "rgba(220,38,38,0.08)", color: "rgb(185,28,28)" };
  }
}

function DossierStatusBadge({ email }: { email: Email }) {
  const status = computeDossierStatus(email);
  if (!status) return null;
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded-full font-medium"
      style={{ background: status.bg, color: status.color }}
    >
      {status.label}
    </span>
  );
}

/* ────────────────── INTENTION BADGE ──────────────────── */

function IntentionBadge({ intention }: { intention: string | null }) {
  if (!intention) return null;
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    LOCATION: { bg: "rgba(59,130,246,0.1)",  text: "rgb(37,99,235)",   label: "Location"   },
    INFO:     { bg: "rgba(100,116,139,0.1)", text: "rgb(71,85,105)",   label: "Info"       },
    HORS_SUJET: { bg: "rgba(15,23,42,0.06)", text: "rgb(148,163,184)", label: "Hors sujet" },
  };
  const s = styles[intention];
  if (!s) return null;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

/* ────────────────── ETAPE BADGE ──────────────────── */

const ETAPE_STYLES: Record<string, { label: string; bg: string; text: string; emoji: string }> = {
  NEW:              { label: "Nouveau",          bg: "rgba(100,116,139,0.1)",  text: "rgb(71,85,105)",   emoji: "🆕" },
  QUALIFICATION:    { label: "Qualification",    bg: "rgba(234,88,12,0.1)",    text: "rgb(194,65,12)",   emoji: "🔍" },
  VISITE_PROPOSEE:  { label: "Visite proposée",  bg: "rgba(59,130,246,0.1)",   text: "rgb(37,99,235)",   emoji: "📅" },
  VISITE_CONFIRMEE: { label: "Visite confirmée", bg: "rgba(22,163,74,0.12)",   text: "rgb(22,163,74)",   emoji: "✅" },
  DOSSIER_DEMANDE:  { label: "Dossier demandé",  bg: "rgba(79,70,229,0.1)",    text: "rgb(79,70,229)",   emoji: "📋" },
  DOSSIER_RECU:     { label: "Dossier reçu",     bg: "rgba(79,70,229,0.15)",   text: "rgb(67,56,202)",   emoji: "📁" },
  VALIDE:           { label: "Validé",            bg: "rgba(22,163,74,0.15)",   text: "rgb(21,128,61)",   emoji: "🎉" },
  REFUSE:           { label: "Refusé",            bg: "rgba(220,38,38,0.1)",    text: "rgb(185,28,28)",   emoji: "❌" },
};

function EtapeBadge({ etape }: { etape: string | null | undefined }) {
  if (!etape || etape === "NEW") return null; // NEW est implicite, pas besoin de badge
  const s = ETAPE_STYLES[etape];
  if (!s) return null;
  return (
    <span
      className="text-xs px-1.5 py-0.5 rounded-full font-medium"
      style={{ background: s.bg, color: s.text }}
    >
      {s.emoji} {s.label}
    </span>
  );
}

/* ────────────────── STATUS PILL ──────────────────── */

function StatusPill({ email }: { email: Email }) {
  if (email.classification_reason === "RDV_CONFIRMÉ") {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}
      >
        ✅ Confirmé
      </span>
    );
  }

  const cat = (email.category || "").toUpperCase();
  const d = normalizeDecision(email.decision);

  if (cat !== "LOCATION") return null;

  if (email.is_urgent) {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(220,38,38,0.1)", color: "rgb(220,38,38)" }}
      >
        🔥 Qualifié
      </span>
    );
  }
  if (email.is_important || d === "traiter") {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(234,88,12,0.1)", color: "rgb(234,88,12)" }}
      >
        🔍 En qualification
      </span>
    );
  }
  if (d === "planifier") {
    return (
      <span
        className="text-xs px-2 py-0.5 rounded-full font-medium"
        style={{ background: "rgba(59,130,246,0.1)", color: "rgb(37,99,235)" }}
      >
        📅 RDV proposé
      </span>
    );
  }
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: "rgba(100,116,139,0.1)", color: "rgb(71,85,105)" }}
    >
      🆕 Nouveau
    </span>
  );
}

/* ────────────────── SEPARATEUR DE GROUPE ──────────────────── */

const GROUP_LABELS: Record<number, string> = {
  0: "🔥 Leads chauds",
  1: "🏠 En qualification",
  2: "⏳ En cours d'analyse",
  3: "ℹ️ Informations",
  4: "🚫 Hors sujet",
};

/* ────────────────── PROPS ──────────────────── */

type EmailsListProps = {
  emails: Email[];
  selectedEmailId: string | null;
  onSelect: (email: Email | null) => void;
  loading: boolean;
};

/* ────────────────── COMPONENT ──────────────────── */

export function EmailsList({ emails, selectedEmailId, onSelect, loading }: EmailsListProps) {
  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="animate-pulse space-y-2">
            <div className="h-3 rounded" style={{ background: "rgb(226 232 240)", width: "60%" }} />
            <div className="h-3 rounded" style={{ background: "rgb(226 232 240)", width: "80%" }} />
            <div className="h-3 rounded" style={{ background: "rgb(226 232 240)", width: "40%" }} />
          </div>
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="p-8 text-center" style={{ color: "rgb(100 116 139)" }}>
        <div className="text-2xl mb-2">📭</div>
        <div className="text-sm">Aucun email trouvé</div>
      </div>
    );
  }

  const sorted = sortEmails(emails);

  // Calcule les groupes pour afficher les séparateurs
  const getGroup = (email: Email): number => {
    const cat = (email.category || "").toUpperCase();
    if (!cat && !email.decision) return 2;
    if (cat === "LOCATION" && computeScore(email) >= 8) return 0;
    if (cat === "LOCATION") return 1;
    if (cat === "INFO") return 3;
    if (cat === "HORS_SUJET") return 4;
    return 2;
  };

  let lastGroup = -1;

  return (
    <div>
      {sorted.map((email) => {
        const group = getGroup(email);
        const showSeparator = group !== lastGroup;
        lastGroup = group;

        const decision = normalizeDecision(email.decision);
        const intention = getIntentionFromCategory(email.category);
        const score = computeScore(email);
        const preview = getEmailPreview(email);
        const isSelected = selectedEmailId === email.id;
        const isRdvConfirme = email.classification_reason === "RDV_CONFIRMÉ";
        const isHorsSujet = intention === "HORS_SUJET";
        const isUnanalyzed = !email.decision && !email.category;

        return (
          <div key={email.id}>
            {/* Séparateur de groupe */}
            {showSeparator && (
              <div
                className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide"
                style={{
                  color: group === 0 ? "rgb(220,38,38)" :
                         group === 1 ? "rgb(234,88,12)" :
                         group === 2 ? "rgb(100,116,139)" :
                         group === 3 ? "rgb(71,85,105)" :
                         "rgb(148,163,184)",
                  background: group === 0 ? "rgba(220,38,38,0.04)" :
                              group === 1 ? "rgba(234,88,12,0.04)" :
                              group === 4 ? "rgba(15,23,42,0.03)" :
                              "rgb(250 250 250)",
                  borderBottom: "1px solid rgb(226 232 240)",
                }}
              >
                {GROUP_LABELS[group] ?? ""}
              </div>
            )}

            {/* Ligne email */}
            <div
              onClick={() => onSelect(email)}
              className="px-4 py-3 border-b cursor-pointer transition-colors"
              style={{
                borderColor: "rgb(226 232 240)",
                background: isSelected ? "rgb(238 242 255)" : "transparent",
                opacity: isHorsSujet && !isSelected ? 0.5 : 1,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)";
              }}
              onMouseLeave={(e) => {
                if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
              }}
            >
              <div className="flex items-start gap-3">
                {/* Avatar coloré selon le score */}
                <Avatar name={email.sender} score={score} />

                <div className="flex-1 min-w-0">
                  {/* Ligne 1 : badges + cercle score */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1 min-w-0 flex-wrap">
                      <StageDot decision={email.decision} />
                      {isRdvConfirme ? (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}
                        >
                          ✅ RDV
                        </span>
                      ) : (
                        <>
                          <IntentionBadge intention={intention} />
                          {!isHorsSujet && <StatusPill email={email} />}
                          {/* BLOC 7 : badge étape_process depuis prospect_data */}
                          <EtapeBadge etape={email.prospect_data?.etape_process as string | null | undefined} />
                        </>
                      )}
                      {email.is_urgent && !isRdvConfirme && (
                        <span className="text-xs" style={{ color: "rgb(220,38,38)" }}>🔴</span>
                      )}
                    </div>

                    {/* Score en cercle + date */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <ScoreCircle score={score} />
                      {email.received_at && (
                        <span className="text-xs whitespace-nowrap" style={{ color: "rgb(148 163 184)" }}>
                          {new Date(email.received_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Ligne 2 : sujet */}
                  <div
                    className="text-sm truncate mb-0.5"
                    style={{
                      color: isSelected
                        ? "rgb(79 70 229)"
                        : isHorsSujet
                        ? "rgb(148 163 184)"
                        : "rgb(30 41 59)",
                      fontWeight: isUnanalyzed ? 600 : isHorsSujet ? 400 : 500,
                    }}
                  >
                    {/* Point bleu pour les emails non encore analysés */}
                    {isUnanalyzed && (
                      <span
                        className="inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle"
                        style={{ background: "rgb(59 130 246)" }}
                      />
                    )}
                    {email.subject || "(Sans objet)"}
                  </div>

                  {/* Ligne 3 : aperçu / résumé IA */}
                  <div
                    className="text-xs line-clamp-1"
                    style={{ color: isHorsSujet ? "rgb(203 213 225)" : "rgb(100 116 139)" }}
                  >
                    {preview}
                  </div>

                  {/* Ligne 4 : statut dossier (BLOC 4) — visible si etape >= DOSSIER_DEMANDE */}
                  <DossierStatusBadge email={email} />
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
