import { CURSOR_CONFIG } from "../constants/oauth";

interface TokenStorageInstructions {
  title: string;
  steps: string[];
  alternativeMethod: string[];
}

/**
 * Cursor IDE OAuth Service
 * Supports Import Token method from Cursor IDE's local SQLite database
 */
export class CursorService {
  config: Record<string, unknown>;

  constructor() {
    this.config = CURSOR_CONFIG as Record<string, unknown>;
  }

  /**
   * Generate Cursor checksum (jyh cipher)
   */
  generateChecksum(machineId: string): string {
    const timestamp: string = Math.floor(Date.now() / 1000).toString();
    let key: number = 165;
    const encoded: number[] = [];

    for (let i = 0; i < timestamp.length; i++) {
      const charCode: number = timestamp.charCodeAt(i);
      encoded.push(charCode ^ key);
      key = (key + charCode) & 0xff;
    }

    const base64Encoded: string = Buffer.from(encoded).toString("base64");
    return `${base64Encoded},${machineId}`;
  }

  /**
   * Build request headers for Cursor API
   */
  buildHeaders(accessToken: string, machineId: string, ghostMode: boolean = false): Record<string, string> {
    const checksum: string = this.generateChecksum(machineId);

    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/connect+proto",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-version": this.config.clientVersion as string,
      "x-cursor-client-type": this.config.clientType as string,
      "x-cursor-client-os": this.detectOS(),
      "x-cursor-client-arch": this.detectArch(),
      "x-cursor-client-device-type": "desktop",
      "x-cursor-checksum": checksum,
      "x-ghost-mode": ghostMode ? "true" : "false",
    };
  }

  /**
   * Detect OS for headers
   */
  detectOS(): string {
    if (typeof process !== "undefined") {
      const platform: string = process.platform;
      if (platform === "win32") return "windows";
      if (platform === "darwin") return "macos";
      return "linux";
    }
    return "linux";
  }

  /**
   * Detect architecture for headers
   */
  detectArch(): string {
    if (typeof process !== "undefined") {
      const arch: string = process.arch;
      if (arch === "x64") return "x86_64";
      if (arch === "arm64") return "aarch64";
      return arch;
    }
    return "x86_64";
  }

  /**
   * Validate and import token from Cursor IDE
   */
  async validateImportToken(accessToken: string, machineId: string): Promise<{ accessToken: string; machineId: string; expiresIn: number; authMethod: string }> {
    if (!accessToken || typeof accessToken !== "string") {
      throw new Error("Access token is required");
    }

    if (!machineId || typeof machineId !== "string") {
      throw new Error("Machine ID is required");
    }

    if (accessToken.length < 50) {
      throw new Error("Invalid token format. Token appears too short.");
    }

    const uuidRegex: RegExp = /^[a-f0-9-]{32,}$/i;
    if (!uuidRegex.test(machineId.replace(/-/g, ""))) {
      throw new Error("Invalid machine ID format. Expected UUID format.");
    }

    return {
      accessToken,
      machineId,
      expiresIn: 86400,
      authMethod: "imported",
    };
  }

  /**
   * Extract user info from token if possible
   */
  extractUserInfo(accessToken: string): { email: string; userId: string } | null {
    try {
      const parts: string[] = accessToken.split(".");
      if (parts.length === 3) {
        let payload: string = parts[1];
        while (payload.length % 4) {
          payload += "=";
        }
        const decoded: Record<string, unknown> = JSON.parse(
          Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
        );
        return {
          email: (decoded.email as string) || (decoded.sub as string),
          userId: (decoded.sub as string) || (decoded.user_id as string),
        };
      }
    } catch {
      // Token is not a JWT, that's okay
    }

    return null;
  }

  /**
   * Get token storage path instructions for user
   */
  getTokenStorageInstructions(): TokenStorageInstructions {
    return {
      title: "How to get your Cursor token",
      steps: [
        "1. Open Cursor IDE and make sure you're logged in",
        "2. Find the state.vscdb file:",
        `   - Linux: ${(this.config.tokenStoragePaths as Record<string, string>).linux}`,
        `   - macOS: ${(this.config.tokenStoragePaths as Record<string, string>).macos}`,
        `   - Windows: ${(this.config.tokenStoragePaths as Record<string, string>).windows}`,
        "3. Open the database with SQLite browser or CLI:",
        "   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='cursorAuth/accessToken'\"",
        "4. Also get the machine ID:",
        "   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='storage.serviceMachineId'\"",
        "5. Paste both values in the form below",
      ],
      alternativeMethod: [
        "Or use this one-liner to get both values:",
        "sqlite3 state.vscdb \"SELECT key, value FROM itemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')\"",
      ],
    };
  }
}
