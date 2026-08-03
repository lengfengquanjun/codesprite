import { DEFAULT_DATA } from "../config/defaults";
import type { AppData } from "../core/types";
import { isTauri, nativeInvoke } from "../platform/native";

const FALLBACK_KEY = "codesprite.app-data.v1";

function mergeData(value?: Partial<AppData> | null): AppData {
  return {
    ...structuredClone(DEFAULT_DATA),
    ...value,
    settings: {
      ...DEFAULT_DATA.settings,
      ...value?.settings,
      aiProvider: { ...DEFAULT_DATA.settings.aiProvider, ...value?.settings?.aiProvider },
      todoDocument: { ...DEFAULT_DATA.settings.todoDocument, ...value?.settings?.todoDocument },
      visibleTools: Array.isArray(value?.settings?.visibleTools)
        ? value.settings.visibleTools.filter(id => DEFAULT_DATA.settings.visibleTools.includes(id))
        : [...DEFAULT_DATA.settings.visibleTools],
      updater: { ...DEFAULT_DATA.settings.updater, ...value?.settings?.updater },
    },
    todos: Array.isArray(value?.todos) ? value.todos.map(item => ({ ...item, kind: item.kind ?? "todo" })) : [],
    clipboard: Array.isArray(value?.clipboard) ? value.clipboard : [],
    workspaces: Array.isArray(value?.workspaces) ? value.workspaces : [],
    namingHistory: Array.isArray(value?.namingHistory) ? value.namingHistory : [],
  };
}

export class AppRepository {
  private data = structuredClone(DEFAULT_DATA);
  private writeQueue = Promise.resolve();

  async load(): Promise<AppData> {
    try {
      const raw = isTauri
        ? await nativeInvoke<string | null>("read_app_data")
        : localStorage.getItem(FALLBACK_KEY);
      this.data = mergeData(raw ? JSON.parse(raw) as Partial<AppData> : null);
    } catch (error) {
      console.error("读取本地数据失败，已使用默认值", error);
      this.data = structuredClone(DEFAULT_DATA);
    }
    return this.snapshot();
  }

  snapshot(): AppData {
    return structuredClone(this.data);
  }

  async update(mutator: (draft: AppData) => void): Promise<AppData> {
    const before = this.snapshot();
    const draft = structuredClone(before);
    mutator(draft);
    draft.schemaVersion = 1;
    const sections = Object.fromEntries(
      (["settings", "todos", "clipboard", "workspaces", "namingHistory"] as const)
        .filter(key => JSON.stringify(before[key]) !== JSON.stringify(draft[key]))
        .map(key => [key, draft[key]]),
    );
    if (!Object.keys(sections).length) return this.snapshot();
    this.writeQueue = this.writeQueue.then(async () => {
      if (isTauri) {
        const payload = await nativeInvoke<string>("update_app_sections", { sections });
        this.data = mergeData(JSON.parse(payload) as Partial<AppData>);
      } else {
        this.data = draft;
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(draft));
      }
    });
    await this.writeQueue;
    return this.snapshot();
  }
}

export const repository = new AppRepository();
