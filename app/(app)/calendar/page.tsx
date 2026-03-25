import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";
import CalendarPage from "@/components/calendar/CalendarPage";

export default async function CalendarRoute() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/auth/login");

  // Guard provider géré par (app)/layout
  return <CalendarPage />;
}
