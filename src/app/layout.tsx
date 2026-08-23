import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/design/theme-provider";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
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
  title: "Commish",
  description: "Season-long fantasy football, done right.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          {/* Plan D Task 9: the notices hook's state moved here so it outlives every
              client-side navigation instead of remounting per page (ruling 19). Renders no UI
              of its own — every page in the product mounts through this layout, including the
              draft room (no `AppHeader`) and the invite page's signed-out half, so this can
              only ever be provider logic. See `notices-provider.tsx`'s own docblock. */}
          <NoticesProvider>{children}</NoticesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
