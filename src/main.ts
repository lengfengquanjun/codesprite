import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import "./styles.css";
import { deleteAiKey, detectMiMoCredentialKind, generateNamesWithAi, hasAiKey, resolveMiMoBaseUrl, saveAiKey, testAiConnection } from "./ai/provider";
import { SATELLITE_ORBIT, TOOL_REGISTRY, WIDGET_LAYOUTS } from "./config/defaults";
import type { AppData, ClipboardItem, Metrics, PortProcess, TodoItem, ToolId, WorkspaceProfile } from "./core/types";
import { installGlobalDiagnostics, operationLog, type OperationLogEntry } from "./diagnostics/logger";
import { generateNames, type NameCandidate, type NamingKind, type NamingRule } from "./naming";
import { isTauri, nativeInvoke, optionalNativeInvoke } from "./platform/native";
import { repository } from "./storage/repository";
import { looksSensitiveText } from "./security/sensitive";
import { applyTheme, THEMES } from "./theme/themes";
import { createTodoReport, parseTodoDocument, serializeTodoDocument, type ReportRange } from "./todo/document";

const app = document.querySelector<HTMLElement>("#app")!;
const query = new URL(location.href).searchParams;
const toolFromUrl = query.get("tool") as ToolId | null;
const pinnedView = query.get("view") === "pinned";
const satelliteView = query.get("view") === "satellite";
const smokeExpand = import.meta.env.DEV && query.get("smoke") === "expand";
let data: AppData;
let menuOpen = false;
let lastClipboard = "";
let widgetResizeQueue = Promise.resolve();
let edgeRevealArmed = true;
let edgeArmTimer = 0;

function markEdgeCollapsed(edge: string): void {
  document.body.dataset.edge = edge;
  document.body.dataset.edgeCollapsed = "true";
  edgeRevealArmed = false;
  window.clearTimeout(edgeArmTimer);
  edgeArmTimer = window.setTimeout(() => { edgeRevealArmed = true; }, 420);
}

const byTool = (id: ToolId) => TOOL_REGISTRY.find(tool => tool.id === id)!;
const visibleTools = () => TOOL_REGISTRY.filter(tool => data.settings.visibleTools.includes(tool.id));
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]!));

function toast(message: string, error = false): void {
  const node = document.querySelector<HTMLElement>("#toast");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 2200);
}

async function safely<T>(action: () => Promise<T>, message = "操作失败"): Promise<T | null> {
  try { return await action(); }
  catch (error) { operationLog.error("operation", "failed", message, String(error)); toast(`${message}：${String(error)}`, true); return null; }
}

async function setWidgetMode(mode: keyof typeof WIDGET_LAYOUTS): Promise<void> {
  document.body.dataset.mode = mode;
  const size = WIDGET_LAYOUTS[mode];
  widgetResizeQueue = widgetResizeQueue.then(async () => { await optionalNativeInvoke("resize_main_window", { ...size, anchorFromRight: 60 }); });
  await widgetResizeQueue;
}

async function syncPinnedTodoReliably(enabled: boolean, alwaysOnTop: boolean, reason: "startup" | "settings", retries = 3): Promise<void> {
  if (!isTauri) return;
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await nativeInvoke("sync_pinned_todo_window", { enabled, alwaysOnTop });
      operationLog.info("todo", "pinned.sync_success", enabled ? "常驻待办窗口已恢复" : "常驻待办窗口已关闭", { reason, attempt });
      return;
    } catch (error) {
      lastError = error;
      operationLog.warn("todo", "pinned.sync_retry", "常驻待办窗口同步失败，准备重试", { reason, attempt, error: String(error) });
      if (attempt < retries) await new Promise(resolve => window.setTimeout(resolve, attempt * 250));
    }
  }
  operationLog.error("todo", "pinned.sync_failed", "常驻待办窗口同步最终失败", { reason, error: String(lastError) });
  toast(`常驻待办恢复失败：${String(lastError)}`, true);
}

function shellMarkup(): string {
  return `<section class="widget-shell"><div class="widget-stage"><div class="orb-cluster">
    <span class="orb-seasonal" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span>
    ${isTauri ? "" : `<nav class="satellite-menu" aria-label="功能菜单">${visibleTools().map((tool, index) =>
      `<button class="satellite" data-tool="${tool.id}" style="--index:${index}" title="${tool.label}"><span>${tool.icon}</span><small>${tool.label}</small></button>`).join("")}</nav>
    `}
    <button id="orb" class="orb" aria-label="展开 CodeSprite"><span id="water" class="orb-water"></span><span class="orb-cpu-ring"></span><span class="orb-glare"></span><span class="orb-code">&lt;/&gt;</span></button><span id="todoAlert" class="orb-alert" aria-label="存在未完成待办"></span>
  </div><button id="edgeHandle" class="edge-handle" aria-label="恢复 CodeSprite 水球"></button><div class="metric-tip" aria-hidden="true"><span class="metric-memory">内存 <b id="memoryValue">--</b></span><i>·</i><span class="metric-cpu">CPU <b id="cpuValue">--</b></span><i>·</i><span class="metric-todo"><b id="todoMetric">0</b> 项待办</span></div></div><div id="toast" class="toast" role="status"></div></section>`;
}

function renderShell(): void {
  app.innerHTML = shellMarkup();
  const orb = document.querySelector<HTMLElement>("#orb")!;
  const edgeHandle = document.querySelector<HTMLButtonElement>("#edgeHandle")!;
  let edgeRevealBusy = false;
  const revealFromEdge = async (force = false) => {
    if (edgeRevealBusy || (!force && !edgeRevealArmed)) return;
    edgeRevealBusy = true;
    const restored = await safely(() => nativeInvoke<boolean>("reveal_widget_from_edge"), "恢复水球失败");
    if (restored) delete document.body.dataset.edgeCollapsed;
    edgeRevealBusy = false;
  };
  edgeHandle.addEventListener("pointerenter", () => void revealFromEdge());
  edgeHandle.addEventListener("click", () => void revealFromEdge(true));
  orb.addEventListener("click", async () => {
    menuOpen = !menuOpen;
    document.querySelector(".orb-cluster")?.classList.toggle("expanded", menuOpen);
    await setWidgetMode("compact");
    if (isTauri) await setSatelliteMenu(menuOpen);
  });
  document.querySelectorAll<HTMLButtonElement>(".satellite").forEach(button => button.addEventListener("click", () => void openTool(button.dataset.tool as ToolId)));
  bindOrbDrag(orb);
  bindMetricsHover();
  document.addEventListener("pointerdown", event => {
    if (!menuOpen || (event.target as HTMLElement).closest(".orb-cluster")) return;
    menuOpen = false;
    document.querySelector(".orb-cluster")?.classList.remove("expanded");
    if (isTauri) void setSatelliteMenu(false);
    void setWidgetMode("compact");
  });
  // 仅供开发环境的桌面窗口烟雾测试使用，生产构建不会自动展开。
  if (smokeExpand) {
    menuOpen = true;
    document.querySelector(".orb-cluster")?.classList.add("expanded");
    operationLog.debug("test", "smoke.expand", "执行功能球窗口烟雾测试");
    void setSatelliteMenu(true);
  }
  void optionalNativeInvoke("set_always_on_top", { enabled: data.settings.alwaysOnTop });
  void syncPinnedTodoReliably(data.settings.pinTodo, data.settings.alwaysOnTop, "startup");
  if (isTauri) void listen("satellite-menu-closed", () => {
    menuOpen = false;
    document.querySelector(".orb-cluster")?.classList.remove("expanded");
  });
  if (isTauri) void listen<string>("widget-edge-collapsed", event => {
    markEdgeCollapsed(event.payload);
  });
  if (isTauri) void listen<string>("widget-edge-revealed", event => {
    document.body.dataset.edge = event.payload;
    delete document.body.dataset.edgeCollapsed;
  });
  if (isTauri) void listen<ToolId>("tray-open-tool", event => {
    if (TOOL_REGISTRY.some(tool => tool.id === event.payload)) void openTool(event.payload);
  });
  if (isTauri) void listen("tray-main-restored", () => {
    void syncPinnedTodoReliably(data.settings.pinTodo, data.settings.alwaysOnTop, "startup");
  });
  void setWidgetMode("compact");
  void refreshMetrics();
  window.setInterval(refreshMetrics, 1800);
  window.setInterval(captureClipboard, 1400);
  if (data.settings.updater.enabled && data.settings.updater.autoCheck) {
    window.setTimeout(() => void autoCheckForUpdate(), 2400);
  }
}

async function autoCheckForUpdate(): Promise<void> {
  try {
    const update = await nativeInvoke<{ currentVersion: string; version: string } | null>("check_app_update", { endpoint: data.settings.updater.endpoint });
    if (!update) { operationLog.info("updater", "auto_check.current", "自动检查完成，当前已是最新版本"); return; }
    operationLog.info("updater", "update.available", "自动检查发现新版本", update);
    toast(`发现 CodeSprite ${update.version}，可在设置中更新`);
  } catch (error) {
    operationLog.warn("updater", "auto_check.failed", "自动检查更新失败", String(error));
  }
}

async function setSatelliteMenu(open: boolean): Promise<void> {
  const tools = visibleTools();
  const items = tools.map((tool, index) => ({
    tool: tool.id,
    title: tool.label,
    ...satellitePlacement(tool.id, index, tools.length),
  }));
  operationLog.info("window", open ? "menu.expand" : "menu.collapse", open ? "展开功能球" : "收起功能球", { items: items.length });
  await safely(
    () => nativeInvoke("set_satellite_menu", { open, items, alwaysOnTop: data.settings.alwaysOnTop }),
    open ? "展开功能球失败" : "收起功能球失败",
  );
}

function satellitePlacement(_id: ToolId, index: number, count: number): { offsetX: number; offsetY: number; size: number } {
  const angle = (SATELLITE_ORBIT.startAngleDeg + index * (360 / Math.max(1, count))) * Math.PI / 180;
  return {
    offsetX: Math.round(Math.cos(angle) * SATELLITE_ORBIT.radiusX),
    offsetY: Math.round(Math.sin(angle) * SATELLITE_ORBIT.radiusY),
    size: SATELLITE_ORBIT.size,
  };
}

function bindMetricsHover(): void {
  const cluster = document.querySelector<HTMLElement>(".orb-cluster")!;
  let timer = 0;
  cluster.addEventListener("pointerenter", () => { clearTimeout(timer); if (!menuOpen) void setWidgetMode("metrics"); });
  cluster.addEventListener("pointerleave", () => { timer = window.setTimeout(() => { if (!menuOpen && document.body.dataset.edgeCollapsed !== "true") void setWidgetMode("compact"); }, 120); });
}

function bindOrbDrag(orb: HTMLElement): void {
  let drag: { x: number; y: number; startX: number; startY: number } | null = null;
  let moved = false;
  let calmTimer = 0;
  orb.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = { x: event.screenX, y: event.screenY, startX: event.screenX, startY: event.screenY };
    moved = false;
    orb.setPointerCapture(event.pointerId);
  });
  orb.addEventListener("pointermove", event => {
    if (!drag || event.buttons !== 1) return;
    if (!moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) < 5) return;
    if (!moved) void setWidgetMode("compact");
    moved = true;
    menuOpen = false;
    document.querySelector(".orb-cluster")?.classList.remove("expanded");
    const deltaX = Math.round(event.screenX - drag.x);
    const deltaY = Math.round(event.screenY - drag.y);
    drag.x = event.screenX; drag.y = event.screenY;
    const cluster = document.querySelector<HTMLElement>(".orb-cluster")!;
    cluster.classList.add("sloshing");
    cluster.style.setProperty("--slosh-x", `${Math.max(-18, Math.min(18, -deltaX * 1.8))}px`);
    cluster.style.setProperty("--slosh-tilt", `${Math.max(-12, Math.min(12, -deltaX * .42))}deg`);
    clearTimeout(calmTimer);
    calmTimer = window.setTimeout(() => cluster.classList.remove("sloshing"), 480);
    if (deltaX || deltaY) void optionalNativeInvoke("move_widget_by", { deltaX, deltaY });
  });
  orb.addEventListener("click", event => { if (moved) { event.preventDefault(); event.stopImmediatePropagation(); moved = false; } }, true);
  orb.addEventListener("pointerup", async () => {
    const shouldSnap = moved;
    drag = null;
    if (!shouldSnap) return;
    await setWidgetMode("compact");
    const edge = await optionalNativeInvoke<string | null>("snap_widget_to_edge", { threshold: 34 });
    if (edge) {
      markEdgeCollapsed(edge);
      operationLog.info("window", "widget.snapped", "水球已吸附到屏幕边缘", { edge });
    } else {
      delete document.body.dataset.edge;
      delete document.body.dataset.edgeCollapsed;
    }
  });
}

async function refreshMetrics(): Promise<void> {
  const metrics = await safely(() => nativeInvoke<Metrics>("system_metrics"), "读取系统状态失败");
  if (!metrics) return;
  const percent = data.settings.metric === "cpu" ? metrics.cpuUsage : metrics.memoryUsage;
  document.querySelector<HTMLElement>("#water")?.style.setProperty("--level", `${Math.max(8, Math.min(92, percent))}%`);
  const level = document.querySelector<HTMLElement>("#orbLevel"); if (level) level.textContent = `${Math.round(percent)}%`;
  const cpu = document.querySelector<HTMLElement>("#cpuValue"); if (cpu) cpu.textContent = `${Math.round(metrics.cpuUsage)}%`;
  const memory = document.querySelector<HTMLElement>("#memoryValue"); if (memory) memory.textContent = `${Math.round(metrics.memoryUsage)}%`;
  const openTodos = data.todos.filter(item => item.kind === "todo" && !item.done).length;
  const todo = document.querySelector<HTMLElement>("#todoMetric"); if (todo) todo.textContent = String(openTodos);
  document.querySelector<HTMLElement>("#todoAlert")?.classList.toggle("visible", openTodos > 0);
}

async function captureClipboard(): Promise<void> {
  if (!isTauri) return;
  const content = await optionalNativeInvoke<string | null>("read_clipboard_text");
  if (!content || content === lastClipboard || content.length > 100_000) return;
  lastClipboard = content;
  if (looksSensitiveText(content)) return;
  await repository.update(draft => {
    const existing = draft.clipboard.find(item => item.content === content);
    if (existing) existing.lastUsedAt = new Date().toISOString();
    else draft.clipboard.unshift({ id: uid(), content, kind: classifyClipboard(content), favorite: false, createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() });
    draft.clipboard = [...draft.clipboard.filter(item => item.favorite), ...draft.clipboard.filter(item => !item.favorite)].slice(0, 300);
  });
}

function classifyClipboard(content: string): ClipboardItem["kind"] {
  if (/^https?:\/\/\S+$/i.test(content.trim())) return "url";
  if (/[{}();]|\b(const|let|class|function|SELECT|FROM|public|def)\b/.test(content)) return "code";
  return "text";
}

async function openTool(id: ToolId): Promise<void> {
  operationLog.info("window", "tool.open", `打开${byTool(id).label}`, { tool: id });
  menuOpen = false;
  document.querySelector(".orb-cluster")?.classList.remove("expanded");
  if (isTauri) await setSatelliteMenu(false);
  void setWidgetMode("compact");
  if (!isTauri) { renderTool(id); return; }
  const tool = byTool(id);
  await safely(() => nativeInvoke("open_tool_window", { tool: id, title: tool.label, spec: tool.window, alwaysOnTop: data.settings.alwaysOnTop }), "打开工具失败");
}

function renderSatelliteWindow(id: ToolId): void {
  const tool = byTool(id);
  document.body.dataset.surface = "satellite";
  app.innerHTML = `<main class="satellite-page"><span class="satellite-seasonal" aria-hidden="true"><i></i><i></i><i></i></span><button class="satellite-window-button" data-tool="${id}" title="${tool.label}" aria-label="打开${tool.label}"><span>${tool.icon}</span></button></main>`;
  app.querySelector<HTMLButtonElement>(".satellite-window-button")?.addEventListener("click", () => void openTool(id));
}

function panelFrame(id: ToolId, body: string): string {
  const tool = byTool(id);
  return `<section class="tool-window" data-window="${id}" role="dialog"><span class="tool-seasonal" aria-hidden="true"></span><header class="tool-title"><span class="tool-title-icon">${tool.icon}</span><strong>${tool.label}</strong><button class="close-panel" aria-label="关闭">×</button></header><div class="tool-body">${body}</div><span class="resize-handle"></span></section>`;
}

function renderTool(id: ToolId): void {
  document.body.dataset.surface = "tool";
  app.innerHTML = `<main class="tool-page" data-tool-page="${id}">${panelFrame(id, toolBody(id))}<div id="toast" class="toast"></div></main>`;
  const panel = app.querySelector<HTMLElement>(".tool-window")!;
  panel.querySelector(".close-panel")?.addEventListener("click", closeTool);
  bindToolDrag(panel);
  ({ naming: bindNaming, clipboard: bindClipboard, todo: bindTodo, workspace: bindWorkspace, port: bindPort, settings: bindSettings }[id])(panel);
}

function toolBody(id: ToolId): string {
  if (id === "naming") return namingMarkup();
  if (id === "clipboard") return clipboardMarkup();
  if (id === "todo") return todoMarkup();
  if (id === "workspace") return workspaceMarkup();
  if (id === "port") return portMarkup();
  return settingsMarkup();
}

function closeTool(): void {
  if (toolFromUrl && isTauri) void optionalNativeInvoke("close_tool_window", { label: getCurrentWebviewWindow().label });
  else renderShell();
}

function bindToolDrag(panel: HTMLElement): void {
  if (!toolFromUrl || !isTauri) return;
  const header = panel.querySelector<HTMLElement>(".tool-title, header");
  if (!header) return;
  let drag: { x: number; y: number } | null = null;
  header.addEventListener("pointerdown", event => {
    if ((event.target as HTMLElement).closest("button,input,select")) return;
    drag = { x: event.screenX, y: event.screenY };
    header.setPointerCapture(event.pointerId);
  });
  header.addEventListener("pointermove", event => {
    if (!drag || event.buttons !== 1) return;
    const deltaX = Math.round(event.screenX - drag.x), deltaY = Math.round(event.screenY - drag.y);
    drag = { x: event.screenX, y: event.screenY };
    if (deltaX || deltaY) void optionalNativeInvoke("move_tool_window_by", { label: getCurrentWebviewWindow().label, deltaX, deltaY });
  });
  header.addEventListener("pointerup", () => { drag = null; });
}

function namingMarkup(): string {
  return `<div class="naming-layout"><div class="naming-row">
    <input id="namingInput" placeholder="输入中文命名意图…" autocomplete="off">
    <select id="namingKind"><option value="variable">变量</option><option value="function">函数</option><option value="table">数据表</option><option value="field">表字段</option><option value="class">类</option><option value="constant">常量</option></select>
    <select id="namingRule"><option value="camel">小驼峰</option><option value="pascal">大驼峰</option><option value="snake">下划线</option><option value="screaming">大写下划线</option></select>
    <select id="namingLanguage"><option>通用</option><option>Java</option><option>C#</option><option>TypeScript</option><option>Python</option><option>Go</option><option>SQL</option></select>
    <button id="goNaming" class="go-button">Go</button></div><div id="nameBubbles" class="name-bubbles"></div></div>`;
}

function bindNaming(panel: HTMLElement): void {
  const input = panel.querySelector<HTMLInputElement>("#namingInput")!;
  const list = panel.querySelector<HTMLElement>("#nameBubbles")!;
  const goButton = panel.querySelector<HTMLButtonElement>("#goNaming")!;
  const aiAvailable = data.settings.aiEnabled && isTauri ? hasAiKey().catch(() => false) : Promise.resolve(false);
  const cache = new Map<string, NameCandidate[]>();
  let requestVersion = 0;
  let expanded: boolean | null = null;
  const setExpanded = (next: boolean) => {
    if (expanded === next) return;
    expanded = next;
    document.body.dataset.namingExpanded = String(next);
    void optionalNativeInvoke("resize_tool_window_height", {
      label: isTauri ? getCurrentWebviewWindow().label : "tool-naming",
      height: next ? 174 : 82,
    });
  };
  setExpanded(false);
  const generate = async () => {
    if (goButton.disabled) return;
    const text = input.value.trim(); if (!text) { input.focus(); return; }
    const kind = panel.querySelector<HTMLSelectElement>("#namingKind")!.value as NamingKind;
    const rule = panel.querySelector<HTMLSelectElement>("#namingRule")!.value as NamingRule;
    const language = panel.querySelector<HTMLSelectElement>("#namingLanguage")!.value;
    const cacheKey = JSON.stringify([text, kind, rule, language]);
    const version = ++requestVersion;
    setExpanded(true);
    renderNameBubbles(list, generateNames(text, kind, rule), input, () => setExpanded(false));
    const cached = cache.get(cacheKey);
    if (cached) {
      renderNameBubbles(list, cached, input, () => setExpanded(false));
      operationLog.debug("naming", "ai.cache_hit", "复用本次运行中的命名结果", { textLength: text.length });
      return;
    }
    if (!(await aiAvailable) || version !== requestVersion) return;
    const started = performance.now();
    goButton.disabled = true;
    goButton.textContent = "…";
    list.classList.add("loading");
    operationLog.info("naming", "ai.start", "开始优化命名候选", { textLength: text.length, kind, rule, language });
    const candidates = await safely(() => generateNamesWithAi(data.settings.aiProvider, { input: text, kind, rule, language }), "AI 命名失败，已保留本地结果");
    list.classList.remove("loading");
    goButton.disabled = false;
    goButton.textContent = "Go";
    if (version !== requestVersion) return;
    if (candidates?.length) {
      cache.set(cacheKey, candidates);
      if (cache.size > 80) cache.delete(cache.keys().next().value!);
      renderNameBubbles(list, candidates, input, () => setExpanded(false));
      operationLog.info("naming", "ai.success", "AI 命名候选已展示", { elapsedMs: Math.round(performance.now() - started), candidates: candidates.length });
    }
  };
  goButton.addEventListener("click", generate);
  input.addEventListener("keydown", event => { if (event.key === "Enter") void generate(); });
  input.addEventListener("input", () => {
    if (input.value) return;
    requestVersion++;
    list.replaceChildren();
    setExpanded(false);
  });
  input.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    requestVersion++;
    list.replaceChildren();
    input.value = "";
    setExpanded(false);
  });
  input.focus();
}

function renderNameBubbles(list: HTMLElement, candidates: NameCandidate[], input: HTMLInputElement, onDismiss: () => void): void {
  list.innerHTML = candidates.map((item, index) => `<button class="name-bubble bubble-${index % 3}" data-value="${escapeHtml(item.value)}"><b>${escapeHtml(item.value)}</b><small>${escapeHtml(item.reason)}</small></button>`).join("");
  list.querySelectorAll<HTMLButtonElement>(".name-bubble").forEach(bubble => bubble.addEventListener("click", () => void popBubbles(list, bubble, input, onDismiss)));
}

async function popBubbles(list: HTMLElement, selected: HTMLButtonElement, input: HTMLInputElement, onDismiss: () => void): Promise<void> {
  const value = selected.dataset.value ?? "";
  await safely(() => isTauri ? nativeInvoke("write_clipboard_text", { content: value }) : navigator.clipboard.writeText(value), "复制失败");
  await repository.update(draft => { draft.namingHistory.unshift({ query: input.value, value, createdAt: new Date().toISOString() }); draft.namingHistory = draft.namingHistory.slice(0, 500); });
  [...list.querySelectorAll<HTMLButtonElement>(".name-bubble")].forEach((bubble, order) => {
    for (let index = 0; index < 12; index++) { const shard = document.createElement("i"); shard.className = "bubble-shard"; shard.style.setProperty("--angle", `${index * 30 + Math.random() * 12}deg`); shard.style.setProperty("--distance", `${36 + Math.random() * 48}px`); bubble.append(shard); }
    window.setTimeout(() => bubble.classList.add("popping"), order * 55);
  });
  window.setTimeout(() => { list.replaceChildren(); input.value = ""; input.focus(); onDismiss(); }, 850);
  toast(`已复制：${value}`);
}

function clipboardMarkup(): string {
  return `<div class="feature-layout"><div class="feature-toolbar"><input id="clipboardSearch" placeholder="搜索剪贴板历史"><button id="captureClipboard">读取当前剪贴板</button></div><div id="clipboardList" class="item-list"></div></div>`;
}

function bindClipboard(panel: HTMLElement): void {
  const search = panel.querySelector<HTMLInputElement>("#clipboardSearch")!;
  const render = () => {
    const keyword = search.value.trim().toLowerCase();
    const items = data.clipboard.filter(item => !keyword || item.content.toLowerCase().includes(keyword));
    panel.querySelector<HTMLElement>("#clipboardList")!.innerHTML = items.length ? items.map(item => `<article class="data-card" data-id="${item.id}"><div><span class="kind">${item.kind}</span><time>${new Date(item.createdAt).toLocaleString()}</time></div><pre>${escapeHtml(item.content.slice(0, 1200))}</pre><footer><button data-action="copy">复制</button><button data-action="favorite">${item.favorite ? "取消收藏" : "收藏"}</button><button data-action="delete" class="danger">删除</button></footer></article>`).join("") : `<div class="empty-state">复制一些文本后，历史会自动出现在这里</div>`;
    panel.querySelectorAll<HTMLElement>(".data-card").forEach(card => card.addEventListener("click", async event => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.action; if (!action) return;
      const id = card.dataset.id!, item = data.clipboard.find(entry => entry.id === id); if (!item) return;
      if (action === "copy") { await safely(() => nativeInvoke("write_clipboard_text", { content: item.content }), "复制失败"); toast("已复制"); return; }
      data = await repository.update(draft => { const target = draft.clipboard.find(entry => entry.id === id); if (action === "delete") draft.clipboard = draft.clipboard.filter(entry => entry.id !== id); else if (target) target.favorite = !target.favorite; }); render();
    }));
  };
  search.addEventListener("input", render);
  panel.querySelector("#captureClipboard")?.addEventListener("click", async () => { lastClipboard = ""; await captureClipboard(); data = repository.snapshot(); render(); });
  render();
}

function todoMarkup(): string {
  const document = data.settings.todoDocument;
  const filename = document.path.split(/[\\/]/).pop();
  return `<div class="todo-layout">
    <section class="todo-document ${document.path ? "connected" : ""}">
      <div class="document-state"><span class="document-dot"></span><div><b>${filename ? escapeHtml(filename) : "尚未连接待办文档"}</b><small id="todoSyncState">${filename ? "Markdown 为主数据 · 本地自动缓存" : "选择一个 Markdown 文档，开启双向同步"}</small></div></div>
      <div class="document-actions"><button id="chooseTodoDocument">${filename ? "更换" : "选择文档"}</button><button id="refreshTodoDocument" ${filename ? "" : "disabled"}>从文档刷新</button><button id="openTodoDocument" ${filename ? "" : "disabled"}>打开文档</button></div>
    </section>
    <form id="todoForm" class="todo-create">
      <label class="todo-field todo-kind-field"><span>类型</span><select id="todoKind"><option value="todo">待办</option><option value="memo">备忘</option></select></label>
      <label class="todo-field todo-text-field"><span>内容</span><input id="todoInput" placeholder="要完成什么，或记下什么…" autocomplete="off"></label>
      <label class="todo-field"><span>优先级</span><select id="todoPriority"><option>P0</option><option selected>P1</option><option>P2</option></select></label>
      <label class="todo-field todo-date-field"><span id="todoDateLabel">截止日期与时间</span><input id="todoDue" type="datetime-local"></label>
      <button class="todo-add" type="submit">添加</button>
    </form>
    <div class="todo-toolbar">
      <div class="todo-filters" id="todoFilters"><button class="active" data-filter="all">全部</button><button data-filter="todo">待办</button><button data-filter="memo">备忘</button><button data-filter="open">未完成</button><button data-filter="done">已完成</button></div>
      <div class="report-actions"><select id="reportRange"><option value="today">今日</option><option value="week">本周</option><option value="month">本月</option></select><button id="copyTodoReport">生成报告</button></div>
    </div>
    <div id="todoList" class="item-list todo-list"></div>
  </div>`;
}

async function writeTodoDocument(items = data.todos): Promise<boolean> {
  const path = data.settings.todoDocument.path;
  if (!path || !isTauri) return false;
  const existing = await nativeInvoke<string | null>("read_text_document", { path });
  await nativeInvoke("write_text_document", { path, content: serializeTodoDocument(items, existing ?? "") });
  const syncedAt = new Date().toISOString();
  data = await repository.update(draft => { draft.settings.todoDocument.lastSyncedAt = syncedAt; });
  operationLog.info("todo", "document.written", "待办已同步到 Markdown 文档", { file: path.split(/[\\/]/).pop(), itemCount: items.length });
  return true;
}

function bindTodo(panel: HTMLElement): void {
  let filter = "all";
  let busy = false;
  const syncState = panel.querySelector<HTMLElement>("#todoSyncState")!;
  const setSyncState = (message: string, state = "idle") => { syncState.textContent = message; syncState.dataset.state = state; };
  const formatDateInput = (value?: string) => value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : "";
  const syncAfterMutation = async () => {
    if (!data.settings.todoDocument.path || !data.settings.todoDocument.autoSync) return;
    setSyncState("正在写入文档…", "loading");
    try { await writeTodoDocument(); setSyncState(`已同步 ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`, "success"); }
    catch (error) { setSyncState("同步失败，本地缓存已保留", "error"); operationLog.error("todo", "document.write_failed", "待办文档写入失败", String(error)); toast(`文档同步失败：${String(error)}`, true); }
  };
  const updateTodos = async (mutator: (items: TodoItem[]) => void) => {
    data = await repository.update(draft => mutator(draft.todos));
    render();
    await syncAfterMutation();
  };
  const render = () => {
    const now = Date.now();
    const items = data.todos.filter(item => filter === "all" || item.kind === filter || (filter === "open" && item.kind === "todo" && !item.done) || (filter === "done" && item.kind === "todo" && item.done));
    panel.querySelector<HTMLElement>("#todoList")!.innerHTML = items.length ? items.map(item => {
      const overdue = item.kind === "todo" && !item.done && item.dueAt && new Date(item.dueAt).getTime() < now;
      return `<article class="todo-card ${item.kind} ${item.done ? "done" : ""} ${overdue ? "overdue" : ""}" data-id="${item.id}">
        <div class="todo-check">${item.kind === "todo" ? `<input data-action="toggle" aria-label="完成待办" type="checkbox" ${item.done ? "checked" : ""}>` : `<span class="memo-mark">✦</span>`}</div>
        <div class="todo-content"><div><span class="todo-kind">${item.kind === "todo" ? "待办" : "备忘"}</span><b>${escapeHtml(item.text)}</b></div>
          ${item.kind === "todo" ? `<label class="card-date ${overdue ? "overdue" : ""}"><span>${overdue ? "已逾期" : "截止"}</span><input data-action="date" type="datetime-local" value="${formatDateInput(item.dueAt)}"></label>` : `<small>记录于 ${new Date(item.createdAt).toLocaleString()}</small>`}
        </div>
        <select data-action="priority" class="priority-select ${item.priority.toLowerCase()}" aria-label="优先级"><option ${item.priority === "P0" ? "selected" : ""}>P0</option><option ${item.priority === "P1" ? "selected" : ""}>P1</option><option ${item.priority === "P2" ? "selected" : ""}>P2</option></select>
        <button data-action="delete" class="icon-danger" aria-label="删除">×</button>
      </article>`;
    }).join("") : `<div class="empty-state todo-empty"><span>✓</span><b>这里很清爽</b><small>${filter === "all" ? "添加第一条待办或备忘吧" : "当前筛选下没有内容"}</small></div>`;

    panel.querySelectorAll<HTMLElement>(".todo-card").forEach(card => {
      card.querySelector<HTMLInputElement>('[data-action="toggle"]')?.addEventListener("change", event => void updateTodos(items => {
        const item = items.find(todo => todo.id === card.dataset.id); if (!item) return;
        item.done = (event.currentTarget as HTMLInputElement).checked; item.completedAt = item.done ? new Date().toISOString() : undefined;
      }));
      card.querySelector<HTMLInputElement>('[data-action="date"]')?.addEventListener("change", event => void updateTodos(items => {
        const item = items.find(todo => todo.id === card.dataset.id); if (item) item.dueAt = (event.currentTarget as HTMLInputElement).value ? new Date((event.currentTarget as HTMLInputElement).value).toISOString() : undefined;
      }));
      card.querySelector<HTMLSelectElement>('[data-action="priority"]')?.addEventListener("change", event => void updateTodos(items => {
        const item = items.find(todo => todo.id === card.dataset.id); if (item) item.priority = (event.currentTarget as HTMLSelectElement).value as TodoItem["priority"];
      }));
      card.querySelector<HTMLButtonElement>('[data-action="delete"]')?.addEventListener("click", () => void updateTodos(items => { const index = items.findIndex(todo => todo.id === card.dataset.id); if (index >= 0) items.splice(index, 1); }));
    });
  };
  const refreshFromDocument = async (showToast = true) => {
    const path = data.settings.todoDocument.path; if (!path || busy) return;
    busy = true; setSyncState("正在读取文档…", "loading");
    try {
      const content = await nativeInvoke<string | null>("read_text_document", { path });
      if (content === null) { await writeTodoDocument(); setSyncState("文档已创建", "success"); }
      else {
        const items = parseTodoDocument(content);
        data = await repository.update(draft => { draft.todos = items; draft.settings.todoDocument.lastSyncedAt = new Date().toISOString(); });
        render(); setSyncState(`已读取 ${items.length} 条 · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`, "success");
        operationLog.info("todo", "document.read", "已从 Markdown 文档刷新", { file: path.split(/[\\/]/).pop(), itemCount: items.length });
      }
      if (showToast) toast("已从文档刷新");
    } catch (error) { setSyncState("读取失败，本地缓存仍可使用", "error"); operationLog.error("todo", "document.read_failed", "待办文档读取失败", String(error)); toast(`读取文档失败：${String(error)}`, true); }
    finally { busy = false; }
  };

  panel.querySelector<HTMLSelectElement>("#todoKind")!.addEventListener("change", event => {
    const memo = (event.currentTarget as HTMLSelectElement).value === "memo";
    panel.querySelector<HTMLElement>("#todoDateLabel")!.textContent = memo ? "备忘不设截止时间" : "截止日期与时间";
    panel.querySelector<HTMLInputElement>("#todoDue")!.disabled = memo;
  });
  panel.querySelector("#todoForm")?.addEventListener("submit", async event => {
    event.preventDefault(); const input = panel.querySelector<HTMLInputElement>("#todoInput")!; if (!input.value.trim()) { input.focus(); return; }
    const kind = panel.querySelector<HTMLSelectElement>("#todoKind")!.value as TodoItem["kind"];
    const dueValue = panel.querySelector<HTMLInputElement>("#todoDue")!.value;
    const item: TodoItem = { id: uid(), kind, text: input.value.trim(), priority: panel.querySelector<HTMLSelectElement>("#todoPriority")!.value as TodoItem["priority"], done: false, dueAt: kind === "todo" && dueValue ? new Date(dueValue).toISOString() : undefined, createdAt: new Date().toISOString() };
    await updateTodos(items => items.unshift(item)); input.value = ""; input.focus();
  });
  panel.querySelectorAll<HTMLButtonElement>("#todoFilters button").forEach(button => button.addEventListener("click", () => { filter = button.dataset.filter!; panel.querySelectorAll("#todoFilters button").forEach(node => node.classList.toggle("active", node === button)); render(); }));
  panel.querySelector("#chooseTodoDocument")?.addEventListener("click", async () => {
    const path = await safely(() => nativeInvoke<string | null>("choose_todo_document", { currentPath: data.settings.todoDocument.path || null }), "选择文档失败");
    if (!path) return;
    data = await repository.update(draft => { draft.settings.todoDocument.path = path; draft.settings.todoDocument.autoSync = true; });
    operationLog.info("todo", "document.selected", "已选择待办 Markdown 文档", { file: path.split(/[\\/]/).pop() });
    renderTool("todo");
  });
  panel.querySelector("#refreshTodoDocument")?.addEventListener("click", () => void refreshFromDocument());
  panel.querySelector("#openTodoDocument")?.addEventListener("click", () => void safely(() => nativeInvoke("open_text_document", { path: data.settings.todoDocument.path }), "打开文档失败"));
  panel.querySelector("#copyTodoReport")?.addEventListener("click", async () => {
    const range = panel.querySelector<HTMLSelectElement>("#reportRange")!.value as ReportRange;
    const report = createTodoReport(data.todos, range);
    await safely(() => isTauri ? nativeInvoke("write_clipboard_text", { content: report }) : navigator.clipboard.writeText(report), "复制报告失败");
    operationLog.info("todo", "report.created", "已生成待办报告", { range }); toast("报告已复制到剪贴板");
  });
  render();
  if (data.settings.todoDocument.path) void refreshFromDocument(false);
}

function workspaceMarkup(): string {
  return `<div class="feature-layout workspace-layout"><form id="workspaceForm" class="workspace-create"><input id="workspaceName" placeholder="组合名称，例如 ChatGPT 开发"><textarea id="workspaceTargets" placeholder="每行一个启动项：名称 | 程序路径或网址 | 参数（可选）&#10;VPN | C:\\Program Files\\VPN\\vpn.exe&#10;ChatGPT | https://chatgpt.com"></textarea><button>保存组合</button></form><div id="workspaceList" class="item-list"></div></div>`;
}

function bindWorkspace(panel: HTMLElement): void {
  const render = () => { panel.querySelector<HTMLElement>("#workspaceList")!.innerHTML = data.workspaces.length ? data.workspaces.map(profile => `<article class="workspace-card" data-id="${profile.id}"><div><b>${escapeHtml(profile.name)}</b><small>${profile.items.length} 个启动项</small></div><code>${escapeHtml(profile.items.map(item => item.target).join(" → "))}</code><footer><button data-action="launch">启动</button><button data-action="delete" class="danger">删除</button></footer></article>`).join("") : `<div class="empty-state">创建一个组合，可一键打开 VPN、IDE、网址或其他程序</div>`;
    panel.querySelectorAll<HTMLElement>(".workspace-card").forEach(card => card.addEventListener("click", async event => {
      const action = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.action; if (!action) return; const id = card.dataset.id!;
      if (action === "delete") { data = await repository.update(draft => { draft.workspaces = draft.workspaces.filter(item => item.id !== id); }); render(); return; }
      const profile = data.workspaces.find(item => item.id === id); if (!profile) return;
      for (const item of profile.items.filter(item => item.enabled)) { const result = await safely(() => nativeInvoke("launch_target", { target: item.target, args: item.args }), `启动 ${item.name} 失败`); if (result === null) break; if (item.delayMs) await new Promise(resolve => setTimeout(resolve, item.delayMs)); }
    }));
  };
  panel.querySelector("#workspaceForm")?.addEventListener("submit", async event => {
    event.preventDefault(); const name = panel.querySelector<HTMLInputElement>("#workspaceName")!.value.trim();
    const lines = panel.querySelector<HTMLTextAreaElement>("#workspaceTargets")!.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const items = lines.map((line, index) => { const [itemName, target, args = ""] = line.split("|").map(part => part.trim()); return { id: uid(), name: itemName || `启动项 ${index + 1}`, target: target || "", args: args.split(/\s+/).filter(Boolean), delayMs: index === 0 ? 0 : 300, enabled: true }; }).filter(item => item.target);
    if (!name || !items.length) { toast("请填写组合名称和至少一个有效启动项", true); return; }
    const profile: WorkspaceProfile = { id: uid(), name, items };
    data = await repository.update(draft => draft.workspaces.unshift(profile)); (event.target as HTMLFormElement).reset(); render();
  });
  render();
}

function portMarkup(): string {
  return `<div class="port-tool">
    <form id="portLookupForm" class="port-lookup">
      <div><b>释放开发端口</b><small>查询 TCP 监听或 UDP 占用进程，确认后安全结束</small></div>
      <input id="portInput" type="number" min="1" max="65535" inputmode="numeric" placeholder="例如 1420" required>
      <button type="submit">查询</button>
    </form>
    <div id="portResults" class="port-results"><div class="empty-state">输入端口号，看看是谁占用了它</div></div>
  </div>`;
}

function bindPort(panel: HTMLElement): void {
  const form = panel.querySelector<HTMLFormElement>("#portLookupForm")!;
  const input = panel.querySelector<HTMLInputElement>("#portInput")!;
  const results = panel.querySelector<HTMLElement>("#portResults")!;
  let currentPort = 0;
  const lookup = async () => {
    const port = Number(input.value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) { toast("请输入 1–65535 之间的端口号", true); return; }
    currentPort = port;
    results.innerHTML = `<div class="empty-state">正在查询端口 ${port}…</div>`;
    const owners = await safely(() => nativeInvoke<PortProcess[]>("inspect_port", { port }), "端口查询失败");
    if (!owners) return;
    operationLog.info("port", "lookup.completed", `端口 ${port} 查询完成`, { owners: owners.length });
    if (!owners.length) {
      results.innerHTML = `<div class="port-free"><span>✓</span><div><b>${port} 当前可用</b><small>没有发现 TCP 监听或 UDP 占用进程</small></div></div>`;
      return;
    }
    results.innerHTML = owners.map(owner => `<article class="port-process">
      <div class="port-process-head"><span class="protocol-badge">${owner.protocol}</span><b>${escapeHtml(owner.processName)}</b><code>PID ${owner.pid}</code></div>
      <p>${escapeHtml(owner.executable ?? (owner.command.join(" ") || "系统未返回程序路径"))}</p>
      <div><small>${escapeHtml(owner.address)}:${owner.port}</small><button class="kill-port danger" data-pid="${owner.pid}" data-name="${escapeHtml(owner.processName)}">结束进程</button></div>
    </article>`).join("");
    results.querySelectorAll<HTMLButtonElement>(".kill-port").forEach(button => button.addEventListener("click", async () => {
      const pid = Number(button.dataset.pid);
      const name = button.dataset.name ?? "未知进程";
      if (!window.confirm(`确认结束 ${name}（PID ${pid}）吗？\n\n它当前占用端口 ${currentPort}，未保存的数据可能丢失。`)) return;
      button.disabled = true;
      const killed = await safely(() => nativeInvoke<void>("kill_port_process", { port: currentPort, pid }), "结束进程失败");
      if (killed === null) { button.disabled = false; return; }
      toast(`已结束 ${name}，端口 ${currentPort} 已释放`);
      window.setTimeout(() => void lookup(), 350);
    }));
  };
  form.addEventListener("submit", event => { event.preventDefault(); void lookup(); });
  input.focus();
}

function settingsMarkup(): string {
  return `<div class="settings-grid">
    <section class="settings-section"><h3>窗口与主题</h3>
      <label><span>窗口置顶<small>主球与工具窗统一遵循</small></span><input id="alwaysOnTop" type="checkbox" ${data.settings.alwaysOnTop ? "checked" : ""}></label>
      <label><span>常驻待办<small>独立小窗显示，不占用主球边界</small></span><input id="pinTodo" type="checkbox" ${data.settings.pinTodo ? "checked" : ""}></label>
      <label><span>水位指标<small>决定球内水位高度</small></span><select id="metric"><option value="memory" ${data.settings.metric === "memory" ? "selected" : ""}>内存</option><option value="cpu" ${data.settings.metric === "cpu" ? "selected" : ""}>CPU</option></select></label>
      <div class="theme-setting"><div class="setting-copy"><span>主题</span><small>同时改变水球材质、季节装饰、功能球与窗口纹理</small></div>
        <div class="theme-picker" role="radiogroup" aria-label="桌面主题">${THEMES.map(theme => `<button type="button" class="theme-choice ${theme.id === data.settings.themeId ? "active" : ""}" data-theme-id="${theme.id}" data-testid="theme-${theme.id}" role="radio" aria-checked="${theme.id === data.settings.themeId}"><i>${theme.icon}</i><span><b>${theme.name}</b><small>${theme.description}</small></span></button>`).join("")}</div>
        <input id="themeId" type="hidden" value="${escapeHtml(data.settings.themeId)}">
      </div>
    </section>
    <section class="settings-section"><h3>功能球</h3>
      <p class="diagnostic-note">选择点击水球后展开的功能。隐藏后仍可从系统托盘打开。</p>
      <div class="tool-visibility">${TOOL_REGISTRY.map(tool => `<label><span><b>${tool.icon}</b>${tool.label}</span><input class="visible-tool" type="checkbox" value="${tool.id}" ${data.settings.visibleTools.includes(tool.id) ? "checked" : ""}></label>`).join("")}</div>
    </section>
    <details class="settings-section"><summary><span>AI 命名</span><small>模型与凭据</small></summary>
      <label><span>启用 AI<small>失败时自动保留本地结果</small></span><input id="aiEnabled" type="checkbox" ${data.settings.aiEnabled ? "checked" : ""}></label>
      <label><span>接口地址</span><input id="aiBaseUrl" value="${escapeHtml(data.settings.aiProvider.baseUrl)}"></label>
      <label><span>模型</span><input id="aiModel" value="${escapeHtml(data.settings.aiProvider.model)}"></label>
      <label><span>API Key<small id="keyStatus">正在检查系统凭据…</small></span><input id="aiKey" type="password" autocomplete="off" placeholder="sk- 按量付费；tp- Token Plan"></label>
      <div id="aiTestStatus" class="connection-status" data-state="idle">尚未测试连接</div>
      <div class="setting-actions"><button id="saveAi" class="icon-action" title="保存并测试 AI" aria-label="保存并测试 AI">✓</button><button id="deleteAi" class="icon-action danger" title="清除 AI 密钥" aria-label="清除 AI 密钥">⌫</button></div>
    </details>
    <details class="settings-section"><summary><span>诊断与本地数据</span><small>日志与缓存</small></summary>
      <div class="diagnostic-toolbar"><button id="refreshLogs" title="刷新日志" aria-label="刷新日志">↻</button><button id="copyLogs" title="复制日志" aria-label="复制日志">⧉</button><button id="clearLogs" title="清空日志" aria-label="清空日志">⌫</button><button id="clearAllData" class="danger" title="清空所有本地数据" aria-label="清空所有本地数据">⊘</button></div>
      <p class="diagnostic-note">日志仅保存在本机，记录操作阶段、窗口和错误；不会记录 API Key 或剪贴板正文。</p>
      <div id="operationLogs" class="operation-logs"><div class="empty-state">正在读取操作日志…</div></div>
    </details>
    <details class="settings-section" open><summary><span>在线更新</span><small>GitHub Releases</small></summary>
      <label><span>启用在线更新<small>仅接受 HTTPS 与签名验证通过的更新包</small></span><input id="updateEnabled" type="checkbox" ${data.settings.updater.enabled ? "checked" : ""}></label>
      <label><span>启动时自动检查<small>只检查版本，不会静默安装</small></span><input id="updateAutoCheck" type="checkbox" ${data.settings.updater.autoCheck ? "checked" : ""}></label>
      <details class="settings-advanced"><summary>高级：更新地址</summary><label><span>更新服务地址<small>默认读取 GitHub Releases 的 latest.json</small></span><input id="updateEndpoint" value="${escapeHtml(data.settings.updater.endpoint)}"></label></details>
      <div id="updateStatus" class="connection-status" data-state="idle">尚未检查更新</div>
      <div class="setting-actions"><button id="checkUpdate" class="icon-action" title="检查更新" aria-label="检查更新">↻</button><button id="installUpdate" class="icon-action" title="下载并安装" aria-label="下载并安装" hidden>↓</button></div>
    </details>
  </div>`;
}

function bindSettings(panel: HTMLElement): void {
  let settingsQueue = Promise.resolve();
  const persist = (): Promise<void> => {
    const next = {
      alwaysOnTop: panel.querySelector<HTMLInputElement>("#alwaysOnTop")!.checked,
      pinTodo: panel.querySelector<HTMLInputElement>("#pinTodo")!.checked,
      metric: panel.querySelector<HTMLSelectElement>("#metric")!.value as "cpu" | "memory",
      themeId: panel.querySelector<HTMLInputElement>("#themeId")!.value,
      aiEnabled: panel.querySelector<HTMLInputElement>("#aiEnabled")!.checked,
      baseUrl: panel.querySelector<HTMLInputElement>("#aiBaseUrl")!.value.trim(),
      model: panel.querySelector<HTMLInputElement>("#aiModel")!.value.trim(),
      visibleTools: [...panel.querySelectorAll<HTMLInputElement>(".visible-tool:checked")].map(node => node.value as ToolId),
      updateEnabled: panel.querySelector<HTMLInputElement>("#updateEnabled")!.checked,
      updateAutoCheck: panel.querySelector<HTMLInputElement>("#updateAutoCheck")!.checked,
      updateEndpoint: panel.querySelector<HTMLInputElement>("#updateEndpoint")!.value.trim(),
    };
    applyTheme(next.themeId);
    settingsQueue = settingsQueue.then(async () => {
      const previous = data.settings;
      data = await repository.update(draft => {
        draft.settings = {
          ...draft.settings,
          alwaysOnTop: next.alwaysOnTop,
          pinTodo: next.pinTodo,
          metric: next.metric,
          themeId: next.themeId,
          aiEnabled: next.aiEnabled,
          visibleTools: next.visibleTools,
          updater: { enabled: next.updateEnabled, autoCheck: next.updateAutoCheck, endpoint: next.updateEndpoint },
          aiProvider: { ...draft.settings.aiProvider, baseUrl: next.baseUrl, model: next.model, timeoutMs: Math.max(draft.settings.aiProvider.timeoutMs, 20_000) },
        };
      });
      if (previous.alwaysOnTop !== next.alwaysOnTop) await optionalNativeInvoke("set_always_on_top", { enabled: next.alwaysOnTop });
      if (previous.pinTodo !== next.pinTodo) await syncPinnedTodoReliably(next.pinTodo, next.alwaysOnTop, "settings");
      operationLog.info("settings", "saved", "设置已按分区保存", { themeId: next.themeId, metric: next.metric, alwaysOnTop: next.alwaysOnTop, pinTodo: next.pinTodo, visibleTools: next.visibleTools });
    });
    return settingsQueue;
  };
  panel.querySelectorAll<HTMLButtonElement>(".theme-choice").forEach(button => button.addEventListener("click", () => {
    const themeId = button.dataset.themeId;
    if (!themeId) return;
    panel.querySelector<HTMLInputElement>("#themeId")!.value = themeId;
    panel.querySelectorAll<HTMLButtonElement>(".theme-choice").forEach(choice => {
      const active = choice === button;
      choice.classList.toggle("active", active);
      choice.setAttribute("aria-checked", String(active));
    });
    applyTheme(themeId);
    void persist();
  }));
  panel.querySelector(".close-panel")?.addEventListener("click", async event => {
    event.stopImmediatePropagation();
    await persist();
    closeTool();
  }, { capture: true });
  panel.querySelectorAll("#alwaysOnTop,#pinTodo,#metric,#aiEnabled,#aiBaseUrl,#aiModel,#updateEnabled,#updateAutoCheck,#updateEndpoint,.visible-tool").forEach(node => node.addEventListener("change", () => void persist()));
  const status = panel.querySelector<HTMLElement>("#keyStatus")!;
  const testState = panel.querySelector<HTMLElement>("#aiTestStatus")!;
  void hasAiKey().then(async exists => {
    status.textContent = exists ? "已安全保存" : "尚未配置";
    if (!exists) return;
    const baseUrlInput = panel.querySelector<HTMLInputElement>("#aiBaseUrl")!;
    const resolution = await nativeInvoke<{ baseUrl: string; credentialKind: string }>("resolve_ai_endpoint", {
      providerId: data.settings.aiProvider.id,
      baseUrl: baseUrlInput.value,
    });
    if (resolution.baseUrl !== baseUrlInput.value.trim().replace(/\/+$/, "")) {
      baseUrlInput.value = resolution.baseUrl;
      await persist();
      operationLog.info("ai", "endpoint.migrated", "已修正已保存凭据对应的接口地址", resolution);
    }
    testState.textContent = resolution.credentialKind === "token-plan" ? "已识别 Token Plan 凭据" : "已识别按量付费凭据";
  }).catch(error => {
    status.textContent = "凭据状态不可用";
    operationLog.warn("ai", "credential.inspect_failed", "检查凭据类型失败", String(error));
  });
  panel.querySelector("#saveAi")?.addEventListener("click", async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    testState.dataset.state = "loading"; testState.textContent = "1/3 正在保存模型配置…";
    try {
      const keyInput = panel.querySelector<HTMLInputElement>("#aiKey")!;
      const key = keyInput.value.trim();
      if (key) {
        const credentialKind = detectMiMoCredentialKind(key);
        if (credentialKind === "unknown") throw new Error("无法识别 API Key 类型，应以 sk-（按量付费）或 tp-（Token Plan）开头");
        const baseUrlInput = panel.querySelector<HTMLInputElement>("#aiBaseUrl")!;
        const resolvedBaseUrl = resolveMiMoBaseUrl(key, baseUrlInput.value);
        if (resolvedBaseUrl !== baseUrlInput.value.trim().replace(/\/+$/, "")) {
          baseUrlInput.value = resolvedBaseUrl;
          operationLog.info("ai", "endpoint.auto_selected", "已根据 API Key 类型自动切换接口", { credentialKind, baseUrl: resolvedBaseUrl });
        }
      }
      await persist();
      if (key) {
        testState.textContent = "2/3 正在写入 Windows 凭据库…";
        await saveAiKey(key);
        keyInput.value = "";
      }
      if (!(await hasAiKey())) throw new Error("系统凭据库中没有找到 API Key，请重新输入后测试");
      status.textContent = "已安全保存";
      testState.textContent = "3/3 正在请求 MiMo，最长等待 20 秒…";
      const response = await testAiConnection(data.settings.aiProvider);
      testState.dataset.state = "success"; testState.textContent = `连接成功：${response.slice(0, 80)}`;
      operationLog.info("ai", "test.success", "设置页连接测试通过");
    } catch (error) {
      testState.dataset.state = "error"; testState.textContent = `连接失败：${String(error)}`;
      operationLog.error("ai", "test.failed", "设置页连接测试失败", String(error));
    } finally {
      button.disabled = false;
      void renderOperationLogs(panel);
    }
  });
  panel.querySelector("#deleteAi")?.addEventListener("click", async () => { await safely(deleteAiKey, "清除密钥失败"); status.textContent = "尚未配置"; });
  panel.querySelector("#refreshLogs")?.addEventListener("click", () => void renderOperationLogs(panel));
  panel.querySelector("#copyLogs")?.addEventListener("click", async () => {
    const logs = await nativeInvoke<OperationLogEntry[]>("read_operation_logs");
    const content = logs.map(formatOperationLog).join("\n");
    await nativeInvoke("write_clipboard_text", { content }); toast("诊断日志已复制");
  });
  panel.querySelector("#clearLogs")?.addEventListener("click", async () => { await nativeInvoke("clear_operation_logs"); await renderOperationLogs(panel); });
  panel.querySelector("#clearAllData")?.addEventListener("click", async () => {
    if (!window.confirm("将删除全部待办、剪贴板历史、工作区、命名历史、设置、操作日志和已保存的 AI Key。此操作不可撤销，确认继续吗？")) return;
    await nativeInvoke("clear_all_local_data", { providerIds: [data.settings.aiProvider.id] });
    localStorage.clear();
    location.reload();
  });
  const updateStatus = panel.querySelector<HTMLElement>("#updateStatus")!;
  const installUpdate = panel.querySelector<HTMLButtonElement>("#installUpdate")!;
  panel.querySelector("#checkUpdate")?.addEventListener("click", async event => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    updateStatus.dataset.state = "loading"; updateStatus.textContent = "正在连接更新服务器…";
    try {
      await persist();
      if (!data.settings.updater.enabled) throw new Error("请先启用在线更新");
      const update = await nativeInvoke<{ currentVersion: string; version: string; date?: string; body?: string } | null>("check_app_update", { endpoint: data.settings.updater.endpoint });
      if (!update) {
        updateStatus.dataset.state = "success"; updateStatus.textContent = "当前已经是最新版本";
        installUpdate.hidden = true;
      } else {
        updateStatus.dataset.state = "success";
        updateStatus.textContent = `发现 ${update.version}（当前 ${update.currentVersion}）${update.body ? `：${update.body.slice(0, 100)}` : ""}`;
        installUpdate.hidden = false;
        operationLog.info("updater", "update.available", "发现新版本", update);
      }
    } catch (error) {
      updateStatus.dataset.state = "error"; updateStatus.textContent = String(error);
      operationLog.error("updater", "check.failed", "检查更新失败", String(error));
    } finally { button.disabled = false; }
  });
  installUpdate.addEventListener("click", async () => {
    if (!window.confirm("将下载经过签名验证的更新包，安装后 CodeSprite 会自动重启。现在继续吗？")) return;
    installUpdate.disabled = true;
    updateStatus.dataset.state = "loading"; updateStatus.textContent = "正在下载并验证更新包，请不要退出…";
    try {
      await nativeInvoke("install_app_update", { endpoint: data.settings.updater.endpoint });
    } catch (error) {
      updateStatus.dataset.state = "error"; updateStatus.textContent = String(error);
      installUpdate.disabled = false;
      operationLog.error("updater", "install.failed", "安装更新失败", String(error));
    }
  });
  void renderOperationLogs(panel);
}

function formatOperationLog(entry: OperationLogEntry): string {
  const time = new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour12: false });
  return `${time} [${entry.level.toUpperCase()}] [${entry.window ?? "-"}] ${entry.area}.${entry.action} ${entry.message}${entry.details ? ` | ${entry.details}` : ""}`;
}

async function renderOperationLogs(panel: HTMLElement): Promise<void> {
  const host = panel.querySelector<HTMLElement>("#operationLogs"); if (!host) return;
  try {
    const logs = await nativeInvoke<OperationLogEntry[]>("read_operation_logs");
    host.innerHTML = logs.length ? logs.slice(-160).reverse().map(entry => `<div class="log-row" data-level="${entry.level}"><time>${new Date(entry.timestamp).toLocaleTimeString("zh-CN", { hour12: false })}</time><b>${escapeHtml(entry.area)} · ${escapeHtml(entry.action)}</b><span>${escapeHtml(entry.message)}</span>${entry.details ? `<code>${escapeHtml(entry.details)}</code>` : ""}</div>`).join("") : `<div class="empty-state">暂无操作日志</div>`;
  } catch (error) {
    host.innerHTML = `<div class="empty-state">读取日志失败：${escapeHtml(String(error))}</div>`;
  }
}

async function init(): Promise<void> {
  installGlobalDiagnostics();
  data = await repository.load();
  if (isTauri && !toolFromUrl && !pinnedView && !satelliteView) {
    try {
      const resolution = await nativeInvoke<{ baseUrl: string; credentialKind: string }>("resolve_ai_endpoint", {
        providerId: data.settings.aiProvider.id,
        baseUrl: data.settings.aiProvider.baseUrl,
      });
      if (resolution.baseUrl !== data.settings.aiProvider.baseUrl.trim().replace(/\/+$/, "")) {
        data = await repository.update(draft => { draft.settings.aiProvider.baseUrl = resolution.baseUrl; });
        operationLog.info("ai", "endpoint.migrated", "启动时已修正凭据对应的接口地址", resolution);
      }
    } catch {
      // 未配置凭据时保持默认地址，设置页会显示“尚未配置”。
    }
  }
  operationLog.info("app", "init", "窗口初始化", { tool: toolFromUrl, pinnedView, satelliteView });
  applyTheme(data.settings.themeId);
  if (isTauri) void listen("app-data-changed", async () => {
    data = await repository.load();
    applyTheme(data.settings.themeId);
    if (pinnedView) renderPinnedTodoWindow();
  });
  if (isTauri) void listen("app-data-reset", () => location.reload());
  if (satelliteView && toolFromUrl && TOOL_REGISTRY.some(tool => tool.id === toolFromUrl)) renderSatelliteWindow(toolFromUrl);
  else if (pinnedView) renderPinnedTodoWindow();
  else if (toolFromUrl && TOOL_REGISTRY.some(tool => tool.id === toolFromUrl)) renderTool(toolFromUrl);
  else renderShell();
}

function renderPinnedTodoWindow(): void {
  document.body.dataset.surface = "pinned-todo";
  const open = data.todos.filter(item => !item.done).slice(0, 5);
  app.innerHTML = `<section class="pinned-todo-window"><header><strong>✓ 今日待办</strong><button id="closePinned">×</button></header><div>${open.length ? open.map(item => `<label class="pinned-row" data-id="${item.id}"><input type="checkbox"><span>${escapeHtml(item.text)}</span><b class="priority ${item.priority.toLowerCase()}">${item.priority}</b></label>`).join("") : `<div class="pinned-empty">今天没有未完成待办</div>`}</div><footer>${data.todos.filter(item => !item.done).length} 项未完成</footer></section><div id="toast" class="toast"></div>`;
  const panel = app.querySelector<HTMLElement>(".pinned-todo-window")!;
  bindToolDrag(panel);
  panel.querySelector("#closePinned")?.addEventListener("click", async () => { data = await repository.update(draft => { draft.settings.pinTodo = false; }); await optionalNativeInvoke("sync_pinned_todo_window", { enabled: false, alwaysOnTop: data.settings.alwaysOnTop }); });
  panel.querySelectorAll<HTMLInputElement>(".pinned-row input").forEach(input => input.addEventListener("change", async () => {
    const id = input.closest<HTMLElement>(".pinned-row")!.dataset.id!;
    data = await repository.update(draft => { const item = draft.todos.find(todo => todo.id === id); if (item) { item.done = true; item.completedAt = new Date().toISOString(); } });
    if (data.settings.todoDocument.path && data.settings.todoDocument.autoSync) await safely(() => writeTodoDocument(), "同步待办文档失败");
    renderPinnedTodoWindow();
  }));
}

void init().catch(error => {
  console.error("CodeSprite 启动失败", error);
  app.innerHTML = `<section class="boot-error"><b>CodeSprite 启动失败</b><span>${escapeHtml(String(error))}</span></section>`;
});
