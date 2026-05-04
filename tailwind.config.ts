import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- 1. DEINE FESTE ORDRY PALETTE ---
        // Diese Farben sind immer gleich, egal welches Theme aktiv ist.
        // Du kannst sie nutzen mit: bg-ordry-dark, text-ordry-orange usw.
        ordry: {
          dark: '#275D7B',      // Hauptfarbe (Dunkelblau)
          medium: '#2D7596',    // Mittelblau
          light: '#358BB2',     // Hellblau
          orange: '#FF6633',    // Akzent Orange
          bg: '#f8f9fa',        // Heller Hintergrund
        },

        // --- 2. DIE LOGIK FÜR DAS THEME-SYSTEM ---
        // Diese Farben ändern sich automatisch (Modern/Classic/Ordry),
        // weil sie auf die Variablen in globals.css zeigen.
        'app-bg': 'var(--bg-main)',
        'app-card': 'var(--bg-card)',
        'app-text': 'var(--text-main)',
        'app-muted': 'var(--text-muted)',
        'app-primary': 'var(--primary)',
        'app-accent': 'var(--accent)',
        'app-danger': 'var(--danger)',
      },
      fontFamily: {
        sans: ['var(--app-font-sans)', 'var(--font-geist-sans)', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
};
export default config;