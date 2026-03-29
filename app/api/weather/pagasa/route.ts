import { NextResponse } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ForecastWeatherCondition = {
  place: string;
  weather_condition: string;
  caused_by: string;
  impacts: string;
};

type ForecastWindCondition = {
  place: string;
  speed: string;
  direction: string;
  coastal_water: string;
};

type TemperatureHumidityEntry = {
  max: { value: string; time: string };
  min: { value: string; time: string };
};

type TidalPrediction = {
  type: string;
  value: string;
  time: string;
};

type PagasaForecast = {
  issued_at?: string;
  synopsis?: string;
  forecast_weather_conditions?: ForecastWeatherCondition[];
  forecast_wind_conditions?: ForecastWindCondition[];
  temperature_humidity?: Record<string, TemperatureHumidityEntry>;
  astronomical_information?: Record<string, string>;
  tidal_predictions?: TidalPrediction[];
};

function clean(text: string | undefined | null) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function findHeadingTable($: cheerio.CheerioAPI, headingText: string) {
  const heading = $("h3")
    .filter((_, el) => clean($(el).text()) === headingText)
    .first();

  if (!heading.length) return null;

  const table = heading.nextAll("table").first();
  return table.length ? table : null;
}

export async function GET() {
  try {
    const url = "https://www.pagasa.dost.gov.ph/weather#daily-weather-forecast";

    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; BatangasFloodVisualizer/1.0; +https://batangas-flood-visualizer.vercel.app/)",
      },
    });

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `PAGASA page returned ${res.status}`,
        },
        { status: 502 }
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    const forecast: PagasaForecast = {};

    // Issued at
    const issueDiv = $("div.issue").first();
    if (issueDiv.length) {
      forecast.issued_at = clean(issueDiv.find("b").first().text()) || clean(issueDiv.text());
    }

    // Synopsis
    const synopsisHeading = $("div.panel-heading")
      .filter((_, el) => clean($(el).text()) === "Synopsis")
      .first();

    if (synopsisHeading.length) {
      const synopsisBody = synopsisHeading.nextAll("div.panel-body").first();
      if (synopsisBody.length) {
        forecast.synopsis = clean(synopsisBody.find("p").first().text()) || clean(synopsisBody.text());
      }
    }

    // Forecast Weather Conditions
    const weatherTable = findHeadingTable($, "Forecast Weather Conditions");
    if (weatherTable) {
      const weatherConditions: ForecastWeatherCondition[] = [];

      weatherTable.find("tbody tr").each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length >= 4) {
          weatherConditions.push({
            place: clean($(cols[0]).text()),
            weather_condition: clean($(cols[1]).text()),
            caused_by: clean($(cols[2]).text()),
            impacts: clean($(cols[3]).text()),
          });
        }
      });

      forecast.forecast_weather_conditions = weatherConditions;
    }

    // Forecast Wind and Coastal Water Conditions
    const windTable = findHeadingTable($, "Forecast Wind and Coastal Water Conditions");
    if (windTable) {
      const windConditions: ForecastWindCondition[] = [];

      windTable.find("tbody tr").each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length >= 4) {
          windConditions.push({
            place: clean($(cols[0]).text()),
            speed: clean($(cols[1]).text()),
            direction: clean($(cols[2]).text()),
            coastal_water: clean($(cols[3]).text()),
          });
        }
      });

      forecast.forecast_wind_conditions = windConditions;
    }

    // Temperature and Relative Humidity
    const tempTable = findHeadingTable($, "Temperature and Relative Humidity");
    if (tempTable) {
      const tempData: Record<string, TemperatureHumidityEntry> = {};

      tempTable.find("tbody tr").each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length >= 5) {
          const metric = clean($(cols[0]).text());
          if (!metric) return;

          tempData[metric] = {
            max: {
              value: clean($(cols[1]).text()),
              time: clean($(cols[2]).text()),
            },
            min: {
              value: clean($(cols[3]).text()),
              time: clean($(cols[4]).text()),
            },
          };
        }
      });

      forecast.temperature_humidity = tempData;
    }

    // Tides and Astronomical Information
    const tidesTable = findHeadingTable($, "Tides and Astronomical Information");
    if (tidesTable) {
      const astroData: Record<string, string> = {};
      const tidalData: TidalPrediction[] = [];

      const rows = tidesTable.find("tbody tr");

      rows.each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length < 3) return;

        const col0 = clean($(cols[0]).text());
        const col1 = clean($(cols[1]).text());
        const col2 = clean($(cols[2]).text());

        const isAstronomical =
          col0.toLowerCase().includes("sun") ||
          col0.toLowerCase().includes("moon") ||
          col0.toLowerCase().includes("illumination");

        if (isAstronomical) {
          astroData[col0] = col1 || col2;
          return;
        }

        const isTideLike =
          col0.toLowerCase().includes("high") ||
          col0.toLowerCase().includes("low");

        if (isTideLike && col1 && col1 !== "--") {
          tidalData.push({
            type: col0,
            value: col1,
            time: col2,
          });
        }
      });

      forecast.astronomical_information = astroData;
      forecast.tidal_predictions = tidalData;
    }

    return NextResponse.json({
      ok: true,
      forecast,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/weather/pagasa] failed:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to scrape PAGASA forecast",
      },
      { status: 500 }
    );
  }
}