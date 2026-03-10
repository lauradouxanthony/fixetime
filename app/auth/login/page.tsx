"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabaseBrowser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setErrorMsg("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setErrorMsg(error.message); return; }
    setTimeout(() => router.push("/home"), 150);
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
              Gérez vos demandes<br />locatives avec l'IA
            </h1>
            <p className="text-indigo-200 mt-3 text-lg">
              Triez, répondez et planifiez automatiquement.
            </p>
          </div>

          {/* Features */}
          <div className="space-y-4">
            {[
              { icon: "⚡", title: "Triage automatique", desc: "L'IA classe vos emails entrants en temps réel" },
              { icon: "✉️", title: "Brouillons contextuels", desc: "Réponses personnalisées selon le profil locataire" },
              { icon: "📊", title: "Dashboard en direct", desc: "Leads actifs, RDV et taux de réponse IA" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{f.icon}</span>
                <div>
                  <div className="text-white font-medium text-sm">{f.title}</div>
                  <div className="text-indigo-300 text-xs mt-0.5">{f.desc}</div>
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
          {/* Logo couleur (visible sur mobile + desktop côté droit) */}
          <div className="flex flex-col items-center gap-2">
            <img src="/logo-fixtime.png" alt="FixTime" className="h-14 w-auto object-contain" />
            <span className="text-xs font-medium" style={{ color: "rgb(79 70 229)" }}>Assistant IA</span>
          </div>

          {/* Titre */}
          <div className="text-center">
            <h2 className="text-2xl font-bold" style={{ color: "rgb(30 41 59)" }}>Connexion</h2>
            <p className="text-sm mt-1" style={{ color: "rgb(100 116 139)" }}>
              Content de vous revoir 👋
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
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
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
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
                style={{ borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" }}
              />
            </div>

            {errorMsg && (
              <div className="rounded-lg px-3 py-2 text-xs text-red-700" style={{ background: "rgba(220,38,38,0.06)", border: "1px solid rgba(220,38,38,0.2)" }}>
                {errorMsg}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={loading || !email || !password}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-50"
              style={{ background: "rgb(79 70 229)" }}
              onMouseEnter={(e) => { if (!loading) (e.currentTarget as HTMLElement).style.background = "rgb(67 56 202)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "rgb(79 70 229)"; }}
            >
              {loading ? "Connexion…" : "Se connecter →"}
            </button>
          </div>

          {/* Lien inscription */}
          <p className="text-center text-sm" style={{ color: "rgb(100 116 139)" }}>
            Pas encore de compte ?{" "}
            <a href="/auth/signup" className="font-medium hover:underline" style={{ color: "rgb(79 70 229)" }}>
              S'inscrire gratuitement
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
