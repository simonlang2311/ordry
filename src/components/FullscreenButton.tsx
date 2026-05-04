"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function FullscreenButton() {
  const pathname = usePathname();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const isTablePage = /^\/([^/]+\/)?(table|t)\/[^/]+/.test(pathname || "");
  const isStaffPage = /^\/([^/]+\/)?(kitchen|bar|waiter)(\/.*)?$/.test(pathname || "");

  useEffect(() => {
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", updateFullscreenState);

    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!document.documentElement.requestFullscreen) {
      return;
    }

    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      return;
    }

    await document.exitFullscreen();
  };

  if (isTablePage) {
    return null;
  }

  const positionClass = isStaffPage
    ? "bottom-4 right-4 z-30"
    : "right-20 top-4 z-[1000]";

  return (
    <button
      type="button"
      onClick={toggleFullscreen}
      aria-label={isFullscreen ? "Vollbild beenden" : "Vollbildmodus starten"}
      title={isFullscreen ? "Vollbild beenden" : "Vollbildmodus"}
      className={`fixed ${positionClass} flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-black/20 text-white shadow-lg shadow-black/15 backdrop-blur-md transition hover:bg-black/30 focus:outline-none focus:ring-2 focus:ring-white/60`}
    >
      {isFullscreen ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path d="M9 4v5H4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 4v5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9 20v-5H4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 20v-5h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
          <path d="M8 4H4v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 4h4v4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 20H4v-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M16 20h4v-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
