"use client";

import { createPortal } from "react-dom";
import { useEffect } from "react";

type InstallAppModalProps = {
  open: boolean;
  installAvailable: boolean;
  installing?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
};

export default function InstallAppModal({
  open,
  installAvailable,
  installing = false,
  onClose,
  onConfirm,
}: InstallAppModalProps) {
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
        onClick={onClose}
      />

      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-end justify-center p-3 sm:items-center sm:p-6">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200 sm:rounded-3xl">
            <div className="border-b border-zinc-200 px-4 py-4 sm:px-5">
              <div className="text-base font-extrabold text-zinc-900 sm:text-lg">
                Install App
              </div>
              <div className="mt-1 text-sm text-zinc-600">
                Add Flood Visualizer to your device for faster access and a more
                app-like experience.
              </div>
            </div>

            <div className="px-4 py-4 sm:px-5">
              {installAvailable ? (
                <div className="space-y-3 text-sm leading-6 text-zinc-700">
                  <p>
                    This will let users open the system from the home screen like
                    a normal app.
                  </p>
                  <p>
                    On supported browsers, the device will show the native install
                    prompt after you continue.
                  </p>
                </div>
              ) : (
                <div className="space-y-3 text-sm leading-6 text-zinc-700">
                  <p>
                    Installation prompt is not available right now on this browser
                    or device state.
                  </p>
                  <p>
                    If you are on iPhone or iPad, use Safari and tap Share, then
                    choose <span className="font-semibold">Add to Home Screen</span>.
                  </p>
                  <p>
                    On Android Chrome, try reloading the page once and opening the
                    menu again.
                  </p>
                </div>
              )}
            </div>

            <div className="border-t border-zinc-200 px-4 py-4 sm:px-5">
              <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                >
                  Cancel
                </button>

                {installAvailable ? (
                  <button
                    type="button"
                    onClick={onConfirm}
                    disabled={installing}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {installing ? "Preparing..." : "Continue Install"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-bold text-white hover:bg-zinc-800"
                  >
                    Got it
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}