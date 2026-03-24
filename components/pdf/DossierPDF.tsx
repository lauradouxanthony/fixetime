/**
 * DossierPDF — Composant React PDF pour le dossier de candidature locataire
 * Utilise @react-pdf/renderer (rendu server-side via renderToBuffer)
 * 3 pages : Résumé candidat / Checklist documents / Historique
 */
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

export interface DossierDoc {
  label: string;
  status: "valide" | "en_attente" | "manquant";
  received_at?: string | null;
}

export interface DossierTimelineEntry {
  id: string;
  action_type: string;
  description?: string | null;
  created_at: string;
}

export interface DossierPDFProps {
  candidatName: string;
  email?: string | null;
  telephone?: string | null;
  situationPro?: string | null;
  revenus?: number | null;
  garant?: string | null;
  ratio?: number | null;
  /** Bien ciblé */
  propertyTitle?: string | null;
  propertyRent?: number | null;
  /** Statut global documents */
  docsTotal: number;
  docsRecus: number;
  docs: DossierDoc[];
  /** Historique (max 10) */
  timeline: DossierTimelineEntry[];
  /** Date de génération ISO */
  generatedAt: string;
}

// ── Couleurs ──────────────────────────────────────────────────────────────────
const C = {
  blue: "#2563eb",
  blueDark: "#1d4ed8",
  blueLight: "#dbeafe",
  green: "#16a34a",
  greenLight: "#dcfce7",
  orange: "#ea580c",
  orangeLight: "#ffedd5",
  red: "#dc2626",
  redLight: "#fee2e2",
  slate: "#1a1a1a",
  gray: "#64748b",
  grayLight: "#f8fafc",
  border: "#e2e8f0",
  white: "#ffffff",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: C.white,
    paddingHorizontal: 40,
    paddingVertical: 40,
    color: C.slate,
    fontSize: 10,
  },
  // Header banderole
  header: {
    backgroundColor: C.blue,
    marginHorizontal: -40,
    marginTop: -40,
    paddingHorizontal: 40,
    paddingVertical: 14,
    marginBottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerTitle: {
    color: C.white,
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
  },
  headerSub: {
    color: "#bfdbfe",
    fontSize: 8,
    marginTop: 2,
  },
  headerDate: {
    color: "#bfdbfe",
    fontSize: 7,
    textAlign: "right",
  },
  // Section
  sectionTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.blue,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    paddingBottom: 4,
    marginBottom: 10,
    marginTop: 16,
  },
  // Grille 2 colonnes
  row2: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 8,
  },
  fieldBox: {
    flex: 1,
    backgroundColor: C.grayLight,
    borderRadius: 4,
    padding: 8,
  },
  fieldLabel: {
    fontSize: 7,
    color: C.gray,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 3,
  },
  fieldValue: {
    fontSize: 10,
    color: C.slate,
  },
  // Badge solvabilité
  solvBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  solvText: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  // Bien ciblé
  propertyBox: {
    backgroundColor: "#eff6ff",
    borderRadius: 6,
    padding: 10,
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  propertyLabel: {
    fontSize: 7,
    color: C.gray,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  propertyTitle: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.slate,
  },
  propertyRent: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
    color: C.blue,
  },
  // Checklist doc
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 5,
    marginBottom: 5,
  },
  docIcon: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    width: 20,
  },
  docLabel: {
    flex: 1,
    fontSize: 9,
    color: C.slate,
  },
  docDate: {
    fontSize: 8,
    color: C.gray,
    marginLeft: 8,
  },
  // Résumé docs
  docsSummaryBox: {
    backgroundColor: C.grayLight,
    borderRadius: 6,
    padding: 10,
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  docsSummaryText: {
    fontSize: 11,
    fontFamily: "Helvetica-Bold",
    color: C.slate,
  },
  // Timeline
  timelineEntry: {
    flexDirection: "row",
    marginBottom: 10,
    gap: 10,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.blue,
    marginTop: 2,
  },
  timelineContent: {
    flex: 1,
    backgroundColor: C.grayLight,
    borderRadius: 5,
    padding: 8,
  },
  timelineAction: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: C.blue,
    marginBottom: 2,
  },
  timelineDesc: {
    fontSize: 8.5,
    color: C.slate,
  },
  timelineDate: {
    fontSize: 7,
    color: C.gray,
    marginTop: 3,
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 20,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: C.border,
    paddingTop: 6,
  },
  footerText: {
    fontSize: 7,
    color: C.gray,
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  EMAIL_RECU: "Email reçu",
  IA_REPONDU: "Réponse IA générée",
  PROSPECT_REPONDU: "Prospect a répondu",
  VISITE_PROPOSEE: "Visite proposée",
  VISITE_CONFIRMEE: "Visite confirmée",
  VISITE_EFFECTUEE: "Visite effectuée",
  DOSSIER_DEMANDE: "Dossier demandé",
  DOCUMENT_RECU: "Document reçu",
  DOCUMENT_VALIDE: "Document validé",
  DOCUMENT_REJETE: "Document rejeté",
  VALIDE: "Dossier validé",
  REFUSE: "Dossier refusé",
  RELANCE: "Relance envoyée",
  NOTE_INTERNE: "Note interne",
  changement_creneau: "Demande changement de créneau",
  docs_recus_hors_etape: "Documents reçus hors étape",
  refus_visite_provisoire: "Refus visite provisoire",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ── Composant principal ───────────────────────────────────────────────────────

export function DossierPDF({
  candidatName,
  email,
  telephone,
  situationPro,
  revenus,
  garant,
  ratio,
  propertyTitle,
  propertyRent,
  docsTotal,
  docsRecus,
  docs,
  timeline,
  generatedAt,
}: DossierPDFProps) {
  const dateStr = new Date(generatedAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Solvabilité
  let solvColor = C.red;
  let solvBg = C.redLight;
  let solvLabel = "";
  if (ratio !== null && ratio !== undefined) {
    if (ratio >= 3) { solvColor = C.green; solvBg = C.greenLight; solvLabel = `✓ Dossier solvable (${ratio.toFixed(1)}x)`; }
    else if (ratio >= 2) { solvColor = C.orange; solvBg = C.orangeLight; solvLabel = `⚠ Solvabilité limite (${ratio.toFixed(1)}x)`; }
    else { solvColor = C.red; solvBg = C.redLight; solvLabel = `✗ Insuffisant (${ratio.toFixed(1)}x)`; }
  }

  const Footer = ({ pageLabel }: { pageLabel: string }) => (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>Généré par FixTime — {dateStr} — Confidentiel</Text>
      <Text style={styles.footerText}>{pageLabel}</Text>
    </View>
  );

  return (
    <Document title={`Dossier ${candidatName}`} author="FixTime">

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* PAGE 1 — Résumé candidat                                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Dossier de candidature — {candidatName}</Text>
            <Text style={styles.headerSub}>{dateStr}</Text>
          </View>
          <Text style={styles.headerDate}>FixTime</Text>
        </View>

        {/* Bien ciblé */}
        {(propertyTitle || propertyRent) && (
          <View style={styles.propertyBox}>
            <View>
              <Text style={styles.propertyLabel}>Bien visé</Text>
              <Text style={styles.propertyTitle}>{propertyTitle ?? "—"}</Text>
            </View>
            {propertyRent && (
              <Text style={styles.propertyRent}>{propertyRent.toLocaleString("fr-FR")} €/mois</Text>
            )}
          </View>
        )}

        {/* Infos candidat */}
        <Text style={styles.sectionTitle}>Informations candidat</Text>

        <View style={styles.row2}>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Situation professionnelle</Text>
            <Text style={styles.fieldValue}>{situationPro ?? "Non renseignée"}</Text>
          </View>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Revenus nets / mois</Text>
            <Text style={styles.fieldValue}>
              {revenus ? `${revenus.toLocaleString("fr-FR")} €` : "Non renseignés"}
            </Text>
          </View>
        </View>

        <View style={styles.row2}>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Email</Text>
            <Text style={styles.fieldValue}>{email ?? "—"}</Text>
          </View>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Téléphone</Text>
            <Text style={styles.fieldValue}>{telephone ?? "—"}</Text>
          </View>
        </View>

        <View style={styles.row2}>
          <View style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>Garant</Text>
            <Text style={styles.fieldValue}>{garant ?? "Non"}</Text>
          </View>
          <View style={[styles.fieldBox, { flex: 1 }]}>
            <Text style={styles.fieldLabel}>Ratio loyer / revenus</Text>
            {ratio !== null && ratio !== undefined ? (
              <Text style={styles.fieldValue}>{ratio.toFixed(1)}x</Text>
            ) : (
              <Text style={styles.fieldValue}>—</Text>
            )}
          </View>
        </View>

        {/* Badge solvabilité */}
        {ratio !== null && ratio !== undefined && (
          <View style={[styles.solvBadge, { backgroundColor: solvBg }]}>
            <Text style={[styles.solvText, { color: solvColor }]}>{solvLabel}</Text>
          </View>
        )}

        <Footer pageLabel="Page 1 / 3" />
      </Page>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* PAGE 2 — Checklist documents                                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Documents fournis</Text>
            <Text style={styles.headerSub}>{candidatName}</Text>
          </View>
          <Text style={styles.headerDate}>FixTime</Text>
        </View>

        {docs.length === 0 ? (
          <Text style={{ fontSize: 9, color: C.gray, marginTop: 8 }}>
            Aucun document attendu défini pour ce bien.
          </Text>
        ) : (
          docs.map((doc, i) => {
            const isValide = doc.status === "valide";
            const isAttente = doc.status === "en_attente";
            const bg = isValide ? C.greenLight : isAttente ? C.orangeLight : C.redLight;
            const iconColor = isValide ? C.green : isAttente ? C.orange : C.red;
            const icon = isValide ? "✓" : isAttente ? "⚠" : "✗";
            return (
              <View key={i} style={[styles.docRow, { backgroundColor: bg }]}>
                <Text style={[styles.docIcon, { color: iconColor }]}>{icon}</Text>
                <Text style={styles.docLabel}>{doc.label}</Text>
                {doc.received_at && (
                  <Text style={styles.docDate}>Reçu le {fmtDate(doc.received_at)}</Text>
                )}
              </View>
            );
          })
        )}

        {/* Résumé global */}
        <View style={styles.docsSummaryBox}>
          <Text style={styles.docsSummaryText}>
            {docsRecus} / {docsTotal} documents reçus
          </Text>
        </View>

        <Footer pageLabel="Page 2 / 3" />
      </Page>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* PAGE 3 — Historique de la candidature                        */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.headerTitle}>Historique de la candidature</Text>
            <Text style={styles.headerSub}>{candidatName}</Text>
          </View>
          <Text style={styles.headerDate}>FixTime</Text>
        </View>

        {timeline.length === 0 ? (
          <Text style={{ fontSize: 9, color: C.gray, marginTop: 8 }}>
            Aucun événement enregistré.
          </Text>
        ) : (
          timeline.slice(0, 10).map((entry, i) => (
            <View key={i} style={styles.timelineEntry}>
              <View style={styles.timelineDot} />
              <View style={styles.timelineContent}>
                <Text style={styles.timelineAction}>
                  {ACTION_LABELS[entry.action_type] ?? entry.action_type}
                </Text>
                {entry.description ? (
                  <Text style={styles.timelineDesc}>{entry.description}</Text>
                ) : null}
                <Text style={styles.timelineDate}>{fmtDate(entry.created_at)}</Text>
              </View>
            </View>
          ))
        )}

        <Footer pageLabel="Page 3 / 3" />
      </Page>

    </Document>
  );
}
