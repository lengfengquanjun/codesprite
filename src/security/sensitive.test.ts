import { describe, expect, it } from "vitest";
import { looksSensitiveText, removeSensitiveClipboardItems } from "./sensitive";

describe("sensitive clipboard protection", () => {
  it.each([
    "tp-" + "example0123456789abcdefghijklmnopqrstuvwxyz",
    "sk-" + "examplekey012345678901234567890",
    "github" + "_pat_11ABCDEF012345678901234567890",
    "password = very-secret-password",
    "-----BEGIN " + "PRIVATE KEY-----\nsecret",
    "eyJhbGciOiJIUzI1NiJ9.abcdefghijklmno.abcdefghijklmno",
  ])("detects credential-like content without storing it: %s", value => {
    expect(looksSensitiveText(value)).toBe(true);
  });

  it.each([
    "SortNo",
    "const tokenCount = 3",
    "https://github.com/lengfengquanjun/codesprite",
    "修复设置页面复选框错位",
  ])("keeps normal developer clipboard content: %s", value => {
    expect(looksSensitiveText(value)).toBe(false);
  });

  it("removes sensitive legacy records", () => {
    const result = removeSensitiveClipboardItems([
      { id: "safe", content: "hello" },
      { id: "secret", content: "tp-" + "example0123456789abcdefghijklmnopqrstuvwxyz" },
    ]);
    expect(result.map(item => item.id)).toEqual(["safe"]);
  });
});
