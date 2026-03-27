"use client";

import { useMemo, useState } from "react";
import { createFeedbackMessage } from "@/app/lib/feedbackRepo";

type SubmitState = "idle" | "submitting" | "success" | "error";

function MessageIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const isSubmitDisabled = useMemo(() => {
    return submitState === "submitting" || message.trim().length < 8;
  }, [submitState, message]);

  function resetForm() {
    setName("");
    setEmail("");
    setSubject("");
    setMessage("");
    setErrorMessage("");
    setSubmitState("idle");
  }

  function closeModal() {
    setOpen(false);
    setErrorMessage("");
    if (submitState === "success") {
      resetForm();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const trimmedMessage = message.trim();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();

    if (trimmedMessage.length < 8) {
      setSubmitState("error");
      setErrorMessage("Please enter a more detailed message.");
      return;
    }

    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setSubmitState("error");
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    try {
      setSubmitState("submitting");
      setErrorMessage("");

      await createFeedbackMessage({
        name: trimmedName || null,
        email: trimmedEmail || null,
        subject: trimmedSubject || null,
        message: trimmedMessage,
      });

      setSubmitState("success");
    } catch (err) {
      setSubmitState("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to send feedback.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (submitState === "success") {
            resetForm();
          }
        }}
        className="fixed bottom-5 right-5 z-[3000] inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
        aria-label="Open feedback form"
      >
        <MessageIcon />
        <span className="hidden sm:inline">Feedback</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[3100] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-extrabold text-zinc-900">Send feedback</h2>
                <p className="mt-1 text-sm text-zinc-600">
                  Share concerns, report issues, or send suggestions about the flood visualizer.
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
                aria-label="Close feedback form"
              >
                ✕
              </button>
            </div>

            {submitState === "success" ? (
              <div className="px-5 py-6">
                <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800 ring-1 ring-emerald-200">
                  Your message has been sent successfully.
                </div>

                <div className="mt-5 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setSubmitState("idle");
                    }}
                    className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                  >
                    Send another
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-5 py-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-semibold text-zinc-700">
                      Name
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-blue-500"
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-semibold text-zinc-700">
                      Email
                    </label>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Optional"
                      className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-blue-500"
                    />
                  </div>
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-semibold text-zinc-700">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Optional"
                    className="w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-blue-500"
                  />
                </div>

                <div className="mt-4">
                  <label className="mb-1 block text-sm font-semibold text-zinc-700">
                    Message
                  </label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={6}
                    placeholder="Tell us what happened, what you noticed, or what could be improved."
                    className="w-full resize-y rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-blue-500"
                  />
                  <div className="mt-1 text-xs text-zinc-500">
                    Minimum 8 characters.
                  </div>
                </div>

                {submitState === "error" && errorMessage && (
                  <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 ring-1 ring-red-200">
                    {errorMessage}
                  </div>
                )}

                <div className="mt-5 flex items-center justify-between gap-3">
                  <div className="text-xs text-zinc-500">
                    Your feedback will be sent to the system inbox for review.
                  </div>

                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={closeModal}
                      className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={isSubmitDisabled}
                      className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitState === "submitting" ? "Sending..." : "Send feedback"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}