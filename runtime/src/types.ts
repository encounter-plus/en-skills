export interface EncounterProfile {
  name: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  domain: string;
  previewUrlTemplate?: string;
  username?: string;
}

export interface ProfilesFile {
  version: 1;
  activeProfile?: string;
  profiles: Record<string, EncounterProfile>;
}

export interface ApiLike {
  authoringPort?(gameId:number):Promise<import('../../src/authoring-api.ts').AuthoringApiPort>;
  authoringMetadata?(gameId: number): Promise<import('../../src/authoring-api.ts').AuthoringMetadata>;
  request<T = unknown>(method: string, path: string, options?: ApiRequestOptions): Promise<T>;
}

export interface ApiRequestOptions {
  body?: unknown;
  auth?: boolean;
  retryAuth?: boolean;
  headers?: Record<string,string>;
}

export interface CredentialStoreLike {
  get(profileName: string): Promise<string | null>;
  set(profileName: string, token: string): Promise<void>;
  delete(profileName: string): Promise<void>;
  backend(): string;
}

export interface LiveContext {
  state: "live" | "not-live" | "unknown";
  currentCount: number;
  passedCount: number;
  checkedAt: string;
  error?: string;
  raw?: unknown;
}

export type RiskOperation =
  | "write-level-content"
  | "update-task"
  | "update-hint"
  | "add-answer-alias"
  | "update-answer"
  | "move-answer"
  | "post-message"
  | "update-game-settings"
  | "create-level"
  | "delete-level"
  | "copy-level"
  | "dismiss-level"
  | "restore-level"
  | "delete-sector";

export interface RiskDecision {
  action: "allow" | "confirm" | "deny";
  reason: string;
}
