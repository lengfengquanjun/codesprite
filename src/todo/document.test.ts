import { describe, expect, it } from "vitest";
import type { TodoItem } from "../core/types";
import { DOCUMENT_END, DOCUMENT_START, parseTodoDocument, serializeTodoDocument } from "./document";

const items: TodoItem[] = [
  { id: "a", kind: "todo", text: "修复登录", priority: "P0", done: false, dueAt: "2026-07-20T10:30:00.000Z", createdAt: "2026-07-19T01:00:00.000Z" },
  { id: "b", kind: "memo", text: "接口需兼容旧版本", priority: "P2", done: false, createdAt: "2026-07-19T02:00:00.000Z" },
];

describe("todo markdown document", () => {
  it("round trips managed items", () => {
    const parsed = parseTodoDocument(serializeTodoDocument(items));
    expect(parsed.map(item => [item.id, item.kind, item.text, item.priority])).toEqual([
      ["a", "todo", "修复登录", "P0"], ["b", "memo", "接口需兼容旧版本", "P2"],
    ]);
  });

  it("preserves content outside the managed block", () => {
    const original = `# 我的工作记录\n\n前言\n\n${DOCUMENT_START}\n## 待办\n${DOCUMENT_END}\n\n## 私人笔记\n不要删除`;
    const output = serializeTodoDocument(items, original);
    expect(output).toContain("前言");
    expect(output).toContain("## 私人笔记\n不要删除");
  });

  it("accepts a hand-written todo without metadata", () => {
    const parsed = parseTodoDocument("## 待办\n- [ ] [P1] 编写文档 | 截止: 2026-07-21 09:00");
    expect(parsed[0]).toMatchObject({ kind: "todo", text: "编写文档", priority: "P1", done: false });
    expect(parsed[0].dueAt).toBeTruthy();
  });
});
