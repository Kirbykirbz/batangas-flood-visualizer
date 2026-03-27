"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import AdminFeedbackInbox from "@/components/admin/AdminFeedbackInbox";
import AdminLoginModal from "@/components/auth/AdminLoginModal";
import {
  getCurrentSession,
  getCurrentUserRole,
  signOutUser,
} from "@/app/lib/authRepo";

function UserIcon() {
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
      <path d="M20 21a8 8 0 0 0-16 0" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function Navbar() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const menuRef = useRef<HTMLDivElement | null>(null);

  async function refreshAuthState() {
  try {
    const session = await getCurrentSession();
    const currentRole = await getCurrentUserRole();

    setIsLoggedIn(!!session?.user);
    setUserEmail(session?.user?.email ?? null);
    setRole(currentRole);
  } catch (err) {
    console.error("Failed to refresh auth state:", err);
    setIsLoggedIn(false);
    setUserEmail(null);
    setRole(null);
  }
}

  useEffect(() => {
    (async () => {
      await refreshAuthState();
    })();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    try {
      await signOutUser();
      setMenuOpen(false);
      await refreshAuthState();
    } catch (err) {
      console.error("Failed to sign out:", err);
    }
  }

  const isAdmin = role === "admin";

  return (
    <>
      <nav className="sticky top-0 z-[1100] border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <Image
              src="/flood-icon.png"
              alt="Batangas City Flood Visualizer"
              width={40}
              height={40}
              className="rounded-full"
              priority
            />

            <div>
              <div className="text-sm font-extrabold text-zinc-900 sm:text-base">
                Flood Visualizer
              </div>
              <div className="text-[11px] text-zinc-500">
                Batangas Flood Monitoring
              </div>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            {isAdmin && <AdminFeedbackInbox />}

            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                aria-label="Open user menu"
              >
                <UserIcon />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-14 z-[3200] w-64 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
                  <div className="border-b border-zinc-200 px-4 py-3">
                    {isLoggedIn ? (
                      <>
                        <div className="text-sm font-extrabold text-zinc-900">
                          {isAdmin ? "Admin Account" : "Signed In"}
                        </div>
                        <div className="mt-1 truncate text-xs text-zinc-500">
                          {userEmail ?? "No email"}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-extrabold text-zinc-900">
                          Guest User
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          Public dashboard access only
                        </div>
                      </>
                    )}
                  </div>

                  <div className="py-2">
                    <Link
                      href="/dashboard"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                    >
                      Dashboard
                    </Link>

                    <Link
  href="/dashboard/admin/events"
  onClick={() => setMenuOpen(false)}
  className="block px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
>
  Rain Events
</Link>

                    <Link
                      href="/dashboard/sensor"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                    >
                      Sensor Dashboard
                    </Link>

                    {isAdmin && (
                      <>
                        <div className="my-2 border-t border-zinc-100" />

                        <Link
                          href="/dashboard/admin/sensors"
                          onClick={() => setMenuOpen(false)}
                          className="block px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                        >
                          Admin Sensors
                        </Link>

                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            window.location.href = "/dashboard/admin";
                          }}
                          className="block w-full px-4 py-2 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                        >
                          Admin Dashboard
                        </button>
                      </>
                    )}

                    <div className="my-2 border-t border-zinc-100" />

                    {!isLoggedIn ? (
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setLoginOpen(true);
                        }}
                        className="block w-full px-4 py-2 text-left text-sm font-semibold text-blue-700 hover:bg-zinc-50"
                      >
                        Admin Sign In
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleSignOut}
                        className="block w-full px-4 py-2 text-left text-sm font-semibold text-red-700 hover:bg-zinc-50"
                      >
                        Sign Out
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <AdminLoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSuccess={refreshAuthState}
      />
    </>
  );
}