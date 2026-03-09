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
};

/* ── AVATAR INITIALES ── */
function Avatar({ name }: { name: string | null }) {
  const clean = (name || "").replace(/<.*>/, "").trim();
  const initials = clean
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "?";
  const hue = [...clean].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
      style={{ background: `hsl(${hue},50%,52%)` }}
      title={clean}
    >
      {initials}
    </div>
  );
}

/* ── STAGE DOT ── */
function StageDot({ decision }: { decision?: string | null }) {
  const d = (decision || "").toLowerCase();
  if (d === "traiter")  return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgb(234 88 12)" }} />;
  if (d === "planifier") return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgb(37 99 235)" }} />;
  if (d === "ignorer")  return <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "rgb(203 213 225)" }} />;
  return <span className="w-2 h-2 rounded-full flex-shrink-0 animate-pulse" style={{ background: "rgb(148 163 184)" }} />;
}

type EmailsListProps = {
  emails: Email[];
  selectedEmailId: string | null;
  onSelect: (email: Email | null) => void;
  loading: boolean;
};

/* -------------------- HELPERS -------------------- */

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
  if (email.is_urgent) return 9;
  if (email.is_important && email.decision === "traiter") return 7;
  if (email.decision === "traiter") return 6;
  if (email.is_important && email.decision === "planifier") return 5;
  if (email.decision === "planifier") return 4;
  if (email.decision === "ignorer") return 2;
  return 5;
}

function IntentionBadge({ intention }: { intention: string | null }) {
  if (!intention) return null;

  const styles: Record<string, { bg: string; text: string; label: string }> = {
    LOCATION: { bg: "rgba(59,130,246,0.1)", text: "rgb(37,99,235)", label: "Location" },
    INFO: { bg: "rgba(100,116,139,0.1)", text: "rgb(71,85,105)", label: "Info" },
    HORS_SUJET: { bg: "rgba(15,23,42,0.08)", text: "rgb(51,65,85)", label: "Hors sujet" },
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

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 8 ? "rgb(220,38,38)" :
    score >= 6 ? "rgb(234,88,12)" :
    score >= 4 ? "rgb(100,116,139)" :
    "rgb(148,163,184)";

  return (
    <span className="text-xs font-semibold" style={{ color }}>
      {score}/10
    </span>
  );
}

function getEmailPreview(email: Email) {
  if (email.summary) return email.summary;
  const d = normalizeDecision(email.decision);
  if (d === "traiter") return "Action requise — réponse attendue";
  if (d === "planifier") return "À planifier — réponse ultérieure";
  if (d === "ignorer") return "Email ignoré automatiquement";
  return "Analyse en cours…";
}

/* -------------------- COMPONENT -------------------- */

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

  return (
    <div>
      {emails.map((email) => {
        const decision = normalizeDecision(email.decision);
        const intention = getIntentionFromCategory(email.category);
        const score = computeScore(email);
        const preview = getEmailPreview(email);
        const isSelected = selectedEmailId === email.id;
        const isRdvConfirme = email.classification_reason === "RDV_CONFIRMÉ";

        return (
          <div
            key={email.id}
            onClick={() => onSelect(email)}
            className="px-4 py-3 border-b cursor-pointer transition-colors animate-fade-in"
            style={{
              borderColor: "rgb(226 232 240)",
              background: isSelected ? "rgb(238 242 255)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = "rgb(248 250 252)";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            {/* Row : avatar + content */}
            <div className="flex items-start gap-3">
              <Avatar name={email.sender} />

              <div className="flex-1 min-w-0">
                {/* Ligne 1 : badges */}
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <StageDot decision={email.decision} />
                    {isRdvConfirme ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                        style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}>
                        ✅ RDV
                      </span>
                    ) : (
                      <IntentionBadge intention={intention} />
                    )}
                    {email.is_urgent && !isRdvConfirme && (
                      <span className="text-xs font-medium" style={{ color: "rgb(220,38,38)" }}>
                        🔴
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <ScoreBadge score={score} />
                    {email.received_at && (
                      <span className="text-xs whitespace-nowrap" style={{ color: "rgb(148 163 184)" }}>
                        {new Date(email.received_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                </div>

                {/* Ligne 2 : sujet */}
                <div
                  className="text-sm font-semibold truncate mb-0.5"
                  style={{ color: isSelected ? "rgb(79 70 229)" : "rgb(30 41 59)" }}
                >
                  {email.subject || "(Sans objet)"}
                </div>

                {/* Ligne 3 : résumé IA */}
                <div className="text-xs line-clamp-1" style={{ color: "rgb(100 116 139)" }}>
                  {preview}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
