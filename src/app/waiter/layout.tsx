import type { ReactNode } from "react";
import { notFound } from "next/navigation";

export default function LegacyWaiterLayout({ children: _children }: { children: ReactNode }) {
  void _children;
  notFound();
}
