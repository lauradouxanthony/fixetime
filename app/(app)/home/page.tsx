import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import DashboardClient from "@/components/dashboard/DashboardClient";

export default async function HomePage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/auth/login");

  // Guard provider (Gmail/Outlook) géré par (app)/layout → redirect /onboarding si aucun token
  return <DashboardClient />;
}
