import { describe, expect, it } from "vitest";
import {
  detectMiMoCredentialKind,
  buildNamingPrompt,
  MIMO_PAY_AS_YOU_GO_URL,
  MIMO_TOKEN_PLAN_URL,
  resolveMiMoBaseUrl,
} from "./provider";

describe("MiMo credential routing", () => {
  it("detects Token Plan and pay-as-you-go keys", () => {
    expect(detectMiMoCredentialKind(" tp-example ")).toBe("token-plan");
    expect(detectMiMoCredentialKind("sk-example")).toBe("pay-as-you-go");
    expect(detectMiMoCredentialKind("other")).toBe("unknown");
  });

  it("selects the matching official endpoint without replacing custom proxies", () => {
    expect(resolveMiMoBaseUrl("tp-example", MIMO_PAY_AS_YOU_GO_URL)).toBe(MIMO_TOKEN_PLAN_URL);
    expect(resolveMiMoBaseUrl("sk-example", MIMO_TOKEN_PLAN_URL)).toBe(MIMO_PAY_AS_YOU_GO_URL);
    expect(resolveMiMoBaseUrl("tp-example", "https://proxy.example/v1")).toBe("https://proxy.example/v1");
  });

  it("keeps the variable naming prompt compact", () => {
    const prompt = buildNamingPrompt({ input: "查询用户订单列表", kind: "function", rule: "camel", language: "TypeScript" });
    expect(prompt).toContain("查询用户订单列表");
    expect(prompt.length).toBeLessThan(100);
  });
});
