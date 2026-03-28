"use client";

import { useEffect, useMemo, useState } from "react";

type TutorialStep = {
  key: string;
  title: string;
  description: string;
};

const STORAGE_KEY_TUTORIAL_SEEN = "flood_dashboard_tutorial_seen_v1";

const STEPS: TutorialStep[] = [
  {
    key: "sensor-selector",
    title: "Sensor Selection",
    description:
      "Choose the monitored location you want to inspect. If location access is enabled, the dashboard can help focus on the nearest available sensor.",
  },
  {
    key: "scenario-horizon",
    title: "Scenario Horizon",
    description:
      "Switch between current conditions and short future scenarios like 2h, 4h, 6h, and 8h if the current rainfall state continues.",
  },
  {
    key: "summary-cards",
    title: "Summary Cards",
    description:
      "These cards summarize rainfall, flood depth, warning level, and active sensors so users can read the situation quickly.",
  },
  {
    key: "map",
    title: "Flood Map",
    description:
      "The map shows active sensor locations and helps users understand the selected area visually.",
  },
  {
    key: "next-steps",
    title: "Next Steps",
    description:
      "Use the sensor selector to switch monitored locations loaded from the database. Use the scenario toggle to preview 2h, 4h, 6h, and 8h outcomes if current conditions persist. Open the Sensor Dashboard for more detailed technical readings and logs. Open Admin Sensors to manage sensor coordinates and status. Open Admin Alerts to manage alert thresholds and notifications.",
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};


export default function DashboardTutorialModal({ open, onClose }: Props) {
  const [stepIndex, setStepIndex] = useState(0);

  const currentStep = useMemo(() => STEPS[stepIndex] ?? null, [stepIndex]);

  useEffect(() => {
    if (!open) {
      return;
    }
  }, [open]);

  function markSeen() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_TUTORIAL_SEEN, "true");
    }
  }

  function handleClose() {
    markSeen();
    onClose();
  }

  function handleNext() {
    if (stepIndex >= STEPS.length - 1) {
      handleClose();
      return;
    }
    setStepIndex((prev) => prev + 1);
  }

  function handleBack() {
    if (stepIndex <= 0) return;
    setStepIndex((prev) => prev - 1);
  }

  function focusSection() {
    if (!currentStep || typeof window === "undefined") return;

    const el = document.querySelector(
      `[data-tour="${currentStep.key}"]`
    ) as HTMLElement | null;

    if (!el) return;

    el.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    el.classList.add("ring-4", "ring-blue-300", "ring-offset-2", "ring-offset-white");

    window.setTimeout(() => {
      el.classList.remove(
        "ring-4",
        "ring-blue-300",
        "ring-offset-2",
        "ring-offset-white"
      );
    }, 1800);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[3100] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-zinc-200">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-zinc-900">
              Dashboard Tutorial
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Learn the main parts of the public flood monitoring dashboard.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Close tutorial"
          >
            ✕
          </button>
        </div>

        <div className="p-5 sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Step {stepIndex + 1} of {STEPS.length}
          </div>

          <div className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">
            {currentStep?.title}
          </div>

          <div className="mt-3 text-sm leading-7 text-zinc-700">
            {currentStep?.description}
          </div>

          <div className="mt-5 rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              What this helps with
            </div>
            <div className="mt-2 text-sm text-zinc-700">
              This step helps users understand how to read the dashboard quickly
              and where to look for important information.
            </div>
          </div>

          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Steps
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {STEPS.map((step, index) => {
                const active = index === stepIndex;

                return (
                  <button
                    key={step.key}
                    type="button"
                    onClick={() => setStepIndex(index)}
                    className={`rounded-2xl px-4 py-3 text-left transition ${
                      active
                        ? "bg-zinc-900 text-white"
                        : "bg-white text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50"
                    }`}
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-80">
                      Step {index + 1}
                    </div>
                    <div className="mt-1 text-sm font-bold">{step.title}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={focusSection}
              className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
            >
              Show me this section
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              >
                Skip
              </button>

              <button
                type="button"
                onClick={handleBack}
                disabled={stepIndex === 0}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Back
              </button>

              <button
                type="button"
                onClick={handleNext}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
              >
                {stepIndex === STEPS.length - 1 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}