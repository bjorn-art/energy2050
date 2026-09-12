import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "New Energy 2050",
  description: "Energy asset investment simulation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
