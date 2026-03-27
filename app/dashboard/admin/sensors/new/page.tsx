"use client";

import { useRouter } from "next/navigation";
import SensorForm, { type SensorFormValues } from "@/components/admin/SensorForm";
import { createSensor } from "@/app/lib/sensorsRepo";

export default function NewSensorPage() {
  const router = useRouter();

  async function handleSubmit(values: SensorFormValues) {
    await createSensor({
      id: values.id.trim(),
      name: values.name.trim(),
      lat: Number(values.lat),
      lng: Number(values.lng),
      zone_label: values.zone_label || null,
      dry_distance_cm: values.dry_distance_cm
        ? Number(values.dry_distance_cm)
        : null,
      is_active: values.is_active,
    });

    router.push("/dashboard/admin/sensors");
  }

  return (
    <div className="p-6  text-gray-900">
      <h1 className="mb-6 text-2xl font-bold">Add Sensor</h1>

      <SensorForm
        initialValues={{
          id: "",
          name: "",
          lat: "",
          lng: "",
          zone_label: "",
          dry_distance_cm: "",
          is_active: true,
        }}
        onSubmit={handleSubmit}
        submitLabel="Create Sensor"
      />
    </div>
  );
}