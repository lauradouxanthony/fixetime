import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/auth/login");

  // Vérifier si l'onboarding est VRAIMENT terminé (ft_onboarding_done dans settings_v1)
  // On ne redirige plus sur la simple présence d'un gmail_token (l'user peut connecter
  // Gmail à l'étape 2 et doit ensuite continuer l'onboarding jusqu'à l'étape 5)
  const { data: settingsRow } = await supabaseAdmin
    .from("settings_v1")
    .select("email_rules")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const emailRules =
    settingsRow?.email_rules && typeof settingsRow.email_rules === "object"
      ? (settingsRow.email_rules as Record<string, unknown>)
      : {};

  if (emailRules.ft_onboarding_done === true) redirect("/home");

  return <OnboardingClient />;
}
