import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const path = req.nextUrl.searchParams.get("path");
    if (!path)
      return NextResponse.json({ error: "PATH_REQUIRED" }, { status: 400 });

    const { data, error } = await supabaseAdmin.storage
      .from("prospect-docs")
      .createSignedUrl(path, 120); // 2 minutes

    if (error || !data?.signedUrl) {
      console.error("[DOC URL] Signed URL error:", error);
      return NextResponse.json({ error: "SIGNED_URL_FAILED" }, { status: 500 });
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (e) {
    console.error("[DOC URL] Fatal:", e);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
