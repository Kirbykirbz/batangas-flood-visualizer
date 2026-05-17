// app/api/admin/events/[id]/report/route.ts

import { NextResponse } from "next/server";
import { jsPDF } from "jspdf";
import { getRainEventById } from "@/app/lib/eventsRepoServer";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";
import { toNumber } from "@/app/lib/sensorReading";

const MM_PER_TIP = 0.27;

type SensorReadingRow = {
  id: number;
  device_id: string;
  ts: string;
  rain_rate_mmh_300: number | null;
  rain_rate_mmh_60: number | null;
  flood_depth_cm: number | null;
  created_at: string;
};

type SensorInfo = {
  id: string;
  name: string | null;
  location_label: string | null;
  lat: number | null;
  lng: number | null;
  zone_label: string | null;
};

type ChartPoint = {
  ts: string;
  rainRate: number;
  floodDepth: number;
};

function rainLabel(mmHr: number): string {
  if (mmHr < 0.5) return "No Rain";
  if (mmHr < 2.5) return "Light";
  if (mmHr < 7.5) return "Moderate";
  if (mmHr < 15) return "Heavy";
  if (mmHr < 30) return "Very Heavy";
  return "Extreme";
}

function fmt(n: number | null, digits = 1) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtInt(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fmtShortTime(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function durationText(startedAt: string, endedAt: string | null) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end)) return "—";

  const mins = Math.max(0, Math.round((end - start) / 60000));
  if (mins < 60) return `${mins} min`;

  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function readableReason(reason: string | null) {
  switch (reason) {
    case "rainfall_threshold_met":
      return "the system opened the event after rainfall reached the configured threshold";
    case "auto_inactive_rain_and_receded_flood":
      return "the system closed the event after rainfall became inactive and flood water had receded";
    case "manual_create":
      return "the event was created manually";
    case "manual_end":
      return "the event was manually ended";
    default:
      return reason || "no reason was recorded";
  }
}

function classifyFloodRisk(depthCm: number | null) {
  if (depthCm == null || depthCm < 5) return "LOW";
  if (depthCm < 15) return "WATCH";
  if (depthCm < 30) return "MODERATE";
  return "HIGH";
}

function addPageIfNeeded(doc: jsPDF, y: number, needed = 40) {
  if (y + needed <= 282) return y;
  doc.addPage();
  return 18;
}

function sectionTitle(doc: jsPDF, title: string, y: number) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.text(title, 14, y);
  doc.setDrawColor(220);
  doc.line(14, y + 3, 196, y + 3);
  return y + 10;
}

function kpiCard(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  title: string,
  value: string,
  subtitle?: string
) {
  doc.setDrawColor(220);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(x, y, w, 25, 3, 3, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(title, x + 4, y + 6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(value, x + 4, y + 15);

  if (subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(subtitle, x + 4, y + 21);
  }
}

function drawParagraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth = 178
) {
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * 5 + 2;
}

function niceMax(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1;

  const exponent = Math.floor(Math.log10(value));
  const base = Math.pow(10, exponent);
  const normalized = value / base;

  if (normalized <= 1) return 1 * base;
  if (normalized <= 2) return 2 * base;
  if (normalized <= 5) return 5 * base;
  return 10 * base;
}

function downsamplePoints(points: ChartPoint[], maxPoints = 70) {
  if (points.length <= maxPoints) return points;

  const result: ChartPoint[] = [];

  for (let i = 0; i < maxPoints; i += 1) {
    const index = Math.round((i / (maxPoints - 1)) * (points.length - 1));
    result.push(points[index]);
  }

  return result;
}

function findPeakPoint(
  points: ChartPoint[],
  valueKey: "rainRate" | "floodDepth"
) {
  if (points.length === 0) return null;

  return points.reduce<ChartPoint | null>((best, point) => {
    if (!best) return point;
    return point[valueKey] > best[valueKey] ? point : best;
  }, null);
}

function drawLineChart({
  doc,
  title,
  subtitle,
  points,
  valueKey,
  unit,
  x,
  y,
  width,
  height,
  peakPoint,
}: {
  doc: jsPDF;
  title: string;
  subtitle: string;
  points: ChartPoint[];
  valueKey: "rainRate" | "floodDepth";
  unit: string;
  x: number;
  y: number;
  width: number;
  height: number;
  peakPoint: ChartPoint | null;
}) {
  const displayPoints = downsamplePoints(points);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(title, x, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(subtitle, x, y + 5);

  const chartY = y + 10;
  const leftPad = 22;
  const bottomPad = 16;
  const topPad = 8;
  const rightPad = 8;

  const plotX = x + leftPad;
  const plotY = chartY + topPad;
  const plotW = width - leftPad - rightPad;
  const plotH = height - topPad - bottomPad;

  doc.setDrawColor(220);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(x, chartY, width, height, 3, 3, "FD");

  if (displayPoints.length === 0) {
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text("No chartable data available.", x + 8, chartY + 25);
    return;
  }

  const values = displayPoints.map((p) => p[valueKey]).filter(Number.isFinite);
  const maxValue = niceMax(Math.max(...values, 1) * 1.1);

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const gy = plotY + ratio * plotH;
    const value = maxValue - ratio * maxValue;

    doc.setDrawColor(235);
    doc.line(plotX, gy, plotX + plotW, gy);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(110);
    doc.text(value.toFixed(maxValue <= 10 ? 1 : 0), x + 3, gy + 2);
  }

  doc.setDrawColor(160);
  doc.line(plotX, plotY, plotX, plotY + plotH);
  doc.line(plotX, plotY + plotH, plotX + plotW, plotY + plotH);

  const scaleX = (index: number) =>
    displayPoints.length <= 1
      ? plotX
      : plotX + (index / (displayPoints.length - 1)) * plotW;

  const scaleY = (value: number) =>
    plotY + plotH - (value / maxValue) * plotH;

  doc.setDrawColor(24, 24, 27);
  doc.setLineWidth(0.75);

  for (let i = 1; i < displayPoints.length; i += 1) {
    const prev = displayPoints[i - 1];
    const curr = displayPoints[i];

    doc.line(
      scaleX(i - 1),
      scaleY(prev[valueKey]),
      scaleX(i),
      scaleY(curr[valueKey])
    );
  }

  if (peakPoint) {
    const peakIndex = displayPoints.findIndex(
      (point) => point.ts === peakPoint.ts
    );

    if (peakIndex >= 0) {
      const px = scaleX(peakIndex);
      const py = scaleY(peakPoint[valueKey]);

      doc.setFillColor(220, 38, 38);
      doc.circle(px, py, 2.2, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(180, 30, 30);
      doc.text(`Peak: ${fmt(peakPoint[valueKey], 2)} ${unit}`, px + 3, py - 3);
    }
  }

  const labelIndexes = Array.from(
    new Set([0, Math.floor(displayPoints.length / 2), displayPoints.length - 1])
  );

  doc.setFontSize(7);
  doc.setTextColor(100);

  labelIndexes.forEach((index) => {
    const point = displayPoints[index];
    if (!point) return;
    doc.text(fmtShortTime(point.ts), scaleX(index) - 7, chartY + height - 5);
  });

  doc.setFontSize(7);
  doc.setTextColor(100);
  doc.text(unit, x + width - 18, y);

  doc.setLineWidth(0.2);
}

function buildSummary({
  event,
  sensor,
  calculatedRainMm,
  peakRainPoint,
  peakFloodPoint,
}: {
  event: NonNullable<Awaited<ReturnType<typeof getRainEventById>>>;
  sensor: SensorInfo | null;
  calculatedRainMm: number;
  peakRainPoint: ChartPoint | null;
  peakFloodPoint: ChartPoint | null;
}) {
  const peakRain = Number(event.peak_rain_rate_mmh ?? 0);
  const peakFlood = event.peak_flood_depth_cm;
  const rainClass = rainLabel(peakRain);
  const floodRisk = classifyFloodRisk(peakFlood);
  const location =
    sensor?.location_label || sensor?.zone_label || "the monitored location";

  return [
    `Rainfall at ${location} peaked at ${fmt(peakRain, 2)} mm/hr, classified as ${rainClass}, around ${fmtTime(peakRainPoint?.ts ?? null)}.`,
    `The event lasted ${durationText(event.started_at, event.ended_at)}, from ${fmtTime(event.started_at)} to ${fmtTime(event.ended_at)}.`,
    `The gauge recorded ${fmtInt(event.total_tips)} tips. At ${MM_PER_TIP} mm per tip, the estimated rainfall is ${fmt(calculatedRainMm, 2)} mm.`,
    `Flood depth peaked at ${fmt(peakFlood, 1)} cm around ${fmtTime(peakFloodPoint?.ts ?? null)}, with a ${floodRisk} flood risk level.`,
    `The last recorded rainfall activity was at ${fmtTime(event.last_tip_at)}.`,
    `The event was triggered because ${readableReason(event.trigger_reason)} and ended because ${readableReason(event.ended_reason)}.`,
  ];
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const eventId = Number(id);

    if (!Number.isFinite(eventId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid event id" },
        { status: 400 }
      );
    }

    const event = await getRainEventById(eventId);

    if (!event) {
      return NextResponse.json(
        { ok: false, error: "Rain event not found" },
        { status: 404 }
      );
    }

    const [{ data: sensorData }, readingsResult] = await Promise.all([
      supabaseAdmin
        .from("sensors")
        .select("id, name, location_label, lat, lng, zone_label")
        .eq("id", event.device_id)
        .maybeSingle(),
      supabaseAdmin
        .from("sensor_readings")
        .select(
          `
          id,
          device_id,
          ts,
          rain_rate_mmh_300,
          rain_rate_mmh_60,
          flood_depth_cm,
          created_at
        `
        )
        .eq("device_id", event.device_id)
        .gte("ts", event.started_at)
        .lte("ts", event.ended_at ?? new Date().toISOString())
        .order("ts", { ascending: true }),
    ]);

    if (readingsResult.error) {
      return NextResponse.json(
        { ok: false, error: `[event report] ${readingsResult.error.message}` },
        { status: 500 }
      );
    }

    const sensor = (sensorData ?? null) as SensorInfo | null;
    const rows = (readingsResult.data ?? []) as SensorReadingRow[];

    const points: ChartPoint[] = rows
      .map((row) => ({
        ts: row.ts || row.created_at,
        rainRate:
          toNumber(row.rain_rate_mmh_300) ??
          toNumber(row.rain_rate_mmh_60) ??
          0,
        floodDepth: toNumber(row.flood_depth_cm) ?? 0,
      }))
      .filter((point) => point.ts)
      .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const calculatedRainMm = Number(
      (Number(event.total_tips ?? 0) * MM_PER_TIP).toFixed(2)
    );

    const peakRainPoint = findPeakPoint(points, "rainRate");
    const peakFloodPoint = findPeakPoint(points, "floodDepth");

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    let y = 16;

    doc.setFillColor(24, 24, 27);
    doc.rect(0, 0, 210, 34, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(255);
    doc.text("Rain Event Report", 14, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(220);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, y + 7);

    y = 44;

    y = sectionTitle(doc, "Event Overview", y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40);

    doc.text(`Event ID: ${event.id}`, 14, y);
    doc.text(`Sensor: ${sensor?.name ?? event.device_id}`, 80, y);

    y += 6;
    doc.text(`Device ID: ${event.device_id}`, 14, y);
    doc.text(`Location: ${sensor?.location_label ?? "—"}`, 80, y);

    y += 6;
    doc.text(`Zone: ${sensor?.zone_label ?? "—"}`, 14, y);
    doc.text(
      `Coordinates: ${fmt(sensor?.lat ?? null, 6)}, ${fmt(sensor?.lng ?? null, 6)}`,
      80,
      y
    );

    y += 6;
    doc.text(`Start: ${fmtTime(event.started_at)}`, 14, y);

    y += 6;
    doc.text(`End: ${fmtTime(event.ended_at)}`, 14, y);

    y += 12;

    kpiCard(
      doc,
      14,
      y,
      42,
      "TOTAL RAIN",
      `${fmt(event.total_rain_mm, 2)} mm`,
      `${MM_PER_TIP} mm/tip`
    );

    kpiCard(
      doc,
      60,
      y,
      42,
      "PEAK RAIN",
      `${fmt(event.peak_rain_rate_mmh, 2)}`,
      rainLabel(Number(event.peak_rain_rate_mmh ?? 0))
    );

    kpiCard(
      doc,
      106,
      y,
      42,
      "PEAK FLOOD",
      `${fmt(event.peak_flood_depth_cm, 1)} cm`,
      fmtShortTime(peakFloodPoint?.ts ?? null)
    );

   kpiCard(
  doc,
  152,
  y,
  42,
  "DURATION",
  durationText(event.started_at, event.ended_at),
  "event length"
);

    y += 36;

    y = sectionTitle(doc, "Summary", y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(45);

    buildSummary({
      event,
      sensor,
      calculatedRainMm,
      peakRainPoint,
      peakFloodPoint,
    }).forEach((line) => {
      y = drawParagraph(doc, `• ${line}`, 16, y);
    });

    y += 4;
    y = addPageIfNeeded(doc, y, 82);

    y = sectionTitle(doc, "Rain Intensity Chart", y);

    drawLineChart({
      doc,
      title: "Rain Intensity Over Time",
      subtitle: "Higher points show stronger rainfall during the event.",
      points,
      valueKey: "rainRate",
      unit: "mm/hr",
      x: 14,
      y,
      width: 182,
      height: 68,
      peakPoint: peakRainPoint,
    });

    y += 84;
    y = addPageIfNeeded(doc, y, 82);

    y = sectionTitle(doc, "Flood Depth Chart", y);

    drawLineChart({
      doc,
      title: "Flood Depth Over Time",
      subtitle: "Rising values show water accumulation; falling values show recession.",
      points,
      valueKey: "floodDepth",
      unit: "cm",
      x: 14,
      y,
      width: 182,
      height: 68,
      peakPoint: peakFloodPoint,
    });

    y += 84;
    y = addPageIfNeeded(doc, y, 60);

    y = sectionTitle(doc, "Technical Summary", y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40);

    const technical = [
      `Event ID: ${event.id}`,
      `Sensor: ${sensor?.name ?? event.device_id}`,
      `Location: ${sensor?.location_label ?? "—"}`,
      `Total Tips: ${fmtInt(event.total_tips)}`,
      `Rain Gauge Conversion: ${MM_PER_TIP} mm per tip`,
      `Calculated Rain from Tips: ${fmt(calculatedRainMm, 2)} mm`,
      `Stored Total Rain: ${fmt(event.total_rain_mm, 2)} mm`,
      `Peak Rain Time: ${fmtTime(peakRainPoint?.ts ?? null)}`,
      `Peak Flood Time: ${fmtTime(peakFloodPoint?.ts ?? null)}`,
      `Last Tip: ${fmtTime(event.last_tip_at)}`,
      `Chart Points: ${points.length}`,
    ];

    technical.forEach((line) => {
      doc.text(line, 14, y);
      y += 6;
    });

    const pageCount = doc.getNumberOfPages();

    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text("Generated by Flood Monitoring System", 14, 290);
      doc.text(`Page ${page} of ${pageCount}`, 178, 290);
    }

    const pdfBytes = new Uint8Array(doc.output("arraybuffer"));

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="rain-event-${eventId}-report.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[GET /api/admin/events/[id]/report] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Failed to export event PDF",
      },
      { status: 500 }
    );
  }
}