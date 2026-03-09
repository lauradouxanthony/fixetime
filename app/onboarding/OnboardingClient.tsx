"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TOTAL_STEPS = 5;

const IA_QUESTIONS = [
  {
    id: "loyer_moyen",
    question: "Quel est le loyer moyen de vos biens ? (€/mois)",
    placeholder: "Ex: 850",
    type: "number",
  },
  {
    id: "nb_biens",
    question: "Combien de biens gérez-vous ?",
    placeholder: "Ex: 25",
    type: "number",
  },
  {
    id: "multiplicateur",
    question: "Quel multiplicateur de revenus exigez-vous ? (ex: 3 = revenus ≥ 3x loyer)",
    placeholder: "Ex: 3",
    type: "number",
  },
  {
    id: "zones",
    question: "Dans quelles zones géographiques opérez-vous ?",
    placeholder: "Ex: Paris 11e, Paris 12e, Vincennes",
    type: "text",
  },
  {
    id: "specificites",
    question: "Avez-vous des spécificités particulières à communiquer aux prospects ?",
    placeholder: "Ex: Pas d'animaux, parking inclus, immeuble haussmannien",
    type: "text",
  },
];

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
        <div
          key={i}
          className="flex-1 h-1.5 rounded-full transition-all duration-300"
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

export default function OnboardingClient() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [agenceName, setAgenceName] = useState("");
  const [iaAnswers, setIaAnswers] = useState<Record<string, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [saving, setSaving] = useState(false);

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const goPrev = () => setStep((s) => Math.max(s - 1, 1));

  const finalize = async () => {
    setSaving(true);
    // Sauvegarder la config agence en localStorage
    localStorage.setItem("fixetime_agence", JSON.stringify({ name: agenceName }));
    // Sauvegarder les réponses IA
    const multiplicateur = parseFloat(iaAnswers.multiplicateur || "3");
    localStorage.setItem("fixetime_locatif", JSON.stringify({
      multiplicateur: isNaN(multiplicateur) ? 3 : multiplicateur,
      profils: { cdi: true, cdd: true, auto: false, retraite: true, garant: true },
      docs: { fiches_paie: true, contrat: true, avis_imposition: true, piece_identite: true, rib: false },
    }));
    localStorage.setItem("fixetime_ia", JSON.stringify({
      instructions: iaAnswers.specificites || "",
    }));
    localStorage.setItem("fixetime_onboarding_done", "true");
    setSaving(false);
    router.push("/home");
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "rgb(250 250 250)" }}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-8"
        style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.08)", border: "1px solid rgb(226 232 240)" }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 mb-6">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold" style={{ background: "rgb(79 70 229)" }}>FT</div>
          <span className="font-semibold text-sm" style={{ color: "rgb(30 41 59)" }}>FixTime</span>
        </div>

        <ProgressBar step={step} />

        {/* ── ÉTAPE 1 : Nom de l'agence ── */}
        {step === 1 && (
          <div className="space-y-6">
            <StepBadge step={1} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Bienvenue sur FixTime 🏠
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                Commençons par configurer votre agence immobilière.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium block mb-2" style={{ color: "rgb(71 85 105)" }}>
                Nom de votre agence
              </label>
              <input
                type="text"
                value={agenceName}
                onChange={(e) => setAgenceName(e.target.value)}
                placeholder="Ex: Agence Dubois Immobilier"
                autoFocus
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                onKeyDown={(e) => { if (e.key === "Enter" && agenceName.trim()) goNext(); }}
              />
            </div>
            <button
              onClick={goNext}
              disabled={!agenceName.trim()}
              className="w-full py-3 rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-40"
              style={{ background: "rgb(79 70 229)" }}
            >
              Continuer →
            </button>
          </div>
        )}

        {/* ── ÉTAPE 2 : Connexion Gmail ── */}
        {step === 2 && (
          <div className="space-y-6">
            <StepBadge step={2} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Connectez votre boîte email
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                FixTime analysera vos emails entrants pour détecter les prospects locataires.
              </p>
            </div>

            <div className="space-y-3">
              <a
                href="/api/auth/google"
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm font-medium transition-all"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgb(79 70 229)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "rgb(226 232 240)"; }}
              >
                <span className="text-xl">📧</span>
                <div>
                  <div className="font-medium">Gmail (Google Workspace)</div>
                  <div className="text-xs" style={{ color: "rgb(100 116 139)" }}>Recommandé</div>
                </div>
                <span className="ml-auto" style={{ color: "rgb(79 70 229)" }}>→</span>
              </a>

              <div
                className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border text-sm opacity-50"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(100 116 139)" }}
              >
                <span className="text-xl">📨</span>
                <div>
                  <div>Outlook / Microsoft 365</div>
                  <div className="text-xs">Bientôt disponible</div>
                </div>
              </div>
            </div>

            <button onClick={goPrev} className="text-sm" style={{ color: "rgb(100 116 139)" }}>
              ← Retour
            </button>
          </div>
        )}

        {/* ── ÉTAPE 3 : Connexion calendrier ── */}
        {step === 3 && (
          <div className="space-y-6">
            <StepBadge step={3} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Connectez votre calendrier
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                FixTime proposera des créneaux de visite selon votre disponibilité.
              </p>
            </div>

            <div
              className="rounded-xl border p-4 flex items-start gap-3"
              style={{ borderColor: "rgb(199 210 254)", background: "rgb(238 242 255)" }}
            >
              <span className="text-lg">✅</span>
              <div>
                <div className="text-sm font-medium" style={{ color: "rgb(79 70 229)" }}>
                  Google Calendar inclus
                </div>
                <div className="text-xs mt-0.5" style={{ color: "rgb(100 116 139)" }}>
                  En connectant Gmail à l'étape précédente, Google Calendar est automatiquement inclus.
                </div>
              </div>
            </div>

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
                className="flex-1 py-3 rounded-xl text-sm font-medium text-white"
                style={{ background: "rgb(79 70 229)" }}
              >
                Continuer →
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 4 : Agent IA de configuration ── */}
        {step === 4 && (
          <div className="space-y-6">
            <StepBadge step={4} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Configurons votre agent IA 🤖
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                {currentQuestion + 1}/{IA_QUESTIONS.length} questions pour personnaliser FixTime.
              </p>
            </div>

            {/* Question courante */}
            <div key={IA_QUESTIONS[currentQuestion].id} className="space-y-3">
              <p className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                {IA_QUESTIONS[currentQuestion].question}
              </p>
              <input
                type={IA_QUESTIONS[currentQuestion].type}
                value={iaAnswers[IA_QUESTIONS[currentQuestion].id] || ""}
                onChange={(e) => setIaAnswers((prev) => ({
                  ...prev,
                  [IA_QUESTIONS[currentQuestion].id]: e.target.value,
                }))}
                placeholder={IA_QUESTIONS[currentQuestion].placeholder}
                autoFocus
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none"
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
                className="flex-1 py-2 rounded-xl text-sm font-medium text-white"
                style={{ background: "rgb(79 70 229)" }}
              >
                {currentQuestion < IA_QUESTIONS.length - 1 ? "Question suivante →" : "Terminer la configuration →"}
              </button>
            </div>

            <button onClick={goPrev} className="text-sm" style={{ color: "rgb(100 116 139)" }}>
              ← Retour
            </button>
          </div>
        )}

        {/* ── ÉTAPE 5 : Récap + Lancement ── */}
        {step === 5 && (
          <div className="space-y-6">
            <StepBadge step={5} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Tout est prêt ! 🎉
              </h2>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                Votre agent IA est configuré pour {agenceName || "votre agence"}.
              </p>
            </div>

            {/* Récap */}
            <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "rgb(226 232 240)", background: "rgb(248 250 252)" }}>
              <div className="text-xs font-semibold mb-2" style={{ color: "rgb(100 116 139)" }}>
                RÉCAPITULATIF
              </div>
              {agenceName && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>Agence</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{agenceName}</span>
                </div>
              )}
              {iaAnswers.multiplicateur && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>Multiplicateur revenus</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.multiplicateur}x</span>
                </div>
              )}
              {iaAnswers.zones && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>Zones</span>
                  <span className="font-medium text-right ml-4" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.zones}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span style={{ color: "rgb(71 85 105)" }}>Mode pipeline</span>
                <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>DRAFT (modifiable)</span>
              </div>
            </div>

            <button
              onClick={finalize}
              disabled={saving}
              className="w-full py-3 rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-60"
              style={{ background: "rgb(79 70 229)" }}
            >
              {saving ? "Chargement…" : "🚀 Accéder à mon tableau de bord"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
