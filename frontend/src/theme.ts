// Design tokens for Household Expense Tracker (dark, emerald).
export const theme = {
  colors: {
    bg: "#0C0D0F",
    surface: "#15171A",
    surface2: "#1F2227",
    text: "#F3F4F6",
    textMuted: "#9CA3AF",
    textDim: "#6B7280",
    brand: "#34D399",
    brandDim: "#064E3B",
    brandStrong: "#10B981",
    onBrand: "#022C1E",
    warn: "#FBBF24",
    error: "#F87171",
    border: "#262A31",
    borderStrong: "#373D47",
    divider: "#1A1D21",
  },
  radius: { sm: 6, md: 12, lg: 20, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  font: {
    body: "System",
    display: "System",
  },
};

export type Theme = typeof theme;
