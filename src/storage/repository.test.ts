import { describe, expect, it } from "vitest";
import { DEFAULT_DATA } from "../config/defaults";
import { mergeData } from "./repository";

describe("app data migration", () => {
  it("moves the retired updater placeholder to GitHub Releases", () => {
    const value = mergeData({
      settings: {
        ...DEFAULT_DATA.settings,
        updater: {
          enabled: true,
          autoCheck: true,
          endpoint: "https://updates.codesprite.dev/{{target}}/{{arch}}/{{current_version}}",
        },
      },
    });
    expect(value.settings.updater.endpoint).toBe("https://github.com/lengfengquanjun/codesprite/releases/latest/download/latest.json");
  });

  it("sanitizes sensitive clipboard records while loading legacy data", () => {
    const value = mergeData({
      clipboard: [
        { id: "safe", content: "SortNo", kind: "code", favorite: false, createdAt: "now", lastUsedAt: "now" },
        { id: "secret", content: "tp-example0123456789abcdefghijklmnopqrstuvwxyz", kind: "text", favorite: false, createdAt: "now", lastUsedAt: "now" },
      ],
    });
    expect(value.clipboard.map(item => item.id)).toEqual(["safe"]);
  });
});
