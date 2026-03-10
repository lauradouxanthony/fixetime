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
    emoji: "💰",
  },
  {
    id: "nb_biens",
    question: "Combien de biens gérez-vous ?",
    placeholder: "Ex: 25",
    type: "number",
    emoji: "🏠",
  },
  {
    id: "multiplicateur",
    question: "Quel multiplicateur de revenus exigez-vous ?",
    placeholder: "Ex: 3 (revenus ≥ 3x le loyer)",
    type: "number",
    emoji: "📊",
  },
  {
    id: "zones",
    question: "Dans quelles zones géographiques opérez-vous ?",
    placeholder: "Ex: Paris 11e, Paris 12e, Vincennes",
    type: "text",
    emoji: "📍",
  },
  {
    id: "specificites",
    question: "Avez-vous des spécificités à communiquer aux prospects ?",
    placeholder: "Ex: Pas d'animaux, parking inclus, immeuble haussmannien",
    type: "text",
    emoji: "📝",
  },
];

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

export default function OnboardingClient() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [agenceName, setAgenceName] = useState("");
  const [iaAnswers, setIaAnswers] = useState<Record<string, string>>({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [saving, setSaving] = useState(false);

  const goNext = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  const goPrev = () => setStep((s) => Math.max(s - 1, 1));
  const skipIA = () => { setCurrentQuestion(0); goNext(); };

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

    // Save to localStorage (instant fallback)
    try {
      localStorage.setItem("fixetime_agence", JSON.stringify({ name: agenceName }));
      localStorage.setItem("fixetime_locatif", JSON.stringify(locatifData));
      localStorage.setItem("fixetime_ia", JSON.stringify(iaData));
      localStorage.setItem("fixetime_onboarding_done", "true");
    } catch { /* silent */ }

    // Save to Supabase via settings API
    try {
      const res = await fetch("/api/settings", { cache: "no-store" });
      const current = res.ok ? await res.json() : {};
      const currentRules = (current?.email_rules && typeof current.email_rules === "object")
        ? current.email_rules : {};

      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email_rules: {
            ...currentRules,
            ft_locatif: locatifData,
            ft_ia: iaData,
            ft_agence: { name: agenceName },
          },
        }),
      });
    } catch { /* silent — localStorage is the fallback */ }

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
        <div className="flex justify-center mb-6">
          <img src="/logo-fixtime.png" alt="FixTime" className="h-16 w-auto object-contain mx-auto" />
        </div>

        <ProgressBar step={step} />

        {/* ── ÉTAPE 1 : Nom de l'agence ── */}
        {step === 1 && (
          <div className="space-y-6 animate-fade-in">
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
          <div className="space-y-6 animate-fade-in">
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

            <div className="flex items-center justify-between">
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
          <div className="space-y-6 animate-fade-in">
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
          <div className="space-y-6 animate-fade-in">
            <StepBadge step={4} />
            <div>
              <h2 className="text-xl font-semibold mb-1" style={{ color: "rgb(30 41 59)" }}>
                Configurons votre agent IA 🤖
              </h2>
              <div className="flex items-center justify-between">
                <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                  {currentQuestion + 1}/{IA_QUESTIONS.length} — Personnalisation FixTime
                </p>
                <QuestionDots total={IA_QUESTIONS.length} current={currentQuestion} />
              </div>
            </div>

            {/* Question courante */}
            <div key={IA_QUESTIONS[currentQuestion].id} className="space-y-3 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="text-xl">{IA_QUESTIONS[currentQuestion].emoji}</span>
                <p className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
                  {IA_QUESTIONS[currentQuestion].question}
                </p>
              </div>
              <input
                type={IA_QUESTIONS[currentQuestion].type}
                value={iaAnswers[IA_QUESTIONS[currentQuestion].id] || ""}
                onChange={(e) => setIaAnswers((prev) => ({
                  ...prev,
                  [IA_QUESTIONS[currentQuestion].id]: e.target.value,
                }))}
                placeholder={IA_QUESTIONS[currentQuestion].placeholder}
                autoFocus
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2"
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
                {currentQuestion < IA_QUESTIONS.length - 1 ? "Question suivante →" : "Terminer →"}
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button onClick={goPrev} className="text-sm" style={{ color: "rgb(148 163 184)" }}>
                ← Retour
              </button>
              <button onClick={skipIA} className="text-sm" style={{ color: "rgb(148 163 184)" }}>
                Passer cette étape →
              </button>
            </div>
          </div>
        )}

        {/* ── ÉTAPE 5 : Récap + Lancement ── */}
        {step === 5 && (
          <div className="space-y-6 animate-fade-in">
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
            <div className="rounded-xl border p-4 space-y-2.5" style={{ borderColor: "rgb(226 232 240)", background: "rgb(248 250 252)" }}>
              <div className="text-xs font-semibold mb-2" style={{ color: "rgb(100 116 139)" }}>
                RÉCAPITULATIF
              </div>
              {agenceName && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>🏢 Agence</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{agenceName}</span>
                </div>
              )}
              {iaAnswers.loyer_moyen && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>💰 Loyer moyen</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.loyer_moyen}€/mois</span>
                </div>
              )}
              {iaAnswers.multiplicateur && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>📊 Multiplicateur revenus</span>
                  <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.multiplicateur}x</span>
                </div>
              )}
              {iaAnswers.zones && (
                <div className="flex justify-between text-sm">
                  <span style={{ color: "rgb(71 85 105)" }}>📍 Zones</span>
                  <span className="font-medium text-right ml-4" style={{ color: "rgb(30 41 59)" }}>{iaAnswers.zones}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span style={{ color: "rgb(71 85 105)" }}>🤖 Mode pipeline</span>
                <span className="font-medium" style={{ color: "rgb(30 41 59)" }}>DRAFT (modifiable)</span>
              </div>
            </div>

            {/* Sauvegarde en cours indicator */}
            <button
              onClick={finalize}
              disabled={saving}
              className="w-full py-3 rounded-xl text-sm font-medium text-white transition-opacity disabled:opacity-60 flex items-center justify-center gap-2"
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
                "🚀 Accéder à mon tableau de bord"
              )}
            </button>

            <button onClick={goPrev} className="w-full text-sm text-center" style={{ color: "rgb(148 163 184)" }}>
              ← Modifier les réponses
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
