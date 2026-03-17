"use client";

import { useEffect, useRef } from "react";
import type { Email } from "@/types/email";
import {
  prospectDisplayName,
  propertyDisplay,
  formatDateShortFR,
  getRentFromEmail,
  statusBadgeLabel,
  statusBadgeCls,
  scoreBadgeLabel,
  scoreBadgeCls,
  reasonPillText,
  isAutopilotPending,
  prettyMoney,
} from "@/components/emails/emailUi";

type EmailsListProps = {
  emails: Email[];
  selectedEmailId: string | null;
  onSelect: (email: Email | null) => void;
  loading: boolean;
};

function SkeletonItem() {
  return (
    <div className="p-4 border-b border-gray-800 animate-pulse">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-2 min-w-0">
          <div className="h-5 bg-gray-700 rounded w-3/4" />
          <div className="h-4 bg-gray-800 rounded w-full" />
          <div className="h-3 bg-gray-800 rounded w-1/2" />
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <div className="h-5 w-10 bg-gray-700 rounded-full" />
          <div className="h-5 w-14 bg-gray-700 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export function EmailsList({ emails, selectedEmailId, onSelect, loading }: EmailsListProps) {
  const selectedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedEmailId || !selectedRef.current) return;
    selectedRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedEmailId]);

  if (loading) {
    return (
      <div className="divide-y divide-gray-800">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonItem key={i} />
        ))}
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="p-6 text-sm text-gray-500 text-center">
        Aucun candidat trouvé.
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-800">
      {emails.map((email) => {
        const name = prospectDisplayName(email);
        const property = propertyDisplay(email);
        const rent = getRentFromEmail(email);
        const lastAction = email.lead_last_action?.trim() ?? null;
        const receivedAt = formatDateShortFR(email.received_at ?? null);
        const score = email.lead_score ?? (email.lead_json as { lead_score?: number } | null)?.lead_score ?? null;
        const status = email.lead_status ?? null;
        const reason = reasonPillText(email);
        const autopilotPending = isAutopilotPending(email);
        const isSelected = selectedEmailId === email.id;

        return (
          <div
            key={email.id}
            ref={isSelected ? (el) => { selectedRef.current = el; } : undefined}
            onClick={() => onSelect(email)}
            className={[
              "p-4 cursor-pointer transition-all duration-150 border-b border-gray-800",
              isSelected
                ? "bg-slate-800/90 border-l-[3px] border-l-sky-500 shadow-[inset_4px_0_6px_-4px_rgba(0,0,0,0.2)]"
                : "border-l-[3px] border-l-transparent hover:bg-gray-900/50",
            ].join(" ")}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                {/* Ligne 1: Nom + badges score + statut */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-white truncate">{name}</span>
                  <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${scoreBadgeCls(score)}`}>
                    {scoreBadgeLabel(score)}
                  </span>
                  <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${statusBadgeCls(status)}`}>
                    {statusBadgeLabel(status)}
                  </span>
                  {autopilotPending && (
                    <span className="shrink-0 text-xs opacity-80" title="Autopilot en attente">🤖</span>
                  )}
                  {reason != null && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-700/60 text-gray-400 border border-gray-600">
                      {reason}
                    </span>
                  )}
                </div>
                {/* Ligne 2: Bien + loyer */}
                <div className="text-sm text-gray-400 truncate">
                  {property}
                  {rent != null && <span className="text-gray-500 ml-1">· {prettyMoney(rent)}</span>}
                </div>
                {/* Ligne 3: Dernière action + date reçue */}
                <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                  {lastAction != null && <span className="truncate">{lastAction}</span>}
                  <span>{receivedAt}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
