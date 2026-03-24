"use client";

import { use, useEffect, useRef, useState } from "react";

type RequiredDoc = { key: string; label: string };

type UploadedDoc = {
  source: string;
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  docType: string;
  confidence: number;
  label: string;
  validated_by_human: boolean;
  uploaded_at: string;
};

type PortalData = {
  prospectName: string;
  situationPro: string;
  requiredDocs: RequiredDoc[];
  uploadedDocs: UploadedDoc[];
  expiresAt: string;
};

type UploadState = {
  status: "idle" | "uploading" | "done" | "error";
  result?: { docType: string; confidence: number; label: string };
  error?: string;
};

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

export default function PortalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const loadPortal = async () => {
    try {
      const res = await fetch(`/api/portal/${token}`);
      const json = await res.json();
      if (json.error) {
        setPageError(json.error);
      } else {
        setData(json as PortalData);
      }
    } catch {
      setPageError("NETWORK_ERROR");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPortal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleUpload = async (docKey: string, file: File) => {
    setUploadStates((prev) => ({
      ...prev,
      [docKey]: { status: "uploading" },
    }));

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/portal/${token}/upload`, {
        method: "POST",
        body: formData,
      });
      const result = await res.json();

      if (res.ok) {
        setUploadStates((prev) => ({
          ...prev,
          [docKey]: { status: "done", result },
        }));
        // Refresh portal data to update uploadedDocs
        await loadPortal();
      } else {
        setUploadStates((prev) => ({
          ...prev,
          [docKey]: { status: "error", error: result.error },
        }));
      }
    } catch {
      setUploadStates((prev) => ({
        ...prev,
        [docKey]: { status: "error", error: "NETWORK_ERROR" },
      }));
    }
  };

  // ── Error states ──────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "rgb(248 250 252)" }}>
        <Spinner />
      </div>
    );
  }

  if (pageError === "TOKEN_NOT_FOUND" || pageError === "TOKEN_EXPIRED") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4" style={{ background: "rgb(248 250 252)" }}>
        <div className="text-4xl">🔗</div>
        <h1 className="text-xl font-semibold text-center" style={{ color: "rgb(30 41 59)" }}>
          {pageError === "TOKEN_EXPIRED" ? "Lien expiré" : "Lien introuvable"}
        </h1>
        <p className="text-sm text-center max-w-xs" style={{ color: "rgb(100 116 139)" }}>
          {pageError === "TOKEN_EXPIRED"
            ? "Ce lien de dépôt a expiré. Contactez votre agence pour en obtenir un nouveau."
            : "Ce lien est invalide ou a déjà été utilisé. Contactez votre agence."}
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "rgb(248 250 252)" }}>
        <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
          Une erreur est survenue. Réessayez plus tard.
        </p>
      </div>
    );
  }

  const expiresDate = new Date(data.expiresAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const uploadedCount = data.uploadedDocs.length;
  const totalDocs = data.requiredDocs.length;
  const progressPct = Math.round((uploadedCount / Math.max(totalDocs, 1)) * 100);
  const allDone = uploadedCount >= totalDocs;

  return (
    <div className="min-h-screen" style={{ background: "rgb(248 250 252)" }}>
      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ background: "rgb(99 102 241)" }}>
        <div className="max-w-lg mx-auto px-4 py-5 flex items-center gap-3">
          {/* Logo FixTime */}
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.2)", color: "white" }}
          >
            FT
          </div>
          <div>
            <div className="text-white font-semibold text-sm leading-tight">FixTime</div>
            <div className="text-white/80 text-xs leading-tight">
              Espace dépôt — {data.prospectName}
            </div>
          </div>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────── */}
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">

        {/* Greeting */}
        <div className="text-center space-y-1 pt-2">
          <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>
            Bonjour {data.prospectName} 👋
          </h1>
          <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
            Lien valable jusqu&apos;au {expiresDate}
          </p>
        </div>

        {/* Progress bar */}
        <div
          className="rounded-2xl bg-white border p-4 space-y-2"
          style={{ borderColor: "rgb(226 232 240)", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
              Progression du dossier
            </span>
            <span
              className="text-sm font-bold"
              style={{ color: allDone ? "rgb(22 163 74)" : "rgb(99 102 241)" }}
            >
              {uploadedCount}/{totalDocs} documents déposés
            </span>
          </div>
          <div
            className="w-full h-2.5 rounded-full overflow-hidden"
            style={{ background: "rgb(226 232 240)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${progressPct}%`,
                background: allDone ? "rgb(22 163 74)" : "rgb(99 102 241)",
              }}
            />
          </div>
          {allDone && (
            <p className="text-xs font-medium" style={{ color: "rgb(22 163 74)" }}>
              ✅ Tous vos documents ont été déposés avec succès !
            </p>
          )}
        </div>

        {/* Doc upload zones */}
        {data.requiredDocs.map((doc) => {
          const uploaded = data.uploadedDocs.find(
            (u) => u.docType === doc.key
          );
          const uploadState = uploadStates[doc.key];
          const isUploading = uploadState?.status === "uploading";
          const isDone = !!uploaded;
          const confidence =
            uploaded?.confidence ?? uploadState?.result?.confidence;
          const badgeOk =
            confidence !== undefined ? confidence >= 0.7 : false;

          return (
            <div
              key={doc.key}
              className="rounded-2xl bg-white border p-4 space-y-3"
              style={{
                borderColor: isDone
                  ? "rgba(22,163,74,0.3)"
                  : "rgb(226 232 240)",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2">
                <span
                  className="text-sm font-medium leading-snug"
                  style={{ color: "rgb(30 41 59)" }}
                >
                  {doc.label}
                </span>
                {isDone && (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                    style={
                      badgeOk
                        ? {
                            background: "rgba(22,163,74,0.1)",
                            color: "rgb(22 163 74)",
                          }
                        : {
                            background: "rgba(234,88,12,0.1)",
                            color: "rgb(234 88 12)",
                          }
                    }
                  >
                    {badgeOk ? "✓ Reçu" : "⚠ Vérifié"}
                  </span>
                )}
              </div>

              {/* Content */}
              {isDone ? (
                <div
                  className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
                  style={{
                    background: "rgba(22,163,74,0.06)",
                    color: "rgb(22 163 74)",
                  }}
                >
                  <span>✅</span>
                  <span className="truncate">{uploaded.filename}</span>
                </div>
              ) : (
                <>
                  <label
                    className={`flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
                      isUploading ? "opacity-60 pointer-events-none" : ""
                    }`}
                    style={{
                      borderColor: "rgb(199 210 254)",
                      background: "rgb(238 242 255)",
                    }}
                  >
                    <input
                      ref={(el) => {
                        inputRefs.current[doc.key] = el;
                      }}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.webp,.heic"
                      className="sr-only"
                      disabled={isUploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleUpload(doc.key, f);
                      }}
                    />
                    {isUploading ? (
                      <>
                        <div style={{ color: "rgb(99 102 241)" }}>
                          <Spinner />
                        </div>
                        <span
                          className="text-xs font-medium"
                          style={{ color: "rgb(99 102 241)" }}
                        >
                          Envoi en cours…
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="text-2xl">📎</span>
                        <span
                          className="text-xs font-semibold text-center"
                          style={{ color: "rgb(79 70 229)" }}
                        >
                          Déposer ou choisir un fichier
                        </span>
                        <span
                          className="text-xs"
                          style={{ color: "rgb(148 163 184)" }}
                        >
                          PDF, JPG, PNG, HEIC · max 10 Mo
                        </span>
                      </>
                    )}
                  </label>

                  {uploadState?.status === "error" && (
                    <p className="text-xs" style={{ color: "rgb(220 38 38)" }}>
                      Erreur lors de l&apos;envoi. Réessayez.
                    </p>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-xs leading-relaxed" style={{ color: "rgb(148 163 184)" }}>
            Vos documents sont transmis de manière sécurisée et traités
            uniquement dans le cadre de votre dossier de location.
          </p>
        </div>
      </div>
    </div>
  );
}
