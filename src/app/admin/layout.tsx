import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export default function LegacyAdminLayout({ children: _children }: { children: ReactNode }) {
  void _children;
  notFound();
}
