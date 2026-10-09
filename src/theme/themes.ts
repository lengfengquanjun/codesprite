export type ThemeDecoration = "ocean" | "nebula" | "winter" | "summer";
export type ThemeMotion = "calm" | "lively";

export interface ThemeManifest {
  id: string;
  name: string;
  icon: string;
  description: string;
  renderer: "water-orb" | "pet";
  decoration: ThemeDecoration;
  motion: ThemeMotion;
  tokens: Record<string, string>;
}

const sharedTokens = {
  "font-ui": 'Inter, "Microsoft YaHei UI", sans-serif',
  "font-code": '"JetBrains Mono", Consolas, monospace',
  "orb-size": "88px",
};

export const THEMES: ThemeManifest[] = [
  {
    id: "aqua-glass",
    name: "深海玻璃",
    icon: "◉",
    description: "通透、安静的默认水球",
    renderer: "water-orb",
    decoration: "ocean",
    motion: "calm",
    tokens: {
      ...sharedTokens,
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
    icon: "✦",
    description: "流动星尘与紫色辉光",
    renderer: "water-orb",
    decoration: "nebula",
    motion: "lively",
    tokens: {
      ...sharedTokens,
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
      "orb-water-top": "rgba(255, 139, 216, 0.82)",
      "orb-water-bottom": "rgba(115, 79, 224, 0.98)",
      "orb-core": "rgba(25, 12, 54, 0.9)",
      "orb-glow": "rgba(182, 156, 255, 0.34)",
      "radius-panel": "16px",
      "radius-control": "10px",
    },
  },
  {
    id: "winter-frost",
    name: "冬日霜晶",
    icon: "❄",
    description: "结霜边缘、雪粒和冰蓝水体",
    renderer: "water-orb",
    decoration: "winter",
    motion: "calm",
    tokens: {
      ...sharedTokens,
      "text-primary": "#f3fbff",
      "text-muted": "#a8bed2",
      "accent": "#b8efff",
      "accent-secondary": "#80d7ff",
      "accent-tertiary": "#d8c9ff",
      "danger": "#ff7794",
      "warning": "#ffe09a",
      "surface": "rgba(13, 35, 55, 0.95)",
      "surface-soft": "rgba(40, 75, 99, 0.55)",
      "surface-input": "rgba(7, 24, 40, 0.86)",
      "line": "rgba(197, 239, 255, 0.3)",
      "shadow": "rgba(3, 16, 28, 0.48)",
      "orb-water-top": "rgba(205, 250, 255, 0.9)",
      "orb-water-bottom": "rgba(81, 169, 218, 0.98)",
      "orb-core": "rgba(10, 35, 55, 0.9)",
      "orb-glow": "rgba(183, 239, 255, 0.44)",
      "radius-panel": "18px",
      "radius-control": "10px",
    },
  },
  {
    id: "summer-garden",
    name: "盛夏青柠",
    icon: "☀",
    description: "阳光、高光气泡与嫩绿叶片",
    renderer: "water-orb",
    decoration: "summer",
    motion: "lively",
    tokens: {
      ...sharedTokens,
      "text-primary": "#f3fff3",
      "text-muted": "#a9c8b0",
      "accent": "#7ef7c4",
      "accent-secondary": "#d8ed69",
      "accent-tertiary": "#51dbe4",
      "danger": "#ff7786",
      "warning": "#ffd75f",
      "surface": "rgba(10, 43, 40, 0.95)",
      "surface-soft": "rgba(34, 83, 64, 0.55)",
      "surface-input": "rgba(5, 29, 29, 0.86)",
      "line": "rgba(145, 241, 189, 0.27)",
      "shadow": "rgba(2, 23, 19, 0.46)",
      "orb-water-top": "rgba(151, 255, 194, 0.88)",
      "orb-water-bottom": "rgba(24, 167, 149, 0.98)",
      "orb-core": "rgba(7, 43, 42, 0.9)",
      "orb-glow": "rgba(126, 247, 196, 0.4)",
      "radius-panel": "14px",
      "radius-control": "9px",
    },
  },
];

export function applyTheme(themeId: string): ThemeManifest {
  const theme = THEMES.find(item => item.id === themeId) ?? THEMES[0];
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  root.dataset.renderer = theme.renderer;
  root.dataset.decoration = theme.decoration;
  root.dataset.motion = theme.motion;
  Object.entries(theme.tokens).forEach(([name, value]) => root.style.setProperty(`--${name}`, value));
  return theme;
}
