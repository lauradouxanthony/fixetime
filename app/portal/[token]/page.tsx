"use client";

/**
 * /portal/[token]
 * Page PUBLIQUE — portail de dépôt de documents pour les prospects.
 * Pas d'AppShell, pas de session requise. Le token est l'auth.
 */
import { useEffect, useRef, useState } from "react";

type RequiredDoc = { key: string; label: string };

type UploadedDoc = {
  filename: string;
  docType: string | null;
  ai_confidence: number | null;
  label: string | null;
  validated_by_human: boolean;
  uploaded_at: string;
  storage_path: string;
};

type PortalInfo = {
  prospectName: string | null;
  prospectEmail: string | null;
  situationPro: string | null;
  requiredDocs: RequiredDoc[];
  uploadedDocs: UploadedDoc[];
  expiresAt: string;
};

type UploadResult = {
  docType: string;
  confidence: number;
  label: string;
  storagePath: string;
  filename: string;
};

function ConfidenceBadge({ confidence }: { confidence: number | null }) {
  if (confidence === null) return null;
  const pct = Math.round((confidence ?? 0) * 100);
  const ok = (confidence ?? 0) >= 0.7;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
      style={{
        background: ok ? "rgba(22,163,74,0.1)" : "rgba(234,88,12,0.1)",
        color: ok ? "rgb(22 163 74)" : "rgb(234 88 12)",
      }}
    >
      {ok ? "🤖" : "⚠️"} {pct}%
    </span>
  );
}

function DocRow({
  doc,
  uploaded,
  token,
  onUploadDone,
}: {
  doc: RequiredDoc;
  uploaded: UploadedDoc | undefined;
  token: string;
  onUploadDone: (result: UploadResult, docKey: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`/api/portal/${token}/upload`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          data.error === "FILE_TOO_LARGE"
            ? "Fichier trop volumineux (max 10 Mo)"
            : data.error === "INVALID_FILE_TYPE"
            ? "Format non accepté. Utilisez PDF, JPG ou PNG."
            : "Erreur lors de l'envoi. Réessayez."
        );
      } else {
        onUploadDone(data as UploadResult, doc.key);
      }
    } catch {
      setError("Erreur réseau. Vérifiez votre connexion.");
    } finally {
      setUploading(false);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const isUploaded = !!uploaded;
  const isValidated = uploaded?.validated_by_human === true;

  return (
    <div
      className="rounded-xl border p-4 space-y-2 transition-colors"
      style={{
        borderColor: isValidated
          ? "rgba(22,163,74,0.3)"
          : isUploaded
          ? "rgba(99,102,241,0.3)"
          : "rgb(226 232 240)",
        background: isValidated
          ? "rgba(22,163,74,0.03)"
          : isUploaded
          ? "rgba(99,102,241,0.03)"
          : "white",
      }}
    >
      {/* Nom du document requis */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "rgb(30 41 59)" }}>
          {doc.label}
        </span>
        {isValidated ? (
          <span className="text-xs font-semibold" style={{ color: "rgb(22 163 74)" }}>
            ✓ Validé
          </span>
        ) : isUploaded ? (
          <span className="text-xs font-medium" style={{ color: "rgb(99 102 241)" }}>
            ⏳ En attente
          </span>
        ) : (
          <span className="text-xs" style={{ color: "rgb(148 163 184)" }}>
            À déposer
          </span>
        )}
      </div>

      {/* Fichier déjà déposé */}
      {uploaded && (
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
          style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)" }}
        >
          <span className="truncate flex-1">📎 {uploaded.filename}</span>
          <ConfidenceBadge confidence={uploaded.ai_confidence} />
          {uploaded.ai_confidence !== null && (uploaded.ai_confidence ?? 0) < 0.7 && (
            <span className="text-orange-500 font-medium shrink-0">
              — Vérifier le fichier
            </span>
          )}
        </div>
      )}

      {/* Zone de drop / bouton upload */}
      {!isValidated && (
        <div
          className="relative rounded-lg border-2 border-dashed cursor-pointer transition-colors"
          style={{
            borderColor: dragOver ? "rgb(99 102 241)" : "rgb(203 213 225)",
            background: dragOver ? "rgba(99,102,241,0.04)" : "transparent",
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <div className="flex flex-col items-center py-4 px-3 text-center select-none">
            {uploading ? (
              <>
                <div
                  className="w-6 h-6 rounded-full border-2 border-t-transparent animate-spin mb-2"
                  style={{ borderColor: "rgb(99 102 241)", borderTopColor: "transparent" }}
                />
                <span className="text-xs" style={{ color: "rgb(100 116 139)" }}>
                  Envoi en cours…
                </span>
              </>
            ) : (
              <>
                <span className="text-2xl mb-1">☁️</span>
                <span className="text-xs font-medium" style={{ color: "rgb(99 102 241)" }}>
                  {isUploaded ? "Remplacer le fichier" : "Cliquez ou glissez un fichier"}
                </span>
                <span className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                  PDF, JPG, PNG — max 10 Mo
                </span>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp"
            onChange={handleInput}
            disabled={uploading}
          />
        </div>
      )}

      {error && (
        <p className="text-xs font-medium" style={{ color: "rgb(220 38 38)" }}>
          ⚠ {error}
        </p>
      )}
    </div>
  );
}

export default function PortalPage({
  params,
}: {
  params: { token: string };
}) {
  const token = params.token;
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "expired" | "error">("loading");
  const [uploadedByKey, setUploadedByKey] = useState<Record<string, UploadedDoc>>({});
  const [extraUploads, setExtraUploads] = useState<UploadResult[]>([]);

  useEffect(() => {
    fetch(`/api/portal/${token}`)
      .then((r) => {
        if (r.status === 410) { setStatus("expired"); return null; }
        if (!r.ok) { setStatus("error"); return null; }
        return r.json();
      })
      .then((data: PortalInfo | null) => {
        if (!data) return;
        setInfo(data);
        // Pré-remplir les docs déjà uploadés
        const byKey: Record<string, UploadedDoc> = {};
        data.uploadedDocs.forEach((u) => {
          if (u.docType) byKey[u.docType] = u;
        });
        setUploadedByKey(byKey);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [token]);

  const handleUploadDone = (result: UploadResult, docKey: string) => {
    const newDoc: UploadedDoc = {
      filename:           result.filename,
      docType:            result.docType,
      ai_confidence:      result.confidence,
      label:              result.label,
      validated_by_human: false,
      uploaded_at:        new Date().toISOString(),
      storage_path:       result.storagePath,
    };
    // Associer au docKey requis si le type IA correspond, sinon stocker en extra
    setUploadedByKey((prev) => ({ ...prev, [docKey]: newDoc }));
    if (result.docType !== docKey) {
      setExtraUploads((prev) => [...prev, result]);
    }
  };

  // ── Écrans d'état ──────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: "rgb(99 102 241)", borderTopColor: "transparent" }}
          />
          <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>Chargement du portail…</p>
        </div>
      </div>
    );
  }

  if (status === "expired") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="text-5xl">⏰</div>
          <h1 className="text-xl font-bold" style={{ color: "rgb(30 41 59)" }}>
            Lien expiré
          </h1>
          <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
            Ce lien de dépôt n'est plus valide. Contactez votre agence pour obtenir un nouveau lien.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white p-6">
        <div className="max-w-sm text-center space-y-4">
          <div className="text-5xl">🔗</div>
          <h1 className="text-xl font-bold" style={{ color: "rgb(30 41 59)" }}>
            Lien introuvable
          </h1>
          <p className="text-sm" style={{ color: "rgb(100 116 139)" }}>
            Ce lien est invalide ou a déjà été utilisé. Contactez votre agence.
          </p>
        </div>
      </div>
    );
  }

  const expiryDate = new Date(info.expiresAt).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  });

  const totalRequired = info.requiredDocs.length;
  const totalUploaded = Object.keys(uploadedByKey).filter((k) =>
    info.requiredDocs.some((d) => d.key === k)
  ).length;
  const allDone = totalUploaded >= totalRequired;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div style={{ background: "rgb(99 102 241)" }}>
        <div className="max-w-lg mx-auto px-4 py-6">
          <div className="flex items-center gap-3 mb-4">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
              style={{ background: "rgba(255,255,255,0.2)" }}
            >
              F
            </div>
            <span className="text-white font-semibold text-lg">FixTime</span>
          </div>
          <h1 className="text-xl font-bold text-white mb-1">
            Déposez vos documents
          </h1>
          {info.prospectName && (
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>
              Bonjour {info.prospectName} — lien valable jusqu'au {expiryDate}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Barre de progression */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "rgb(226 232 240)", background: "white" }}
        >
          <div className="flex items-center justify-between text-sm mb-2">
            <span style={{ color: "rgb(71 85 105)" }}>
              {totalUploaded}/{totalRequired} documents déposés
            </span>
            <span
              className="font-semibold"
              style={{
                color: allDone
                  ? "rgb(22 163 74)"
                  : totalUploaded > 0
                  ? "rgb(234 88 12)"
                  : "rgb(100 116 139)",
              }}
            >
              {Math.round((totalUploaded / Math.max(totalRequired, 1)) * 100)}%
            </span>
          </div>
          <div
            className="w-full h-2 rounded-full overflow-hidden"
            style={{ background: "rgb(226 232 240)" }}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.round((totalUploaded / Math.max(totalRequired, 1)) * 100)}%`,
                background: allDone
                  ? "rgb(22,163,74)"
                  : totalUploaded > 0
                  ? "rgb(99,102,241)"
                  : "rgb(226,232,240)",
              }}
            />
          </div>
          {allDone && (
            <p
              className="text-sm font-medium mt-2"
              style={{ color: "rgb(22 163 74)" }}
            >
              ✓ Tous vos documents ont été déposés. L'agence les examinera prochainement.
            </p>
          )}
        </div>

        {/* Notice IA */}
        <div
          className="rounded-xl border px-4 py-3 text-xs"
          style={{
            borderColor: "rgba(99,102,241,0.2)",
            background: "rgba(99,102,241,0.04)",
            color: "rgb(71 85 105)",
          }}
        >
          🤖 Chaque document est automatiquement reconnu par notre IA. Si la reconnaissance
          est inférieure à 70%, vérifiez que le fichier est bien lisible et correspond
          au bon document.
        </div>

        {/* Liste des documents requis */}
        <div className="space-y-3">
          {info.requiredDocs.map((doc) => (
            <DocRow
              key={doc.key}
              doc={doc}
              uploaded={uploadedByKey[doc.key]}
              token={token}
              onUploadDone={handleUploadDone}
            />
          ))}
        </div>

        {/* Upload libre (document non listé) */}
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "rgb(226 232 240)", background: "white" }}
        >
          <p className="text-sm font-medium mb-3" style={{ color: "rgb(30 41 59)" }}>
            📎 Ajouter un autre document
          </p>
          <DocRow
            doc={{ key: "_extra", label: "Document complémentaire" }}
            uploaded={undefined}
            token={token}
            onUploadDone={(result) => setExtraUploads((prev) => [...prev, result])}
          />
          {extraUploads.map((u, i) => (
            <div
              key={i}
              className="mt-2 flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
              style={{ background: "rgb(248 250 252)", color: "rgb(71 85 105)" }}
            >
              <span className="truncate flex-1">📎 {u.filename}</span>
              <span
                className="shrink-0 font-medium"
                style={{ color: "rgb(99 102 241)" }}
              >
                {u.label}
              </span>
              <ConfidenceBadge confidence={u.confidence} />
            </div>
          ))}
        </div>

        {/* Footer */}
        <p className="text-center text-xs pb-6" style={{ color: "rgb(148 163 184)" }}>
          Vos documents sont transmis de manière sécurisée et traités uniquement
          dans le cadre de votre dossier de location.
        </p>
      </div>
    </div>
  );
}
