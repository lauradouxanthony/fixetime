import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(request: NextRequest) {
  try {
    const supabase = supabaseServer();

    // 1) Vérifier user connecté
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      console.error("AUTH ERROR:", authError);
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const userId = authData.user.id;

    // 2) Vérifier token Google
    const { data: tokenRow, error: tokenError } = await supabase
      .from("gmail_tokens")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenError || !tokenRow) {
      console.error("TOKEN ERROR:", tokenError);
      return NextResponse.json({ error: "NO_GOOGLE_TOKEN" }, { status: 400 });
    }

    // 3) Appeler la function Edge
    const edgeUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sync`;

    console.log("Calling EDGE FUNCTION:", edgeUrl);

    const edgeRes = await fetch(edgeUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenRow.access_token}`,
      },
    });

    const edgeJson = await edgeRes.json().catch(() => {
      console.error("EDGE JSON PARSE FAILED");
      return null;
    });

    if (!edgeRes.ok) {
      console.error("EDGE FUNCTION ERROR:", edgeJson);
      return NextResponse.json(
        { error: "EDGE_FUNCTION_ERROR", details: edgeJson },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      edge: edgeJson,
    });
  } catch (err) {
    console.error("SYNC_ALL_FATAL_ERROR:", err);
    return NextResponse.json(
      { error: "SYNC_ALL_FAILED", details: String(err) },
      { status: 500 }
    );
  }
}
