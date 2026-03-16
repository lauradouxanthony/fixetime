"use client";

import { useEffect, useState, useCallback } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import AppShell from "@/components/layout/AppShell";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import type { EtapeProcess } from "@/types/email";

const supabase = supabaseBrowser();

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
  prospect_data: {
    nom?: string | null;
    situation_pro?: string | null;
    revenus_mensuels?: number | null;
    loyer_max?: number | null;
    telephone?: string | null;
    garant?: string | null;
    etape_process?: EtapeProcess | null;
  } | null;
};

const ETAPE_CONFIG: Record<EtapeProcess, { label: string; color: string; bg: string; border: string }> = {
  NEW:              { label: "Nouveau",          color: "rgb(100 116 139)", bg: "rgb(248 250 252)",  border: "rgb(226 232 240)" },
  QUALIFICATION:    { label: "Qualification",    color: "rgb(234 88 12)",   bg: "rgb(255 247 237)",  border: "rgb(254 215 170)" },
  VISITE_PROPOSEE:  { label: "Visite proposée",  color: "rgb(2 132 199)",   bg: "rgb(240 249 255)",  border: "rgb(186 230 253)" },
  VISITE_CONFIRMEE: { label: "Visite confirmée", color: "rgb(22 163 74)",   bg: "rgb(240 253 244)",  border: "rgb(187 247 208)" },
  DOSSIER_DEMANDE:  { label: "Dossier demandé",  color: "rgb(234 179 8)",   bg: "rgb(254 252 232)",  border: "rgb(253 224 71)"  },
  DOSSIER_RECU:     { label: "Dossier reçu",     color: "rgb(147 51 234)",  bg: "rgb(250 245 255)",  border: "rgb(233 213 255)" },
  VALIDE:           { label: "Validé",           color: "rgb(22 163 74)",   bg: "rgb(240 253 244)",  border: "rgb(134 239 172)" },
  REFUSE:           { label: "Refusé",           color: "rgb(220 38 38)",   bg: "rgb(254 242 242)",  border: "rgb(252 165 165)" },
};

// Colonnes affichées dans le Kanban (on masque VALIDE/REFUSE par défaut)
const VISIBLE_STAGES: EtapeProcess[] = [
  "NEW", "QUALIFICATION", "VISITE_PROPOSEE", "VISITE_CONFIRMEE", "DOSSIER_DEMANDE", "DOSSIER_RECU",
];

function getEtapeFromLead(lead: Lead): EtapeProcess {
  const etape = lead.prospect_data?.etape_process;
  if (etape && etape in ETAPE_CONFIG) return etape;
  if (lead.classification_reason === "RDV_CONFIRMÉ") return "VISITE_CONFIRMEE";
  if (lead.category === "LOCATION" && lead.is_urgent) return "QUALIFICATION";
  return "NEW";
}

function hoursAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.round((Date.now() - new Date(dateStr).getTime()) / 3_600_000);
}

function SolvabilityBadge({ revenus, loyer, multiplicateur = 3 }: { revenus: number | null; loyer: number | null; multiplicateur?: number }) {
  if (!revenus || !loyer) return null;
  const ratio = revenus / loyer;
  const ok = ratio >= multiplicateur;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{
        background: ok ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)",
        color: ok ? "rgb(22 163 74)" : "rgb(220 38 38)",
      }}
    >
      {ratio.toFixed(1)}x {ok ? "✓" : "✗"}
    </span>
  );
}

function LeadCard({
  lead,
  onVisiteEffectuee,
  onVisiteAnnulee,
  onMoveToStage,
}: {
  lead: Lead;
  onVisiteEffectuee: (id: string) => void;
  onVisiteAnnulee: (id: string) => void;
  onMoveToStage: (id: string, etape: EtapeProcess) => void;
}) {
  const etape = getEtapeFromLead(lead);
  const config = ETAPE_CONFIG[etape];
  const pd = lead.prospect_data;
  const nom = pd?.nom || (lead.sender || "Inconnu").replace(/<.*>/, "").trim();
  const hours = hoursAgo(lead.received_at);
  const tooOld = hours !== null && hours > 48;
  const spMap: Record<string, string> = { CDI: "CDI", CDD: "CDD", AUTO_ENTREPRENEUR: "Auto.", ETUDIANT: "Étudiant", RETRAITE: "Retraité" };
  const situationLabel = pd?.situation_pro ? (spMap[pd.situation_pro] ?? pd.situation_pro) : null;

  return (
    <div
      className="rounded-xl border p-3 space-y-2 bg-white transition-shadow hover:shadow-sm"
      style={{
        borderColor: tooOld ? "rgba(220,38,38,0.3)" : "rgb(226 232 240)",
      }}
    >
      {/* Nom + badge étape */}
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium text-sm truncate" style={{ color: "rgb(30 41 59)" }}>
          {nom}
        </div>
        <span
          className="text-xs px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
        >
          {config.label}
        </span>
      </div>

      {/* Sujet */}
      <div className="text-xs truncate" style={{ color: "rgb(100 116 139)" }}>
        {lead.subject || "(Sans objet)"}
      </div>

      {/* Situation + solvabilité */}
      <div className="flex items-center gap-2 flex-wrap">
        {situationLabel && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
            {situationLabel}
          </span>
        )}
        <SolvabilityBadge revenus={pd?.revenus_mensuels ?? null} loyer={pd?.loyer_max ?? null} />
        {tooOld && hours !== null && (
          <span className="text-xs font-semibold" style={{ color: "rgb(220 38 38)" }}>
            ⏰ {Math.floor(hours / 24)}j
          </span>
        )}
      </div>

      {/* Résumé */}
      {lead.summary && (
        <div className="text-xs line-clamp-2" style={{ color: "rgb(148 163 184)" }}>
          {lead.summary}
        </div>
      )}

      {/* ── BLOC 5 : Boutons visite effectuée / annulée ─────────────── */}
      {etape === "VISITE_CONFIRMEE" && (
        <div className="grid grid-cols-2 gap-1.5 pt-1">
          <button
            onClick={() => onVisiteEffectuee(lead.id)}
            className="text-xs py-1.5 rounded-lg font-medium text-center"
            style={{ background: "rgba(22,163,74,0.12)", color: "rgb(22 163 74)" }}
          >
            ✅ Visite effectuée
          </button>
          <button
            onClick={() => onVisiteAnnulee(lead.id)}
            className="text-xs py-1.5 rounded-lg font-medium text-center"
            style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}
          >
            ❌ Annulée
          </button>
        </div>
      )}

      {/* Déplacer vers */}
      <div className="flex gap-1 flex-wrap pt-0.5 border-t" style={{ borderColor: "rgb(241 245 249)" }}>
        <span className="text-xs self-center" style={{ color: "rgb(148 163 184)" }}>→</span>
        {(["QUALIFICATION", "VISITE_PROPOSEE", "VALIDE", "REFUSE"] as EtapeProcess[])
          .filter(s => s !== etape)
          .map(s => (
            <button
              key={s}
              onClick={() => onMoveToStage(lead.id, s)}
              className="text-xs px-1.5 py-0.5 rounded-md"
              style={{
                background: ETAPE_CONFIG[s].bg,
                color: ETAPE_CONFIG[s].color,
                border: `1px solid ${ETAPE_CONFIG[s].border}`,
              }}
            >
              {ETAPE_CONFIG[s].label}
            </button>
          ))}
      </div>
    </div>
  );
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showRefused, setShowRefused] = useState(false);
  const { toast } = useToast();

  const fetchLeads = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = "/auth/login"; return; }

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const { data } = await supabase
      .from("emails")
      .select("id, sender, subject, summary, body, received_at, category, is_urgent, is_important, classification_reason, prospect_data")
      .eq("user_id", user.id)
      .eq("category", "LOCATION")
      .gte("received_at", since.toISOString())
      .order("received_at", { ascending: false })
      .limit(200);

    if (data) setLeads(data as Lead[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleVisiteEffectuee = async (id: string) => {
    const res = await fetch(`/api/leads/${id}/visite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "effectuee" }),
    });
    if (res.ok) {
      toast("✅ Visite marquée comme effectuée — Dossier demandé par IA", "success");
      await fetchLeads();
    } else {
      toast("Erreur lors de la mise à jour", "error");
    }
  };

  const handleVisiteAnnulee = async (id: string) => {
    const res = await fetch(`/api/leads/${id}/visite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "annulee" }),
    });
    if (res.ok) {
      toast("❌ Visite annulée — Prospect remis en Qualification", "success");
      await fetchLeads();
    } else {
      toast("Erreur lors de la mise à jour", "error");
    }
  };

  const handleMoveToStage = async (id: string, etape: EtapeProcess) => {
    const { data: email } = await supabase.from("emails").select("prospect_data").eq("id", id).single();
    const pd = ((email as any)?.prospect_data as Record<string, unknown> | null) ?? {};
    const updated = { ...pd, etape_process: etape };
    await supabase.from("emails").update({ prospect_data: updated }).eq("id", id);
    setLeads(prev => prev.map(l => l.id === id ? { ...l, prospect_data: { ...l.prospect_data, etape_process: etape } } : l));
    toast(`Déplacé → ${ETAPE_CONFIG[etape].label}`, "success");
  };

  const activeLeads = leads.filter(l => getEtapeFromLead(l) !== "REFUSE" && getEtapeFromLead(l) !== "VALIDE");
  const refusedLeads = leads.filter(l => getEtapeFromLead(l) === "REFUSE" || getEtapeFromLead(l) === "VALIDE");

  const stageLeads = (stage: EtapeProcess) => activeLeads.filter(l => getEtapeFromLead(l) === stage);

  const urgentCount = leads.filter(l => l.is_urgent).length;
  const staleCount = leads.filter(l => { const h = hoursAgo(l.received_at); return h !== null && h > 48; }).length;
  const visiteProposeCount = stageLeads("VISITE_PROPOSEE").length + stageLeads("VISITE_CONFIRMEE").length;
  const dossierCount = stageLeads("DOSSIER_DEMANDE").length + stageLeads("DOSSIER_RECU").length;

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>Prospects</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                {activeLeads.length} actifs · 30 jours
                {urgentCount > 0 && <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>🔥 {urgentCount} urgent{urgentCount > 1 ? "s" : ""}</span>}
                {staleCount > 0 && <span className="ml-2 font-medium" style={{ color: "rgb(220 38 38)" }}>⏰ {staleCount} sans réponse &gt;48h</span>}
              </p>
            </div>
            <div className="flex gap-4">
              {visiteProposeCount > 0 && (
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: "rgb(2 132 199)" }}>{visiteProposeCount}</div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Visites</div>
                </div>
              )}
              {dossierCount > 0 && (
                <div className="text-center">
                  <div className="text-lg font-bold" style={{ color: "rgb(147 51 234)" }}>{dossierCount}</div>
                  <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Dossiers</div>
                </div>
              )}
              <button
                onClick={() => setShowRefused(v => !v)}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ background: "rgb(241 245 249)", color: "rgb(100 116 139)" }}
              >
                {showRefused ? "Masquer refusés" : `Refusés/Validés (${refusedLeads.length})`}
              </button>
            </div>
          </div>
        </div>

        {/* Kanban */}
        <div className="flex-1 overflow-x-auto p-6">
          {loading ? (
            <div className="flex gap-4">
              {VISIBLE_STAGES.slice(0, 4).map(s => (
                <div key={s} className="w-64 flex-shrink-0 space-y-3">
                  <SkeletonCard /><SkeletonCard />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex gap-4 h-full">
              {VISIBLE_STAGES.map((stage) => {
                const config = ETAPE_CONFIG[stage];
                const items = stageLeads(stage);
                return (
                  <div key={stage} className="w-64 flex-shrink-0 flex flex-col gap-3">
                    <div
                      className="flex items-center justify-between px-3 py-2 rounded-lg"
                      style={{ background: config.bg, border: `1px solid ${config.border}` }}
                    >
                      <span className="text-sm font-semibold" style={{ color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white" style={{ color: config.color }}>
                        {items.length}
                      </span>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                      {items.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 rounded-xl border border-dashed" style={{ borderColor: config.border }}>
                          <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>Aucun prospect</div>
                        </div>
                      ) : (
                        items.map(lead => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            onVisiteEffectuee={handleVisiteEffectuee}
                            onVisiteAnnulee={handleVisiteAnnulee}
                            onMoveToStage={handleMoveToStage}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Colonne Refusés/Validés (toggleable) */}
              {showRefused && (
                <div className="w-64 flex-shrink-0 flex flex-col gap-3">
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg"
                    style={{ background: "rgb(248 250 252)", border: "1px solid rgb(226 232 240)" }}>
                    <span className="text-sm font-semibold" style={{ color: "rgb(100 116 139)" }}>Refusés / Validés</span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white" style={{ color: "rgb(100 116 139)" }}>{refusedLeads.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                    {refusedLeads.map(lead => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onVisiteEffectuee={handleVisiteEffectuee}
                        onVisiteAnnulee={handleVisiteAnnulee}
                        onMoveToStage={handleMoveToStage}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
