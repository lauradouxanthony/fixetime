import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import AppLayoutClient from "./AppLayoutClient";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/auth/login");
  }

  // Rediriger vers l'onboarding si non terminé
  const { data: settingsRow } = await supabaseAdmin
    .from("settings_v1")
    .select("email_rules")
    .eq("user_id", data.user.id)
    .maybeSingle();

  const emailRules =
    settingsRow?.email_rules && typeof settingsRow.email_rules === "object"
      ? (settingsRow.email_rules as Record<string, unknown>)
      : {};

  if (emailRules.ft_onboarding_done !== true) {
    redirect("/onboarding");
  }

  return <AppLayoutClient>{children}</AppLayoutClient>;
}

