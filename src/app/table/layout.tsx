import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export default function LegacyTableLayout({ children: _children }: { children: ReactNode }) {
  void _children;
  notFound();
}
