"use client";

import { useEffect, useState } from "react";
import type { SensorRecord } from "@/app/lib/sensorsRepo";

function toInputDate(value: Date) {
  const pad = (n: number) =>
    String(n).padStart(2, "0");

  return (
    `${value.getFullYear()}-` +
    `${pad(value.getMonth() + 1)}-` +
    `${pad(value.getDate())}T` +
    `${pad(value.getHours())}:` +
    `${pad(value.getMinutes())}`
  );
}

export function SensorCsvExportCard({
  sensors,
}: {
  sensors: SensorRecord[];
}) {

  // ============================================
  // HYDRATION-SAFE INITIAL VALUES
  // ============================================

  const [mounted, setMounted] =
    useState(false);

  const [deviceId, setDeviceId] =
    useState("");

  const [start, setStart] =
    useState("");

  const [end, setEnd] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState("");

  // ============================================
  // INITIALIZE ONLY AFTER MOUNT
  // ============================================

  useEffect(() => {

    setMounted(true);

    const now =
      new Date();

    const sevenDaysAgo =
      new Date(
        now.getTime() -
        7 * 24 * 60 * 60 * 1000
      );

    setStart(
      toInputDate(sevenDaysAgo)
    );

    setEnd(
      toInputDate(now)
    );

    if (
      sensors.length > 0
    ) {
      setDeviceId(
        sensors[0].id
      );
    }

  }, [sensors]);

  // ============================================
  // DOWNLOAD HANDLER
  // ============================================

  async function handleDownload() {

    try {

      setLoading(true);
      setError("");

      if (
        !deviceId ||
        !start ||
        !end
      ) {
        throw new Error(
          "Please complete all fields."
        );
      }

      const params =
        new URLSearchParams({
          deviceId,
          start:
            new Date(start)
              .toISOString(),
          end:
            new Date(end)
              .toISOString(),
        });

      const response =
        await fetch(
          `/api/admin/sensors/export?${params.toString()}`
        );

      if (!response.ok) {

        let message =
          "Export failed";

        try {

          const json =
            await response.json();

          message =
            json.error ??
            message;

        } catch {}

        throw new Error(
          message
        );
      }

      const blob =
        await response.blob();

      const url =
        window.URL.createObjectURL(
          blob
        );

      const a =
        document.createElement("a");

      a.href = url;

      a.download =
        `sensor-export-${deviceId}.csv`;

      document.body.appendChild(a);

      a.click();

      a.remove();

      window.URL.revokeObjectURL(
        url
      );

    } catch (err) {

      setError(
        err instanceof Error
          ? err.message
          : "Export failed"
      );

    } finally {

      setLoading(false);
    }
  }

  // ============================================
  // PREVENT SSR HYDRATION MISMATCH
  // ============================================

  if (!mounted) {
    return null;
  }

  // ============================================
  // UI
  // ============================================

  return (
    <div className="
      mt-4
      rounded-2xl
      border
      border-zinc-200
      bg-white
      shadow-sm
    ">
      <div className="
        border-b
        border-zinc-200
        px-4
        py-4
        sm:px-5
      ">
        <div className="
          text-base
          font-extrabold
          text-zinc-900
        ">
          Historical CSV Export
        </div>

        <div className="
          mt-1
          text-sm
          text-zinc-600
        ">
          Export telemetry using
          custom date ranges.
        </div>
      </div>

      <div className="
        grid
        grid-cols-1
        gap-4
        px-4
        py-4
        sm:px-5
        xl:grid-cols-4
      ">

        {/* SENSOR */}

        <div>
          <label className="
            block
            text-xs
            font-semibold
            uppercase
            tracking-wide
            text-zinc-500
          ">
            Sensor
          </label>

          <select
            value={deviceId}
            onChange={(e) =>
              setDeviceId(
                e.target.value
              )
            }
            className="
              mt-1
              w-full
              rounded-xl
              border
              border-zinc-200
              bg-white
              px-3
              py-2
              text-sm
              font-semibold
              text-zinc-900
              shadow-sm
            "
          >
            {sensors.map(
              (sensor) => (
                <option
                  key={sensor.id}
                  value={sensor.id}
                >
                  {sensor.name} — {sensor.id}
                </option>
              )
            )}
          </select>
        </div>

        {/* START */}

        <div>
          <label className="
            block
            text-xs
            font-semibold
            uppercase
            tracking-wide
            text-zinc-500
          ">
            Start Date
          </label>

          <input
            type="datetime-local"
            value={start}
            onChange={(e) =>
              setStart(
                e.target.value
              )
            }
            className="
              mt-1
              w-full
              rounded-xl
              border
              border-zinc-200
              bg-white
              px-3
              py-2
              text-sm
              font-semibold
              text-zinc-900
              shadow-sm
            "
          />
        </div>

        {/* END */}

        <div>
          <label className="
            block
            text-xs
            font-semibold
            uppercase
            tracking-wide
            text-zinc-500
          ">
            End Date
          </label>

          <input
            type="datetime-local"
            value={end}
            onChange={(e) =>
              setEnd(
                e.target.value
              )
            }
            className="
              mt-1
              w-full
              rounded-xl
              border
              border-zinc-200
              bg-white
              px-3
              py-2
              text-sm
              font-semibold
              text-zinc-900
              shadow-sm
            "
          />
        </div>

        {/* BUTTON */}

        <div className="
          flex
          items-end
        ">
          <button
            type="button"
            onClick={
              handleDownload
            }
            disabled={loading}
            className="
              inline-flex
              w-full
              items-center
              justify-center
              rounded-xl
              bg-zinc-900
              px-4
              py-2
              text-sm
              font-bold
              text-white
              shadow-sm
              hover:bg-zinc-800
              disabled:opacity-60
            "
          >
            {loading
              ? "Exporting..."
              : "Download CSV"}
          </button>
        </div>
      </div>

      {error && (
        <div className="
          border-t
          border-red-200
          bg-red-50
          px-4
          py-3
          text-sm
          text-red-700
        ">
          {error}
        </div>
      )}
    </div>
  );
}