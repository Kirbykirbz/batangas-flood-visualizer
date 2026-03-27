// app/lib/floodForecast.ts

export type ForecastHorizon = "now" | "2h" | "4h" | "6h" | "8h";

export type ForecastComputationInput = {
  forecastHorizon: ForecastHorizon;
  rainMmHrCurrent: number;
  floodDepthCmCurrent: number;
  rainMemory: number;
  rainFullMmHr?: number;
  depthFullCm?: number;
  depthOnCm?: number;
  depthDampBase?: number;
  overflow?: boolean;
};

export type ScenarioMetrics = {
  rainMmHr: number;
  floodDepthCm: number;
  projectedRainMm: number;
  rainfallContributionCm: number;
  drainageLossCm: number;
};

export type FloodRiskResult = {
  scenario: ScenarioMetrics;
  rainFactor: number;
  depthFactor: number;
  effectiveDepthFactor: number;
  dynamicRisk: number;
  active: boolean;
  riskStage: 0 | 1 | 2 | 3;
};

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function forecastHours(h: ForecastHorizon): number {
  switch (h) {
    case "2h":
      return 2;
    case "4h":
      return 4;
    case "6h":
      return 6;
    case "8h":
      return 8;
    default:
      return 0;
  }
}

export function getRiskStage(risk: number, active: boolean): 0 | 1 | 2 | 3 {
  if (!active) return 0;
  if (risk <= 0.3) return 1;
  if (risk <= 0.6) return 2;
  return 3;
}

export function getRiskColor(risk: number): string {
  if (risk <= 0.3) return "#22c55e";
  if (risk <= 0.6) return "#f59e0b";
  return "#dc2626";
}

export function getStageLabel(stage: 0 | 1 | 2 | 3): string {
  switch (stage) {
    case 1:
      return "Stage 1 - High susceptibility only";
    case 2:
      return "Stage 2 - High and medium susceptibility";
    case 3:
      return "Stage 3 - Full susceptibility spread";
    default:
      return "Inactive";
  }
}

export function projectScenarioMetrics(
  params: ForecastComputationInput
): ScenarioMetrics {
  const {
    forecastHorizon,
    rainMmHrCurrent,
    floodDepthCmCurrent,
    rainMemory,
    rainFullMmHr = 50,
    depthFullCm = 30,
  } = params;

  if (forecastHorizon === "now") {
    return {
      rainMmHr: rainMmHrCurrent,
      floodDepthCm: Math.max(0, floodDepthCmCurrent),
      projectedRainMm: 0,
      rainfallContributionCm: 0,
      drainageLossCm: 0,
    };
  }

  const hours = forecastHours(forecastHorizon);
  const rainFactorCurrent = clamp01(rainMmHrCurrent / rainFullMmHr);

  // Persistence blends current rainfall with recent rainfall memory.
  const persistence = clamp01(0.55 * rainFactorCurrent + 0.45 * rainMemory);

  // Short-horizon projected rainfall using current measured intensity.
  const projectedRainMm = rainMmHrCurrent * hours;

  // Nonlinear runoff response:
  // more persistent rainfall causes proportionally more water rise.
  const runoffResponse =
    0.10 +
    0.18 * persistence +
    0.10 * rainFactorCurrent * rainFactorCurrent;

  const rainfallContributionCm = projectedRainMm * runoffResponse;

  // Drainage weakens when rainfall is stronger and more persistent.
  const drainageCmPerHr =
    1.6 -
    0.9 * persistence -
    0.3 * rainFactorCurrent;

  const boundedDrainageCmPerHr = Math.max(0.25, drainageCmPerHr);
  const drainageLossCm = boundedDrainageCmPerHr * hours;

  const projectedDepthRaw =
    floodDepthCmCurrent +
    rainfallContributionCm -
    drainageLossCm;

  const floodDepthCm = Math.max(
    0,
    Math.min(projectedDepthRaw, depthFullCm * 1.6)
  );

  return {
    rainMmHr: rainMmHrCurrent,
    floodDepthCm,
    projectedRainMm,
    rainfallContributionCm,
    drainageLossCm,
  };
}

export function computeFloodRisk(
  params: ForecastComputationInput
): FloodRiskResult {
  const {
    forecastHorizon,
    rainFullMmHr = 50,
    depthFullCm = 30,
    depthOnCm = 5,
    depthDampBase = 0.2,
    rainMemory,
    overflow = false,
  } = params;

  const scenario = projectScenarioMetrics(params);

  // Overflow is treated as a critical hazard state.
  // This makes the map, HUD, and future admin tools react consistently.
  if (overflow) {
    return {
      scenario: {
        ...scenario,
        floodDepthCm: Math.max(scenario.floodDepthCm, depthFullCm),
      },
      rainFactor: 1,
      depthFactor: 1,
      effectiveDepthFactor: 1,
      dynamicRisk: 1,
      active: true,
      riskStage: 3,
    };
  }

  const rainFactor = clamp01(scenario.rainMmHr / rainFullMmHr);
  const depthFactor = clamp01(scenario.floodDepthCm / depthFullCm);

  // Gate depth influence using rainfall memory so standing water
  // matters more when recent rainfall has been persistent.
  const gate = depthDampBase + (1 - depthDampBase) * rainMemory;
  const effectiveDepthFactor = depthFactor * gate;

  // Base risk from current/forecast scenario.
  const baseRisk = clamp01(0.4 * rainFactor + 0.6 * effectiveDepthFactor);

  // Add a modest forecast-only boost so longer horizons and persistent rain
  // are reflected more clearly in the displayed risk and stage.
  const hours = forecastHours(forecastHorizon);
  const horizonBoost =
    forecastHorizon === "now"
      ? 0
      : Math.min(0.12, 0.015 * hours + 0.05 * rainMemory);

  const dynamicRisk = clamp01(baseRisk + horizonBoost);

  const active =
    scenario.rainMmHr > 0 || scenario.floodDepthCm >= depthOnCm;

  const riskStage = getRiskStage(dynamicRisk, active);

  return {
    scenario,
    rainFactor,
    depthFactor,
    effectiveDepthFactor,
    dynamicRisk,
    active,
    riskStage,
  };
}