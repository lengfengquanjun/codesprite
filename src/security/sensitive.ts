const SENSITIVE_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|tp|ghp|glpat|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret)\s*[:=]\s*["']?[^\s"']{8,}/i,
];

export function looksSensitiveText(content: string): boolean {
  const value = content.trim();
  if (!value) return false;
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(value));
}

export function removeSensitiveClipboardItems<T extends { content: string }>(items: T[]): T[] {
  return items.filter(item => !looksSensitiveText(item.content));
}
