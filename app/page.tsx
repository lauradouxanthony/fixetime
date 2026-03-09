import { supabaseServer } from "@/lib/supabaseServer";
import { redirect } from "next/navigation";

export default async function RootPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();

  if (data.user) {
    redirect("/home");
  } else {
    redirect("/auth/login");
  }
}
