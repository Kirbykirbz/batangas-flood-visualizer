export default function TrendsPage() {
  return (
    <div className="min-h-screen p-6 bg-zinc-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6">
        {/* Title */}
        <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-50 mb-4">
          Rainfall & Water Level Trends
        </h2>

        {/* Description / Hint */}
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Once connected to the sensors, this section will display historical and real-time trends for rainfall intensity and water levels in your community. Charts will provide insights into patterns, peak periods, and potential flood risks.
        </p>

        {/* Placeholder chart */}
        <div className="w-full h-64 flex items-center justify-center border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700">
          <span className="text-gray-400 dark:text-gray-300 italic">
            Chart preview will appear here
          </span>
        </div>

        {/* Optional hint cards */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900 rounded-lg">
            <p className="text-blue-700 dark:text-blue-300 text-sm">
              Rainfall trends help predict potential floods before they occur.
            </p>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-900 rounded-lg">
            <p className="text-green-700 dark:text-green-300 text-sm">
              Water level trends indicate how quickly rivers and canals respond to rain events.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
