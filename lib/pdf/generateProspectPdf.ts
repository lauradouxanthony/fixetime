/**
 * Générateur PDF dossier prospect — FixTime
 * Utilise jsPDF côté client uniquement (dynamic import recommandé)
 */

export interface PdfAttachment {
  filename?: string | null;
  name?: string | null;
  storage_url?: string | null;
  size?: number | null;
}

export interface PdfTimelineEntry {
  id: string;
  action_type: string;
  description?: string | null;
  created_at: string;
}

export interface PdfProperty {
  title: string;
  rent: number;
  type?: string | null;
}

export interface GeneratePdfParams {
  email: {
    id: string;
    sender?: string | null;
    subject?: string | null;
    received_at?: string | null;
    prospect_data?: Record<string, unknown> | null;
    attachments?: PdfAttachment[];
  };
  property?: PdfProperty | null;
  timeline?: PdfTimelineEntry[];
  agenceName?: string;
}

const ACTION_LABELS: Record<string, string> = {
  EMAIL_RECU:        "Email reçu",
  IA_REPONDU:        "Réponse IA générée",
  PROSPECT_REPONDU:  "Prospect a répondu",
  VISITE_PROPOSEE:   "Visite proposée",
  VISITE_CONFIRMEE:  "Visite confirmée",
  VISITE_EFFECTUEE:  "Visite effectuée",
  DOSSIER_DEMANDE:   "Dossier demandé",
  DOCUMENT_RECU:     "Document reçu",
  VALIDE:            "Dossier validé",
  REFUSE:            "Dossier refusé",
  RELANCE:           "Relance envoyée",
  NOTE_INTERNE:      "Note interne",
};

export async function generateProspectPdf(params: GeneratePdfParams): Promise<void> {
  const { jsPDF } = await import("jspdf");

  const { email, property, timeline = [], agenceName = "FixTime" } = params;
  const pd = (email.prospect_data ?? {}) as Record<string, unknown>;

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ── Couleurs ──
  const INDIGO: [number, number, number] = [79, 70, 229];
  const SLATE:  [number, number, number] = [30, 41, 59];
  const GRAY:   [number, number, number] = [100, 116, 139];
  const WHITE:  [number, number, number] = [255, 255, 255];

  // ══════════════════════════════════════════════════════
  // PAGE 1 — Fiche prospect
  // ══════════════════════════════════════════════════════

  // Header bandeaux indigo
  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, 210, 26, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("FixTime", 14, 11);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(agenceName, 14, 19);

  // Date de génération
  doc.setTextColor(200, 200, 240);
  doc.setFontSize(8);
  doc.text(`Généré le ${new Date().toLocaleDateString("fr-FR")}`, 170, 19);

  // Titre page
  doc.setTextColor(...SLATE);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Fiche Prospect", 14, 40);

  // Ligne de séparation
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(14, 44, 196, 44);

  let y = 52;

  const addField = (label: string, value: string | null | undefined): void => {
    if (!value) return;
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text(label.toUpperCase(), 14, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...SLATE);
    doc.setFontSize(11);
    doc.text(value, 14, y + 6);
    y += 16;
  };

  // Infos prospect
  addField("Nom / Prénom",            pd.nom as string | null);
  addField("Email",                   email.sender);
  addField("Téléphone",               pd.telephone as string | null);
  addField("Situation professionnelle", pd.situation_pro as string | null);
  addField("Revenus nets / mois",
    pd.revenus_mensuels
      ? `${Number(pd.revenus_mensuels).toLocaleString("fr-FR")} €`
      : null
  );
  addField("Loyer visé",
    pd.loyer_max
      ? `${Number(pd.loyer_max).toLocaleString("fr-FR")} €/mois`
      : null
  );
  addField("Nombre de personnes", pd.nb_personnes != null ? String(pd.nb_personnes) : null);
  addField("Animaux",               pd.animaux as string | null);
  addField("Garant",                pd.garant  as string | null);

  y += 2;

  // Ratio solvabilité
  if (pd.revenus_mensuels && pd.loyer_max) {
    const revenus = Number(pd.revenus_mensuels);
    const loyer   = Number(pd.loyer_max);
    if (revenus > 0) {
      const ratio = (loyer / revenus) * 100;
      const ok    = ratio <= 33;
      const bg: [number, number, number] = ok ? [240, 253, 244] : [254, 242, 242];
      const fg: [number, number, number] = ok ? [22, 163, 74]   : [220, 38, 38];
      doc.setFillColor(...bg);
      doc.roundedRect(14, y, 100, 14, 3, 3, "F");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...fg);
      doc.text(
        `Ratio solvabilité : ${ratio.toFixed(0)}%  ${ok ? "✓ Solvable" : "⚠ Risque élevé"}`,
        18, y + 9
      );
      y += 22;
    }
  }

  // Bien concerné
  if (property) {
    doc.setFillColor(247, 247, 254);
    doc.roundedRect(14, y, 180, 20, 3, 3, "F");
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRAY);
    doc.text("BIEN CONCERNÉ", 18, y + 7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...SLATE);
    doc.setFontSize(10);
    doc.text(property.title, 18, y + 14);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INDIGO);
    doc.text(`${property.rent.toLocaleString("fr-FR")} €/mois`, 155, y + 14);
    y += 28;
  }

  // Statut dossier
  const attachments = email.attachments ?? [];
  const docsReceived = attachments.filter((a) => !!a.storage_url).length;
  const status =
    docsReceived === 0 || docsReceived === 1 ? "INCOMPLET" :
    docsReceived <= 3                         ? "PARTIEL"   : "COMPLET";
  const statusColor: Record<string, [number, number, number]> = {
    COMPLET:   [22, 163, 74],
    PARTIEL:   [234, 179, 8],
    INCOMPLET: [239, 68, 68],
  };
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...(statusColor[status] ?? GRAY));
  doc.text(
    `Statut dossier : ${status} — ${docsReceived} document${docsReceived > 1 ? "s" : ""} reçu${docsReceived > 1 ? "s" : ""}`,
    14, y
  );

  // ══════════════════════════════════════════════════════
  // PAGE 2 — Documents reçus
  // ══════════════════════════════════════════════════════
  doc.addPage();

  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, 210, 20, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Documents reçus", 14, 13);

  y = 34;

  if (attachments.length === 0) {
    doc.setTextColor(...GRAY);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Aucun document reçu pour ce prospect.", 14, y);
  } else {
    for (const att of attachments) {
      if (y > 270) { doc.addPage(); y = 20; }
      const hasFile = !!att.storage_url;
      const bgColor: [number, number, number] = hasFile ? [240, 253, 244] : [248, 250, 252];
      doc.setFillColor(...bgColor);
      doc.roundedRect(14, y, 180, 14, 2, 2, "F");
      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(hasFile ? 22 : 148, hasFile ? 163 : 163, hasFile ? 74 : 184);
      doc.text(hasFile ? "✓" : "○", 18, y + 9);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...SLATE);
      const fname = att.filename ?? att.name ?? "Document";
      doc.text(fname.length > 55 ? fname.substring(0, 52) + "…" : fname, 26, y + 9);
      if (att.size) {
        doc.setTextColor(...GRAY);
        const kb = Math.round(att.size / 1024);
        doc.text(`${kb} Ko`, 170, y + 9);
      }
      y += 18;
    }
  }

  // ══════════════════════════════════════════════════════
  // PAGE 3 — Timeline / Historique
  // ══════════════════════════════════════════════════════
  doc.addPage();

  doc.setFillColor(...INDIGO);
  doc.rect(0, 0, 210, 20, "F");
  doc.setTextColor(...WHITE);
  doc.setFontSize(13);
  doc.setFont("helvetica", "bold");
  doc.text("Historique complet", 14, 13);

  y = 34;

  if (timeline.length === 0) {
    doc.setTextColor(...GRAY);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("Aucun événement enregistré dans l'historique.", 14, y);
  } else {
    for (const entry of timeline) {
      if (y > 270) { doc.addPage(); y = 20; }
      const date    = new Date(entry.created_at);
      const dateStr = date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
      const timeStr = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

      doc.setFillColor(248, 250, 252);
      doc.roundedRect(14, y, 180, 18, 2, 2, "F");

      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INDIGO);
      doc.text(ACTION_LABELS[entry.action_type] ?? entry.action_type, 18, y + 6);

      doc.setFont("helvetica", "normal");
      doc.setTextColor(...SLATE);
      const desc = entry.description ?? "";
      doc.text(desc.length > 72 ? desc.substring(0, 69) + "…" : desc, 18, y + 13);

      doc.setTextColor(...GRAY);
      doc.text(`${dateStr} ${timeStr}`, 148, y + 6);

      y += 22;
    }
  }

  // ── Footer sur toutes les pages ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Page ${i} / ${pageCount}  —  Généré par FixTime le ${new Date().toLocaleDateString("fr-FR")}`,
      14, 290
    );
  }

  // ── Sauvegarde ──
  const nom    = (pd.nom as string | null) ?? email.sender ?? "prospect";
  const safe   = nom.replace(/[^a-zA-ZÀ-ÿ0-9]/g, "_").substring(0, 30);
  const today  = new Date().toISOString().split("T")[0];
  doc.save(`dossier_${safe}_${today}.pdf`);
}
