import { describe, expect, it } from "vitest";
import { generateNames } from "./naming";

describe("local naming fallback", () => {
  it("preserves Chinese phrase order", () => {
    expect(generateNames("订单排序序号", "variable", "camel")[0].value).toBe("orderSortNo");
  });

  it("adds a verb for function names", () => {
    expect(generateNames("订单详情", "function", "camel").map(item => item.value)).toContain("getOrderDetail");
  });

  it("supports database and constant conventions", () => {
    expect(generateNames("用户状态", "field", "snake")[0].value).toBe("user_status");
    expect(generateNames("最大数量", "constant", "screaming")[0].value).toBe("COUNT");
  });

  it("returns no misleading fallback for unknown Chinese", () => {
    expect(generateNames("完全未知词", "variable", "camel")).toEqual([]);
  });
});
