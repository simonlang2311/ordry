export const FONT_MAP: Record<string, string> = {
  geist: "var(--font-geist-sans)",
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  inter: "Inter, var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  aptos: "Aptos, Calibri, 'Segoe UI', Arial, sans-serif",
  avenir: "'Avenir Next', Avenir, Montserrat, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Times New Roman', Times, serif",
  garamond: "Garamond, 'EB Garamond', 'Times New Roman', serif",
  palatino: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
  didot: "Didot, 'Bodoni 72', 'Bodoni MT', Georgia, serif",
  rounded: "'Trebuchet MS', 'Avenir Next', 'Segoe UI', sans-serif",
  friendly: "'Gill Sans', 'Gill Sans MT', Calibri, 'Trebuchet MS', sans-serif",
  slab: "Rockwell, 'Roboto Slab', 'Courier New', serif",
  condensed: "'Arial Narrow', 'Helvetica Neue Condensed', 'Roboto Condensed', Arial, sans-serif",
  mono: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
};

export const FONT_OPTIONS = [
  { key: "geist", label: "Geist" },
  { key: "system", label: "System Sans" },
  { key: "inter", label: "Inter" },
  { key: "aptos", label: "Aptos" },
  { key: "avenir", label: "Avenir Next" },
  { key: "rounded", label: "Rounded Sans" },
  { key: "friendly", label: "Gill Sans" },
  { key: "serif", label: "Georgia" },
  { key: "garamond", label: "Garamond" },
  { key: "palatino", label: "Palatino" },
  { key: "didot", label: "Didot" },
  { key: "slab", label: "Rockwell" },
  { key: "condensed", label: "Arial Narrow" },
  { key: "mono", label: "Monospace" },
];

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

export type ThemeColors = CustomThemeColors & {
  text: string;
  muted: string;
};

export const THEME_COLOR_MAP: Record<string, ThemeColors> = {
  classic: {
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#1e293b",
    muted: "#64748b",
    primary: "#d97706",
    accent: "#15803d",
  },
  futuristic: {
    background: "#ffffff",
    surface: "#f5f5f5",
    text: "#333333",
    muted: "#666666",
    primary: "#6b7280",
    accent: "#374151",
  },
  ordry: {
    background: "#f8f9fa",
    surface: "#ffffff",
    text: "#275D7B",
    muted: "#2D7596",
    primary: "#358BB2",
    accent: "#FF6633",
  },
  retro_menu: {
    background: "#ead7cf",
    surface: "#f3e6c8",
    text: "#5b4b3d",
    muted: "#8f775f",
    primary: "#2e4fa6",
    accent: "#ead7cf",
  },
  soft_menu: {
    background: "#efefef",
    surface: "#f7f7f7",
    text: "#111111",
    muted: "#6b6b6b",
    primary: "#111111",
    accent: "#178c52",
  },
  modern: {
    background: "#efe9dd",
    surface: "#f7f2e8",
    text: "#5f5a53",
    muted: "#7f766b",
    primary: "#8b8278",
    accent: "#6f665c",
  },
};

export const CUSTOM_THEME_FIELDS: Array<{ key: keyof CustomThemeColors; label: string }> = [
  { key: "background", label: "Hintergrund" },
  { key: "surface", label: "Karten" },
  { key: "primary", label: "Hauptfarbe" },
  { key: "accent", label: "Akzent" },
];

const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16) / 255,
    g: parseInt(value.slice(2, 4), 16) / 255,
    b: parseInt(value.slice(4, 6), 16) / 255,
  };
};

const toLinear = (value: number) =>
  value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

export const getContrastRatio = (foreground: string, background: string) => {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const fgLum = 0.2126 * toLinear(fg.r) + 0.7152 * toLinear(fg.g) + 0.0722 * toLinear(fg.b);
  const bgLum = 0.2126 * toLinear(bg.r) + 0.7152 * toLinear(bg.g) + 0.0722 * toLinear(bg.b);
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  return (lighter + 0.05) / (darker + 0.05);
};

export type ContrastCheck = {
  label: string;
  foreground: string;
  background: string;
  ratio: number;
  required: number;
  passed: boolean;
};

export const validateCustomThemeContrast = (colors: CustomThemeColors): ContrastCheck[] => {
  const checks = [
    { label: "Text auf Hintergrund", foreground: colors.primary, background: colors.background, required: 4.5 },
    { label: "Text auf Karten", foreground: colors.primary, background: colors.surface, required: 4.5 },
    { label: "Akzent/Hinweise auf Hintergrund", foreground: colors.accent, background: colors.background, required: 3 },
    { label: "Akzent/Hinweise auf Karten", foreground: colors.accent, background: colors.surface, required: 3 },
    { label: "Weiße Schrift auf Hauptfarbe", foreground: "#ffffff", background: colors.primary, required: 4.5 },
    { label: "Weiße Schrift auf Akzentfarbe", foreground: "#ffffff", background: colors.accent, required: 4.5 },
  ];

  return checks.map((check) => {
    const ratio = getContrastRatio(check.foreground, check.background);
    return {
      ...check,
      ratio,
      passed: ratio >= check.required,
    };
  });
};

const passesAgainstSurfaces = (color: string, surfaces: string[], required: number) =>
  surfaces.every((surface) => getContrastRatio(color, surface) >= required);

const firstReadableColor = (candidates: string[], surfaces: string[], required: number) =>
  candidates.find((color) => passesAgainstSurfaces(color, surfaces, required)) ||
  (passesAgainstSurfaces("#111111", surfaces, required) ? "#111111" : "#ffffff");

const firstWhiteReadableColor = (candidates: string[], fallback: string) =>
  candidates.find((color) => getContrastRatio("#ffffff", color) >= 4.5) || fallback;

const setImportantCssVar = (name: string, value: string) => {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty(name, value, "important");
};

export const getThemeColors = (theme: string, customColors = DEFAULT_CUSTOM_THEME_COLORS): ThemeColors => {
  if (theme === "custom") {
    return {
      background: customColors.background,
      surface: customColors.surface,
      text: customColors.primary,
      muted: customColors.accent,
      primary: customColors.primary,
      accent: customColors.accent,
    };
  }

  return THEME_COLOR_MAP[theme] || THEME_COLOR_MAP.modern;
};

export const resolveAccessibleThemeColors = (theme: string, customColors = DEFAULT_CUSTOM_THEME_COLORS): ThemeColors => {
  const colors = getThemeColors(theme, customColors);
  const textSurfaces = [colors.background, colors.surface];
  const textCandidates = [colors.text, colors.primary, colors.accent, colors.muted, "#111111", "#ffffff"];
  const text = firstReadableColor(textCandidates, textSurfaces, 4.5);
  const muted = firstReadableColor([colors.muted, colors.accent, text, colors.primary, "#111111", "#ffffff"], textSurfaces, 3);
  const primary = firstWhiteReadableColor([colors.primary, text, colors.muted, colors.accent, "#111111"], text);
  const accent = firstWhiteReadableColor([colors.accent, colors.primary, text, colors.muted, "#111111"], primary);

  return {
    ...colors,
    text,
    muted,
    primary,
    accent,
  };
};

export const applyAccessibleThemeColors = (theme: string, customColors = DEFAULT_CUSTOM_THEME_COLORS) => {
  const colors = resolveAccessibleThemeColors(theme, customColors);
  setImportantCssVar("--bg-main", colors.background);
  setImportantCssVar("--bg-card", colors.surface);
  setImportantCssVar("--text-main", colors.text);
  setImportantCssVar("--text-muted", colors.muted);
  setImportantCssVar("--primary", colors.primary);
  setImportantCssVar("--accent", colors.accent);
  setImportantCssVar("--scrollbar", colors.accent);
};

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
  root.style.setProperty("--custom-bg-main", colors.background, "important");
  root.style.setProperty("--custom-bg-card", colors.surface, "important");
  root.style.setProperty("--custom-text-main", colors.primary, "important");
  root.style.setProperty("--custom-text-muted", colors.accent, "important");
  root.style.setProperty("--custom-primary", colors.primary, "important");
  root.style.setProperty("--custom-accent", colors.accent, "important");
  root.style.setProperty("--custom-scrollbar", colors.accent, "important");
  applyAccessibleThemeColors("custom", colors);
};
