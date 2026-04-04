"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const TOTAL_STEPS = 6;

type BienForm = { titre: string; loyer: string; type: string };
const BIEN_TYPES = ["Appartement", "Maison", "Studio", "Parking", "Local commercial"];

const PROPERTY_TYPES = [
  { id: "appartements", label: "Appartements" },
  { id: "maisons", label: "Maisons" },
  { id: "studios", label: "Studios" },
  { id: "parkings", label: "Parkings" },
  { id: "locaux_commerciaux", label: "Locaux commerciaux" },
];

const IA_QUESTIONS = [
  {
    id: "loyer_moyen",
    question: "Quel est le loyer moyen de vos biens ?",
    placeholder: "Ex: 850 €/mois",
    type: "text",
    icon: "💰",
  },
  {
    id: "nb_biens",
    question: "Combien de biens gérez-vous ?",
    placeholder: "Ex: 25 biens",
    type: "text",
    icon: "🏠",
  },
  {
    id: "multiplicateur",
    question: "Quel multiplicateur de revenus exigez-vous ?",
    placeholder: "Ex: 3 (revenus ≥ 3× le loyer)",
    type: "text",
    icon: "📊",
  },
  {
    id: "zones",
    question: "Dans quelles zones géographiques opérez-vous ?",
    placeholder: "Ex: Paris 11e, Paris 12e, Vincennes",
    type: "text",
    icon: "📍",
  },
  {
    id: "specificites",
    question: "Spécificités à communiquer aux prospects ?",
    placeholder: "Ex: Pas d'animaux, parking inclus, immeuble haussmannien",
    type: "text",
    icon: "📝",
  },
];

// ── Composants utilitaires ──────────────────────────────────────────────────

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-8">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className="flex-1 h-1.5 rounded-full transition-all duration-500"
          style={{ background: i < step ? "rgb(79 70 229)" : "rgb(226 232 240)" }}
        />
      ))}
    </div>
  );
}

function StepBadge({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ background: "rgb(79 70 229)" }}
      >
        {step}
      </div>
      <span className="text-xs font-medium" style={{ color: "rgb(100 116 139)" }}>
        Étape {step} sur {TOTAL_STEPS}
      </span>
    </div>
  );
}

function QuestionDots({ total, current }: { total: number; current: number }) {
  return (
    <div className="flex gap-1.5 items-center">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-300"
          style={{
            width: i === current ? "20px" : "6px",
            height: "6px",
            background: i <= current ? "rgb(79 70 229)" : "rgb(226 232 240)",
          }}
        />
      ))}
    </div>
  );
}

// ── Composant principal ──────────────────────────────────────────────────────

export default function OnboardingClient() {
  const router = useRouter();

  // État principal
  const [step, setStep] = useState(1);
  const [connectedProvider, setConnectedProvider] = useState<"gmail" | "outlook" | null>(null);

  // Étape 1 — Infos agence
  const [agenceName, setAgenceName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [city, setCity] = useState("");
  const [propertyTypes, setPropertyTypes] = useState<string[]>(["appartements"]);

  // Étape 4 — Mes biens
  const [biens, setBiens] = useState<BienForm[]>([{ titre: "", loyer: "", type: "Appartement" }]);

  // Étape 5 — IA
  const [iaAnswers, setIaAnswers] = useState<Record<string, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);

  // UI
  const [saving, setSaving] = useState(false);

  // Lire les params URL au montage (step=X, provider=gmail|outlook)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const stepParam = parseInt(params.get("step") ?? "1");
    const providerParam = params.get("provider");

    if (!isNaN(stepParam) && stepParam >= 1 && stepParam <= 6) {
      setStep(stepParam);
    }
    if (providerParam === "gmail" || providerParam === "outlook") {
      setConnectedProvider(providerParam);
    }
  }, []);

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const goPrev = () => setStep((s) => Math.max(s - 1, 1));

  const togglePropertyType = (id: string) => {
    setPropertyTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  // ── Sauvegarde finale (atomic, 1 seul POST) ─────────────────────────────
  const finalize = async () => {
    setSaving(true);

    const multiplicateur = parseFloat(iaAnswers.multiplicateur || "3");
    const locatifData = {
      multiplicateur: isNaN(multiplicateur) ? 3 : multiplicateur,
      profils: { cdi: true, cdd: true, auto: false, retraite: true, garant: true },
      docs: { fiches_paie: true, contrat: true, avis_imposition: true, piece_identite: true, rib: false },
    };
    const iaData = {
      instructions: iaAnswers.specificites || "",
      zones: iaAnswers.zones || "",
      loyer_moyen: iaAnswers.loyer_moyen || "",
      nb_biens: iaAnswers.nb_biens || "",
    };
    const agenceData = {
      name: agenceName,
      firstName,
      city,
      propertyTypes,
    };

    // localStorage fallback (instant)
    try {
      localStorage.setItem("fixetime_agence", JSON.stringify(agenceData));
      localStorage.setItem("fixetime_locatif", JSON.stringify(locatifData));
      localStorage.setItem("fixetime_ia", JSON.stringify(iaData));
      localStorage.setItem("fixetime_onboarding_done", "true");
    } catch { /* silent */ }

    // Save en DB — POST atomic (le serveur merge avec l'existant)
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_rules: {
            ft_locatif: locatifData,
            ft_ia: iaData,
            ft_agence: agenceData,
            ft_onboarding_done: true, // ← flag "onboarding terminé"
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error("[ONBOARDING] POST settings échoué:", res.status, err);
      } else {
        console.log("[ONBOARDING] ✅ Settings sauvegardés");
      }
    } catch (e) {
      console.error("[ONBOARDING] Erreur réseau settings:", e);
    }

    // Sauvegarder les biens ajoutés pendant l'onboarding (BLOC 2A)
    const validBiens = biens.filter((b) => b.titre.trim().length > 0);
    for (const bien of validBiens) {
      try {
        await fetch("/api/properties", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: bien.titre.trim(),
            rent: parseFloat(bien.loyer) || null,
            type: bien.type,
            available: true,
          }),
        });
      } catch (e) {
        console.warn("[ONBOARDING] Bien non sauvegardé:", bien.titre, e);
      }
    }

    setSaving(false);
    router.push("/home");
  };

  // ── Rendu ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgb(250 250 252)" }}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-8"
        style={{ boxShadow: "0 8px 40px rgba(79,70,229,0.10)", border: "1px solid rgb(226 232 240)" }}
      >
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <img src="/logo-fixtime.png" alt="FixTime" className="h-14 w-auto object-contain" />
        </div>

        <ProgressBar step={step} />

        {/* ── ÉTAPE 1 : Infos agence ── */}
        {step === 1 && (
          <div className="space-y-5">
            <StepBadge step={1} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Votre agence immobilière
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                Ces informations personnalisent votre assistant IA.
              </p>
            </div>

            {/* Nom de l'agence */}
            <div>
              <label className="text-sm font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Nom de l'agence <span style={{ color: "rgb(79 70 229)" }}>*</span>
              </label>
              <input
                type="text"
                value={agenceName}
                onChange={(e) => setAgenceName(e.target.value)}
                placeholder="Ex: Agence Dubois Immobilier"
                autoFocus
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>

            {/* Prénom */}
            <div>
              <label className="text-sm font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Votre prénom
              </label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Ex: Marie"
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>

            {/* Ville */}
            <div>
              <label className="text-sm font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Ville principale d'activité
              </label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Ex: Paris, Lyon, Bordeaux…"
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>

            {/* Types de biens */}
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: "rgb(71 85 105)" }}>
                Types de biens gérés
              </label>
              <div className="flex flex-wrap gap-2">
                {PROPERTY_TYPES.map((pt) => {
                  const selected = propertyTypes.includes(pt.id);
                  return (
                    <button
                      key={pt.id}
                      type="button"
                      onClick={() => togglePropertyType(pt.id)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                      style={{
                        borderColor: selected ? "rgb(79 70 229)" : "rgb(226 232 240)",
                        background: selected ? "rgb(238 242 255)" : "white",
                        color: selected ? "rgb(79 70 229)" : "rgb(71 85 105)",
                      }}
                    >
                      {pt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              onClick={goNext}
              disabled={!agenceName.trim()}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: "rgb(79 70 229)" }}
            >
              Continuer →
            </button>
          </div>
        )}

        {/* ── ÉTAPE 2 : Connexion email ── */}
        {step === 2 && (
          <div className="space-y-5">
            <StepBadge step={2} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Connectez votre messagerie
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                FixTime analysera vos emails entrants pour détecter les prospects locataires.
              </p>
            </div>

            <div className="space-y-3">
              {/* Gmail */}
              <a
                href="/api/auth/google"
                className="flex items-center gap-4 w-full px-4 py-4 rounded-xl border text-sm font-medium transition-all group"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgb(79 70 229)";
                  (e.currentTarget as HTMLElement).style.background = "rgb(248 249 255)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "rgb(226 232 240)";
                  (e.currentTarget as HTMLElement).style.background = "white";
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgb(234 67 53)" }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
                    <path d="M20 4H4C2.9 4 2 4.9 2 6v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm" style={{ color: "rgb(30 41 59)" }}>Gmail / Google Workspace</div>
                  <div className="text-xs mt-0.5" style={{ color: "rgb(100 116 139)" }}>
                    Connexion sécurisée OAuth 2.0
                  </div>
                </div>
                <span style={{ color: "rgb(79 70 229)" }}>→</span>
              </a>

              {/* Outlook — Prochainement (sync non disponible) */}
              <div
                className="flex items-center gap-4 w-full px-4 py-4 rounded-xl border text-sm font-medium cursor-not-allowed opacity-60"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(100 116 139)", background: "rgb(248 250 252)" }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgb(148 163 184)" }}
                >
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="white">
                    <path d="M21.5 8.5v9c0 1.1-.9 2-2 2h-15c-1.1 0-2-.9-2-2v-9l9.5 5.5 9.5-5.5zm0-2l-9.5 5.5L2.5 6.5c0-1.1.9-2 2-2h15c1.1 0 2 .9 2 2z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm flex items-center gap-2" style={{ color: "rgb(71 85 105)" }}>
                    Outlook / Microsoft 365
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgb(241 245 249)", color: "rgb(100 116 139)" }}>
                      Prochainement
                    </span>
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                    La synchronisation Outlook sera disponible prochainement
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button onClick={goPrev} className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                ← Retour
              </button>
              <button onClick={goNext} className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                Passer cette étape →
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 3 : Connexion calendrier ── */}
        {step === 3 && (
          <div className="space-y-5">
            <StepBadge step={3} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Votre calendrier est connecté
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                FixTime proposera des créneaux de visite selon votre disponibilité.
              </p>
            </div>

            {/* Affichage dynamique selon le provider connecté */}
            {connectedProvider === "outlook" ? (
              <div
                className="rounded-xl border p-4 flex items-start gap-3"
                style={{ borderColor: "rgb(186 230 253)", background: "rgb(240 249 255)" }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgb(0 120 212)" }}
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white">
                    <path d="M19 4h-1V2h-2v2H8V2H6v2H5C3.9 4 3 4.9 3 6v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "rgb(0 120 212)" }}>
                    Outlook Calendar inclus
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "rgb(100 116 139)" }}>
                    En connectant Outlook, votre calendrier Microsoft est automatiquement inclus.
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="rounded-xl border p-4 flex items-start gap-3"
                style={{ borderColor: "rgb(199 210 254)", background: "rgb(238 242 255)" }}
              >
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgb(79 70 229)" }}
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="white">
                    <path d="M19 4h-1V2h-2v2H8V2H6v2H5C3.9 4 3 4.9 3 6v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-semibold" style={{ color: "rgb(79 70 229)" }}>
                    Google Calendar inclus
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: "rgb(100 116 139)" }}>
                    En connectant Gmail, Google Calendar est automatiquement inclus dans votre espace.
                  </div>
                </div>
              </div>
            )}

            {/* Message si aucun provider connecté */}
            {!connectedProvider && (
              <div
                className="rounded-xl border p-3 text-xs"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(100 116 139)", background: "rgb(248 250 252)" }}
              >
                💡 Connectez votre messagerie à l'étape précédente pour activer la synchronisation calendrier.
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={goPrev}
                className="flex-1 py-3 rounded-xl text-sm font-medium border transition-colors"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
              >
                ← Retour
              </button>
              <button
                onClick={goNext}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "rgb(79 70 229)" }}
              >
                Continuer →
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 4 : Mes biens ── */}
        {step === 4 && (
          <div className="space-y-5">
            <StepBadge step={4} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Vos biens à louer
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                Ajoutez vos premiers biens. Vous pourrez en ajouter d'autres depuis votre tableau de bord.
              </p>
            </div>

            {biens.map((bien, idx) => (
              <div
                key={idx}
                className="rounded-xl border p-4 space-y-3"
                style={{ borderColor: "rgb(226 232 240)", background: idx === 0 ? "white" : "rgb(250 250 252)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold" style={{ color: "rgb(100 116 139)" }}>
                    Bien {idx + 1}
                  </span>
                  {idx > 0 && (
                    <button
                      type="button"
                      onClick={() => setBiens((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-xs"
                      style={{ color: "rgb(220 38 38)" }}
                    >
                      Supprimer
                    </button>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium block mb-1" style={{ color: "rgb(71 85 105)" }}>
                    Titre du bien <span style={{ color: "rgb(79 70 229)" }}>*</span>
                  </label>
                  <input
                    type="text"
                    value={bien.titre}
                    onChange={(e) => setBiens((prev) => prev.map((b, i) => i === idx ? { ...b, titre: e.target.value } : b))}
                    placeholder="Ex: Appartement T3 - Paris 11e"
                    className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "rgb(71 85 105)" }}>
                      Loyer (€/mois)
                    </label>
                    <input
                      type="number"
                      value={bien.loyer}
                      onChange={(e) => setBiens((prev) => prev.map((b, i) => i === idx ? { ...b, loyer: e.target.value } : b))}
                      placeholder="850"
                      className="w-full rounded-xl border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium block mb-1" style={{ color: "rgb(71 85 105)" }}>
                      Type
                    </label>
                    <select
                      value={bien.type}
                      onChange={(e) => setBiens((prev) => prev.map((b, i) => i === idx ? { ...b, type: e.target.value } : b))}
                      className="w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                    >
                      {BIEN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setBiens((prev) => [...prev, { titre: "", loyer: "", type: "Appartement" }])}
              className="w-full py-2.5 rounded-xl text-sm font-medium border border-dashed transition-colors"
              style={{ borderColor: "rgb(199 210 254)", color: "rgb(79 70 229)" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(238 242 255)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              + Ajouter un autre bien
            </button>

            <div className="flex gap-3">
              <button
                onClick={goPrev}
                className="flex-1 py-3 rounded-xl text-sm font-medium border transition-colors"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
              >
                ← Retour
              </button>
              <button
                onClick={goNext}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "rgb(79 70 229)" }}
              >
                Continuer →
              </button>
            </div>

            <button
              onClick={goNext}
              className="w-full text-sm text-center py-1"
              style={{ color: "rgb(148 163 184)" }}
            >
              Passer cette étape →
            </button>
          </div>
        )}

        {/* ── ÉTAPE 5 : Configuration IA ── */}
        {step === 5 && (
          <div className="space-y-5">
            <StepBadge step={5} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Configurez votre agent IA
              </h2>
              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                  Question {currentQuestion + 1} sur {IA_QUESTIONS.length}
                </p>
                <QuestionDots total={IA_QUESTIONS.length} current={currentQuestion} />
              </div>
            </div>

            {/* Question courante */}
            <div key={IA_QUESTIONS[currentQuestion].id} className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-xl">{IA_QUESTIONS[currentQuestion].icon}</span>
                <p className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                  {IA_QUESTIONS[currentQuestion].question}
                </p>
              </div>
              <input
                type={IA_QUESTIONS[currentQuestion].type}
                value={iaAnswers[IA_QUESTIONS[currentQuestion].id] || ""}
                onChange={(e) =>
                  setIaAnswers((prev) => ({
                    ...prev,
                    [IA_QUESTIONS[currentQuestion].id]: e.target.value,
                  }))
                }
                placeholder={IA_QUESTIONS[currentQuestion].placeholder}
                autoFocus
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (currentQuestion < IA_QUESTIONS.length - 1) {
                      setCurrentQuestion((q) => q + 1);
                    } else {
                      goNext();
                    }
                  }
                }}
              />
            </div>

            {/* Navigation questions */}
            <div className="flex gap-2">
              {currentQuestion > 0 && (
                <button
                  onClick={() => setCurrentQuestion((q) => q - 1)}
                  className="px-4 py-2 rounded-xl text-sm border"
                  style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)" }}
                >
                  ←
                </button>
              )}
              <button
                onClick={() => {
                  if (currentQuestion < IA_QUESTIONS.length - 1) {
                    setCurrentQuestion((q) => q + 1);
                  } else {
                    goNext();
                  }
                }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold text-white"
                style={{ background: "rgb(79 70 229)" }}
              >
                {currentQuestion < IA_QUESTIONS.length - 1 ? "Question suivante →" : "Terminer →"}
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button onClick={goPrev} className="text-sm" style={{ color: "rgb(148 163 184)" }}>
                ← Retour
              </button>
              <button
                onClick={() => { setCurrentQuestion(0); goNext(); }}
                className="text-sm"
                style={{ color: "rgb(148 163 184)" }}
              >
                Passer cette étape →
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 6 : Récap + Lancement ── */}
        {step === 6 && (
          <div className="space-y-5">
            <StepBadge step={6} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Votre espace est prêt
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                Récapitulatif de votre configuration.
              </p>
            </div>

            {/* Récap */}
            <div
              className="rounded-xl border p-4 space-y-2.5"
              style={{ borderColor: "rgb(226 232 240)", background: "rgb(248 250 252)" }}
            >
              <div className="text-xs font-semibold mb-2 tracking-wide" style={{ color: "rgb(100 116 139)" }}>
                CONFIGURATION
              </div>

              {agenceName && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>🏢 Agence</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{agenceName}</span>
                </div>
              )}
              {firstName && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>👤 Responsable</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{firstName}</span>
                </div>
              )}
              {city && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>📍 Ville</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{city}</span>
                </div>
              )}
              {connectedProvider && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>✉️ Messagerie</span>
                  <span className="font-medium" style={{ color: "rgb(79 70 229)" }}>
                    {connectedProvider === "gmail" ? "Gmail connecté" : "Outlook connecté"}
                  </span>
                </div>
              )}
              {iaAnswers.multiplicateur && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>📊 Multiplicateur</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.multiplicateur}×</span>
                </div>
              )}
              {iaAnswers.loyer_moyen && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>💰 Loyer moyen</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.loyer_moyen}</span>
                </div>
              )}
              {propertyTypes.length > 0 && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>🏠 Types de biens</span>
                  <span className="font-medium text-right ml-4" style={{ color: "rgb(30 41 59)" }}>
                    {propertyTypes.length} type{propertyTypes.length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
              {biens.filter((b) => b.titre.trim()).length > 0 && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>🏢 Biens ajoutés</span>
                  <span className="font-medium" style={{ color: "rgb(79 70 229)" }}>
                    {biens.filter((b) => b.titre.trim()).length} bien{biens.filter((b) => b.titre.trim()).length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span style={{ color: "rgb(71 85 105)" }}>🤖 Mode IA</span>
                <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>DRAFT (modifiable)</span>
              </div>
            </div>

            <button
              onClick={finalize}
              disabled={saving}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
              style={{ background: "rgb(79 70 229)" }}
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sauvegarde en cours…
                </>
              ) : (
                "Accéder à mon tableau de bord →"
              )}
            </button>

            <button
              onClick={goPrev}
              className="w-full text-sm text-center"
              style={{ color: "rgb(148 163 184)" }}
            >
              ← Modifier la configuration
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
