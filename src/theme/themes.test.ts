import { describe, expect, it } from "vitest";
import { THEMES } from "./themes";

describe("theme manifests", () => {
  it("provides unique configurable themes including seasonal variants", () => {
    expect(new Set(THEMES.map(theme => theme.id)).size).toBe(THEMES.length);
    expect(THEMES.map(theme => theme.decoration)).toEqual(expect.arrayContaining(["winter", "summer"]));
  });

  it.each(THEMES)("$id defines visual, motion and required color tokens", theme => {
    expect(theme.name).not.toHaveLength(0);
    expect(theme.description).not.toHaveLength(0);
    expect(["calm", "lively"]).toContain(theme.motion);
    expect(theme.tokens).toEqual(expect.objectContaining({
      accent: expect.any(String),
      surface: expect.any(String),
      "orb-core": expect.any(String),
      "orb-water-top": expect.any(String),
      "orb-water-bottom": expect.any(String),
    }));
  });
});
