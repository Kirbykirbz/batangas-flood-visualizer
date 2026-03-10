interface RiskIndicatorProps {
  level?: "Normal" | "Watch" | "Warning" | "Critical";
}

export default function RiskIndicator({ level }: RiskIndicatorProps) {
  // Map risk level to color
  const colorMap: Record<string, string> = {
    Normal: "bg-green-500",
    Watch: "bg-yellow-400",
    Warning: "bg-orange-500",
    Critical: "bg-red-600",
  };

  // If no level is provided, show "No data yet"
  const hasData = !!level;

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 rounded-xl shadow-lg bg-white dark:bg-gray-600 text-center">
      <h3 className="text-gray-600 dark:text-gray-400 text-sm mb-3">Flood Risk Level</h3>

      {hasData ? (
        <>
          <div className="flex items-center justify-center gap-2 mb-2">
            <span
              className={`w-5 h-5 rounded-full ${colorMap[level!]} inline-block`}
            ></span>
            <span className="text-xl font-bold text-gray-400 dark:text-zinc-50">{level}</span>
          </div>
          <p className="text-gray-500 dark:text-gray-300 text-sm">
            {level === "Normal" && "No immediate flood risk."}
            {level === "Watch" && "Be cautious: rainfall may cause minor flooding."}
            {level === "Warning" && "Flooding likely in low-lying areas soon."}
            {level === "Critical" && "Immediate action required! Severe flooding expected."}
          </p>
        </>
      ) : (
        <p className="text-gray-500 dark:text-gray-300 text-sm italic">
          No data available yet.
        </p>
      )}
    </div>
  );
}
