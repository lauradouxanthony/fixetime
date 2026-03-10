"use client";

/**
 * ProspectFiche — Extraction heuristique de 8 champs depuis le corps d'un email LOCATION.
 * Affiche chaque champ avec un statut ✅ / ⚠️ / ❓ et une barre de progression.
 */

type FieldStatus = "ok" | "partial" | "missing";

interface ProspectField {
  key: string;
  label: string;
  value: string | null;
  status: FieldStatus;
}

/* ─── Extraction heuristique ─── */
export interface ProspectData {
  nom: string | null;
  tel: string | null;
  situation: string | null;   // CDI / CDD / Étudiant / Auto-entrepreneur / Retraité
  revenus: number | null;     // €/mois
  loyerMax: number | null;    // € loyer max envisagé
  animaux: string | null;     // oui / non
  personnes: number | null;   // nb de personnes
  dateEmmenagement: string | null;
}

const SITUATION_KEYWORDS: [string, string][] = [
  ["étudiant", "Étudiant"],
  ["etudiante", "Étudiant"],
  ["lycéen", "Étudiant"],
  ["école", "Étudiant"],
  ["université", "Étudiant"],
  ["cdi", "CDI"],
  ["cdd", "CDD"],
  ["auto-entrepreneur", "Auto-entrepreneur"],
  ["autoentrepreneur", "Auto-entrepreneur"],
  ["freelance", "Auto-entrepreneur"],
  ["indépendant", "Auto-entrepreneur"],
  ["retraité", "Retraité"],
  ["retraitée", "Retraité"],
  ["intermittent", "Intermittent"],
];

export function extractProspect(body: string | null | undefined): ProspectData {
  if (!body) return {
    nom: null, tel: null, situation: null, revenus: null,
    loyerMax: null, animaux: null, personnes: null, dateEmmenagement: null,
  };

  const text = body;
  const lower = text.toLowerCase();
  const lines = text.split(/\r?\n/);

  // ── Nom ──
  let nom: string | null = null;
  // Cherche "Je m'appelle X", "Prénom : X", "Nom : X", ligne de signature courte
  const nomPatterns = [
    /(?:je m['']appelle|je suis|prénom\s*:?\s*|nom\s*:?\s*)([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+(?:\s+[A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+)*)/,
    /^([A-ZÀÂÄ][a-zàâäéèêëîïôùûüç]+\s+[A-ZÀÂÄ][A-ZÀÂÄ][A-ZÀÂÄ]+)$/m, // Prénom NOM
  ];
  for (const p of nomPatterns) {
    const m = text.match(p);
    const matched = m?.[1];
    if (matched && matched.length >= 3 && matched.length <= 50) { nom = matched.trim(); break; }
  }
  // Fallback : signature (dernière ligne non vide < 40 chars et 2+ mots)
  if (!nom) {
    const nonEmptyLines = lines.map((l) => l.trim()).filter((l) => l.length > 2 && l.length < 45);
    const lastLine = nonEmptyLines[nonEmptyLines.length - 1] ?? null;
    if (lastLine && lastLine.split(/\s+/).length >= 2 && !/[.@]/.test(lastLine)) nom = lastLine;
  }

  // ── Téléphone ──
  let tel: string | null = null;
  const telMatch = text.match(/(?:(?:\+33|0033|0)[1-9](?:[.\- ]?\d{2}){4})/);
  if (telMatch) tel = telMatch[0].replace(/[.\- ]/g, " ").trim();

  // ── Situation professionnelle ──
  let situation: string | null = null;
  for (const [kw, label] of SITUATION_KEYWORDS) {
    if (lower.includes(kw)) { situation = label; break; }
  }

  // ── Revenus & loyer max ──
  const moneyRe = /(\d[\d\s]*(?:[,\.]\d+)?)\s*(?:€|euros?|eur)/gi;
  const allMoney = [...text.matchAll(moneyRe)].map((m) => ({
    val: parseFloat(m[1].replace(/\s/g, "").replace(",", ".")),
    idx: m.index ?? 0,
  }));

  let revenus: number | null = null;
  let loyerMax: number | null = null;

  for (const line of lines) {
    const l = line.toLowerCase();
    const m = line.match(/(\d[\d\s]*)\s*(?:€|euros?)/i);
    if (!m) continue;
    const val = parseFloat(m[1].replace(/\s/g, ""));
    if (!val || val < 100) continue;
    if (l.includes("salaire") || l.includes("revenu") || l.includes("gagne") || l.includes("touche")) {
      if (!revenus) revenus = val;
    } else if (l.includes("loyer") || l.includes("budget") || l.includes("mensuel")) {
      if (!loyerMax) loyerMax = val;
    }
  }

  // Fallback sur les 2 premiers montants > 200 trouvés
  const bigMoney = allMoney.filter((m) => m.val >= 200).slice(0, 3);
  if (!revenus && !loyerMax && bigMoney.length >= 2) {
    loyerMax = bigMoney[0].val;
    revenus = bigMoney[1].val;
  } else if (!revenus && bigMoney.length >= 1 && !loyerMax) {
    revenus = bigMoney[0].val;
  }

  // ── Animaux ──
  let animaux: string | null = null;
  if (lower.includes("pas d'animal") || lower.includes("sans animal") || lower.includes("pas d'animaux")) {
    animaux = "Non";
  } else if (lower.includes("chat") || lower.includes("chien") || lower.includes("animal") || lower.includes("animaux")) {
    animaux = "Oui";
  }

  // ── Nombre de personnes ──
  let personnes: number | null = null;
  const persMatch = text.match(/(\d+)\s*(?:personnes?|occupants?|habitants?|adultes?)/i);
  if (persMatch) personnes = parseInt(persMatch[1]);
  else if (lower.includes("seul") || lower.includes("seule") || lower.includes("célibataire")) personnes = 1;
  else if (lower.includes("couple") || lower.includes("deux personnes") || lower.includes("2 personnes")) personnes = 2;

  // ── Date d'emménagement ──
  let dateEmmenagement: string | null = null;
  const datePatterns = [
    /(?:dès le|à partir du?|emménager(?:\s+le)?|disponible(?:\s+le)?|entrée(?:\s+le)?)\s+([^\n,]{3,30})/i,
    /\b(\d{1,2}(?:er)?\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+\d{4})/i,
    /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/,
    /(?:mois de|en)\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)/i,
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m?.[1]) { dateEmmenagement = m[1].trim(); break; }
  }

  return { nom, tel, situation, revenus, loyerMax, animaux, personnes, dateEmmenagement };
}

function statusIcon(status: FieldStatus): string {
  if (status === "ok") return "✅";
  if (status === "partial") return "⚠️";
  return "❓";
}

function statusColor(status: FieldStatus): string {
  if (status === "ok") return "rgb(22 163 74)";
  if (status === "partial") return "rgb(234 88 12)";
  return "rgb(148 163 184)";
}

function toFields(data: ProspectData): ProspectField[] {
  const f = (key: string, label: string, raw: string | number | null): ProspectField => {
    const value = raw !== null ? String(raw) : null;
    const status: FieldStatus = value ? "ok" : "missing";
    return { key, label, value, status };
  };

  return [
    f("nom", "Nom / Prénom", data.nom),
    f("tel", "Téléphone", data.tel),
    f("situation", "Situation pro", data.situation),
    f("revenus", "Revenus (€/mois)", data.revenus !== null ? `${data.revenus.toLocaleString("fr-FR")} €` : null),
    f("loyerMax", "Loyer max", data.loyerMax !== null ? `${data.loyerMax.toLocaleString("fr-FR")} €/mois` : null),
    f("animaux", "Animaux", data.animaux),
    f("personnes", "Nb personnes", data.personnes !== null ? String(data.personnes) : null),
    f("dateEmmenagement", "Date emménagement", data.dateEmmenagement),
  ];
}

function scoreColor(pct: number): string {
  if (pct >= 75) return "rgb(22 163 74)";
  if (pct >= 40) return "rgb(234 88 12)";
  return "rgb(220 38 38)";
}

interface ProspectFicheProps {
  body: string | null | undefined;
}

export default function ProspectFiche({ body }: ProspectFicheProps) {
  const data = extractProspect(body);
  const fields = toFields(data);
  const okCount = fields.filter((f) => f.status === "ok").length;
  const pct = Math.round((okCount / fields.length) * 100);
  const color = scoreColor(pct);

  return (
    <div
      className="rounded-xl border p-4 space-y-4 animate-fade-in"
      style={{ borderColor: "rgb(226 232 240)", background: "white" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)" }}>
          Fiche prospect
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color }}>
            {okCount}/{fields.length} infos
          </span>
          <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: `${color}18`, color }}>
            {pct}%
          </span>
        </div>
      </div>

      {/* Barre de progression */}
      <div className="relative h-2 rounded-full overflow-hidden" style={{ background: "rgb(226 232 240)" }}>
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>

      {/* Champs */}
      <div className="space-y-1.5">
        {fields.map((field) => (
          <div
            key={field.key}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg"
            style={{
              background: field.status === "ok" ? "rgba(22,163,74,0.04)" : "rgb(248 250 252)",
              border: `1px solid ${field.status === "ok" ? "rgba(22,163,74,0.15)" : "rgb(226 232 240)"}`,
            }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs" style={{ minWidth: "16px" }}>{statusIcon(field.status)}</span>
              <span className="text-xs" style={{ color: "rgb(100 116 139)", minWidth: "120px", flexShrink: 0 }}>
                {field.label}
              </span>
            </div>
            <div className="text-xs font-medium truncate text-right" style={{ color: field.value ? "rgb(30 41 59)" : statusColor(field.status) }}>
              {field.value ?? "Non détecté"}
            </div>
          </div>
        ))}
      </div>

      {/* Message contextuel */}
      {pct < 40 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(220,38,38,0.06)", color: "rgb(185 28 28)", border: "1px solid rgba(220,38,38,0.15)" }}>
          ⚠️ Dossier incomplet — l'IA demandera les informations manquantes dans le brouillon.
        </div>
      )}
      {pct >= 40 && pct < 75 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(234,88,12,0.06)", color: "rgb(194 65 12)", border: "1px solid rgba(234,88,12,0.15)" }}>
          📋 Dossier partiel — quelques infos manquantes à compléter.
        </div>
      )}
      {pct >= 75 && (
        <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "rgba(22,163,74,0.06)", color: "rgb(21 128 61)", border: "1px solid rgba(22,163,74,0.15)" }}>
          ✅ Dossier bien renseigné — le brouillon peut proposer directement un RDV.
        </div>
      )}
    </div>
  );
}
