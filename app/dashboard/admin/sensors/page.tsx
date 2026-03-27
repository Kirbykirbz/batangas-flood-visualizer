// app/dashboard/admin/sensors/page.tsx
import Link from "next/link";
import { listSensors } from "@/app/lib/sensorsRepo";


export default async function AdminSensorsPage() {
  const sensors = await listSensors();

  return (
    <div className="space-y-6 p-6 text-gray-900">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sensors</h1>
        <Link
          href="/dashboard/admin/sensors/new"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white"
        >
          Add Sensor
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-left">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Latitude</th>
              <th className="px-4 py-3">Longitude</th>
              <th className="px-4 py-3">Zone</th>
              <th className="px-4 py-3">Active</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {sensors.map((sensor) => (
              <tr key={sensor.id} className="border-t border-zinc-100">
                <td className="px-4 py-3">{sensor.id}</td>
                <td className="px-4 py-3">{sensor.name}</td>
                <td className="px-4 py-3">{sensor.lat}</td>
                <td className="px-4 py-3">{sensor.lng}</td>
                <td className="px-4 py-3">{sensor.zone_label ?? "—"}</td>
                <td className="px-4 py-3">{sensor.is_active ? "Yes" : "No"}</td>
                <td className="px-4 py-3">
                  <Link
                    href={`/dashboard/admin/sensors/${sensor.id}`}
                    className="font-semibold text-blue-600"
                  >
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}