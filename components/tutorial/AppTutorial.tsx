"use client";

import { useEffect, useMemo, useState } from "react";

type TutorialStep = {
  key: string;
  title: string;
  description: string;
};

const STORAGE_KEY_TUTORIAL_SEEN = "flood_tutorial_seen_v1";

const STEPS: TutorialStep[] = [
  {
    key: "navbar-menu",
    title: "Navigation Menu",
    description:
      "Open this menu to move between the main dashboard, rain events, and the sensor dashboard. Admin users also get access to admin tools here.",
  },
  {
    key: "sensor-selector",
    title: "Sensor Selection",
    description:
      "Choose which monitored sensor location you want to inspect. If location access is allowed, the system can help you focus on the nearest sensor.",
  },
  {
    key: "scenario-horizon",
    title: "Scenario Horizon",
    description:
      "Switch between current conditions and short scenario projections such as 2h, 4h, 6h, and 8h if the current rainfall state continues.",
  },
  {
    key: "summary-cards",
    title: "Summary Cards",
    description:
      "These cards summarize current rain, flood depth, warning level, and online sensors for quick public viewing.",
  },
  {
    key: "map",
    title: "Flood Map",
    description:
      "This map shows the monitored sensor locations and helps users visually understand the selected area and sensor placement.",
  },
  {
    key: "next-steps",
    title: "Next Steps",
    description:
      "Use this section as a quick guide for what to do next, including opening the sensor dashboard for more detailed readings.",
  },
];

type RectState = {
  top: number;
  left: number;
  width: number;
  height: number;
} | null;

export default function AppTutorial() {
  const [open, setOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [rect, setRect] = useState<RectState>(null);
  const [isMobile, setIsMobile] = useState(false);

  const currentStep = useMemo(
    () => (stepIndex >= 0 ? STEPS[stepIndex] ?? null : null),
    [stepIndex]
  );

  function openWelcome() {
    setOpen(true);
    setStepIndex(-1);
  }

  function finishTutorial() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY_TUTORIAL_SEEN, "true");
    }
    setOpen(false);
    setStepIndex(-1);
    setRect(null);
  }

  function skipTutorial() {
    finishTutorial();
  }

  function startTutorial() {
    setStepIndex(0);
  }

  function nextStep() {
    if (stepIndex >= STEPS.length - 1) {
      finishTutorial();
      return;
    }
    setStepIndex((prev) => prev + 1);
  }

  function prevStep() {
    if (stepIndex <= 0) {
      setStepIndex(-1);
      return;
    }
    setStepIndex((prev) => prev - 1);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;

    const rafId = window.requestAnimationFrame(() => {
      const seen = window.localStorage.getItem(STORAGE_KEY_TUTORIAL_SEEN);
      if (!seen) {
        openWelcome();
      }
    });

    const handleOpenTutorial = () => {
      openWelcome();
    };

    window.addEventListener("open-app-tutorial", handleOpenTutorial as EventListener);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener(
        "open-app-tutorial",
        handleOpenTutorial as EventListener
      );
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const updateViewportFlags = () => {
      setIsMobile(window.innerWidth < 768);
    };

    const rafId = window.requestAnimationFrame(updateViewportFlags);
    window.addEventListener("resize", updateViewportFlags);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateViewportFlags);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !open || !currentStep) {
      return;
    }

    const updateRect = () => {
      const el = document.querySelector(
        `[data-tour="${currentStep.key}"]`
      ) as HTMLElement | null;

      if (!el) {
        setRect(null);
        return;
      }

      const r = el.getBoundingClientRect();

      setRect({
        top: r.top + window.scrollY,
        left: r.left + window.scrollX,
        width: r.width,
        height: r.height,
      });
    };

    const rafId = window.requestAnimationFrame(updateRect);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
      if (typeof window !== "undefined" && !(open && currentStep)) {
        setRect(null);
      }
    };
  }, [open, currentStep]);

  const showWelcome = stepIndex === -1;

  const desktopTooltipStyle =
    rect && typeof window !== "undefined" && !isMobile
      ? {
          top: Math.max(12, rect.top + rect.height + 12),
          left: Math.max(
            12,
            Math.min(rect.left, window.scrollX + window.innerWidth - 380)
          ),
        }
      : undefined;

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[4000] bg-black/40" />

      {showWelcome ? (
        <div className="fixed inset-0 z-[4010] flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-zinc-200 bg-white p-6 shadow-2xl">
            <div className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
              Welcome
            </div>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-zinc-900">
              Welcome to Flood Visualizer
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-6 text-zinc-700">
              <p>
                This dashboard helps users monitor rainfall, flood depth, warning
                level, and map-based sensor coverage for Batangas City.
              </p>
              <p>
                The short tutorial will show the main controls so first-time users
                can understand how to read the dashboard quickly.
              </p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={skipTutorial}
                className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={startTutorial}
                className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
              >
                Start Tour
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {!showWelcome && currentStep ? (
        <>
          {rect ? (
            <div
              className="pointer-events-none fixed z-[4010] rounded-2xl ring-4 ring-zinc-900/80 ring-offset-2 ring-offset-white transition-all"
              style={{
                top: rect.top - window.scrollY,
                left: rect.left - window.scrollX,
                width: rect.width,
                height: rect.height,
              }}
            />
          ) : null}

          {isMobile ? (
            <div className="fixed inset-x-0 bottom-0 z-[4020] p-3">
              <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl">
                <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Step {stepIndex + 1} of {STEPS.length}
                </div>
                <div className="mt-2 text-lg font-extrabold text-zinc-900">
                  {currentStep.title}
                </div>
                <div className="mt-2 text-sm leading-6 text-zinc-700">
                  {currentStep.description}
                </div>

                <div className="mt-5 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={skipTutorial}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                  >
                    Skip
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={prevStep}
                      className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
                    >
                      {stepIndex === STEPS.length - 1 ? "Finish" : "Next"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              className="absolute z-[4020] w-full max-w-sm rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl"
              style={desktopTooltipStyle}
            >
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Step {stepIndex + 1} of {STEPS.length}
              </div>
              <div className="mt-2 text-lg font-extrabold text-zinc-900">
                {currentStep.title}
              </div>
              <div className="mt-2 text-sm leading-6 text-zinc-700">
                {currentStep.description}
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={skipTutorial}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                >
                  Skip
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={prevStep}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={nextStep}
                    className="rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
                  >
                    {stepIndex === STEPS.length - 1 ? "Finish" : "Next"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}