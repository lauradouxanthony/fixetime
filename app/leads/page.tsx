"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import AppShell from "@/components/layout/AppShell";
import { SkeletonCard } from "@/components/ui/Skeleton";

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
  { key: "nouveau",       label: "Nouveau",      color: "rgb(79 70 229)",  bg: "rgb(238 242 255)", border: "rgb(199 210 254)" },
  { key: "qualification", label: "Qualification", color: "rgb(234 88 12)", bg: "rgb(255 247 237)", border: "rgb(254 215 170)" },
  { key: "rdv_propose",   label: "RDV proposé",  color: "rgb(2 132 199)",  bg: "rgb(240 249 255)", border: "rgb(186 230 253)" },
  { key: "confirme",      label: "Confirmé",     color: "rgb(22 163 74)",  bg: "rgb(240 253 244)", border: "rgb(187 247 208)" },
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

/* ── SCORE BADGE ── */
type Heat = "chaud" | "tiede" | "froid";

function getHeat(lead: Lead): Heat {
  if (lead.is_urgent) return "chaud";
  if (lead.is_important) return "tiede";
  return "froid";
}

function HeatBadge({ heat }: { heat: Heat }) {
  const config = {
    chaud: { icon: "🔥", label: "Chaud",  bg: "rgba(220,38,38,0.08)",   color: "rgb(220 38 38)" },
    tiede: { icon: "🌡",  label: "Tiède",  bg: "rgba(234,88,12,0.08)",   color: "rgb(234 88 12)" },
    froid: { icon: "❄️", label: "Froid",  bg: "rgba(100,116,139,0.08)", color: "rgb(100 116 139)" },
  }[heat];
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1"
      style={{ background: config.bg, color: config.color }}
    >
      <span>{config.icon}</span>
      {config.label}
    </span>
  );
}

/* ── AVATAR ── */
function Avatar({ name }: { name: string | null }) {
  const clean = (name || "").replace(/<.*>/, "").trim();
  const initials = clean.split(/[\s@.]+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
  const hue = [...clean].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
      style={{ background: `hsl(${hue},50%,52%)` }}
    >
      {initials}
    </div>
  );
}

/* ── DOC STATUS ── */
function DocStatusRow({ label, received }: { label: string; received: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span style={{ color: received ? "rgb(22 163 74)" : "rgb(203 213 225)", fontSize: "10px" }}>
        {received ? "✓" : "○"}
      </span>
      <span className="text-xs" style={{ color: received ? "rgb(71 85 105)" : "rgb(148 163 184)" }}>
        {label}
      </span>
    </div>
  );
}

function guessDocsFromSummary(summary: string | null): { fiches: boolean; contrat: boolean; id: boolean } {
  const t = (summary || "").toLowerCase();
  return {
    fiches:  t.includes("fiche") || t.includes("salaire") || t.includes("paie"),
    contrat: t.includes("contrat") || t.includes("cdi") || t.includes("cdd"),
    id:      t.includes("identit") || t.includes("passeport") || t.includes("carte"),
  };
}

/* ── LEAD CARD ── */
function LeadCard({ lead, onMove }: { lead: Lead; onMove: (id: string, stage: LeadStage) => void }) {
  const isRdvConfirme = lead.classification_reason === "RDV_CONFIRMÉ";
  const heat = getHeat(lead);
  const docs = guessDocsFromSummary(lead.summary);
  const docsCount = Object.values(docs).filter(Boolean).length;

  return (
    <div
      className="rounded-xl border p-3 space-y-2.5 cursor-default transition-all hover-lift animate-fade-in"
      style={{ background: "white", borderColor: "rgb(226 232 240)" }}
    >
      {/* Row 1 : avatar + sender */}
      <div className="flex items-center gap-2">
        <Avatar name={lead.sender} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: "rgb(71 85 105)" }}>
            {(lead.sender || "Inconnu").replace(/<.*>/, "").trim()}
          </div>
          <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
            {lead.received_at
              ? new Date(lead.received_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
              : ""}
          </div>
        </div>
        {isRdvConfirme ? (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}>✅</span>
        ) : (
          <HeatBadge heat={heat} />
        )}
      </div>

      {/* Row 2 : sujet */}
      <div className="text-sm font-semibold truncate" style={{ color: "rgb(30 41 59)" }}>
        {lead.subject || "(Sans objet)"}
      </div>

      {/* Row 3 : résumé */}
      {lead.summary && (
        <div className="text-xs line-clamp-2" style={{ color: "rgb(100 116 139)" }}>
          {lead.summary}
        </div>
      )}

      {/* Row 4 : statut dossier */}
      <div className="rounded-lg p-2 space-y-1" style={{ background: "rgb(248 250 252)" }}>
        <div className="text-xs font-medium mb-1" style={{ color: "rgb(100 116 139)" }}>
          Dossier ({docsCount}/3)
        </div>
        <DocStatusRow label="Fiches de paie" received={docs.fiches} />
        <DocStatusRow label="Contrat de travail" received={docs.contrat} />
        <DocStatusRow label="Pièce d'identité" received={docs.id} />
      </div>

      {/* Row 5 : actions de déplacement */}
      <div className="flex gap-1 flex-wrap pt-0.5">
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
  const [stageOverrides, setStageOverrides] = useState<Record<string, LeadStage>>({});

  useEffect(() => {
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

  const heat = { chaud: leads.filter((l) => l.is_urgent).length, tiede: leads.filter((l) => !l.is_urgent && l.is_important).length };

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>Prospects</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                {leads.length} leads · 30 jours
                {heat.chaud > 0 && <span className="ml-2 text-red-500 font-medium">🔥 {heat.chaud} chaud{heat.chaud > 1 ? "s" : ""}</span>}
              </p>
            </div>
            <div className="flex gap-4">
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
        </div>

        {/* Kanban */}
        <div className="flex-1 overflow-x-auto p-6">
          {loading ? (
            <div className="flex gap-4">
              {STAGES.map((s) => (
                <div key={s.key} className="w-72 flex-shrink-0 space-y-3">
                  <SkeletonCard />
                  <SkeletonCard />
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
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: stage.bg, border: `1px solid ${stage.border}` }}
                    >
                      <span className="text-sm font-semibold" style={{ color: stage.color }}>
                        {stage.label}
                      </span>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ background: "white", color: stage.color }}
                      >
                        {stageItems.length}
                      </span>
                    </div>

                    {/* Cards */}
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                      {stageItems.length === 0 ? (
                        <div
                          className="flex flex-col items-center justify-center py-10 rounded-xl border border-dashed"
                          style={{ borderColor: stage.border }}
                        >
                          <div className="text-xl mb-1">👤</div>
                          <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Aucun prospect</div>
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
