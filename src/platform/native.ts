import { invoke, isTauri as detectTauri } from "@tauri-apps/api/core";

export const isTauri = detectTauri();

export async function nativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) throw new Error(`原生命令 ${command} 只能在桌面应用中使用`);
  return invoke<T>(command, args);
}

export async function optionalNativeInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  return nativeInvoke<T>(command, args);
}
