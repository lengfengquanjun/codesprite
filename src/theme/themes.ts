export interface ThemeManifest {
  id: string;
  name: string;
  renderer: "water-orb" | "pet";
  tokens: Record<string, string>;
}

export const THEMES: ThemeManifest[] = [
  {
    id: "aqua-glass",
    name: "深海玻璃",
    renderer: "water-orb",
    tokens: {
      "font-ui": 'Inter, "Microsoft YaHei UI", sans-serif',
      "font-code": '"JetBrains Mono", Consolas, monospace',
      "text-primary": "#e8f7ff",
      "text-muted": "#91a6c8",
      "accent": "#55e4f4",
      "accent-secondary": "#60efce",
      "accent-tertiary": "#8f7bff",
      "danger": "#ff6c8d",
      "warning": "#ffc76b",
      "surface": "rgba(10, 24, 54, 0.94)",
      "surface-soft": "rgba(21, 38, 73, 0.52)",
      "surface-input": "rgba(5, 12, 28, 0.82)",
      "line": "rgba(130, 190, 235, 0.24)",
      "shadow": "rgba(0, 0, 0, 0.38)",
      "orb-size": "88px",
      "orb-water-top": "rgba(105, 240, 236, 0.82)",
      "orb-water-bottom": "rgba(37, 151, 214, 0.98)",
      "orb-core": "rgba(7, 17, 43, 0.88)",
      "orb-glow": "rgba(82, 222, 244, 0.3)",
      "radius-panel": "14px",
      "radius-control": "8px",
    },
  },
  {
    id: "violet-nebula",
    name: "紫雾星云",
    renderer: "water-orb",
    tokens: {
      "font-ui": 'Inter, "Microsoft YaHei UI", sans-serif',
      "font-code": '"JetBrains Mono", Consolas, monospace',
      "text-primary": "#f5f1ff",
      "text-muted": "#b1a6cf",
      "accent": "#b69cff",
      "accent-secondary": "#ff8bd8",
      "accent-tertiary": "#69ddeb",
      "danger": "#ff7893",
      "warning": "#ffd27a",
      "surface": "rgba(30, 19, 57, 0.95)",
      "surface-soft": "rgba(56, 35, 88, 0.55)",
      "surface-input": "rgba(19, 11, 38, 0.84)",
      "line": "rgba(198, 164, 255, 0.25)",
      "shadow": "rgba(10, 3, 24, 0.45)",
      "orb-size": "88px",
      "orb-water-top": "rgba(255, 139, 216, 0.82)",
      "orb-water-bottom": "rgba(115, 79, 224, 0.98)",
      "orb-core": "rgba(25, 12, 54, 0.9)",
      "orb-glow": "rgba(182, 156, 255, 0.34)",
      "radius-panel": "16px",
      "radius-control": "10px",
    },
  },
];

export function applyTheme(themeId: string): ThemeManifest {
  const theme = THEMES.find(item => item.id === themeId) ?? THEMES[0];
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.renderer = theme.renderer;
  Object.entries(theme.tokens).forEach(([name, value]) => root.style.setProperty(`--${name}`, value));
  return theme;
}

