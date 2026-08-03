export type ToolId = "naming" | "clipboard" | "todo" | "workspace" | "port" | "settings";
export type WidgetMode = "compact" | "metrics" | "menu";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  icon: string;
  window: { width: number; height: number; minWidth: number; minHeight: number; transparent: boolean };
}

export interface Metrics {
  cpuUsage: number;
  memoryUsage: number;
  usedMemoryGb: number;
  totalMemoryGb: number;
}

export type TodoPriority = "P0" | "P1" | "P2";
export type TodoKind = "todo" | "memo";
export interface TodoItem {
  id: string;
  text: string;
  kind: TodoKind;
  priority: TodoPriority;
  done: boolean;
  dueAt?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TodoDocumentSettings {
  path: string;
  autoSync: boolean;
  lastSyncedAt?: string;
}

export interface ClipboardItem {
  id: string;
  content: string;
  kind: "text" | "code" | "url";
  favorite: boolean;
  createdAt: string;
  lastUsedAt: string;
}

export interface WorkspaceLaunchItem {
  id: string;
  name: string;
  target: string;
  args: string[];
  delayMs: number;
  enabled: boolean;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  items: WorkspaceLaunchItem[];
}

export interface AiProviderConfig {
  id: string;
  name: string;
  protocol: "openai-chat";
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface AppSettings {
  alwaysOnTop: boolean;
  pinTodo: boolean;
  themeId: string;
  metric: "memory" | "cpu";
  aiEnabled: boolean;
  aiProvider: AiProviderConfig;
  todoDocument: TodoDocumentSettings;
  visibleTools: ToolId[];
  updater: {
    enabled: boolean;
    autoCheck: boolean;
    endpoint: string;
  };
}

export interface PortProcess {
  port: number;
  pid: number;
  protocol: "TCP" | "UDP";
  address: string;
  processName: string;
  executable?: string;
  command: string[];
}

export interface AppData {
  schemaVersion: 1;
  settings: AppSettings;
  todos: TodoItem[];
  clipboard: ClipboardItem[];
  workspaces: WorkspaceProfile[];
  namingHistory: Array<{ query: string; value: string; createdAt: string }>;
}
