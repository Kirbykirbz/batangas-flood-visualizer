interface SensorCardProps {
  title: string;
  value?: string;
  status?: string;
}

export default function SensorCard({ title, value, status }: SensorCardProps) {
  const hasData = !!value && !!status;

  return (
    <div className="flex flex-col justify-between p-6 bg-white dark:bg-gray-800 rounded-xl shadow-lg h-40">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-50 mb-2">{title}</h3>

      {hasData ? (
        <>
          <p className="text-2xl font-bold text-gray-900 dark:text-zinc-50">{value}</p>
          <p className="text-gray-600 dark:text-gray-300">{status}</p>
        </>
      ) : (
        <>
          <p className="text-2xl font-bold text-gray-400 dark:text-gray-500 animate-pulse">
            --.- 
          </p>
          <p className="text-gray-400 dark:text-gray-500 italic text-sm">
            No data available yet
          </p>
        </>
      )}
    </div>
  );
}
