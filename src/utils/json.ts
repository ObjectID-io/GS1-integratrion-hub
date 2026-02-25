export function safeJsonStringify(v: unknown, space?: number): string {
  try {
    return JSON.stringify(v, null, space);
  } catch {
    return "";
  }
}
