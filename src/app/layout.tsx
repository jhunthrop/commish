import type { Metadata } from "next";
import { Saira, Saira_Condensed } from "next/font/google";
import { ThemeProvider } from "@/design/theme-provider";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
import { TITLE_TEMPLATE } from "@/components/app-shell/page-metadata";
import "./globals.css";

/**
 * SUNDAY v5, law 3. Condensed is load-bearing, not decorative: it is what buys ten columns at
 * 18px on a board, which is the whole reason a timing tower reads as sport and a spreadsheet
 * does not. Replacing this with a normal-width face silently breaks the law.
 *
 * `Saira_Condensed` carries every name, number and label. `Saira` carries the few sentences the
 * product still has, and doubles as the numeric face because it ships true tabular figures.
 */
const sairaCondensed = Saira_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const saira = Saira({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  // A5/N11: every page used to render with `document.title = "Commish"` — this template is the
  // one place the " · Commish" suffix is assembled (`pageTitle`, `@/components/app-shell/page-
  // metadata`); a page that sets its own `metadata.title` gets it appended automatically, and a
  // page that sets none (the front door itself) falls back to `default` below, unchanged from
  // before this task.
  title: { default: "Commish", template: TITLE_TEMPLATE },
  description: "Season-long fantasy football, done right.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sairaCondensed.variable} ${saira.variable} antialiased`}>
        <ThemeProvider>
          {/* Plan D Task 9: the notices hook's state moved here so it outlives every
              client-side navigation instead of remounting per page (ruling 19). Renders no UI
              of its own — every page in the product mounts through this layout, including the
              draft room (no `TopBar`) and the invite page's signed-out half, so this can
              only ever be provider logic. See `notices-provider.tsx`'s own docblock. */}
          <NoticesProvider>{children}</NoticesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
