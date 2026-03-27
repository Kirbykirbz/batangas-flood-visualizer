"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import SensorForm, { type SensorFormValues } from "@/components/admin/SensorForm";
import { getSensorById, updateSensor } from "@/app/lib/sensorsRepo";

export default function EditSensorPage() {
  const params = useParams();
  const router = useRouter();

  const id = params.id as string;

  const [initialValues, setInitialValues] = useState<SensorFormValues | null>(null);

  useEffect(() => {
    async function load() {
      const sensor = await getSensorById(id);
      if (!sensor) return;

      setInitialValues({
        id: sensor.id,
        name: sensor.name,
        lat: String(sensor.lat),
        lng: String(sensor.lng),
        zone_label: sensor.zone_label ?? "",
        dry_distance_cm:
          sensor.dry_distance_cm != null
            ? String(sensor.dry_distance_cm)
            : "",
        is_active: sensor.is_active,
      });
    }

    load();
  }, [id]);

  async function handleSubmit(values: SensorFormValues) {
    await updateSensor(id, {
      name: values.name.trim(),
      lat: Number(values.lat),
      lng: Number(values.lng),
      zone_label: values.zone_label || null,
      dry_distance_cm: values.dry_distance_cm
        ? Number(values.dry_distance_cm)
        : null,
      is_active: values.is_active,
      updated_at: new Date().toISOString(),
    });

    router.push("/dashboard/admin/sensors");
  }

  if (!initialValues) {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="p-6 text-gray-900">
      <h1 className="mb-6 text-2xl font-bold">Edit Sensor</h1>

      <SensorForm
        initialValues={initialValues}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </div>
  );
}