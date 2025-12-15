// app/onboarding/page.tsx
import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  const supabase = await supabaseServer(); // ⭐⭐⭐ SEULE CHOSE MODIFIÉE

  const { data: userData } = await supabase.auth.getUser();

  // 1) Redirection si pas connecté
  if (!userData?.user) {
    redirect("/auth/login");
  }

  const user = userData.user;

  // 2) Vérifier si un token Google existe déjà
  const { data: tokenRows } = await supabase
    .from("gmail_tokens")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (tokenRows) {
    // Google déjà connecté → aller au dashboard
    redirect("/home");
  }

  // 3) Sinon afficher l’onboarding
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-slate-50 px-4">
      <div className="w-full max-w-lg bg-slate-900 rounded-2xl p-10 shadow-xl border border-slate-800">

        <h1 className="text-3xl font-bold mb-4">Bienvenue dans FixTime</h1>

        <p className="text-slate-300 mb-8 leading-relaxed">
          FixTime va analyser vos emails, votre calendrier et vous faire gagner
          du temps au quotidien. Pour commencer, connectez votre compte Google.
        </p>

        <a
          href="/api/auth/google"
          className="w-full block text-center bg-blue-600 hover:bg-blue-700 transition px-6 py-3 rounded-xl font-semibold"
        >
          Connecter mon compte Google
        </a>

        <p className="text-slate-400 text-sm mt-6 text-center">
          Cette autorisation permet à FixTime d’accéder à Gmail et Google Agenda
          pour organiser votre journée.
        </p>
      </div>
    </div>
  );
}
