import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const MIN_BUN_VERSION = "1.2.0";

const MAX_BUFFER = 8 * 1024 * 1024;

export interface BunResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export class BunNotFoundError extends Error {}

// The VS Code extension host is Node, not Bun, so we shell out to the `bun`
// binary on PATH rather than using Bun's own APIs.
export async function runBun(
  args: string[],
  cwd: string,
  bunPath = "bun"
): Promise<BunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bunPath, args, {
      cwd,
      maxBuffer: MAX_BUFFER,
    });
    return { exitCode: 0, stderr, stdout };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    if (err.code === "ENOENT") {
      throw new BunNotFoundError(`Could not find "${bunPath}" on PATH.`, {
        cause: error,
      });
    }
    // Non-zero exit still carries useful stdout (e.g. `bun audit` exits 1 when
    // vulnerabilities are found).
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stderr: err.stderr ?? "",
      stdout: err.stdout ?? "",
    };
  }
}

export async function getBunVersion(bunPath = "bun"): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bunPath, ["--version"], {
      maxBuffer: MAX_BUFFER,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export function isVersionAtLeast(actual: string, minimum: string): boolean {
  const a = parseVersion(actual);
  const b = parseVersion(minimum);
  for (let i = 0; i < 3; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) {
      return left > right;
    }
  }
  return true;
}

function parseVersion(version: string): number[] {
  const core = version.split("-")[0] ?? version;
  return core.split(".").map((part) => Number.parseInt(part, 10) || 0);
}
