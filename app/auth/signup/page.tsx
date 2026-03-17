"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [agenceName, setAgenceName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { agency_name: agenceName } },
    });
    setLoading(false);
    if (error) { setError(error.message); return; }
    // Toujours → onboarding (pas de redirect /home pour les nouveaux comptes)
    router.push("/onboarding");
  }

  return (
    <div className="flex h-screen">
      {/* ── Colonne gauche — branding indigo ── */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: "linear-gradient(135deg, rgb(79 70 229) 0%, rgb(55 48 163) 100%)" }}
      >
        {/* Logo texte */}
        <div className="flex items-center gap-3">
          <div
            className="w-11 h-11 flex items-center justify-center rounded-xl"
            style={{ background: "rgba(255,255,255,0.18)", border: "1.5px solid rgba(255,255,255,0.3)" }}
          >
            <span className="text-white font-bold text-xl">F</span>
          </div>
          <span className="text-white font-bold text-2xl tracking-tight">FixTime</span>
        </div>

        {/* Tagline + bullets */}
        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              L&apos;IA qui gère vos<br />demandes locatives<br />à votre place
            </h1>
          </div>

          {/* Bullet points */}
          <div className="space-y-4">
            {[
              "Répondez à tous vos prospects en 2min",
              "Zéro email manqué, zéro visite ratée",
              "Remplacez 10h de travail par semaine",
            ].map((text) => (
              <div key={text} className="flex items-start gap-3">
                <span className="text-green-300 font-bold text-lg leading-none mt-0.5">✓</span>
                <span className="text-white text-base leading-snug">{text}</span>
              </div>
            ))}
          </div>

          {/* Testimonial */}
          <div
            className="rounded-xl p-4"
            style={{ background: "rgba(255,255,255,0.1)", borderLeft: "4px solid rgb(79 70 229)", backdropFilter: "blur(4px)" }}
          >
            <p className="text-white italic text-sm leading-relaxed">
              &ldquo;FixTime nous a fait gagner 2 jours par semaine sur la gestion locative.&rdquo;
            </p>
            <p className="text-indigo-200 text-xs mt-2 font-medium">
              — Marie L., Agence Immo Lyon
            </p>
          </div>
        </div>

        {/* Footer */}
        <p className="text-indigo-400 text-xs">© 2025 FixTime — Assistant IA immobilier</p>
      </div>

      {/* ── Colonne droite — formulaire ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 bg-white">
        <div className="w-full max-w-sm space-y-7">
          {/* Logo + Titre */}
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 flex items-center justify-center rounded-xl"
                style={{ background: "rgb(79 70 229)" }}
              >
                <span className="text-white font-bold text-base">F</span>
              </div>
              <span className="font-bold text-xl tracking-tight" style={{ color: "rgb(30 41 59)" }}>FixTime</span>
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold" style={{ color: "rgb(30 41 59)" }}>Créer votre compte</h2>
              <p className="text-sm mt-1" style={{ color: "rgb(100 116 139)" }}>
                Configurez votre agence en moins de 2 minutes.
              </p>
            </div>
          </div>

          {/* Formulaire */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Nom agence
              </label>
              <input
                type="text"
                placeholder="Agence Dupont Immobilier"
                value={agenceName}
                onChange={(e) => setAgenceName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Email
              </label>
              <input
                type="email"
                placeholder="vous@agence.fr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Password
              </label>
              <input
                type="password"
                placeholder="Minimum 6 caractères"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>

            {error && (
              <div className="rounded-lg px-3 py-2 text-xs text-red-700" style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)" }}>
                {error}
              </div>
            )}

            <button
              onClick={handleSignup}
              disabled={loading || !email || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: "rgb(79 70 229)" }}
              onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.background = "rgb(67 56 202)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(79 70 229)"; }}
            >
              {loading ? "Création de l'espace…" : "Créer mon espace →"}
            </button>
          </div>

          {/* Lien connexion */}
          <p className="text-center text-sm" style={{ color: "rgb(100 116 139)" }}>
            Déjà un compte ?{" "}
            <a href="/auth/login" className="font-medium hover:underline" style={{ color: "rgb(79 70 229)" }}>
              Se connecter
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
