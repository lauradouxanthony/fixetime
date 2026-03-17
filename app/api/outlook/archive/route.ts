import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getValidMicrosoftAccessToken } from "@/lib/microsoft/getValidAccessToken";

export const runtime = "nodejs";

async function getWellKnownFolderId(accessToken: string, wellKnown: string) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders/${wellKnown}?$select=id`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );

  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  return json?.id ?? null;
}

async function findFolderId(accessToken: string, displayName: string) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/mailFolders?$top=200&$select=id,displayName`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    }
  );
  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  const folders = json?.value ?? [];
  const match = folders.find(
    (f: any) =>
      (f.displayName || "").toLowerCase() === displayName.toLowerCase()
  );
  return match?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const providerMessageId = body?.providerMessageId as string | undefined;
    const emailId = body?.emailId as string | undefined;
    
    if (!providerMessageId) {
      return NextResponse.json(
        { error: "MISSING_PROVIDER_MESSAGE_ID" },
        { status: 400 }
      );
    }
    
    const msgId = encodeURIComponent(providerMessageId);
    

    const accessToken = await getValidMicrosoftAccessToken(user.id);

    // 1) Folder cible (archive) + fallbacks
    let destFolderId: string | null = null;

    // OK 1) well-known archive (le plus fiable)
    destFolderId = await getWellKnownFolderId(accessToken, "archive");

    // OK 2) fallback well-known deleteditems
    if (!destFolderId) {
      destFolderId = await getWellKnownFolderId(accessToken, "deleteditems");
    }

    // OK 3) fallback displayName (langues)
    if (!destFolderId) destFolderId = await findFolderId(accessToken, "Archive");
    if (!destFolderId)
      destFolderId = await findFolderId(accessToken, "Éléments supprimés");
    if (!destFolderId)
      destFolderId = await findFolderId(accessToken, "Deleted Items");

    if (!destFolderId) {
      return NextResponse.json(
        { error: "NO_ARCHIVE_FOLDER_FOUND" },
        { status: 400 }
      );
    }

    // 2) Move message (OK BONNE API : POST /move + destinationId)

const res = await fetch(
  `https://graph.microsoft.com/v1.0/me/messages/${msgId}/move`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ destinationId: destFolderId }),
    cache: "no-store",
  }
);


if (!res.ok) {
  const txt = await res.text();
  console.error("OUTLOOK_ARCHIVE_ERROR", res.status, txt);

  return NextResponse.json(
    { error: "OUTLOOK_ARCHIVE_ERROR", status: res.status, details: txt },
    { status: res.status } // OK on renvoie le vrai status Graph
  );
}


    // 3) Marquer archivé en DB
    if (emailId) {
      await supabaseAdmin
        .from("emails")
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq("id", emailId)
        .eq("user_id", user.id);
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("OUTLOOK_ARCHIVE_FATAL", e);
    return NextResponse.json(
      { error: "OUTLOOK_ARCHIVE_FAILED" },
      { status: 500 }
    );
  }
}
