// components/admin/SensorForm.tsx
"use client";

import { useState } from "react";

export type SensorFormValues = {
  id: string;
  name: string;
  lat: string;
  lng: string;
  zone_label: string;
  dry_distance_cm: string;
  is_active: boolean;
};

export default function SensorForm({
  initialValues,
  onSubmit,
  submitLabel,
}: {
  initialValues: SensorFormValues;
  onSubmit: (values: SensorFormValues) => Promise<void>;
  submitLabel: string;
}) {
  const [values, setValues] = useState<SensorFormValues>(initialValues);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setError(null);

    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save sensor.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-6">
      <div>
        <label className="mb-1 block text-sm font-medium">Sensor ID</label>
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          value={values.id}
          onChange={(e) => setValues({ ...values, id: e.target.value })}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Name</label>
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          value={values.name}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Latitude</label>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={values.lat}
            onChange={(e) => setValues({ ...values, lat: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Longitude</label>
          <input
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            value={values.lng}
            onChange={(e) => setValues({ ...values, lng: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Zone Label</label>
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          value={values.zone_label}
          onChange={(e) => setValues({ ...values, zone_label: e.target.value })}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Dry Distance (cm)</label>
        <input
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          value={values.dry_distance_cm}
          onChange={(e) => setValues({ ...values, dry_distance_cm: e.target.value })}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={values.is_active}
          onChange={(e) => setValues({ ...values, is_active: e.target.checked })}
        />
        Active
      </label>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={isSaving}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isSaving ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}