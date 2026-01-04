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
};

type EmailsListProps = {
  emails: Email[];
  selectedEmailId: string | null;
  onSelect: (email: Email | null) => void;
  loading: boolean;
};

/* -------------------- HELPERS -------------------- */

function normalizeDecision(
  decision?: string | null
): "traiter" | "ignorer" | "planifier" | null {
  if (!decision) return null;
  const d = String(decision).trim().toLowerCase();

  if (d.includes("trait")) return "traiter";
  if (d.includes("ignor")) return "ignorer";
  if (d.includes("deleg") || d.includes("planif")) return "planifier";

  return null;
}

function fallbackDecisionFromSubject(email: Email) {
  const subject = (email.subject || "").toLowerCase();
  const sender = (email.sender || "").toLowerCase();

  if (subject.includes("urgent") || subject.includes("demain") || subject.includes("asap"))
    return "traiter";
  if (subject.includes("réunion") || subject.includes("rdv"))
    return "traiter";

  if (
    sender.includes("newsletter") ||
    sender.includes("no-reply") ||
    sender.includes("noreply") ||
    subject.includes("promo") ||
    subject.includes("offre")
  )
    return "ignorer";

  return null;
}

function labelDecision(decision: "traiter" | "ignorer" | "planifier" | null) {
  if (decision === "traiter") return "À traiter";
  if (decision === "planifier") return "À planifier";
  if (decision === "ignorer") return "À ignorer";
  return "Analyse…";
}

function classDecision(decision: "traiter" | "ignorer" | "planifier" | null) {
  if (decision === "traiter") return "bg-red-600 text-white";
  if (decision === "planifier") return "bg-yellow-500 text-black";
  if (decision === "ignorer") return "bg-gray-700 text-white";
  return "bg-gray-800 text-gray-300";
}

function safeMinutes(email: Email) {
  if (email.estimated_time !== null && email.estimated_time !== undefined) {
    return email.estimated_time;
  }

  // fallback UNIQUEMENT si pas encore analysé
  return 5;
}


function getEmailPreview(email: Email, decision: string | null) {
  if (email.summary) return email.summary;

  if (decision === "traiter") return "Action requise — réponse attendue";
  if (decision === "planifier") return "À planifier — réponse ultérieure";
  if (decision === "ignorer") return "Email ignoré automatiquement";

  return "Email analysé automatiquement par FixTime";
}

/* -------------------- COMPONENT -------------------- */

export function EmailsList({
  emails,
  selectedEmailId,
  onSelect,
  loading,
}: EmailsListProps) {
  if (loading) {
    return <div className="p-4 text-sm text-gray-500">Chargement…</div>;
  }

  if (emails.length === 0) {
    return <div className="p-4 text-sm text-gray-500">Aucun email trouvé.</div>;
  }

  return (
    <div>
      {emails.map((email) => {
        const decision =
        email.decision !== null && email.decision !== undefined
          ? normalizeDecision(email.decision)
          : fallbackDecisionFromSubject(email);
      
        const minutes = safeMinutes(email);
        const preview = getEmailPreview(email, decision);

        return (
          <div
            key={email.id}
            onClick={() => onSelect(email)}
            className={[
              "p-4 border-b border-gray-800 cursor-pointer space-y-2",
              selectedEmailId === email.id
                ? "bg-gray-900"
                : "hover:bg-gray-900",
            ].join(" ")}
          >
            {/* Ligne 1 : badges + temps */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${classDecision(
                    decision
                  )}`}
                >
                  {labelDecision(decision)}
                </span>

                {email.is_urgent && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-300 border border-red-800/60">
                    Urgent
                  </span>
                )}

                {email.is_important && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/40 text-blue-300 border border-blue-800/60">
                    Important
                  </span>
                )}
              </div>

              <div className="text-xs text-gray-400 whitespace-nowrap">
                ⏱️ {minutes} min
              </div>
            </div>

            {/* Ligne 2 : sujet */}
            <div className="text-sm font-semibold text-white truncate">
              {email.subject || "(Sans objet)"}
            </div>

            {/* Ligne 3 : preview intelligente */}
            <div className="text-xs text-gray-400 line-clamp-2">
              {preview}
            </div>

            {/* Ligne 4 : sender + date */}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-400 truncate">
                {email.sender || "Expéditeur inconnu"}
              </div>
              <div className="text-xs text-gray-500 whitespace-nowrap">
                {email.received_at
                  ? new Date(email.received_at).toLocaleString()
                  : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
