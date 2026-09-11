import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { ThemeProvider } from "@/design/theme-provider";
import { NoticesProvider } from "@/components/app-shell/notices-provider";
import { TITLE_TEMPLATE, TAGLINE } from "@/components/app-shell/page-metadata";
import "./globals.css";

/**
 * SIDELINE'S TWO FACES (founder chose the direction 2026-09-10). `Bricolage_Grotesque` carries
 * every name, number and header, loaded as the variable font WITH its optical-size axis: the
 * same file draws a calm 17px name on a row and an expressive 58px figure on a player's page,
 * and `globals.css`'s `.font-display` turns optical sizing on. `Figtree` carries sentences and
 * labels, and doubles as the numeric register with tabular figures on (`.font-mono`).
 *
 * Weights are the variable range, not a list: the display face is used at 600 to 800 and the
 * body at 400 to 600, and `weight-cap.source.test.ts` is what keeps a sentence from reaching
 * for 700.
 */
const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
});

const figtree = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // A5/N11: every page used to render with `document.title = "Commish"` — this template is the
  // one place the " · Commish" suffix is assembled (`pageTitle`, `@/components/app-shell/page-
  // metadata`); a page that sets its own `metadata.title` gets it appended automatically, and a
  // page that sets none (the front door itself) falls back to `default` below, unchanged from
  // before this task.
  title: { default: "Commish", template: TITLE_TEMPLATE },
  description: TAGLINE,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${bricolage.variable} ${figtree.variable} antialiased`}>
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
