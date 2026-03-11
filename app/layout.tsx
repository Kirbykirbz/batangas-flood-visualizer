import "./globals.css" with { type: "css" };

export const metadata = {
  title: "Community Flood Pathway Visualizer",
  description: "AIoT-based flood monitoring and visualization system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-100 text-gray-900">
        {children}
      </body>
    </html>
  );
}
