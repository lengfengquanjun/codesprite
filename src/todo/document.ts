import type { TodoItem, TodoKind, TodoPriority } from "../core/types";

export const DOCUMENT_START = "<!-- codesprite:start -->";
export const DOCUMENT_END = "<!-- codesprite:end -->";

const makeId = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const cleanText = (value: string) => value.replace(/\s+/g, " ").replace(/<!--/g, "").trim();

function visibleDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseVisibleDate(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value.trim().replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function metadata(item: TodoItem): string {
  const values = [`id=${item.id}`, `created=${item.createdAt}`];
  if (item.completedAt) values.push(`completed=${item.completedAt}`);
  return `<!-- codesprite:${values.join(";")} -->`;
}

function managedBlock(items: TodoItem[]): string {
  const todos = items.filter(item => item.kind === "todo");
  const memos = items.filter(item => item.kind === "memo");
  const todoLines = todos.length
    ? todos.map(item => `- [${item.done ? "x" : " "}] [${item.priority}] ${cleanText(item.text)}${item.dueAt ? ` | 截止: ${visibleDate(item.dueAt)}` : ""} ${metadata(item)}`)
    : ["_暂无待办_" ];
  const memoLines = memos.length
    ? memos.map(item => `- [${item.priority}] ${cleanText(item.text)} | 记录: ${visibleDate(item.createdAt)} ${metadata(item)}`)
    : ["_暂无备忘_" ];
  return [DOCUMENT_START, "## 待办", ...todoLines, "", "## 备忘", ...memoLines, DOCUMENT_END].join("\n");
}

export function serializeTodoDocument(items: TodoItem[], existing = ""): string {
  const block = managedBlock(items);
  const start = existing.indexOf(DOCUMENT_START);
  const end = existing.indexOf(DOCUMENT_END);
  if (start >= 0 && end >= start) {
    return `${existing.slice(0, start)}${block}${existing.slice(end + DOCUMENT_END.length)}`;
  }
  const prefix = existing.trim() || "# CodeSprite 备忘与待办\n\n> 可直接编辑下方内容，回到工具后点击“从文档刷新”。";
  return `${prefix}\n\n${block}\n`;
}

function parseMeta(raw = ""): Record<string, string> {
  return Object.fromEntries(raw.split(";").map(pair => pair.split("=", 2)).filter(pair => pair.length === 2));
}

export function parseTodoDocument(content: string): TodoItem[] {
  const start = content.indexOf(DOCUMENT_START);
  const end = content.indexOf(DOCUMENT_END);
  const source = start >= 0 && end > start ? content.slice(start + DOCUMENT_START.length, end) : content;
  const result: TodoItem[] = [];
  let kind: TodoKind = "todo";

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^##\s*待办/.test(line)) { kind = "todo"; continue; }
    if (/^##\s*备忘/.test(line)) { kind = "memo"; continue; }
    if (!line.startsWith("- ")) continue;
    const metaMatch = line.match(/\s*<!--\s*codesprite:(.*?)\s*-->\s*$/);
    const meta = parseMeta(metaMatch?.[1]);
    const body = metaMatch ? line.slice(0, metaMatch.index).trim() : line;
    const now = new Date().toISOString();

    if (kind === "todo") {
      const match = body.match(/^-\s*\[([ xX])\]\s*(?:\[(P[012])\]\s*)?(.+?)(?:\s*\|\s*截止:\s*(.+))?$/);
      if (!match) continue;
      const done = match[1].toLowerCase() === "x";
      result.push({
        id: meta.id || makeId(), kind, text: match[3].trim(), priority: (match[2] || "P1") as TodoPriority,
        done, dueAt: parseVisibleDate(match[4]), createdAt: meta.created || now,
        completedAt: done ? (meta.completed || now) : undefined,
      });
    } else {
      const match = body.match(/^-\s*(?:\[(P[012])\]\s*)?(.+?)(?:\s*\|\s*记录:\s*(.+))?$/);
      if (!match) continue;
      result.push({
        id: meta.id || makeId(), kind, text: match[2].trim(), priority: (match[1] || "P2") as TodoPriority,
        done: false, createdAt: meta.created || parseVisibleDate(match[3]) || now,
      });
    }
  }
  return result;
}

export type ReportRange = "today" | "week" | "month";

export function createTodoReport(items: TodoItem[], range: ReportRange, now = new Date()): string {
  const start = new Date(now);
  const end = new Date(now);
  if (range === "today") {
    start.setHours(0, 0, 0, 0); end.setHours(23, 59, 59, 999);
  } else if (range === "week") {
    const offset = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - offset); start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime()); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999);
  } else {
    start.setDate(1); start.setHours(0, 0, 0, 0);
    end.setMonth(start.getMonth() + 1, 0); end.setHours(23, 59, 59, 999);
  }
  const inRange = (value?: string) => value ? new Date(value).getTime() >= start.getTime() && new Date(value).getTime() <= end.getTime() : false;
  const completed = items.filter(item => item.kind === "todo" && item.done && inRange(item.completedAt));
  const pending = items.filter(item => item.kind === "todo" && !item.done && (inRange(item.dueAt) || inRange(item.createdAt)));
  const memos = items.filter(item => item.kind === "memo" && inRange(item.createdAt));
  const labels = { today: "日报", week: "周报", month: "月报" } as const;
  const lines = (values: TodoItem[], format: (item: TodoItem) => string) => values.length ? values.map(format) : ["- 暂无"];
  return [`# ${visibleDate(start.toISOString()).slice(0, 10)} ${labels[range]}`, "", "## 已完成",
    ...lines(completed, item => `- ${item.text}`), "", "## 后续计划",
    ...lines(pending, item => `- [${item.priority}] ${item.text}${item.dueAt ? `（${visibleDate(item.dueAt)}）` : ""}`), "", "## 备忘",
    ...lines(memos, item => `- ${item.text}`), ""].join("\n");
}
