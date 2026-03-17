import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FixTimeLogo } from "@/components/ui/FixTimeLogo";

export default async function RootPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    redirect("/home");
  }

  // Landing page publique (non connecté)
  return (
    <div className="min-h-screen flex flex-col" style={{ background: "rgb(250 250 252)" }}>

      {/* ── Navbar ── */}
      <header className="px-8 py-5 flex items-center justify-between border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
        <FixTimeLogo size="md" variant="dark" />
        <div className="flex items-center gap-4">
          <Link
            href="/auth/login"
            className="text-sm font-medium px-4 py-2 rounded-xl transition-colors"
            style={{ color: "rgb(71 85 105)" }}
          >
            Connexion
          </Link>
          <Link
            href="/auth/signup"
            className="text-sm font-semibold px-5 py-2 rounded-xl text-white transition-colors"
            style={{ background: "rgb(79 70 229)" }}
          >
            Essai gratuit →
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center max-w-3xl mx-auto w-full">

        {/* Badge */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold mb-8"
          style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}
        >
          🤖 Assistant IA pour agents immobiliers
        </div>

        {/* Headline */}
        <h1
          className="text-5xl font-bold tracking-tight leading-tight mb-6"
          style={{ color: "rgb(15 23 42)" }}
        >
          Gérez vos demandes
          <br />
          locatives avec <span style={{ color: "rgb(79 70 229)" }}>l&apos;IA</span>
        </h1>

        {/* Sous-titre */}
        <p className="text-lg mb-10 max-w-xl" style={{ color: "rgb(71 85 105)" }}>
          FixTime analyse vos emails, qualifie vos prospects et rédige des réponses
          contextuelles — pour que vous vous concentriez sur ce qui compte vraiment.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row items-center gap-4 mb-16">
          <Link
            href="/auth/signup"
            className="px-8 py-4 rounded-2xl text-base font-semibold text-white shadow-lg transition-all hover:shadow-xl"
            style={{ background: "rgb(79 70 229)" }}
          >
            Commencer gratuitement →
          </Link>
          <Link
            href="/auth/login"
            className="px-8 py-4 rounded-2xl text-base font-medium border transition-colors"
            style={{ borderColor: "rgb(226 232 240)", color: "rgb(71 85 105)", background: "white" }}
          >
            J&apos;ai déjà un compte
          </Link>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 w-full">
          {[
            {
              emoji: "📬",
              title: "Triage automatique",
              desc: "L'IA classe vos emails en Location, Info et Hors sujet. Fini le temps perdu à trier.",
            },
            {
              emoji: "✍️",
              title: "Brouillons contextuels",
              desc: "Des réponses personnalisées pré-rédigées selon le profil du prospect et votre style.",
            },
            {
              emoji: "📊",
              title: "Pipeline en temps réel",
              desc: "Suivez chaque candidat de la première prise de contact jusqu'à la signature.",
            },
          ].map(({ emoji, title, desc }) => (
            <div
              key={title}
              className="rounded-2xl border p-6 text-left"
              style={{ borderColor: "rgb(226 232 240)", background: "white" }}
            >
              <div className="text-3xl mb-3">{emoji}</div>
              <h3 className="text-base font-semibold mb-2" style={{ color: "rgb(30 41 59)" }}>
                {title}
              </h3>
              <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
                {desc}
              </p>
            </div>
          ))}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="px-8 py-6 border-t text-center" style={{ borderColor: "rgb(226 232 240)" }}>
        <p className="text-xs" style={{ color: "rgb(148 163 184)" }}>
          © 2025 FixTime — Assistant IA pour la gestion locative
        </p>
      </footer>
    </div>
  );
}
