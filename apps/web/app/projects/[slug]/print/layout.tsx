import type { ReactNode } from "react";

// Minimal layout — no sidebar, no header. Used for PDF export.
export default function PrintLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
