import type { AiProviderConfig } from "../core/types";
import { nativeInvoke } from "../platform/native";

export const MIMO_PAY_AS_YOU_GO_URL = "https://api.xiaomimimo.com/v1";
export const MIMO_TOKEN_PLAN_URL = "https://token-plan-cn.xiaomimimo.com/v1";

export type MiMoCredentialKind = "pay-as-you-go" | "token-plan" | "unknown";

export function detectMiMoCredentialKind(apiKey: string): MiMoCredentialKind {
  const normalized = apiKey.trim().toLowerCase();
  if (normalized.startsWith("tp-")) return "token-plan";
  if (normalized.startsWith("sk-")) return "pay-as-you-go";
  return "unknown";
}

export function resolveMiMoBaseUrl(apiKey: string, configuredBaseUrl: string): string {
  const configured = configuredBaseUrl.trim().replace(/\/+$/, "");
  const officialUrls = new Set([MIMO_PAY_AS_YOU_GO_URL, MIMO_TOKEN_PLAN_URL]);
  if (!officialUrls.has(configured)) return configured;
  const kind = detectMiMoCredentialKind(apiKey);
  if (kind === "token-plan") return MIMO_TOKEN_PLAN_URL;
  if (kind === "pay-as-you-go") return MIMO_PAY_AS_YOU_GO_URL;
  return configured;
}

export interface NamingAiRequest {
  input: string;
  kind: string;
  rule: string;
  language: string;
}

export interface NamingAiCandidate { value: string; reason: string }

export interface AiChatOptions {
  systemPrompt?: string;
  maxCompletionTokens?: number;
  jsonObject?: boolean;
  temperature?: number;
  topP?: number;
}

const NAMING_SYSTEM_PROMPT = "你是工程代码命名器。只输出JSON对象：{\"names\":[{\"value\":\"标识符\",\"reason\":\"六字内理由\"}]}。恰好3项，短而语义完整，符合语言习惯，禁生造缩写；序号用No，编码用Code，数量用Count。";

export function buildNamingPrompt(request: NamingAiRequest): string {
  return `意图=${request.input};类型=${request.kind};格式=${request.rule};语言=${request.language}`;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return JSON.parse(source);
}

export async function generateNamesWithAi(config: AiProviderConfig, request: NamingAiRequest): Promise<NamingAiCandidate[]> {
  const prompt = buildNamingPrompt(request);
  const options: AiChatOptions = {
    systemPrompt: NAMING_SYSTEM_PROMPT,
    maxCompletionTokens: 180,
    jsonObject: true,
    temperature: 0.15,
    topP: 0.8,
  };
  const response = await nativeInvoke<string>("ai_chat", { config: { ...config, timeoutMs: Math.min(config.timeoutMs, 12_000) }, prompt, options });
  const parsed = extractJson(response);
  const items = Array.isArray(parsed) ? parsed : (parsed as { names?: unknown })?.names;
  if (!Array.isArray(items)) throw new Error("模型返回格式缺少 names 数组");
  return items
    .filter(item => item && typeof item.value === "string" && typeof item.reason === "string")
    .map(item => ({ value: item.value.trim(), reason: item.reason.trim() }))
    .filter(item => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.value))
    .slice(0, 3);
}

export async function testAiConnection(config: AiProviderConfig): Promise<string> {
  const response = await nativeInvoke<string>("ai_chat", {
    config: { ...config, timeoutMs: Math.max(config.timeoutMs, 20_000) },
    prompt: "这是连接测试。请只回复 OK。",
  });
  if (!response.trim()) throw new Error("模型返回了空响应");
  return response.trim();
}

export async function saveAiKey(apiKey: string): Promise<void> {
  await nativeInvoke("save_ai_secret", { providerId: "xiaomi-mimo", apiKey });
}

export async function hasAiKey(): Promise<boolean> {
  return nativeInvoke("has_ai_secret", { providerId: "xiaomi-mimo" });
}

export async function deleteAiKey(): Promise<void> {
  await nativeInvoke("delete_ai_secret", { providerId: "xiaomi-mimo" });
}
