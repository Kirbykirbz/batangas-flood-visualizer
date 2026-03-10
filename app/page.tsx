import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 dark:bg-black font-sans">
      <main className="flex flex-col items-center justify-center gap-10 px-8 py-16 text-center sm:px-16 bg-white dark:bg-gray-900 rounded-lg shadow-lg max-w-3xl">
        
        {/* Logo / Icon */}
        <Image
  src="/flood-icon.png" // notice the leading slash
  alt="Flood Visualizer Logo"
  width={100}
  height={200}
  className="rounded-full border-2 border-blue-600"
  priority
/>


        {/* Title & Tagline */}
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-bold text-gray-900 dark:text-zinc-50">
            AIoT Flood Pathway Visualizer
          </h1>
          <p className="text-lg text-gray-600 dark:text-zinc-400 max-w-md">
            Monitor flood risks in your community in real-time, view water levels, rainfall trends, and predicted flood pathways.
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Dashboard Button */}
          <Link
            href="/dashboard"
            className="flex h-12 w-full sm:w-auto items-center justify-center rounded-full bg-blue-600 text-white px-6 text-lg font-semibold hover:bg-blue-700 transition"
          >
            Go to Dashboard
          </Link>

          {/* About / Info Button */}
          <Link
            href="/dashboard/about"
            className="flex h-12 w-full sm:w-auto items-center justify-center rounded-full border border-gray-300 px-6 text-lg font-semibold text-gray-700 hover:bg-gray-100 transition dark:border-gray-600 dark:text-zinc-50 dark:hover:bg-gray-800"
          >
            Learn More
          </Link>
        </div>
      </main>
    </div>
  );
}
