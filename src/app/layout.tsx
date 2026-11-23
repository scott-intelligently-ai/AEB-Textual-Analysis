import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense } from "react";
import { FeedbackProvider } from "@/components/feedback";
import { Nav, NavLinks } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Speech Text Analysis",
  description:
    "Turn scanned speeches into text, count the terms that matter, and record the tone of each use.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">
        <FeedbackProvider>
          <div className="flex min-h-screen">
            <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white px-3 py-5">
              <div className="mb-6 px-2.5">
                <p className="text-sm font-semibold tracking-tight text-zinc-900">
                  Speech Text Analysis
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">Terms, frequency, and tone</p>
              </div>
              <nav aria-label="Main">
                {/* The active link depends on the URL, which is only known per request. */}
                <Suspense fallback={<NavLinks pathname={null} />}>
                  <Nav />
                </Suspense>
              </nav>
            </aside>
            <main className="min-w-0 flex-1 px-8 py-8">
              <div className="mx-auto max-w-6xl">{children}</div>
            </main>
          </div>
        </FeedbackProvider>
      </body>
    </html>
  );
}
