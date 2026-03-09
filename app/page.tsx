import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";

export default async function RootPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/home");
  } else {
    redirect("/auth/login");
  }
}
