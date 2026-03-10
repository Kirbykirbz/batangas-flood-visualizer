import SensorCard from "@/components/SensorCard";

export default function SensorsPage() {
  return (
    <div className="min-h-screen p-6 bg-zinc-50 dark:bg-gray-900">
      <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-zinc-50">
        Sensor Readings
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <SensorCard title="Rainfall Intensity" />
        <SensorCard title="Water Level" />
        <SensorCard title="Flow Rate" />
        <SensorCard title="Rain Duration" />
      </div>
    </div>
  );
}
