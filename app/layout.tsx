import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource/barlow-condensed/400.css";
import "@fontsource/barlow-condensed/500.css";
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bharat Sangeet at UNC Chapel Hill",
  description: "UNC Chapel Hill's student community for Carnatic and Hindustani classical music.",
  icons: {
    icon: "/unc-bharat-sangeet-logo.jpg",
    apple: "/unc-bharat-sangeet-logo.jpg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /*
    THESIS: A living rehearsal measure replaces the generic dashboard grid.
    OWN-WORLD: Carolina blue, maroon, ivory, timing lines, squared controls, and condensed editorial display type.
    STORY: Visitors meet one pan-Indian classical community; members see scope, time, and next actions immediately.
    FIRST VIEWPORT: A score-index rail frames one dominant calendar measure and three operational beats.
    FORM: Rhythmic Floor Plan, grounded direction 3, seed 3e1205aa.
    FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
  */
  return <html lang="en"><body data-design-seed="3e1205aa">{children}</body></html>;
}
