import { buildSystemPrompt, BuildSystemPromptParams } from "../lib/ai/buildSystemPrompt";

// Paramètres de base communs à tous les tests
const BASE_PARAMS: BuildSystemPromptParams = {
  nomAgence: "Agence Test",
  multiplicateur: 3,
  seuilAutopilote: 3.5,
  tonDeVoix: "Professionnel et formel",
  instructions: "",
  prioriteProfils: "",
  heureDebut: 9,
  heureFin: 18,
  dureeVisite: 60,
  etapeProcess: "NEW",
  garantObligatoire: { cdd: true, auto: true, etudiant: true, retraite: false },
  prospect: {
    nom: null,
    telephone: null,
    situation_pro: null,
    revenus_mensuels: null,
    revenus_garant: null,
    loyer_max: null,
    garant: null,
    date_entree_souhaitee: null,
  },
  bien: null,
  docsList: ["Fiches de paie (3 mois)", "Contrat de travail", "Pièce d'identité"],
  faqContext: "",
  multipleProperties: [],
  champsQualification: ["situation_pro", "revenus_mensuels", "garant"],
  customQuestion: "",
};

const BIEN_RIVOLI = {
  id: "prop-001",
  name: "Studio rue de Rivoli",
  title: null,
  address: "15 rue de Rivoli, 75001 Paris",
  rent: 850,
  loyer: 850,
  charges: 80,
  charges_mensuelles: 80,
  type: "studio",
  meuble: false,
  animaux_acceptes: true,
  parking_inclus: false,
  disponible_a_partir_de: "2024-04-01",
  description: null,
  notes_specifiques: null,
};

const BIEN_T2 = {
  ...BIEN_RIVOLI,
  id: "prop-002",
  name: "T2 République",
  loyer: 1200,
  rent: 1200,
  animaux_acceptes: false,
  disponible_a_partir_de: "2024-05-15",
};

// ── Test 1 : animaux_acceptes = true ──────────────────────────────────────────
describe("Test 1 — animaux_acceptes = true", () => {
  it("le prompt doit contenir 'OUI — les animaux sont acceptés'", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      bien: BIEN_RIVOLI,
    });
    expect(prompt).toContain("OUI — les animaux sont acceptés");
    expect(prompt).not.toContain("NON — les animaux ne sont pas");
  });
});

// ── Test 2 : animaux_acceptes = false ─────────────────────────────────────────
describe("Test 2 — animaux_acceptes = false", () => {
  it("le prompt doit contenir 'NON — les animaux ne sont pas'", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      bien: BIEN_T2,
    });
    expect(prompt).toContain("NON — les animaux ne sont pas");
    expect(prompt).not.toContain("OUI — les animaux sont acceptés");
  });
});

// ── Test 3 : etape = NEW → loyer et disponibilité dans le prompt ──────────────
describe("Test 3 — etape NEW avec bien identifié", () => {
  it("le prompt doit contenir le loyer et la date de disponibilité", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      etapeProcess: "NEW",
      bien: BIEN_RIVOLI,
    });
    expect(prompt).toContain("850€/mois");
    expect(prompt).toContain("2024-04-01");
  });

  it("le prompt doit contenir la règle PREMIER CONTACT", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      etapeProcess: "NEW",
      bien: BIEN_RIVOLI,
    });
    expect(prompt).toContain("RÈGLE PREMIER CONTACT");
  });
});

// ── Test 4 : prospect CDI solvable → workflow doit proposer une visite ────────
describe("Test 4 — CDI solvable, workflow QUALIFICATION", () => {
  it("le prompt doit indiquer de proposer des créneaux de visite si solvable", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      etapeProcess: "QUALIFICATION",
      bien: BIEN_RIVOLI,
      prospect: {
        ...BASE_PARAMS.prospect,
        situation_pro: "CDI",
        revenus_mensuels: 3500,
      },
    });
    // Le workflow doit mentionner VISITE_PROPOSEE quand solvable
    expect(prompt).toContain("VISITE_PROPOSEE");
    // Le seuil calculé doit apparaître (3.5 * 850 = 2975)
    expect(prompt).toContain("2975");
  });

  it("le prompt doit lister les documents à préparer si qualification complète", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      etapeProcess: "QUALIFICATION",
      bien: BIEN_RIVOLI,
      prospect: {
        ...BASE_PARAMS.prospect,
        situation_pro: "CDI",
        revenus_mensuels: 3500,
      },
    });
    expect(prompt).toContain("Fiches de paie");
  });
});

// ── Test 5 : ETUDIANT → garant obligatoire dans le prompt ────────────────────
describe("Test 5 — profil ETUDIANT", () => {
  it("le prompt doit mentionner GARANT OBLIGATOIRE pour les étudiants", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      prospect: {
        ...BASE_PARAMS.prospect,
        situation_pro: "ETUDIANT",
      },
    });
    expect(prompt).toContain("GARANT OBLIGATOIRE");
    expect(prompt.toLowerCase()).toContain("etudiant");
  });
});

// ── Test bonus : animaux_acceptes = null → "Non précisé" ─────────────────────
describe("Test bonus — animaux_acceptes = null", () => {
  it("le prompt doit afficher 'Non précisé' quand animaux_acceptes est null", () => {
    const prompt = buildSystemPrompt({
      ...BASE_PARAMS,
      bien: { ...BIEN_RIVOLI, animaux_acceptes: null },
    });
    expect(prompt).toContain("Non précisé");
    expect(prompt).not.toContain("OUI — les animaux");
    expect(prompt).not.toContain("NON — les animaux");
  });
});
