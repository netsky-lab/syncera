import type { Metadata } from "next";
import { Inter_Tight, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";
import "highlight.js/styles/github-dark.css";
import { AppShell } from "@/components/app-shell";
import { verifySessionUser, COOKIE_NAME } from "@/lib/sessions";

const inter = Inter_Tight({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});
const instrumentSerif = Instrument_Serif({
  variable: "--font-source-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Syncera - verified research reports",
    template: "%s · Syncera",
  },
  description:
    "Open-source research engine: question-first decomposition, primary-source harvest, three-layer fact verifier (URL liveness → keyword substring → LLM adversarial review). Only verified facts make it into the final report.",
  openGraph: {
    title: "Syncera",
    description:
      "Question-first research engine with a three-layer fact verifier.",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const jar = await cookies();
  const viewerUid =
    verifySessionUser(jar.get(COOKIE_NAME)?.value)?.uid ?? null;

  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} ${instrumentSerif.variable} h-full antialiased dark`}
    >
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
      </head>
      <body className="min-h-full bg-ink-900 text-fg">
        {viewerUid ? <AppShell>{children}</AppShell> : children}
      </body>
    </html>
  );
}
