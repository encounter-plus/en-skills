import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { CredentialStoreLike } from "./types.js";
import {WindowsCredentialReader,startWindowsCredentialReader} from './windows-credential-reader.js';

const SERVICE = "en-skills.encounter";

interface ProcessResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runProcess(command: string, args: string[], stdin = ""): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? 1 }));
    child.stdin.end(stdin);
  });
}

async function runFirst(commands: string[], args: string[], stdin = ""): Promise<ProcessResult> {
  let lastError: unknown;
  for (const command of commands) {
    try {
      return await runProcess(command, args, stdin);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      lastError = error;
    }
  }
  throw lastError ?? new Error(`Executable not found: ${commands.join(" or ")}`);
}

export class OsCredentialStore implements CredentialStoreLike {
  private readonly windowsReaders = new Map<string,WindowsCredentialReader>();
  backend(): string {
    if (process.platform === "win32") return "Windows Credential Manager";
    if (process.platform === "darwin") return "macOS Keychain";
    if (process.platform === "linux") return "Secret Service (secret-tool)";
    return "unsupported";
  }

  async get(profileName: string): Promise<string | null> {
    if(process.platform==='win32'){
      let reader=this.windowsReaders.get(profileName);
      if(!reader){
        const script=fileURLToPath(new URL('../scripts/windows-credential.ps1',import.meta.url));
        reader=new WindowsCredentialReader(()=>startWindowsCredentialReader(script,`${SERVICE}:profile:${profileName}`));
        this.windowsReaders.set(profileName,reader);
      }
      const value=await reader.get();return value?.replace(/[\r\n]+$/,'')||null;
    }
    const result = await this.execute("get", profileName);
    if (result.code === 2) return null;
    if (result.code !== 0) throw new Error(`Credential read failed (${this.backend()}): ${result.stderr.trim()}`);
    const value = result.stdout.replace(/[\r\n]+$/, "");
    return value || null;
  }

  async set(profileName: string, token: string): Promise<void> {
    if (!token) throw new Error("Refusing to store an empty token");
    const result = await this.execute("set", profileName, token);
    if (result.code !== 0) throw new Error(`Credential write failed (${this.backend()}): ${result.stderr.trim()}`);
  }

  async delete(profileName: string): Promise<void> {
    const result = await this.execute("delete", profileName);
    if (result.code !== 0 && result.code !== 2) {
      throw new Error(`Credential delete failed (${this.backend()}): ${result.stderr.trim()}`);
    }
  }

  private async execute(action: "get" | "set" | "delete", profileName: string, secret = ""): Promise<ProcessResult> {
    const account = `profile:${profileName}`;
    if (process.platform === "win32") {
      const script = fileURLToPath(new URL("../scripts/windows-credential.ps1", import.meta.url));
      return runFirst(
        [process.env.POWERSHELL_EXE || "pwsh.exe", "powershell.exe"],
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, action, `${SERVICE}:${account}`],
        secret,
      );
    }

    if (process.platform === "darwin") {
      if (action === "get") return runProcess("security", ["find-generic-password", "-s", SERVICE, "-a", account, "-w"]);
      if (action === "delete") return runProcess("security", ["delete-generic-password", "-s", SERVICE, "-a", account]);
      // The macOS security CLI has no stdin option for add-generic-password.
      return runProcess("security", ["add-generic-password", "-U", "-s", SERVICE, "-a", account, "-w", secret]);
    }

    if (process.platform === "linux") {
      const attributes = ["service", SERVICE, "account", account];
      if (action === "get") return runProcess("secret-tool", ["lookup", ...attributes]);
      if (action === "delete") return runProcess("secret-tool", ["clear", ...attributes]);
      return runProcess("secret-tool", ["store", `--label=Encounter agent ${profileName}`, ...attributes], secret);
    }

    throw new Error(`No OS credential backend for ${process.platform}`);
  }
}

export class MemoryCredentialStore implements CredentialStoreLike {
  private readonly values = new Map<string, string>();
  backend(): string {
    return "memory";
  }
  async get(profileName: string): Promise<string | null> {
    return this.values.get(profileName) ?? null;
  }
  async set(profileName: string, token: string): Promise<void> {
    this.values.set(profileName, token);
  }
  async delete(profileName: string): Promise<void> {
    this.values.delete(profileName);
  }
}
