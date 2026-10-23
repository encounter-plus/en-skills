import type { ApiLike, ApiRequestOptions, CredentialStoreLike, EncounterProfile } from "./types.js";
import { redactText, redactValue } from "./redaction.js";

const MAX_ERROR_BODY = 8_192;

export class ApiError extends Error {
  readonly code = "ENCOUNTER_API_ERROR";
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function extractToken(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  for (const key of ["token", "access_token", "accessToken"]) {
    if (typeof object[key] === "string" && object[key]) return object[key] as string;
  }
  return null;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("json") || /^[\[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      // Preserve the body below; some API errors incorrectly advertise JSON.
    }
  }
  return text;
}

export class EncounterApiClient implements ApiLike {
  constructor(
    readonly profile: EncounterProfile,
    readonly profileName: string,
    readonly credentials: CredentialStoreLike,
    readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async login(login: string, password: string): Promise<{ response: unknown; token: string }> {
    const response = await this.requestInternal("POST", "/login", {
      auth: false,
      retryAuth: false,
      body: { login, password, shared_computer: false },
    });
    const token = extractToken(response);
    if (!token) throw new Error("Login succeeded but the response did not contain a JWT token");
    await this.credentials.set(this.profileName, token);
    return { response: redactValue(response), token };
  }

  async request<T = unknown>(method: string, requestPath: string, options: ApiRequestOptions = {}): Promise<T> {
    return (await this.requestInternal(method, requestPath, options)) as T;
  }

  private async requestInternal(method: string, requestPath: string, options: ApiRequestOptions): Promise<unknown> {
    const auth = options.auth !== false;
    const token = auth ? await this.credentials.get(this.profileName) : null;
    if (auth && !token) {
      throw new Error(`Profile '${this.profileName}' is not authenticated. Run encounter-agent auth login --profile ${this.profileName}`);
    }

    const response = await this.fetchOnce(method, requestPath, options.body, token,options.headers);
    if (response.status === 401 && auth && options.retryAuth !== false && ["GET", "HEAD"].includes(method.toUpperCase())) {
      const refreshed = await this.refreshToken(token as string);
      if (refreshed) {
        const retry = await this.fetchOnce(method, requestPath, options.body, refreshed,options.headers);
        return this.finishResponse(retry, method, requestPath);
      }
    }
    return this.finishResponse(response, method, requestPath);
  }

  private async fetchOnce(method: string, requestPath: string, body: unknown, token: string | null,extraHeaders?:Record<string,string>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const url = new URL(requestPath, `${this.profile.apiBaseUrl}/`);
    const headers: Record<string, string> = {
      ...extraHeaders,
      Accept: "application/json",
      "X-En-Domain": this.profile.domain,
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ApiError(`Network error for ${method} ${requestPath}: ${redactText(message)}`, 0, method, requestPath);
    } finally {
      clearTimeout(timer);
    }
  }

  private async refreshToken(currentToken: string): Promise<string | null> {
    const response = await this.fetchOnce("POST", "/refresh-token", undefined, currentToken);
    if (!response.ok) return null;
    const parsed = await parseResponse(response);
    const token = extractToken(parsed);
    if (!token) return null;
    await this.credentials.set(this.profileName, token);
    return token;
  }

  private async finishResponse(response: Response, method: string, requestPath: string): Promise<unknown> {
    const parsed = await parseResponse(response);
    if (!response.ok) {
      const raw = typeof parsed === "string" ? parsed.slice(0, MAX_ERROR_BODY) : parsed;
      throw new ApiError(
        `Encounter API returned HTTP ${response.status} for ${method} ${requestPath}`,
        response.status,
        method,
        requestPath,
        redactValue(raw),
      );
    }
    return parsed;
  }
}
