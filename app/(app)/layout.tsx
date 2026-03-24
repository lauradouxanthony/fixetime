import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasConnectedProvider } from "@/lib/auth/hasConnectedProvider";
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

  return <AppLayoutClient>{children}</AppLayoutClient>;
}

