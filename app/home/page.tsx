import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import AppShell from "@/components/layout/AppShell";
import DashboardClient from "@/components/dashboard/DashboardClient";

export default async function HomePage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  // Pas connecté → login
  if (!data.user) redirect("/auth/login");

  // Pas de Google connecté → onboarding
  const { data: tokenRow } = await supabase
    .from("gmail_tokens")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!tokenRow) redirect("/onboarding");

  return (
    <AppShell>
      <DashboardClient />
    </AppShell>
  );
}
