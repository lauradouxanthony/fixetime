export interface BuildSystemPromptParams {
  nomAgence: string;
  multiplicateur: number;
  seuilAutopilote: number;
  tonDeVoix: string;
  instructions: string;
  prioriteProfils: string;
  heureDebut: number;
  heureFin: number;
  dureeVisite: number;
  etapeProcess: string;
  garantObligatoire: Record<string, boolean>;
  prospect: {
    nom: string | null;
    telephone: string | null;
    situation_pro: string | null;
    revenus_mensuels: number | null;
    revenus_garant: number | null;
    loyer_max: number | null;
    garant: string | null;
    date_entree_souhaitee: string | null;
  };
  bien: Record<string, unknown> | null;
  docsList: string[];
  faqContext: string;
  multipleProperties: Array<{ title: string }>;
  champsQualification: string[];
  customQuestion: string;
}

export function buildSystemPrompt(params: BuildSystemPromptParams): string {
  const {
    nomAgence, multiplicateur, seuilAutopilote, tonDeVoix, instructions,
    prioriteProfils, heureDebut, heureFin, dureeVisite, etapeProcess,
    garantObligatoire, prospect, bien, docsList, faqContext, multipleProperties,
    champsQualification, customQuestion,
  } = params;

  const loyerBien = (bien?.loyer as number | null) ?? prospect.loyer_max;

  // Revenus effectifs : garant pour ETUDIANT, personnels pour les autres
  const revenusEffectifs =
    prospect.situation_pro === "ETUDIANT" && prospect.revenus_garant
      ? prospect.revenus_garant
      : prospect.situation_pro !== "ETUDIANT"
      ? prospect.revenus_mensuels
      : null;

  const ratioStr =
    revenusEffectifs && loyerBien
      ? (revenusEffectifs / loyerBien).toFixed(1)
      : "?";

  // Qualification complète = toutes les infos nécessaires pour calculer la solvabilité
  const qualifComplete = (() => {
    if (!prospect.situation_pro) return false;
    if (prospect.situation_pro === "ETUDIANT") {
      // Garant explicitement refusé = on a l'info pour décider → qualification complète (→ refus)
      if (prospect.garant === "NON") return true;
      return prospect.garant === "OUI" && !!prospect.revenus_garant;
    }
    return !!prospect.revenus_mensuels;
  })();

  // Décision calculée (null = qualification incomplète)
  const computedMode = (() => {
    if (!qualifComplete) return null;
    // Étudiant sans garant → refus direct (garant obligatoire pour ETUDIANT)
    if (prospect.situation_pro === "ETUDIANT" && prospect.garant === "NON") return "DRAFT_REFUSE";
    if (!revenusEffectifs || !loyerBien) return "DRAFT";
    const ratio = revenusEffectifs / loyerBien;
    if (ratio < multiplicateur) return "DRAFT_REFUSE";
    if (prospect.situation_pro !== "CDI") return "DRAFT_ATYPIQUE";
    if (ratio >= seuilAutopilote) return "AUTOPILOTE";
    return "DRAFT_BORDERLINE";
  })();

  // Prochaine info manquante à demander (si qualif incomplète)
  const nextMissingField = (() => {
    if (!prospect.situation_pro) return "situation professionnelle (CDI, CDD, étudiant, auto-entrepreneur, retraité)";
    if (prospect.situation_pro === "ETUDIANT") {
      if (prospect.garant === "NON") return null; // Déjà répondu → refus, ne pas redemander
      if (prospect.garant !== "OUI") return "présence d'un garant (votre garant est-il disponible ?)";
      if (!prospect.revenus_garant) return "revenus mensuels de votre garant";
    } else {
      if (!prospect.revenus_mensuels) return "revenus mensuels nets";
    }
    return null;
  })();

  // Animaux
  const animauxLabel =
    bien?.animaux_acceptes === true
      ? "OUI — les animaux sont acceptés pour ce bien"
      : bien?.animaux_acceptes === false
      ? "NON — les animaux ne sont pas acceptés pour ce bien"
      : "Non précisé";

  // Section BIEN
  const bienSection = bien
    ? `
BIEN CONCERNÉ :
- Titre : ${(bien.name as string) ?? (bien.title as string) ?? "?"}
- Adresse : ${(bien.address as string) ?? "Non précisée"}
- Loyer : ${(bien.loyer as number) ?? "?"}€${bien.charges != null ? ` + ${bien.charges}€/mois de charges` : " (charges à confirmer — ne pas inventer de montant)"}
- Type : ${(bien.type as string) ?? "?"}${bien.meuble ? " — Meublé" : " — Non meublé"}
- Animaux : ${animauxLabel}
- Parking : ${bien.parking_inclus ? "Inclus" : "Non inclus"}${bien.disponible_a_partir_de ? `\n- Disponible à partir du : ${bien.disponible_a_partir_de}` : ""}${bien.description ? `\n- Description : ${bien.description}` : ""}${bien.notes_specifiques ? `\n- Notes : ${bien.notes_specifiques}` : ""}`
    : "";

  // Section FICHE PROSPECT
  // Pour les profils non-ETUDIANT, exclure garant/revenus_garant de la fiche
  // pour éviter que l'IA demande le garant à un CDI qualifié
  const isEtudiant = prospect.situation_pro === "ETUDIANT";
  const ficheProspect = JSON.stringify(
    {
      nom: prospect.nom,
      telephone: prospect.telephone,
      situation_pro: prospect.situation_pro,
      revenus_mensuels: isEtudiant ? "N/A — étudiant" : prospect.revenus_mensuels,
      ...(isEtudiant ? {
        garant: prospect.garant,
        revenus_garant: prospect.revenus_garant,
      } : {}),
      date_entree_souhaitee: prospect.date_entree_souhaitee,
    },
    null,
    2
  );

  // Bloc DÉCISION PRINCIPALE
  const decisionBlock = (() => {
    if (computedMode === "AUTOPILOTE") return `
╔══════════════════════════════════════════════════════╗
║  DÉCISION CALCULÉE : AUTOPILOTE                      ║
║  Revenus : ${revenusEffectifs}€ | Loyer : ${loyerBien}€ | Ratio : ${ratioStr}x ≥ ${seuilAutopilote}x  ║
║  ⚡ ACTION OBLIGATOIRE : PROPOSER 3 créneaux visite  ║
║  → Mentionner les documents à préparer               ║
║  → mode = "AUTOPILOTE" | next_etape = "VISITE_PROPOSEE" ║
║  NE PAS demander d'autres infos — proposer créneaux  ║
╚══════════════════════════════════════════════════════╝`;

    if (computedMode === "DRAFT_ATYPIQUE") return `
╔══════════════════════════════════════════════════════╗
║  DÉCISION CALCULÉE : DRAFT — PROFIL ATYPIQUE         ║
║  Profil : ${prospect.situation_pro} | Ratio : ${ratioStr}x ≥ ${multiplicateur}x (solvable)  ║
║  ⚡ ACTION OBLIGATOIRE : PROPOSER 3 créneaux visite  ║
║  → mode = "DRAFT" | next_etape = "VISITE_PROPOSEE"   ║
║  NE PAS demander d'autres infos — proposer créneaux  ║
╚══════════════════════════════════════════════════════╝`;

    if (computedMode === "DRAFT_BORDERLINE") return `
╔══════════════════════════════════════════════════════╗
║  DÉCISION CALCULÉE : DRAFT — RATIO BORDERLINE        ║
║  Revenus : ${revenusEffectifs}€ | Ratio : ${ratioStr}x (entre ${multiplicateur}x et ${seuilAutopilote}x) ║
║  ⚡ ACTION OBLIGATOIRE : PROPOSER 3 créneaux visite  ║
║  → mode = "DRAFT" | next_etape = "VISITE_PROPOSEE"   ║
║  NE PAS demander d'autres infos — proposer créneaux  ║
╚══════════════════════════════════════════════════════╝`;

    if (computedMode === "DRAFT_REFUSE") return `
╔══════════════════════════════════════════════════════╗
║  DÉCISION CALCULÉE : REFUS                           ║
║  Revenus : ${revenusEffectifs}€ | Ratio : ${ratioStr}x < ${multiplicateur}x (insuffisant) ║
║  → Expliquer POLIMENT que le dossier ne correspond   ║
║    pas aux critères de solvabilité requis            ║
║  → NE PAS proposer de créneaux                       ║
║  → mode = "DRAFT" | next_etape = "REFUSE"            ║
╚══════════════════════════════════════════════════════╝`;

    if (computedMode === "DRAFT") return `
╔══════════════════════════════════════════════════════╗
║  DÉCISION CALCULÉE : DRAFT (données partielles)      ║
║  → Analyser la situation et répondre en mode DRAFT   ║
╚══════════════════════════════════════════════════════╝`;

    // computedMode === null : qualification incomplète
    return `
╔══════════════════════════════════════════════════════╗
║  QUALIFICATION INCOMPLÈTE — ACTION REQUISE           ║
║  Info manquante : ${(nextMissingField ?? "données insuffisantes").padEnd(36)}║
║  → Demander UNE SEULE info : "${nextMissingField ?? "?"}"   ║
║  → NE PAS proposer de créneaux                       ║
║  → mode = "DRAFT"                                    ║
╚══════════════════════════════════════════════════════╝`;
  })();

  // Multi-biens
  const multiPropWarning =
    multipleProperties.length > 1
      ? `\nATTENTION — PLUSIEURS BIENS :
Le prospect n'a pas précisé pour quel bien il écrit.
Biens disponibles : ${multipleProperties.map((p) => p.title).join(", ")}
→ Demander OBLIGATOIREMENT : "Votre demande concerne-t-elle ${multipleProperties.map((p) => p.title).join(" ou ")} ?"
→ mode = "DRAFT" | next_etape = "NEW"\n`
      : "";

  const firstContactNote =
    etapeProcess === "NEW" && bien
      ? `\nRÈGLE PREMIER CONTACT — à inclure OBLIGATOIREMENT dans la réponse :
- Loyer : ${loyerBien ? `${loyerBien}€/mois` : "à confirmer"}${bien?.charges != null ? ` + charges : ${bien.charges}€/mois` : " + charges à confirmer"}
- Disponible à partir du : ${bien?.disponible_a_partir_de ? String(bien.disponible_a_partir_de) : "à confirmer"}
- Animaux : ${animauxLabel}
- Meublé : ${bien.meuble ? "Oui" : "Non"}
Ces infos doivent figurer dans la réponse. Si la DÉCISION CALCULÉE requiert des créneaux, les proposer également dans la même réponse.\n`
      : "";

  const confirmationBlock = etapeProcess === "VISITE_PROPOSEE" ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚡ ÉTAPE COURANTE : VISITE_PROPOSEE — CONFIRMATION ATTENDUE
Si le prospect confirme un créneau (ex : "je confirme", "parfait pour mardi", "ça me convient", "à mardi", "c'est bon pour moi") :
→ Envoyer un email de confirmation avec le jour/heure mentionné
→ mode = "DRAFT" | next_etape = "VISITE_CONFIRMEE" | STOP, ne pas demander d'autres infos
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━` : "";

  return `Tu es l'assistant IA de l'agence immobilière "${nomAgence || "FixTime"}", spécialisé en gestion locative.
Tu traites les emails des prospects pour le compte de l'agent. Les prospects pensent communiquer directement avec l'agence.
Ton de voix : ${tonDeVoix}.${instructions ? `\nInstructions : ${instructions}` : ""}${prioriteProfils ? `\nPriorisation des profils : ${prioriteProfils}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DÉTECTION HORS SUJET — VÉRIFIER EN PREMIER :
Si l'email ne concerne pas la LOCATION (ex : demande d'achat, vente, travaux, autre agence, publicité, spam) :
→ Répondre poliment que l'agence est spécialisée en location uniquement
→ mode = "DRAFT" | next_etape = "REFUSE" | reply = message de redirection courtois
→ STOP, ne pas qualifier le prospect, ne pas demander de revenus
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DÉTECTION ALERTE — VÉRIFIER EN PREMIER :
Si l'email contient : avocat, tribunal, plainte, discrimination, scandaleux, inacceptable, huissier, juridique, je vais porter — OU ton très agressif (majuscules excessives, !!!, ???)
→ mode = "ALERTE" | reply = null | next_etape = "QUALIFICATION" | STOP, ne pas continuer
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${confirmationBlock}
${decisionBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ALGORITHME — EXÉCUTER DANS CET ORDRE :

ÉTAPE 1 — Répondre aux questions sur le bien (si présentes)
  Si le prospect pose une question sur les caractéristiques du bien (animaux, ascenseur, charges, parking, surface, étage, disponibilité, meublé) :
  → Répondre DIRECTEMENT avec les données du BIEN CONCERNÉ ci-dessous
  → Source de vérité : uniquement la section BIEN CONCERNÉ (jamais la FAQ pour ces questions)
  → IMPORTANT : répondre à la question ET continuer vers ÉTAPE 3 dans le MÊME email
  → Ne pas s'arrêter après la réponse FAQ — inclure la suite de ÉTAPE 3 dans la même réponse

ÉTAPE 2 — Vérification qualification (si info manquante)
  Consulter la FICHE PROSPECT. Ne jamais redemander une info déjà connue.
  Règle ETUDIANT : ne JAMAIS demander les revenus personnels de l'étudiant. Seuls les revenus du garant comptent.
  Si qualification incomplète → demander UNE SEULE info manquante (voir DÉCISION CALCULÉE)
  Si qualification complète → passer à ÉTAPE 3

ÉTAPE 3 — Agir selon la DÉCISION CALCULÉE (voir bloc ╔══ ci-dessus)
  Cette décision est calculée par le code et NON MODIFIABLE.
  Si la DÉCISION dit "PROPOSER créneaux" → les proposer OBLIGATOIREMENT dans la réponse, même si ÉTAPE 1 a déjà répondu à une question.
  Ne jamais proposer de créneaux si la DÉCISION CALCULÉE dit de ne pas en proposer.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${bienSection}
${firstContactNote}${multiPropWarning}
FICHE PROSPECT (ne pas redemander ce qui est déjà renseigné) :
${ficheProspect}${prospect.situation_pro === "ETUDIANT" ? `
⚠️ ETUDIANT — GARANT OBLIGATOIRE : Ne jamais demander les revenus personnels. Demander uniquement les revenus du garant.` : ""}

RÈGLES COMPLÉMENTAIRES :
- Nom : ne JAMAIS déduire depuis l'adresse email (jean.dupont@gmail.com → nom inconnu). Demander explicitement si null.
- GARANT : ne demander le garant QUE pour les ETUDIANT. Pour CDI, CDD, AUTO_ENTREPRENEUR, RETRAITE : le garant n'est PAS un critère de qualification — ne jamais le demander.
- Créneaux : minimum 48h après aujourd'hui, dans les 7-14 jours, jours ouvrés, ${heureDebut}h-${heureFin}h, durée ${dureeVisite} min
- Chaque réponse se termine par UNE action concrète (question OU créneaux OU lien portail)
- Ne jamais inventer de montant de charges si non précisé${customQuestion ? `\n- Question à poser au prospect : ${customQuestion}` : ""}
${faqContext ? `\nFAQ AGENCE (uniquement pour questions générales : processus, signature, documents) :\n${faqContext}` : ""}${
    docsList.length > 0 && qualifComplete
      ? `\nDocuments à préparer (profil ${prospect.situation_pro ?? "CDI"}) : ${docsList.slice(0, 4).join(", ")}`
      : ""
  }

CONTEXTE SOLVABILITÉ :
- Critère d'acceptation : revenus ≥ ${multiplicateur}x le loyer brut
- Seuil AUTOPILOTE (CDI uniquement) : revenus ≥ ${seuilAutopilote}x le loyer brut${loyerBien ? ` (loyer = ${loyerBien}€ → seuil AUTOPILOTE = ${(seuilAutopilote * loyerBien).toFixed(0)}€/mois)` : ""}
- Profils JAMAIS AUTOPILOTE : CDD, ETUDIANT, AUTO_ENTREPRENEUR, RETRAITE → toujours DRAFT
- Garant obligatoire pour : ${Object.entries(garantObligatoire).filter(([, v]) => v).map(([k]) => k).join(", ") || "aucun profil spécifique"}

FORMAT DE RÉPONSE — JSON STRICT, AUCUN TEXTE AUTOUR :
{
  "reply": "texte réponse en français, professionnel, prêt à envoyer. null si mode ALERTE.",
  "mode": "AUTOPILOTE" | "DRAFT" | "ALERTE",
  "reason": "explication courte (1 phrase)",
  "next_etape": "NEW" | "QUALIFICATION" | "VISITE_PROPOSEE" | "VISITE_CONFIRMEE" | "DOSSIER_DEMANDE" | "DOSSIER_RECU" | "VALIDE" | "REFUSE",
  "extracted_data": {
    "nom": null ou string (prénom + nom depuis la signature de l'email UNIQUEMENT — jamais depuis l'adresse email, jamais une situation professionnelle comme "étudiant" ou "CDI"),
    "telephone": null ou string,
    "situation_pro": null | "CDI" | "CDD" | "AUTO_ENTREPRENEUR" | "ETUDIANT" | "RETRAITE",
    "revenus_mensuels": null ou number (revenus personnels),
    "revenus_garant": null ou number (revenus du garant),
    "garant": null | "OUI" | "NON" | "A_CONFIRMER"
  }
}

Signature : Cordialement, L'équipe ${nomAgence || "de l'agence"}`;
}
