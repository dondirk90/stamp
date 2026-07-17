export const Brand = {
  cream: "#f7f1e8",
  creamStrong: "#efe4d5",
  sand: "#dcc8b1",
  cocoa: "#4a3124",
  espresso: "#2d1d14",
  latte: "#8d6d59",
  line: "rgba(74, 49, 36, 0.12)",
  white: "#fffdfa",
};

export const AppTheme = {
  background: Brand.cream,
  surface: Brand.white,
  surfaceMuted: "#f3eadf",
  text: Brand.espresso,
  textMuted: "rgba(45, 29, 20, 0.68)",
  accent: Brand.cocoa,
  accentSoft: "#6c4a38",
  border: Brand.line,
  success: "#58704c",
};

export const Colors = {
  light: {
    text: AppTheme.text,
    background: AppTheme.background,
    tint: AppTheme.accent,
    icon: AppTheme.textMuted,
    tabIconDefault: AppTheme.textMuted,
    tabIconSelected: AppTheme.accent,
    surface: AppTheme.surface,
    border: AppTheme.border,
  },
  dark: {
    text: AppTheme.text,
    background: AppTheme.background,
    tint: AppTheme.accent,
    icon: AppTheme.textMuted,
    tabIconDefault: AppTheme.textMuted,
    tabIconSelected: AppTheme.accent,
    surface: AppTheme.surface,
    border: AppTheme.border,
  },
};

export const Type = {
  display: 40,
  title: 28,
  section: 20,
  body: 16,
  meta: 13,
  micro: 11,
};
