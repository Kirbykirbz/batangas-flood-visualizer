import Image from "next/image";

export default function AboutPage() {
  return (
    <div className="min-h-screen p-6 bg-zinc-50 dark:bg-gray-900 flex justify-center">
      <div className="max-w-3xl w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 space-y-6">
        
        {/* Logo */}
        <div className="flex justify-center">
          <Image
            src="/flood-icon.png" // make sure the logo exists in public folder
            alt="Flood Visualizer Logo"
            width={120}
            height={120}
            className="rounded-full border-4 border-blue-600"
          />
        </div>

        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-900 dark:text-zinc-50 text-center">
          About the AIoT Flood Pathway Visualizer
        </h1>

        {/* Description */}
        <p className="text-gray-700 dark:text-gray-300 leading-relaxed text-center">
          The AIoT Flood Pathway Visualizer is designed to empower communities with
          timely flood risk awareness. By integrating real-time sensor data,
          geospatial analysis, and predictive modeling, it provides actionable
          insights for decision-making during heavy rainfall and potential flooding events.
        </p>

        {/* Key Features */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-blue-50 dark:bg-blue-900 rounded-lg">
            <h3 className="font-semibold text-blue-700 dark:text-blue-300 mb-1">Real-time Monitoring</h3>
            <p className="text-gray-700 dark:text-gray-300 text-sm">
              Collects data from rainfall and water level sensors for live updates.
            </p>
          </div>
          <div className="p-4 bg-green-50 dark:bg-green-900 rounded-lg">
            <h3 className="font-semibold text-green-700 dark:text-green-300 mb-1">Predictive Alerts</h3>
            <p className="text-gray-700 dark:text-gray-300 text-sm">
              Uses historical trends and models to anticipate flood risks in advance.
            </p>
          </div>
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900 rounded-lg">
            <h3 className="font-semibold text-yellow-700 dark:text-yellow-300 mb-1">Community Dashboard</h3>
            <p className="text-gray-700 dark:text-gray-300 text-sm">
              Provides an intuitive interface for residents to view flood pathways and risk indicators.
            </p>
          </div>
          <div className="p-4 bg-red-50 dark:bg-red-900 rounded-lg">
            <h3 className="font-semibold text-red-700 dark:text-red-300 mb-1">Educational Insights</h3>
            <p className="text-gray-700 dark:text-gray-300 text-sm">
              Helps the community understand flood patterns, seasonal impacts, and safe evacuation measures.
            </p>
          </div>
        </div>

        {/* Closing Statement */}
        <p className="text-gray-700 dark:text-gray-300 text-center mt-4">
          This project demonstrates how AIoT technology can bridge data, predictive modeling,
          and community action to mitigate flood risks and save lives.
        </p>
      </div>
    </div>
  );
}
