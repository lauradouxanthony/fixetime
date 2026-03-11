"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import AppShell from "@/components/layout/AppShell";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

const supabase = supabaseBrowser();

type LeadStage = "nouveau" | "qualification" | "rdv_propose" | "confirme";

type Lead = {
  id: string;
  sender: string | null;
  subject: string | null;
  summary: string | null;
  body: string | null;
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

/* ── EXTRACTION HEURISTIQUE ── */

function detectSituation(body: string | null): string | null {
  const l = (body || "").toLowerCase();
  if (l.includes("étudiant") || l.includes("etudiante") || l.includes("école") || l.includes("université")) return "Étudiant";
  if (l.includes("cdi")) return "CDI";
  if (l.includes("cdd")) return "CDD";
  if (l.includes("auto-entrepreneur") || l.includes("autoentrepreneur") || l.includes("freelance")) return "Auto-entrepreneur";
  if (l.includes("retraité") || l.includes("retraitée")) return "Retraité";
  return null;
}

function extractRevenus(body: string | null): number | null {
  const text = body || "";
  for (const line of text.split(/\r?\n/)) {
    const l = line.toLowerCase();
    const m = line.match(/(\d[\d\s]*)\s*(?:€|euros?)/i);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/\s/g, ""));
    if (!val || val < 200) continue;
    if (l.includes("salaire") || l.includes("revenu") || l.includes("gagne") || l.includes("touche")) return val;
  }
  return null;
}

function extractLoyer(body: string | null): number | null {
  const text = body || "";
  for (const line of text.split(/\r?\n/)) {
    const l = line.toLowerCase();
    const m = line.match(/(\d[\d\s]*)\s*(?:€|euros?)/i);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/\s/g, ""));
    if (!val || val < 100) continue;
    if (l.includes("loyer") || l.includes("budget") || l.includes("mensuel")) return val;
  }
  return null;
}

function guessDocsCount(summary: string | null, body: string | null): number {
  const t = ((summary || "") + " " + (body || "")).toLowerCase();
  let score = 0;
  if (t.includes("fiche de paie") || t.includes("bulletin") || t.includes("salaire")) score++;
  if (t.includes("contrat") || t.includes("cdi") || t.includes("cdd")) score++;
  if (t.includes("avis d'imposition") || t.includes("impôt") || t.includes("fiscal")) score++;
  if (t.includes("identit") || t.includes("passeport") || t.includes("carte")) score++;
  if (t.includes("rib") || t.includes("relevé bancaire")) score++;
  return score;
}

function hoursAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

/* ── SCORE CIRCLE ── */
function ScoreCircle({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(score / max, 1);
  const color = pct >= 0.75 ? "rgb(22 163 74)" : pct >= 0.4 ? "rgb(234 88 12)" : "rgb(220 38 38)";
  const r = 16;
  const circumference = 2 * Math.PI * r;
  const dash = pct * circumference;

  return (
    <div className="relative flex-shrink-0" style={{ width: 40, height: 40 }}>
      <svg width="40" height="40" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={r} fill="none" stroke="rgb(226 232 240)" strokeWidth="3" />
        <circle
          cx="20" cy="20" r={r} fill="none"
          stroke={color} strokeWidth="3"
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform="rotate(-90 20 20)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[9px] font-bold" style={{ color }}>{score}</span>
      </div>
    </div>
  );
}

function computeScore(lead: Lead): number {
  let score = 0;
  if (lead.is_urgent) score += 30;
  else if (lead.is_important) score += 15;
  if (detectSituation(lead.body)) score += 15;
  const rev = extractRevenus(lead.body);
  const loy = extractLoyer(lead.body);
  if (rev && loy && rev / loy >= 3) score += 25;
  else if (rev || loy) score += 10;
  const docs = guessDocsCount(lead.summary, lead.body);
  score += Math.min(docs * 6, 30);
  return Math.min(score, 100);
}

/* ── DOSSIER BAR ── */
function DossierBar({ count, max = 5 }: { count: number; max?: number }) {
  const pct = Math.round((count / max) * 100);
  const color = pct >= 60 ? "rgb(22 163 74)" : pct >= 30 ? "rgb(234 88 12)" : "rgb(220 38 38)";
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs" style={{ color: "rgb(100 116 139)" }}>Dossier</span>
        <span className="text-xs font-medium" style={{ color }}>{count}/{max} docs</span>
      </div>
      <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── LEAD CARD ── */
function LeadCard({
  lead,
  onMove,
  onAction,
}: {
  lead: Lead;
  onMove: (id: string, stage: LeadStage) => void;
  onAction: (id: string, action: "relancer" | "rdv" | "valider") => void;
}) {
  const score = computeScore(lead);
  const situation = detectSituation(lead.body);
  const revenus = extractRevenus(lead.body);
  const loyer = extractLoyer(lead.body);
  const docsCount = guessDocsCount(lead.summary, lead.body);
  const hours = hoursAgo(lead.received_at);
  const tooOld = hours !== null && hours > 24;
  const ratio = revenus && loyer ? revenus / loyer : null;
  const solvable = ratio !== null && ratio >= 3;

  return (
    <div
      className="rounded-xl border p-3 space-y-2.5 cursor-default transition-all hover-lift animate-fade-in"
      style={{
        background: "white",
        borderColor: tooOld ? "rgba(220,38,38,0.3)" : "rgb(226 232 240)",
        boxShadow: tooOld ? "0 0 0 1px rgba(220,38,38,0.15)" : undefined,
      }}
    >
      {/* Row 1 : score + sender + badge >24h */}
      <div className="flex items-center gap-2">
        <ScoreCircle score={score} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: "rgb(71 85 105)" }}>
            {(lead.sender || "Inconnu").replace(/<.*>/, "").trim()}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {tooOld ? (
              <span className="text-xs font-semibold" style={{ color: "rgb(220 38 38)" }}>
                ⏰ {Math.floor(hours! / 24)}j sans réponse
              </span>
            ) : hours !== null ? (
              <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>Il y a {hours}h</span>
            ) : null}
          </div>
        </div>
        {lead.classification_reason === "RDV_CONFIRMÉ" ? (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22,163,74)" }}>✅ Confirmé</span>
        ) : lead.is_urgent ? (
          <span className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ background: "rgba(220,38,38,0.1)", color: "rgb(220 38 38)" }}>🔥 Urgent</span>
        ) : null}
      </div>

      {/* Sujet */}
      <div className="text-sm font-semibold truncate" style={{ color: "rgb(30 41 59)" }}>
        {lead.subject || "(Sans objet)"}
      </div>

      {/* Situation pro + ratio */}
      <div className="flex items-center gap-2 flex-wrap">
        {situation && (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}
          >
            {situation}
          </span>
        )}
        {ratio !== null && (
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: solvable ? "rgba(22,163,74,0.08)" : "rgba(220,38,38,0.08)",
              color: solvable ? "rgb(22 163 74)" : "rgb(220 38 38)",
            }}
          >
            {ratio.toFixed(1)}x revenus/loyer
          </span>
        )}
      </div>

      {/* Résumé */}
      {lead.summary && (
        <div className="text-xs line-clamp-2" style={{ color: "rgb(100 116 139)" }}>
          {lead.summary}
        </div>
      )}

      {/* Dossier bar */}
      <DossierBar count={docsCount} max={5} />

      {/* Actions primaires */}
      <div className="grid grid-cols-3 gap-1 pt-0.5">
        <button
          onClick={(e) => { e.stopPropagation(); onAction(lead.id, "relancer"); }}
          className="text-xs py-1.5 rounded-lg font-medium transition-colors text-center"
          style={{ background: "rgb(238 242 255)", color: "rgb(79 70 229)" }}
        >
          ↩ Relancer
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAction(lead.id, "rdv"); }}
          className="text-xs py-1.5 rounded-lg font-medium transition-colors text-center"
          style={{ background: "rgb(240 249 255)", color: "rgb(2 132 199)" }}
        >
          📅 RDV
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onAction(lead.id, "valider"); }}
          className="text-xs py-1.5 rounded-lg font-medium transition-colors text-center"
          style={{ background: "rgb(240 253 244)", color: "rgb(22 163 74)" }}
        >
          ✓ Valider
        </button>
      </div>

      {/* Déplacer vers */}
      <div className="flex gap-1 flex-wrap pt-0.5 border-t" style={{ borderColor: "rgb(241 245 249)" }}>
        <span className="text-xs self-center" style={{ color: "rgb(148 163 184)" }}>→</span>
        {STAGES.filter((s) => s.key !== lead.stage).map((s) => (
          <button
            key={s.key}
            onClick={(e) => { e.stopPropagation(); onMove(lead.id, s.key); }}
            className="text-xs px-2 py-0.5 rounded-md transition-colors"
            style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}` }}
          >
            {s.label}
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
  const { toast } = useToast();

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
        .select("id, sender, subject, summary, body, received_at, category, is_urgent, is_important, classification_reason")
        .eq("user_id", user.id)
        .eq("category", "LOCATION")
        .gte("received_at", since.toISOString())
        .order("received_at", { ascending: false })
        .limit(100);

      if (data) {
        setLeads(data.map((e: Omit<Lead, "stage">) => ({
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

  const handleAction = (id: string, action: "relancer" | "rdv" | "valider") => {
    if (action === "valider") {
      moveToStage(id, "confirme");
      toast("Lead validé ✅", "success");
    } else if (action === "rdv") {
      moveToStage(id, "rdv_propose");
      toast("Déplacé vers RDV proposé 📅", "success");
    } else if (action === "relancer") {
      toast("Brouillon de relance à envoyer depuis le pipeline →", "success");
    }
  };

  const stageLeads = (stage: LeadStage) => leads.filter((l) => l.stage === stage);

  const urgentCount = leads.filter((l) => l.is_urgent).length;
  const staleCount = leads.filter((l) => {
    const h = hoursAgo(l.received_at);
    return h !== null && h > 24;
  }).length;

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
                {urgentCount > 0 && (
                  <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>
                    🔥 {urgentCount} urgent{urgentCount > 1 ? "s" : ""}
                  </span>
                )}
                {staleCount > 0 && (
                  <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>
                    · ⏰ {staleCount} sans réponse &gt;24h
                  </span>
                )}
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
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onMove={moveToStage}
                            onAction={handleAction}
                          />
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
