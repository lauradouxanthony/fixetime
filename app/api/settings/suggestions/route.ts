import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function POST(req: Request) {
  const supabase = await supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { type, value, action } = body;
  // type: "sender" | "keyword"
  // value: "@client.com" | "facture"
  // action: "important" | "ignore" | "ai"

  const { data: settings } = await supabase
    .from("settings_v1")
    .select("email_rules")
    .eq("user_id", user.id)
    .single();

  const rules = settings?.email_rules ?? {
    always_important: [],
    always_ignore: [],
    keywords: { urgent: [], ignore: [] },
  };

  if (type === "sender") {
    rules.always_important = rules.always_important || [];
    rules.always_ignore = rules.always_ignore || [];

    rules.always_important = rules.always_important.filter((v: string) => v !== value);
rules.always_ignore = rules.always_ignore.filter((v: string) => v !== value);


    if (action === "important") rules.always_important.push(value);
    if (action === "ignore") rules.always_ignore.push(value);
  }

  if (type === "keyword") {
    rules.keywords.urgent = rules.keywords.urgent || [];
    rules.keywords.ignore = rules.keywords.ignore || [];

    rules.keywords.urgent = rules.keywords.urgent.filter((v: string) => v !== value);
rules.keywords.ignore = rules.keywords.ignore.filter((v: string) => v !== value);


    if (action === "important") rules.keywords.urgent.push(value);
    if (action === "ignore") rules.keywords.ignore.push(value);
  }

  await supabase
    .from("settings_v1")
    .update({ email_rules: rules })
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}
