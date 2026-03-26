"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";
import { Users } from "lucide-react";

type Property = {
  id: string;
  title: string;
  address: string | null;
  type: string | null;
  rent: number;
  description: string | null;
  available: boolean;
  created_at: string;
  prospect_count?: number;
  animaux_acceptes: boolean;
  parking_inclus: boolean;
  charges_mensuelles: number | null;
  meuble: boolean;
  disponible_a_partir_de: string | null;
  notes_specifiques: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  studio: "Studio", T1: "T1", T2: "T2", T3: "T3", T4: "T4", T5: "T5",
  garage: "Garage", autre: "Autre",
};

/* ── Formulaire ajout/édition ── */
function PropertyForm({
  initial, onSave, onCancel,
}: {
  initial?: Partial<Property>;
  onSave: (data: Partial<Property>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [type, setType] = useState(initial?.type ?? "");
  const [rent, setRent] = useState(String(initial?.rent ?? ""));
  const [description, setDescription] = useState(initial?.description ?? "");
  const [available, setAvailable] = useState(initial?.available !== false);
  const [animauxAcceptes, setAnimauxAcceptes] = useState(initial?.animaux_acceptes ?? false);
  const [parkingInclus, setParkingInclus] = useState(initial?.parking_inclus ?? false);
  const [chargesMensuelles, setChargesMensuelles] = useState(String(initial?.charges_mensuelles ?? ""));
  const [meuble, setMeuble] = useState(initial?.meuble ?? false);
  const [disponibleAPartirDe, setDisponibleAPartirDe] = useState(initial?.disponible_a_partir_de ?? "");
  const [notesSpecifiques, setNotesSpecifiques] = useState(initial?.notes_specifiques ?? "");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({
      title, address: address || null, type: type || null,
      rent: parseInt(rent, 10), description: description || null, available,
      animaux_acceptes: animauxAcceptes,
      parking_inclus: parkingInclus,
      charges_mensuelles: chargesMensuelles ? parseInt(chargesMensuelles, 10) : null,
      meuble,
      disponible_a_partir_de: disponibleAPartirDe || null,
      notes_specifiques: notesSpecifiques || null,
    });
    setSaving(false);
  };

  const inputCls = "w-full border rounded-xl px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-300 transition-all";
  const inputStyle = { borderColor: "rgb(226 232 240)", color: "rgb(30 41 59)" };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "rgb(71 85 105)" }}>Titre du bien *</label>
          <input required value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: T2 Victor Hugo, 45m²" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "rgb(71 85 105)" }}>Loyer (€) *</label>
          <input required type="number" value={rent} onChange={(e) => setRent(e.target.value)}
            placeholder="850" className={inputCls} style={inputStyle} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "rgb(71 85 105)" }}>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls} style={inputStyle}>
            <option value="">Choisir…</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "rgb(71 85 105)" }}>Adresse</label>
          <input value={address} onChange={(e) => setAddress(e.target.value)}
            placeholder="12 rue Victor Hugo, 75011 Paris" className={inputCls} style={inputStyle} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium mb-1.5" style={{ color: "rgb(71 85 105)" }}>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            rows={3} placeholder="Caractéristiques, étage, charges…"
            className={`${inputCls} resize-none`} style={inputStyle} />
        </div>
        <div className="col-span-2">
          <div className="flex items-center gap-3">
            <input type="checkbox" id="available" checked={available}
              onChange={(e) => setAvailable(e.target.checked)} className="rounded w-4 h-4" />
            <label htmlFor="available" className="text-sm font-medium" style={{ color: "rgb(71 85 105)" }}>
              ✅ Bien actif — accepter les candidatures
            </label>
          </div>
          <p className="text-xs mt-1 ml-7" style={{ color: "rgb(148 163 184)" }}>
            La date de disponibilité effective est définie dans le champ ci-dessous.
          </p>
        </div>

        {/* ── FAQ par bien ── */}
        <div className="col-span-2">
          <div className="text-xs font-semibold uppercase tracking-wide mb-2 pt-1" style={{ color: "rgb(100 116 139)" }}>
            FAQ / Infos rapides (injectées dans les réponses IA)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="animaux" checked={animauxAcceptes}
                onChange={(e) => setAnimauxAcceptes(e.target.checked)} className="rounded w-4 h-4" />
              <label htmlFor="animaux" className="text-sm" style={{ color: "rgb(71 85 105)" }}>Animaux acceptés</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="parking" checked={parkingInclus}
                onChange={(e) => setParkingInclus(e.target.checked)} className="rounded w-4 h-4" />
              <label htmlFor="parking" className="text-sm" style={{ color: "rgb(71 85 105)" }}>Parking inclus</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="meuble" checked={meuble}
                onChange={(e) => setMeuble(e.target.checked)} className="rounded w-4 h-4" />
              <label htmlFor="meuble" className="text-sm" style={{ color: "rgb(71 85 105)" }}>Meublé</label>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Charges (€/mois)</label>
              <input type="number" value={chargesMensuelles} onChange={(e) => setChargesMensuelles(e.target.value)}
                placeholder="Ex: 80" className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Disponible à partir du</label>
              <input type="date" value={disponibleAPartirDe} onChange={(e) => setDisponibleAPartirDe(e.target.value)}
                className={inputCls} style={inputStyle} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Notes spécifiques</label>
              <input value={notesSpecifiques} onChange={(e) => setNotesSpecifiques(e.target.value)}
                placeholder="Ex: Pas de colocation, 3ème étage…" className={inputCls} style={inputStyle} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={saving}
          className="px-5 py-2 rounded-xl text-sm font-semibold text-white transition-opacity"
          style={{ background: "rgb(79 70 229)", opacity: saving ? 0.7 : 1 }}>
          {saving ? "Enregistrement…" : (initial?.id ? "Enregistrer" : "Ajouter le bien")}
        </button>
        <button type="button" onClick={onCancel}
          className="px-5 py-2 rounded-xl text-sm font-medium"
          style={{ background: "rgb(241 245 249)", color: "rgb(71 85 105)" }}>
          Annuler
        </button>
      </div>
    </form>
  );
}

/* ── Card Bien ── */
function PropertyCard({
  property, editing, onEdit, onSave, onCancelEdit, onArchive, onRestore,
}: {
  property: Property;
  editing: boolean;
  onEdit: () => void;
  onSave: (data: Partial<Property>) => void;
  onCancelEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  if (editing) {
    return (
      <div className="bg-white rounded-2xl border p-5" style={{ borderColor: "rgb(199 210 254)" }}>
        <PropertyForm initial={property} onSave={onSave} onCancel={onCancelEdit} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border p-5 space-y-3 transition-shadow hover:shadow-md"
      style={{ borderColor: "rgb(226 232 240)" }}>

      {/* Header : titre + badge dispo */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm truncate" style={{ color: "rgb(30 41 59)" }}>
            {property.title}
          </div>
          {property.address && (
            <div className="text-xs mt-0.5 truncate" style={{ color: "rgb(148 163 184)" }}>
              📍 {property.address}
            </div>
          )}
        </div>
        <span className="text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0"
          style={property.available
            ? { background: "rgba(22,163,74,0.1)", color: "rgb(22 163 74)" }
            : { background: "rgb(241 245 249)", color: "rgb(148 163 184)" }}>
          {property.available ? "Disponible" : "Archivé"}
        </span>
      </div>

      {/* Type + Loyer */}
      <div className="flex items-center gap-2">
        {property.type && (
          <span className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
            {TYPE_LABELS[property.type] ?? property.type}
          </span>
        )}
        <span className="text-lg font-bold" style={{ color: "rgb(30 41 59)" }}>
          {property.rent.toLocaleString("fr-FR")} €
          <span className="text-xs font-normal ml-1" style={{ color: "rgb(148 163 184)" }}>/mois</span>
        </span>
      </div>

      {/* Description */}
      {property.description && (
        <p className="text-xs line-clamp-2" style={{ color: "rgb(100 116 139)" }}>
          {property.description}
        </p>
      )}

      {/* FAQ badges */}
      {(property.animaux_acceptes || property.parking_inclus || property.meuble || property.charges_mensuelles != null) && (
        <div className="flex flex-wrap gap-1.5">
          {property.meuble && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(79,70,229,0.07)", color: "rgb(79 70 229)" }}>Meublé</span>}
          {property.animaux_acceptes && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.1)", color: "rgb(22 163 74)" }}>Animaux ✓</span>}
          {property.parking_inclus && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(59,130,246,0.1)", color: "rgb(37 99 235)" }}>Parking ✓</span>}
          {property.charges_mensuelles != null && <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgb(241 245 249)", color: "rgb(100 116 139)" }}>+{property.charges_mensuelles}€ ch.</span>}
        </div>
      )}

      {/* Footer : prospects + actions */}
      <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: "rgb(241 245 249)" }}>
        {/* Count prospects */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: "rgb(100 116 139)" }}>
          <Users className="h-3.5 w-3.5" />
          <span>
            {property.prospect_count ?? 0} prospect{(property.prospect_count ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Actions */}
        {property.available ? (
          <div className="flex gap-1.5">
            <button onClick={onEdit}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: "rgb(241 245 249)", color: "rgb(71 85 105)" }}>
              ✏️ Modifier
            </button>
            <button onClick={onArchive}
              className="text-xs px-3 py-1.5 rounded-lg font-medium"
              style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}>
              Archiver
            </button>
          </div>
        ) : (
          <button onClick={onRestore}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
            Remettre disponible
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Page principale ── */
export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const { toast } = useToast();

  const fetchProperties = async () => {
    const res = await fetch("/api/properties");
    if (res.ok) {
      const data = await res.json();
      setProperties(data.properties ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchProperties(); }, []);

  const handleAdd = async (data: Partial<Property>) => {
    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      toast("Bien ajouté ✅", "success");
      setShowForm(false);
      fetchProperties();
    } else {
      const err = await res.json().catch(() => ({}));
      toast(`Erreur lors de l'ajout : ${err.details ?? err.error ?? "inconnu"}`, "error");
    }
  };

  const handleEdit = async (id: string, data: Partial<Property>) => {
    const res = await fetch(`/api/properties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      toast("Bien modifié ✅", "success");
      setEditingId(null);
      fetchProperties();
    } else {
      toast("Erreur lors de la modification", "error");
    }
  };

  const handleArchive = async (id: string) => {
    const res = await fetch(`/api/properties/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Bien archivé", "success");
      fetchProperties();
    }
  };

  const handleRestore = async (id: string) => {
    const res = await fetch(`/api/properties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: true }),
    });
    if (res.ok) {
      toast("Bien remis disponible ✅", "success");
      fetchProperties();
    }
  };

  const available = properties.filter(p => p.available);
  const archived = properties.filter(p => !p.available);
  const totalProspects = properties.reduce((sum, p) => sum + (p.prospect_count ?? 0), 0);

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>Mes biens</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                {available.length} disponible{available.length > 1 ? "s" : ""}
                {archived.length > 0 ? ` · ${archived.length} archivé${archived.length > 1 ? "s" : ""}` : ""}
                {totalProspects > 0 ? ` · ${totalProspects} prospect${totalProspects > 1 ? "s" : ""} actif${totalProspects > 1 ? "s" : ""}` : ""}
              </p>
            </div>
            <button
              onClick={() => { setShowForm(true); setEditingId(null); }}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
              style={{ background: "rgb(79 70 229)" }}>
              + Ajouter un bien
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Formulaire d'ajout */}
          {showForm && !editingId && (
            <div className="bg-white rounded-2xl border p-6" style={{ borderColor: "rgb(199 210 254)" }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "rgb(30 41 59)" }}>Nouveau bien</h2>
              <PropertyForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
            </div>
          )}

          {loading ? (
            <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Chargement…</div>
          ) : properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="text-5xl mb-4">🏠</div>
              <div className="text-sm font-semibold mb-1" style={{ color: "rgb(71 85 105)" }}>
                Aucun bien enregistré
              </div>
              <div className="text-xs" style={{ color: "rgb(148 163 184)" }}>
                Ajoutez vos biens pour que l'IA puisse les lier aux prospects
              </div>
            </div>
          ) : (
            <>
              {/* Biens disponibles */}
              {available.length > 0 && (
                <div>
                  <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "rgb(100 116 139)" }}>
                    Disponibles ({available.length})
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {available.map((p) => (
                      <PropertyCard
                        key={p.id}
                        property={p}
                        editing={editingId === p.id}
                        onEdit={() => setEditingId(p.id)}
                        onSave={(data) => handleEdit(p.id, data)}
                        onCancelEdit={() => setEditingId(null)}
                        onArchive={() => handleArchive(p.id)}
                        onRestore={() => handleRestore(p.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Toggle biens archivés */}
              {archived.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowArchived(!showArchived)}
                    className="text-xs font-medium flex items-center gap-1.5 mb-3"
                    style={{ color: "rgb(148 163 184)" }}>
                    <span>{showArchived ? "▼" : "▶"}</span>
                    Archivés ({archived.length})
                  </button>
                  {showArchived && (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-60">
                      {archived.map((p) => (
                        <PropertyCard
                          key={p.id}
                          property={p}
                          editing={false}
                          onEdit={() => {}}
                          onSave={() => {}}
                          onCancelEdit={() => {}}
                          onArchive={() => {}}
                          onRestore={() => handleRestore(p.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
