import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";

export default async function OnboardingPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  // Sécurité
  if (!data.user) redirect("/auth/login");

  // 👉 Vérifier si Google déjà connecté
  const { data: token } = await supabase
    .from("gmail_tokens")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  // SI OUI → HOME (anti-boucle)
  if (token) {
    redirect("/home");
  }

  // SINON → onboarding normal
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
      <div className="max-w-md w-full rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
        <h1 className="text-xl font-semibold">
          Connectez votre compte Google
        </h1>

        <p className="text-sm text-slate-400">
          Fixetime a besoin d’accéder à Gmail et Google Calendar pour fonctionner.
        </p>

        <a
          href="/api/auth/google"
          className="block w-full text-center rounded-xl bg-sky-600 hover:bg-sky-500 transition px-4 py-2 text-sm font-semibold"
        >
          Connecter mon compte Google
        </a>
      </div>
    </div>
  );
}
