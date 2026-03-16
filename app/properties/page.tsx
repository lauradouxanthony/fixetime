"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/layout/AppShell";
import { useToast } from "@/components/ui/Toast";

type Property = {
  id: string;
  title: string;
  address: string | null;
  type: string | null;
  rent: number;
  description: string | null;
  available: boolean;
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  studio: "Studio", T1: "T1", T2: "T2", T3: "T3", T4: "T4", T5: "T5",
  garage: "Garage", autre: "Autre",
};

function PropertyForm({
  initial,
  onSave,
  onCancel,
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
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    await onSave({ title, address: address || null, type: type || null, rent: parseInt(rent, 10), description: description || null, available });
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>
            Titre du bien *
          </label>
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: T2 Victor Hugo, 45m²"
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none"
            style={{ borderColor: "rgb(226 232 240)" }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Loyer (€) *</label>
          <input
            required
            type="number"
            value={rent}
            onChange={(e) => setRent(e.target.value)}
            placeholder="850"
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none"
            style={{ borderColor: "rgb(226 232 240)" }}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none"
            style={{ borderColor: "rgb(226 232 240)" }}
          >
            <option value="">Choisir…</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Adresse</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="12 rue Victor Hugo, 75011 Paris"
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none"
            style={{ borderColor: "rgb(226 232 240)" }}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium mb-1" style={{ color: "rgb(71 85 105)" }}>Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Caractéristiques, étage, charges…"
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none resize-none"
            style={{ borderColor: "rgb(226 232 240)" }}
          />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <input
            type="checkbox"
            id="available"
            checked={available}
            onChange={(e) => setAvailable(e.target.checked)}
            className="rounded"
          />
          <label htmlFor="available" className="text-sm" style={{ color: "rgb(71 85 105)" }}>
            Disponible à la location
          </label>
        </div>
      </div>
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity"
          style={{ background: "rgb(79 70 229)", opacity: saving ? 0.7 : 1 }}
        >
          {saving ? "Enregistrement…" : (initial?.id ? "Modifier" : "Ajouter")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm font-medium"
          style={{ background: "rgb(241 245 249)", color: "rgb(71 85 105)" }}
        >
          Annuler
        </button>
      </div>
    </form>
  );
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
      toast("Erreur lors de l'ajout", "error");
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

  const available = properties.filter(p => p.available);
  const archived = properties.filter(p => !p.available);

  return (
    <AppShell>
      <div className="h-full flex flex-col" style={{ background: "rgb(250 250 250)" }}>

        {/* Header */}
        <div className="px-6 py-4 border-b bg-white" style={{ borderColor: "rgb(226 232 240)" }}>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold" style={{ color: "rgb(30 41 59)" }}>Mes biens</h1>
              <p className="text-xs mt-0.5" style={{ color: "rgb(148 163 184)" }}>
                {available.length} disponible{available.length > 1 ? "s" : ""} · {archived.length} archivé{archived.length > 1 ? "s" : ""}
              </p>
            </div>
            <button
              onClick={() => { setShowForm(true); setEditingId(null); }}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white"
              style={{ background: "rgb(79 70 229)" }}
            >
              + Ajouter un bien
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Formulaire d'ajout */}
          {showForm && !editingId && (
            <div className="bg-white rounded-xl border p-5" style={{ borderColor: "rgb(226 232 240)" }}>
              <h2 className="text-sm font-semibold mb-4" style={{ color: "rgb(30 41 59)" }}>Nouveau bien</h2>
              <PropertyForm onSave={handleAdd} onCancel={() => setShowForm(false)} />
            </div>
          )}

          {loading ? (
            <div className="text-sm" style={{ color: "rgb(148 163 184)" }}>Chargement…</div>
          ) : properties.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="text-4xl mb-3">🏠</div>
              <div className="text-sm font-medium" style={{ color: "rgb(71 85 105)" }}>Aucun bien enregistré</div>
              <div className="text-xs mt-1" style={{ color: "rgb(148 163 184)" }}>Ajoutez vos premiers biens pour les lier aux prospects</div>
            </div>
          ) : (
            <>
              {/* Biens disponibles */}
              {available.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold mb-3" style={{ color: "rgb(71 85 105)" }}>
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
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Biens archivés */}
              {archived.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold mb-3" style={{ color: "rgb(148 163 184)" }}>
                    Archivés ({archived.length})
                  </h2>
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
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function PropertyCard({
  property, editing, onEdit, onSave, onCancelEdit, onArchive,
}: {
  property: Property;
  editing: boolean;
  onEdit: () => void;
  onSave: (data: Partial<Property>) => void;
  onCancelEdit: () => void;
  onArchive: () => void;
}) {
  if (editing) {
    return (
      <div className="bg-white rounded-xl border p-4" style={{ borderColor: "rgb(199 210 254)" }}>
        <PropertyForm initial={property} onSave={onSave} onCancel={onCancelEdit} />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border p-4 space-y-3" style={{ borderColor: "rgb(226 232 240)" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate" style={{ color: "rgb(30 41 59)" }}>
            {property.title}
          </div>
          {property.address && (
            <div className="text-xs mt-0.5 truncate" style={{ color: "rgb(148 163 184)" }}>
              {property.address}
            </div>
          )}
        </div>
        <div
          className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
          style={property.available
            ? { background: "rgba(22,163,74,0.1)", color: "rgb(22 163 74)" }
            : { background: "rgb(241 245 249)", color: "rgb(148 163 184)" }
          }
        >
          {property.available ? "Disponible" : "Archivé"}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {property.type && (
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "rgba(79,70,229,0.08)", color: "rgb(79 70 229)" }}>
            {TYPE_LABELS[property.type] ?? property.type}
          </span>
        )}
        <span className="text-base font-bold" style={{ color: "rgb(30 41 59)" }}>
          {property.rent.toLocaleString("fr-FR")} €/mois
        </span>
      </div>

      {property.description && (
        <p className="text-xs line-clamp-2" style={{ color: "rgb(100 116 139)" }}>
          {property.description}
        </p>
      )}

      {property.available && (
        <div className="flex gap-2 pt-1">
          <button
            onClick={onEdit}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "rgb(241 245 249)", color: "rgb(71 85 105)" }}
          >
            ✏️ Modifier
          </button>
          <button
            onClick={onArchive}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "rgba(220,38,38,0.08)", color: "rgb(220 38 38)" }}
          >
            Archiver
          </button>
        </div>
      )}
    </div>
  );
}
