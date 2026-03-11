"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navItems = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "Sensor Details", href: "/dashboard/sensor" },
  ];

  function isActive(href: string) {
    return pathname === href;
  }

  return (
    <nav className="sticky top-0 z-[1100] border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-3 py-3 sm:px-4">
        {/* Brand */}
        <Link
          href="/dashboard"
          className="min-w-0 flex items-center gap-2"
          onClick={() => setOpen(false)}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-sm font-extrabold text-white">
            FV
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-extrabold text-zinc-900 sm:text-base">
              Flood Visualizer
            </div>
            <div className="hidden text-[11px] text-zinc-500 sm:block">
              Batangas Flood Monitoring
            </div>
          </div>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-2 md:flex">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
                  active
                    ? "bg-zinc-900 text-white"
                    : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                {item.name}
              </Link>
            );
          })}
        </div>

        {/* Mobile menu button */}
        <button
          type="button"
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-bold text-zinc-800 shadow-sm hover:bg-zinc-50 md:hidden"
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="border-t border-zinc-200 bg-white md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col px-3 py-3">
            {navItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900"
                  }`}
                >
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </nav>
  );
}
