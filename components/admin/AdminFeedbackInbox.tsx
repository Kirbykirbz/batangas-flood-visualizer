"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  listFeedbackMessages,
  updateFeedbackStatus,
  type FeedbackMessageRecord,
} from "@/app/lib/feedbackRepo";

function fmtTime(ts: string | null) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function statusClasses(status: FeedbackMessageRecord["status"]) {
  switch (status) {
    case "resolved":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    case "read":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    default:
      return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  }
}

function InboxIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 4h16v12H15l-3 3-3-3H4z" />
    </svg>
  );
}

function FeedbackModal({
  message,
  updatingId,
  onClose,
  onStatusChange,
}: {
  message: FeedbackMessageRecord;
  updatingId: number | null;
  onClose: () => void;
  onStatusChange: (id: number, status: FeedbackMessageRecord["status"]) => Promise<void>;
}) {
  return createPortal(
    <div className="fixed inset-0 z-[9999]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="absolute inset-0 overflow-y-auto">
        <div className="flex min-h-full items-start justify-center px-4 pb-6 pt-24 sm:px-6 sm:pt-28 md:pt-32">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-zinc-200">
            <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
              <div className="min-w-0">
                <div className="break-words text-lg font-extrabold text-zinc-900">
                  {message.subject?.trim() || "No subject"}
                </div>
                <div className="mt-1 break-words text-sm text-zinc-500">
                  {message.name?.trim() || "Anonymous"}
                  {message.email ? ` • ${message.email}` : ""}
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {fmtTime(message.created_at)}
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
              >
                ✕
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto px-5 py-5">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(
                    message.status
                  )}`}
                >
                  {message.status.toUpperCase()}
                </span>

                {message.resolved_at && (
                  <span className="text-xs text-zinc-500">
                    Resolved: {fmtTime(message.resolved_at)}
                  </span>
                )}
              </div>

              <div className="rounded-2xl bg-zinc-50 p-4 ring-1 ring-zinc-200">
                <div className="text-xs font-semibold text-zinc-500">Message</div>
                <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-zinc-800">
                  {message.message}
                </div>
              </div>
            </div>

            <div className="border-t border-zinc-200 bg-white px-5 py-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={updatingId === message.id}
                  onClick={() => onStatusChange(message.id, "read")}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                >
                  Mark Read
                </button>

                <button
                  type="button"
                  disabled={updatingId === message.id}
                  onClick={() => onStatusChange(message.id, "resolved")}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
                >
                  Resolve
                </button>

                <button
                  type="button"
                  disabled={updatingId === message.id}
                  onClick={() => onStatusChange(message.id, "new")}
                  className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-60"
                >
                  Mark New
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="ml-auto rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-bold text-zinc-800 hover:bg-zinc-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function AdminFeedbackInbox() {
  const [messages, setMessages] = useState<FeedbackMessageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<FeedbackMessageRecord | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);

  const rootRef = useRef<HTMLDivElement | null>(null);

  async function loadMessages() {
    try {
      setLoading(true);
      const rows = await listFeedbackMessages(50);
      setMessages(rows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMessages();
    const id = window.setInterval(loadMessages, 15000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }

    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dropdownOpen]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDropdownOpen(false);
        setSelectedMessage(null);
      }
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const unreadCount = useMemo(() => {
    return messages.filter((m) => m.status === "new").length;
  }, [messages]);

  const recentMessages = useMemo(() => {
    return messages.slice(0, 12);
  }, [messages]);

  async function handleStatusChange(
    id: number,
    status: FeedbackMessageRecord["status"]
  ) {
    try {
      setUpdatingId(id);
      await updateFeedbackStatus(id, status);
      await loadMessages();

      setSelectedMessage((prev) => {
        if (!prev || prev.id !== id) return prev;
        return {
          ...prev,
          status,
          resolved_at:
            status === "resolved"
              ? new Date().toISOString()
              : status === "new"
              ? null
              : prev.resolved_at,
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update message.");
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleOpenMessage(message: FeedbackMessageRecord) {
    setSelectedMessage(message);
    setDropdownOpen(false);

    if (message.status === "new") {
      try {
        await updateFeedbackStatus(message.id, "read");
        await loadMessages();
        setSelectedMessage({
          ...message,
          status: "read",
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to open message.");
      }
    }
  }

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          type="button"
          onClick={() => setDropdownOpen((v) => !v)}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:bg-zinc-50"
          aria-label="Open feedback inbox"
          title="Feedback inbox"
        >
          <InboxIcon />

          {unreadCount > 0 && (
            <>
              <span className="absolute right-1.5 top-1.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-white" />
              <span className="absolute -right-1 -top-1 min-w-[1.15rem] rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            </>
          )}
        </button>

        {dropdownOpen && (
          <div className="absolute right-0 top-14 z-[3200] w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <div>
                <div className="text-sm font-extrabold text-zinc-900">Feedback Inbox</div>
                <div className="text-xs text-zinc-500">
                  Recent messages from public users
                </div>
              </div>

              <button
                type="button"
                onClick={loadMessages}
                className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-600 hover:bg-zinc-100"
              >
                Refresh
              </button>
            </div>

            {error && (
              <div className="border-b border-zinc-200 bg-red-50 px-4 py-3 text-xs text-red-700">
                {error}
              </div>
            )}

            {loading ? (
              <div className="px-4 py-6 text-sm text-zinc-500">Loading messages…</div>
            ) : recentMessages.length === 0 ? (
              <div className="px-4 py-6 text-sm text-zinc-500">No messages yet.</div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                {recentMessages.map((message) => (
                  <button
                    key={message.id}
                    type="button"
                    onClick={() => handleOpenMessage(message)}
                    className="block w-full border-b border-zinc-100 px-4 py-3 text-left transition hover:bg-zinc-50"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-bold text-zinc-900">
                          {message.subject?.trim() || "No subject"}
                        </div>
                        <div className="mt-1 truncate text-xs text-zinc-500">
                          {message.name?.trim() || "Anonymous"}
                          {message.email ? ` • ${message.email}` : ""}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${statusClasses(
                          message.status
                        )}`}
                      >
                        {message.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="mt-2 line-clamp-2 text-sm text-zinc-700">
                      {message.message}
                    </div>

                    <div className="mt-2 text-xs text-zinc-500">
                      {fmtTime(message.created_at)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedMessage && (
        <FeedbackModal
          message={selectedMessage}
          updatingId={updatingId}
          onClose={() => setSelectedMessage(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </>
  );
}