"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import AppShell from "@/components/layout/AppShell";

const supabase = supabaseBrowser();

type LeadStage = "nouveau" | "qualification" | "rdv_propose" | "confirme";

type Lead = {
  id: string;
  sender: string | null;
  subject: string | null;
  summary: string | null;
  received_at: string | null;
  category: string | null;
  is_urgent: boolean | null;
  is_important: boolean | null;
  classification_reason: string | null;
  stage: LeadStage;
};

const STAGES: { key: LeadStage; label: string; color: string; bg: string; border: string }[] = [
  { key: "nouveau", label: "Nouveau", color: "rgb(79 70 229)", bg: "rgb(238 242 255)", border: "rgb(199 210 254)" },
  { key: "qualification", label: "Qualification", color: "rgb(234 88 12)", bg: "rgb(255 247 237)", border: "rgb(254 215 170)" },
  { key: "rdv_propose", label: "RDV proposé", color: "rgb(2 132 199)", bg: "rgb(240 249 255)", border: "rgb(186 230 253)" },
  { key: "confirme", label: "Confirmé ✅", color: "rgb(22 163 74)", bg: "rgb(240 253 244)", border: "rgb(187 247 208)" },
];

function getStageFromEmail(email: {
  classification_reason?: string | null;
  category?: string | null;
  is_important?: boolean | null;
}): LeadStage {
  if (email.classification_reason === "RDV_CONFIRMÉ") return "confirme";
  if (email.classification_reason?.includes("créneau") || email.classification_reason?.includes("rdv")) return "rdv_propose";
  if (email.category === "LOCATION" && email.is_important) return "qualification";
  return "nouveau";
}

function LeadCard({ lead, onMove }: { lead: Lead; onMove: (id: string, stage: LeadStage) => void }) {
  const isRdvConfirme = lead.classification_reason === "RDV_CONFIRMÉ";

  return (
    <div
      className="rounded-xl border p-3 space-y-2 cursor-pointer transition-all hover:shadow-sm"
      style={{ background: "white", borderColor: "rgb(226 232 240)" }}
    >
      {/* Badges */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {isRdvConfirme && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}>
            ✅ RDV Confirmé
          </span>
        )}
        {lead.is_urgent && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(220,38,38,0.1)", color: "rgb(220 38 38)" }}>
            Urgent
          </span>
        )}
      </div>

      {/* Sujet */}
      <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
        {lead.subject || "(Sans objet)"}
      </div>

      {/* Résumé */}
      {lead.summary && (
        <div className="text-xs line-clamp-2" style={{ color: "rgb(100 116 139)" }}>
          {lead.summary}
        </div>
      )}

      {/* Expéditeur + date */}
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs truncate" style={{ color: "rgb(148 163 184)" }}>
          {lead.sender?.replace(/<.*>/, "").trim() || "Expéditeur inconnu"}
        </div>
        <div className="text-xs whitespace-nowrap" style={{ color: "rgb(148 163 184)" }}>
          {lead.received_at
            ? new Date(lead.received_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
            : ""}
        </div>
      </div>

      {/* Actions de déplacement */}
      <div className="flex gap-1 pt-1 flex-wrap">
        {STAGES.filter((s) => s.key !== lead.stage).map((s) => (
          <button
            key={s.key}
            onClick={(e) => { e.stopPropagation(); onMove(lead.id, s.key); }}
            className="text-xs px-2 py-0.5 rounded-md transition-colors"
            style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
          >
            → {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  // Local stage overrides (persisted to localStorage)
  const [stageOverrides, setStageOverrides] = useState<Record<string, LeadStage>>({});

  useEffect(() => {
    // Load stage overrides from localStorage
    try {
      const stored = localStorage.getItem("fixetime_lead_stages");
      if (stored) setStageOverrides(JSON.parse(stored));
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    const fetchLeads = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { window.location.href = "/auth/login"; return; }

      const since = new Date();
      since.setDate(since.getDate() - 30);

      const { data } = await supabase
        .from("emails")
        .select("id, sender, subject, summary, received_at, category, is_urgent, is_important, classification_reason")
        .eq("user_id", user.id)
        .eq("category", "LOCATION")
        .gte("received_at", since.toISOString())
        .order("received_at", { ascending: false })
        .limit(100);

      if (data) {
        setLeads(data.map((e: any) => ({
          ...e,
          stage: stageOverrides[e.id] ?? getStageFromEmail(e),
        })));
      }
      setLoading(false);
    };

    fetchLeads();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageOverrides]);

  const moveToStage = (id: string, stage: LeadStage) => {
    const newOverrides = { ...stageOverrides, [id]: stage };
    setStageOverrides(newOverrides);
    try { localStorage.setItem("fixetime_lead_stages", JSON.stringify(newOverrides)); } catch { /* silent */ }
    setLeads((prev) => prev.map((l) => l.id === id ? { ...l, stage } : l));
  };

  const stageLeads = (stage: LeadStage) => leads.filter((l) => l.stage === stage);

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white flex items-center justify-between"
          style={{ borderColor: "rgb(226 232 240)" }}>
          <div>
            <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>Prospects</h1>
            <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
              {leads.length} leads LOCATION sur 30 jours
            </p>
          </div>
          <div className="flex gap-3">
            {STAGES.map((s) => (
              <div key={s.key} className="text-center">
                <div className="text-lg font-bold" style={{ color: s.color }}>
                  {stageLeads(s.key).length}
                </div>
                <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Kanban */}
        <div className="flex-1 overflow-x-auto p-6">
          {loading ? (
            <div className="flex gap-4">
              {STAGES.map((s) => (
                <div key={s.key} className="w-72 flex-shrink-0 space-y-3">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: "rgb(226 232 240)" }} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4 h-full">
              {STAGES.map((stage) => {
                const stageItems = stageLeads(stage.key);
                return (
                  <div key={stage.key} className="w-72 flex-shrink-0 flex flex-col gap-3">
                    {/* Column header */}
                    <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: stage.bg, border: `1px solid ${stage.border}` }}>
                      <span className="text-sm font-semibold" style={{ color: stage.color }}>
                        {stage.label}
                      </span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full"
                        style={{ background: "white", color: stage.color }}>
                        {stageItems.length}
                      </span>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                      {stageItems.length === 0 ? (
                        <div className="text-center py-8 text-xs" style={{ color: "rgb(148 163 184)" }}>
                          Aucun prospect
                        </div>
                      ) : (
                        stageItems.map((lead) => (
                          <LeadCard key={lead.id} lead={lead} onMove={moveToStage} />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
