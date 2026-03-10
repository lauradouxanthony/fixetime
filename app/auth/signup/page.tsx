"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

export default function SignupPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) { setError(error.message); return; }
    router.push("/home");
  }

  return (
    <div className="flex h-screen">
      {/* ── Colonne gauche — branding indigo ── */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12"
        style={{ background: "linear-gradient(135deg, rgb(79 70 229) 0%, rgb(55 48 163) 100%)" }}
      >
        {/* Logo texte (fond indigo — image fond blanc incompatible avec filtre) */}
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-indigo-700 text-sm font-bold" style={{ background: "rgba(255,255,255,0.9)" }}>FT</div>
          <span className="text-white font-bold text-xl tracking-tight">FixTime</span>
        </div>

        {/* Tagline */}
        <div className="space-y-8">
          <div>
            <h1 className="text-4xl font-bold text-white leading-tight">
              Démarrez en quelques<br />minutes
            </h1>
            <p className="text-indigo-200 mt-3 text-lg">
              Connectez votre Gmail et laissez l'IA travailler.
            </p>
          </div>

          {/* Steps */}
          <div className="space-y-4">
            {[
              { step: "1", title: "Créez votre compte", desc: "Email + mot de passe, c'est tout" },
              { step: "2", title: "Connectez Gmail", desc: "Autorisation OAuth sécurisée Google" },
              { step: "3", title: "L'IA trie et répond", desc: "Opérationnel en moins de 5 minutes" },
            ].map((s) => (
              <div key={s.step} className="flex items-start gap-3">
                <div
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-indigo-700"
                  style={{ background: "rgba(255,255,255,0.9)" }}
                >
                  {s.step}
                </div>
                <div>
                  <div className="text-white font-medium text-sm">{s.title}</div>
                  <div className="text-indigo-300 text-xs mt-0.5">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-indigo-400 text-xs">© 2025 FixTime — Assistant IA immobilier</p>
      </div>

      {/* ── Colonne droite — formulaire ── */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 bg-white">
        <div className="w-full max-w-sm space-y-7">
          {/* Logo couleur */}
          <div className="flex flex-col items-center gap-2">
            <img src="/logo-fixtime.png" alt="FixTime" className="h-14 w-auto object-contain" />
            <span className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>Assistant IA</span>
          </div>

          {/* Titre */}
          <div className="text-center">
            <h2 className="text-2xl font-bold" style={{ color: "rgb(30 41 59)" }}>Créer un compte</h2>
            <p className="text-sm mt-1" style={{ color: "rgb(100 116 139)" }}>
              Gratuit · Sans carte bancaire 🎉
            </p>
          </div>

          {/* Formulaire */}
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "rgb(71 85 105)" }}>
                Adresse email
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
                Mot de passe
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
              {loading ? "Création du compte…" : "Créer mon compte →"}
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
