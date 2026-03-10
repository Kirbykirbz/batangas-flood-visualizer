"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

export default function Navbar() {
  const pathname = usePathname();

  const navItems = [
    { name: "Dashboard", href: "/dashboard" },
    { name: "Sensor", href: "/dashboard/sensor" },
    { name: "Trends", href: "/dashboard/trends" },
    { name: "About", href: "/dashboard/about" },
  ];

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-md">
      <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
        
        {/* Logo / Brand */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="w-10 h-10">
          </div>
          <span className="font-bold text-xl text-gray-900 dark:text-zinc-50">
            Flood Visualizer
          </span>
        </Link>

        {/* Navigation Links */}
        <div className="flex items-center gap-6">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`relative px-3 py-2 text-gray-700 dark:text-gray-300 font-medium rounded-md transition-all
                  ${isActive ? "bg-blue-100 dark:bg-blue-700 text-blue-800 dark:text-white" : "hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white"}
                `}
              >
                {item.name}
                {isActive && (
                  <span className="absolute -bottom-1 left-0 right-0 h-1 bg-blue-600 rounded-full"></span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
