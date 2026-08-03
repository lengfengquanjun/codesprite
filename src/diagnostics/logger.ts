import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri, nativeInvoke } from "../platform/native";

export type LogLevel = "debug" | "info" | "warn" | "error";
export interface OperationLogEntry {
  timestamp: number;
  level: LogLevel;
  area: string;
  action: string;
  message: string;
  details?: string;
  window?: string;
}

function currentWindow(): string {
  try { return isTauri ? getCurrentWebviewWindow().label : "browser"; }
  catch { return "unknown"; }
}

export function logOperation(level: LogLevel, area: string, action: string, message: string, details?: unknown): void {
  if (!isTauri) return;
  const safeDetails = details === undefined
    ? undefined
    : typeof details === "string" ? details : JSON.stringify(details);
  void nativeInvoke("write_operation_log", {
    entry: { level, area, action, message, details: safeDetails, window: currentWindow() },
  }).catch(error => console.error("写入操作日志失败", error));
}

export const operationLog = {
  debug: (area: string, action: string, message: string, details?: unknown) => logOperation("debug", area, action, message, details),
  info: (area: string, action: string, message: string, details?: unknown) => logOperation("info", area, action, message, details),
  warn: (area: string, action: string, message: string, details?: unknown) => logOperation("warn", area, action, message, details),
  error: (area: string, action: string, message: string, details?: unknown) => logOperation("error", area, action, message, details),
};

export function installGlobalDiagnostics(): void {
  window.addEventListener("error", event => operationLog.error("runtime", "window.error", event.message, `${event.filename}:${event.lineno}:${event.colno}`));
  window.addEventListener("unhandledrejection", event => operationLog.error("runtime", "promise.rejected", "未处理的异步异常", String(event.reason)));
  document.addEventListener("click", event => {
    const target = (event.target as HTMLElement).closest<HTMLElement>("button,[data-tool],[data-action]");
    if (!target) return;
    operationLog.debug("ui", "click", target.getAttribute("aria-label") || target.textContent?.trim().slice(0, 40) || target.id || target.tagName, {
      id: target.id || undefined,
      tool: target.dataset.tool,
      action: target.dataset.action,
    });
  }, true);
  document.addEventListener("change", event => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (!target.id || target.type === "password" || target.type === "text") return;
    operationLog.debug("ui", "change", target.id, target instanceof HTMLInputElement && target.type === "checkbox" ? { checked: target.checked } : undefined);
  }, true);
  let expected = Date.now() + 5_000;
  window.setInterval(() => {
    const now = Date.now();
    const delay = now - expected;
    if (delay > 2_000) operationLog.warn("runtime", "event-loop.stalled", "界面事件循环出现明显阻塞", { delayMs: delay });
    expected = now + 5_000;
  }, 5_000);
}
