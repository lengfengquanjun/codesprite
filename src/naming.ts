export type NamingKind = "variable" | "function" | "table" | "field" | "class" | "constant";
export type NamingRule = "camel" | "pascal" | "snake" | "screaming";
export interface NameCandidate { value: string; reason: string }

const dictionary: Record<string, string> = {
  "订单": "order", "排序": "sort", "序号": "no", "编号": "no", "编码": "code",
  "用户": "user", "客户": "customer", "商品": "product", "列表": "list", "集合": "collection",
  "获取": "get", "查询": "find", "创建": "create", "新增": "create", "删除": "delete",
  "更新": "update", "保存": "save", "加载": "load", "校验": "validate", "转换": "convert",
  "名称": "name", "状态": "status", "数量": "count", "总数": "total", "地址": "address",
  "时间": "time", "日期": "date", "是否": "is", "启用": "enabled", "成功": "success",
  "结果": "result", "配置": "config", "文件": "file", "项目": "project", "任务": "task",
  "消息": "message", "请求": "request", "响应": "response", "详情": "detail", "记录": "record",
};

const terms = Object.keys(dictionary).sort((a, b) => b.length - a.length);

function tokenize(input: string): string[] {
  const source = input.trim().toLowerCase();
  const words: string[] = [];
  let index = 0;
  while (index < source.length) {
    const matched = terms.find(term => source.startsWith(term, index));
    if (matched) {
      words.push(dictionary[matched]);
      index += matched.length;
      continue;
    }
    const latin = source.slice(index).match(/^[a-z][a-z0-9]*/)?.[0];
    if (latin) {
      words.push(latin);
      index += latin.length;
      continue;
    }
    index += 1;
  }
  return words.filter((word, position) => word !== words[position - 1]);
}

function format(words: string[], rule: NamingRule): string {
  const clean = words.filter(Boolean);
  if (!clean.length) return "value";
  if (rule === "snake") return clean.join("_");
  if (rule === "screaming") return clean.join("_").toUpperCase();
  return clean.map((word, index) => index === 0 && rule === "camel"
    ? word
    : word[0].toUpperCase() + word.slice(1)).join("");
}

export function generateNames(input: string, kind: NamingKind, rule: NamingRule): NameCandidate[] {
  const base = tokenize(input);
  if (!base.length) return [];
  const variants: Array<[string[], string]> = [[base, "语义完整"]];
  if (base.length > 2) variants.push([base.filter(word => !["detail", "record"].includes(word)), "上下文精简"]);
  if (kind === "function" && !["get", "find", "create", "update", "delete", "save", "load", "validate", "convert"].includes(base[0])) {
    variants.push([["get", ...base], "函数意图明确"]);
  }
  if (kind === "class") variants.push([[...base, "service"], "职责明确"]);
  if (kind === "table" && !base.includes("record")) variants.push([[...base, "record"], "表语义清晰"]);
  if (base.includes("sort") && base.includes("no")) variants.push([["sort", "no"], "工程常用"]);
  if (base[base.length - 1] === "no") variants.push([[...base.slice(0, -1), "number"], "避免歧义"]);

  const unique = new Map<string, NameCandidate>();
  variants.forEach(([words, reason]) => {
    const value = format(words, rule);
    if (!unique.has(value)) unique.set(value, { value, reason });
  });
  return [...unique.values()].slice(0, 5);
}
