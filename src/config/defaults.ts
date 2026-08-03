import type { AiProviderConfig, AppData, ToolDefinition } from "../core/types";
import { MIMO_PAY_AS_YOU_GO_URL } from "../ai/provider";

export const DEFAULT_AI_PROVIDER: AiProviderConfig = {
  id: "xiaomi-mimo",
  name: "小米 MiMo",
  protocol: "openai-chat",
  baseUrl: MIMO_PAY_AS_YOU_GO_URL,
  model: "mimo-v2.5-pro",
  timeoutMs: 20_000,
};

export const TOOL_REGISTRY: ToolDefinition[] = [
  { id: "naming", label: "变量命名", icon: "{}", window: { width: 760, height: 210, minWidth: 620, minHeight: 170, transparent: true } },
  { id: "clipboard", label: "剪贴板", icon: "▣", window: { width: 560, height: 440, minWidth: 440, minHeight: 320, transparent: true } },
  { id: "todo", label: "待办备忘", icon: "✓", window: { width: 720, height: 620, minWidth: 560, minHeight: 480, transparent: true } },
  { id: "workspace", label: "工作区", icon: "⌘", window: { width: 620, height: 480, minWidth: 480, minHeight: 340, transparent: true } },
  { id: "port", label: "端口进程", icon: ":_", window: { width: 520, height: 390, minWidth: 440, minHeight: 320, transparent: true } },
  { id: "settings", label: "设置", icon: "⚙", window: { width: 620, height: 560, minWidth: 500, minHeight: 420, transparent: true } },
];

export const WIDGET_LAYOUTS = {
  compact: { width: 120, height: 120 },
  metrics: { width: 360, height: 120 },
} as const;

/**
 * 功能球使用独立原生透明窗口，坐标相对中心水球的中心点。
 * 布局属于产品配置，不与 CSS 或 Rust 窗口代码耦合，后续主题可替换整套轨道。
 */
export const SATELLITE_ORBIT = {
  radiusX: 100,
  radiusY: 100,
  size: 72,
  startAngleDeg: -90,
} as const;

export const DEFAULT_DATA: AppData = {
  schemaVersion: 1,
  settings: {
    alwaysOnTop: false,
    pinTodo: false,
    themeId: "aqua-glass",
    metric: "memory",
    aiEnabled: true,
    aiProvider: DEFAULT_AI_PROVIDER,
    todoDocument: { path: "", autoSync: true },
    visibleTools: ["naming", "clipboard", "todo", "workspace", "port", "settings"],
    updater: {
      enabled: true,
      autoCheck: false,
      endpoint: "https://github.com/lengfengquanjun/codesprite/releases/latest/download/latest.json",
    },
  },
  todos: [],
  clipboard: [],
  workspaces: [],
  namingHistory: [],
};
