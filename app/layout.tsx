import type { Metadata, Viewport } from "next";
import "./globals.css";

import FeedbackWidget from "@/components/feedback/FeedbackWidget";
import InAppAlertEffects from "@/components/alerts/InAppAlertEffects";
import PWARegister from "@/components/pwa/PWARegister";


export const metadata: Metadata = {
  title: "Community Flood Pathway Visualizer",
  description: "IoT-based flood monitoring and visualization system",
  applicationName: "FloodMonitor",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FloodMonitor",
  },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-gray-100 text-gray-900">
        <PWARegister />
        
        {children}
        
       
        <FeedbackWidget />
        <InAppAlertEffects />
      </body>
    </html>
  );
}