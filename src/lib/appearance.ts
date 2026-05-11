export const FONT_MAP: Record<string, string> = {
  geist: "var(--font-geist-sans)",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  rounded: "'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

export type CustomThemeColors = {
  background: string;
  surface: string;
  primary: string;
  accent: string;
};

export const CUSTOM_THEME_SETTINGS_KEY = "custom_theme_colors";

export const DEFAULT_CUSTOM_THEME_COLORS: CustomThemeColors = {
  background: "#f8f9fa",
  surface: "#ffffff",
  primary: "#275D7B",
  accent: "#FF6633",
};

export const CUSTOM_THEME_FIELDS: Array<{ key: keyof CustomThemeColors; label: string }> = [
  { key: "background", label: "Hintergrund" },
  { key: "surface", label: "Karten" },
  { key: "primary", label: "Hauptfarbe" },
  { key: "accent", label: "Akzent" },
];

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

export const parseCustomThemeColors = (value?: string | null): CustomThemeColors => {
  if (!value) return DEFAULT_CUSTOM_THEME_COLORS;

  try {
    const parsed = JSON.parse(value) as Partial<CustomThemeColors>;
    return {
      background: isHexColor(parsed.background) ? parsed.background : DEFAULT_CUSTOM_THEME_COLORS.background,
      surface: isHexColor(parsed.surface) ? parsed.surface : DEFAULT_CUSTOM_THEME_COLORS.surface,
      primary: isHexColor(parsed.primary) ? parsed.primary : DEFAULT_CUSTOM_THEME_COLORS.primary,
      accent: isHexColor(parsed.accent) ? parsed.accent : DEFAULT_CUSTOM_THEME_COLORS.accent,
    };
  } catch {
    return DEFAULT_CUSTOM_THEME_COLORS;
  }
};

export const applyCustomThemeColors = (colors: CustomThemeColors) => {
  const root = document.documentElement;
  root.style.setProperty("--custom-bg-main", colors.background);
  root.style.setProperty("--custom-bg-card", colors.surface);
  root.style.setProperty("--custom-text-main", colors.primary);
  root.style.setProperty("--custom-text-muted", colors.accent);
  root.style.setProperty("--custom-primary", colors.primary);
  root.style.setProperty("--custom-accent", colors.accent);
  root.style.setProperty("--custom-scrollbar", colors.accent);
};
