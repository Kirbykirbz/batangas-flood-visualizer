// app/api/admin/sensors/export/route.ts

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabaseAdmin";

// ======================================================
// CONFIG
// ======================================================

const PAGE_SIZE = 5000;

// safety limit to prevent huge exports
const MAX_EXPORT_ROWS = 250000;

// ======================================================
// HELPERS
// ======================================================

function csvEscape(value: unknown) {

  if (value == null) {
    return "";
  }

  const str = String(value);

  if (/[",\n]/.test(str)) {

    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function rowsToCsv(
  rows: Record<string, unknown>[]
) {

  if (rows.length === 0) {
    return "";
  }

  const headers =
    Object.keys(rows[0]);

  const headerLine =
    headers
      .map(csvEscape)
      .join(",");

  const bodyLines =
    rows.map((row) =>
      headers
        .map((header) =>
          csvEscape(row[header])
        )
        .join(",")
    );

  return [
    headerLine,
    ...bodyLines,
  ].join("\n");
}

// ======================================================
// ROUTE
// ======================================================

export async function GET(
  req: NextRequest
) {

  try {

    // ==================================================
    // QUERY PARAMS
    // ==================================================

    const url =
      new URL(req.url);

    const deviceId =
      url.searchParams.get(
        "deviceId"
      );

    const start =
      url.searchParams.get(
        "start"
      );

    const end =
      url.searchParams.get(
        "end"
      );

    // ==================================================
    // VALIDATION
    // ==================================================

    if (
      !deviceId ||
      !start ||
      !end
    ) {

      return NextResponse.json(
        {
          ok: false,
          error:
            "Missing query params"
        },
        {
          status: 400,
        }
      );
    }

    // ==================================================
    // FETCH PAGINATED DATA
    // ==================================================

    const rows:
      Record<string, unknown>[] = [];

    let from = 0;

    while (true) {

      const to =
        from +
        PAGE_SIZE -
        1;

      const {
        data,
        error,
      } =
        await supabaseAdmin
          .from(
            "sensor_readings"
          )
          .select(`
            id,
            device_id,
            ts,

            raw_dist_cm,
            raw_water_cm,
            stable_water_cm,

            us_valid,
            accepted_for_stable,
            overflow,

            rain_ticks_total,

            tips_60,
            tips_300,

            rain_rate_mmh_60,
            rain_rate_mmh_300,

            rssi_dbm,

            flood_depth_cm,
            dry_distance_cm,

            created_at,

            vbat_v,
            current_ma,
            battery_percentage,

            network_type
          `)
          .eq(
            "device_id",
            deviceId
          )
          .gte(
            "ts",
            start
          )
          .lte(
            "ts",
            end
          )
          .order(
            "ts",
            {
              ascending: true,
            }
          )
          .range(
            from,
            to
          );

      // ================================================
      // ERROR
      // ================================================

      if (error) {

        console.error(
          "[sensor export]",
          error
        );

        return NextResponse.json(
          {
            ok: false,
            error:
              error.message,
          },
          {
            status: 500,
          }
        );
      }

      // ================================================
      // NO MORE DATA
      // ================================================

      if (
        !data ||
        data.length === 0
      ) {
        break;
      }

      // ================================================
      // PUSH PAGE
      // ================================================

      rows.push(...data);

      // ================================================
      // SAFETY LIMIT
      // ================================================

      if (
        rows.length >
        MAX_EXPORT_ROWS
      ) {

        return NextResponse.json(
          {
            ok: false,
            error:
              `Export exceeds ${MAX_EXPORT_ROWS.toLocaleString()} rows`,
          },
          {
            status: 400,
          }
        );
      }

      // ================================================
      // FINISHED
      // ================================================

      if (
        data.length <
        PAGE_SIZE
      ) {
        break;
      }

      // ================================================
      // NEXT PAGE
      // ================================================

      from += PAGE_SIZE;
    }

    // ==================================================
    // NO ROWS
    // ==================================================

    if (
      rows.length === 0
    ) {

      return NextResponse.json(
        {
          ok: false,
          error:
            "No rows found"
        },
        {
          status: 404,
        }
      );
    }

    // ==================================================
    // CSV
    // ==================================================

    const csv =
      rowsToCsv(rows);

    // ==================================================
    // FILENAME
    // ==================================================

    const filename =
      `sensor-export-${deviceId}-${start}-to-${end}.csv`;

    // ==================================================
    // RESPONSE
    // ==================================================

    return new NextResponse(
      csv,
      {
        status: 200,

        headers: {

          "Content-Type":
            "text/csv; charset=utf-8",

          "Content-Disposition":
            `attachment; filename="${filename}"`,

          "Cache-Control":
            "no-store",
        },
      }
    );

  } catch (error) {

    console.error(
      "[GET /api/admin/sensors/export]",
      error
    );

    return NextResponse.json(
      {
        ok: false,

        error:
          error instanceof Error
            ? error.message
            : "Export failed",
      },
      {
        status: 500,
      }
    );
  }
}