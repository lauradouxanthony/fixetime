import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import OnboardingClient from "./OnboardingClient";

export default async function OnboardingPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/auth/login");

  // Si Google déjà connecté → home
  const { data: token } = await supabase
    .from("gmail_tokens")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (token) redirect("/home");

  return <OnboardingClient />;
}
