const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /Bearer\s+[A-Za-z0-9._~-]+/gi;

export function redactText(value: string): string {
  return value.replace(BEARER, "Bearer [REDACTED]").replace(JWT, "[REDACTED_JWT]");
}

export function redactValue(value: unknown, key = ""): unknown {
  if (/password|token|authorization|cookie|secret/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        redactValue(child, childKey),
      ]),
    );
  }
  return value;
}

export function safeError(error: unknown): { name: string; message: string; code?: string; details?: unknown } {
  const candidate = error as Error & { code?: string; details?: unknown };
  return {
    name: candidate?.name || "Error",
    message: redactText(candidate?.message || String(error)),
    ...(candidate?.code ? { code: candidate.code } : {}),
    ...(candidate?.details !== undefined ? { details: redactValue(candidate.details) } : {}),
  };
}
