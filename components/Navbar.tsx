"use client";

import Link from "next/link";
import Image from "next/image";

export default function Navbar() {
  return (
    <nav className="sticky top-0 z-[1100] border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center px-3 py-3 sm:px-4">
        
        {/* Logo / Brand */}
        <Link
          href="/dashboard"
          className="flex items-center gap-3"
        >
          {/* Logo Image */}
          <Image
            src="/flood-icon.png"
            alt="Batangas City Flood Visualizer"
            width={40}
            height={40}
            className="rounded-full"
            priority
          />

          {/* Text */}
          <div>
            <div className="text-sm font-extrabold text-zinc-900 sm:text-base">
              Flood Visualizer
            </div>
            <div className="text-[11px] text-zinc-500">
              Batangas Flood Monitoring
            </div>
          </div>
        </Link>

      </div>
    </nav>
  );
}