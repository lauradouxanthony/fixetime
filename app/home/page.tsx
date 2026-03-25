import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import DashboardClient from "@/components/dashboard/DashboardClient";
import AppShell from "@/components/layout/AppShell";

export default async function HomePage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/auth/login");

  return (
    <AppShell>
      <DashboardClient />
    </AppShell>
  );
}
