"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type SearchResult = {
  prospects: Array<{ id: string; sender: string | null; subject: string | null; received_at: string | null; prospect_data?: { nom?: string | null; etape_process?: string | null; telephone?: string | null } | null }>;
  emails: Array<{ id: string; sender: string | null; subject: string | null; received_at: string | null; category?: string | null }>;
  biens: Array<{ id: string; title: string; address: string | null; rent: number; available: boolean }>;
};

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 300);
    return () => clearTimeout(t);
  }, [query, search]);

  const hasResults = results && (
    results.prospects.length + results.emails.length + results.biens.length > 0
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20"
      style={{ background: "rgba(15,23,42,0.5)" }}
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: "white" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b" style={{ borderColor: "rgb(226 232 240)" }}>
          <span className="text-lg">🔍</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher un prospect, email ou bien…"
            className="flex-1 text-sm outline-none bg-transparent"
            style={{ color: "rgb(30 41 59)" }}
          />
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgb(241 245 249)", color: "rgb(100 116 139)" }}>
            Esc
          </span>
        </div>

        {/* Results */}
        {loading && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "rgb(148 163 184)" }}>
            Recherche…
          </div>
        )}

        {!loading && query.length >= 2 && !hasResults && (
          <div className="px-4 py-6 text-center text-sm" style={{ color: "rgb(148 163 184)" }}>
            Aucun résultat pour « {query} »
          </div>
        )}

        {!loading && hasResults && (
          <div className="max-h-80 overflow-y-auto">
            {/* Prospects */}
            {results!.prospects.length > 0 && (
              <div>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)", background: "rgb(250 250 250)" }}>
                  🏠 Prospects
                </div>
                {results!.prospects.map((p) => {
                  // Normaliser : la route retourne prospect_name (RPC) ou prospect_data (fallback)
                  const nomAff: string = (p as any).prospect_name
                    ?? (p as any).prospect_data?.nom_prenom
                    ?? (p as any).prospect_data?.nom
                    ?? p.sender
                    ?? "(Inconnu)";
                  const etapeAff: string | null = (p as any).etape
                    ?? (p as any).prospect_data?.etape_process
                    ?? null;
                  return (
                    <button key={p.id} onClick={() => { router.push("/emails"); setOpen(false); }}
                      className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left">
                      <span className="text-lg">👤</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                          {nomAff}
                        </div>
                        <div className="text-xs truncate" style={{ color: "rgb(148 163 184)" }}>
                          {p.sender} — {p.subject}
                        </div>
                        {etapeAff && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
                            {etapeAff.replace(/_/g, " ")}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Emails */}
            {results!.emails.length > 0 && (
              <div>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)", background: "rgb(250 250 250)" }}>
                  📧 Emails
                </div>
                {results!.emails.map((e) => (
                  <button key={e.id} onClick={() => { router.push("/emails"); setOpen(false); }}
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left">
                    <span className="text-lg">📧</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>
                        {e.subject ?? "(Sans objet)"}
                      </div>
                      <div className="text-xs truncate" style={{ color: "rgb(148 163 184)" }}>{e.sender}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Biens */}
            {results!.biens.length > 0 && (
              <div>
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "rgb(100 116 139)", background: "rgb(250 250 250)" }}>
                  🏢 Biens
                </div>
                {results!.biens.map((b) => (
                  <button key={b.id} onClick={() => { router.push("/properties"); setOpen(false); }}
                    className="w-full px-4 py-2.5 flex items-center gap-3 hover:bg-slate-50 transition-colors text-left">
                    <span className="text-lg">🏠</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: "rgb(30 41 59)" }}>{b.title}</div>
                      <div className="text-xs truncate" style={{ color: "rgb(148 163 184)" }}>{b.address} — {b.rent.toLocaleString("fr-FR")} €/mois</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer hint */}
        {!query && (
          <div className="px-4 py-4 text-center text-xs" style={{ color: "rgb(148 163 184)" }}>
            Tapez pour rechercher dans vos prospects, emails et biens
          </div>
        )}
      </div>
    </div>
  );
}
