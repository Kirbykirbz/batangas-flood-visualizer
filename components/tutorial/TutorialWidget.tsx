"use client";

import { useEffect, useMemo, useState } from "react";

type TutorialStep = {
  key: string;
  title: string;
  description: string;
};

const STORAGE_KEY_TUTORIAL_SEEN = "flood_tutorial_seen_v2";

const STEPS: TutorialStep[] = [
  {
    key: "navbar-menu",
    title: "Navigation Menu",
    description:
      "Open the user menu to access the main dashboard, rain events, sensor dashboard, installation, and admin tools if you are signed in as admin.",
  },
  {
    key: "sensor-selector",
    title: "Sensor Selection",
    description:
      "Use this selector to switch the monitored location. If location access is allowed, the system can help you focus on the nearest available sensor.",
  },
  {
    key: "scenario-horizon",
    title: "Scenario Horizon",
    description:
      "Switch between current conditions and short future scenarios such as 2h, 4h, 6h, and 8h if the present rainfall state continues.",
  },
  {
    key: "summary-cards",
    title: "Summary Cards",
    description:
      "These cards give a quick overview of rainfall, flood depth, warning level, and active sensors for the selected location.",
  },
  {
    key: "map",
    title: "Flood Map",
    description:
      "This map helps you understand the monitored sensor locations visually. You can use it to inspect the selected area and sensor placement.",
  },
  {
    key: "next-steps",
    title: "Next Steps",
    description:
      "This section gives simple guidance on what to do after reviewing the main dashboard, including opening the sensor dashboard for more detail.",
  },
];

type OpenSource = "auto" | "manual";

export default function TutorialWidget() {
  const [open, setOpen] = useState(false);
  const [openSource, setOpenSource] = useState<OpenSource>("manual");
  const [stepIndex, setStepIndex] = useState(0);

  const currentStep = useMemo(() => STEPS[stepIndex] ?? null, [stepIndex]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOpenTutorial = () => {
      setOpenSource("manual");
      setStepIndex(0);
      setOpen(true);
    };

    const rafId = window.requestAnimationFrame(() => {
      const seen = window.localStorage.getItem(STORAGE_KEY_TUTORIAL_SEEN);
      if (!seen) {
        setOpenSource("auto");
        setStepIndex(0);
        setOpen(true);
      }
    });

    window.addEventListener("open-app-tutorial", handleOpenTutorial as EventListener);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener(
        "open-app-tutorial",
        handleOpenTutorial as EventListener
      );
    };
  }, []);

  function markSeen() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_TUTORIAL_SEEN, "true");
    }
  }

  function closeTutorial() {
    markSeen();
    setOpen(false);
  }

  function goNext() {
    if (stepIndex >= STEPS.length - 1) {
      closeTutorial();
      return;
    }
    setStepIndex((prev) => prev + 1);
  }

  function goBack() {
    if (stepIndex <= 0) return;
    setStepIndex((prev) => prev - 1);
  }

  function jumpToStep(index: number) {
    setStepIndex(index);
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
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-zinc-200">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-extrabold text-zinc-900">
              {openSource === "auto" && stepIndex === 0
                ? "Welcome to Flood Visualizer"
                : "Dashboard Tutorial"}
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              Learn the key parts of the public flood monitoring dashboard.
            </p>
          </div>

          <button
            type="button"
            onClick={closeTutorial}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Close tutorial"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-[240px_1fr]">
          <div className="border-b border-zinc-200 bg-zinc-50 md:border-b-0 md:border-r">
            <div className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Tutorial Steps
              </div>

              <div className="mt-3 space-y-2">
                {STEPS.map((step, index) => {
                  const active = index === stepIndex;

                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => jumpToStep(index)}
                      className={`w-full rounded-2xl px-3 py-3 text-left transition ${
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
                This step helps new users understand where to look and what each
                important dashboard section is for.
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={focusSection}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              >
                Focus This Section
              </button>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={closeTutorial}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                >
                  Skip
                </button>

                <button
                  type="button"
                  onClick={goBack}
                  disabled={stepIndex === 0}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Back
                </button>

                <button
                  type="button"
                  onClick={goNext}
                  className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
                >
                  {stepIndex === STEPS.length - 1 ? "Finish" : "Next"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}