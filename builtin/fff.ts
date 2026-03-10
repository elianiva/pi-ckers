import path from "node:path";
import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import https from "node:https";
import { fileURLToPath } from "node:url";
import os from "node:os";
import k from "koffi";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { createPicker } from "../create-picker";
import type { PickerContext } from "../types";

const RELEASE_BASE_URL =
  "https://github.com/dmtrKovalenko/fff.nvim/releases/download/10a27f9";

// Platform mapping
function getPlatformInfo(): {
  arch: string;
  os: string;
  suffix: string;
  supported: boolean;
} {
  const platform = os.platform();
  const arch = os.arch();

  // Map Node.js arch to Rust-style arch
  const archMap: Record<string, string> = {
    arm64: "aarch64",
    x64: "x86_64",
  };

  // Determine OS and suffix
  let osName: string;
  let suffix: string;

  switch (platform) {
    case "darwin":
      osName = "apple-darwin";
      suffix = "dylib";
      break;
    case "linux":
      osName = "unknown-linux-gnu";
      suffix = "so";
      break;
    case "android":
      osName = "linux-android";
      suffix = "so";
      break;
    case "win32":
      osName = "pc-windows-msvc";
      suffix = "dll";
      break;
    default:
      return { arch: "", os: "", suffix: "", supported: false };
  }

  const mappedArch = archMap[arch];
  if (!mappedArch) {
    return { arch: "", os: "", suffix: "", supported: false };
  }

  return {
    arch: mappedArch,
    os: osName,
    suffix,
    supported: true,
  };
}

function getBinaryFilename(): { filename: string; supported: boolean } {
  const info = getPlatformInfo();
  if (!info.supported) {
    return { filename: "", supported: false };
  }
  const filename = `c-lib-${info.arch}-${info.os}.${info.suffix}`;
  return { filename, supported: true };
}

function getBinaryUrl(): { url: string | null; localName: string } {
  const { filename, supported } = getBinaryFilename();
  if (!supported) {
    return { url: null, localName: filename };
  }
  return { url: `${RELEASE_BASE_URL}/${filename}`, localName: filename };
}

// Anonymous struct definition - avoids duplicate type name errors on hot reload
const fffResultStruct = k.struct({
  success: "bool",
  _pad0: k.array("uint8", 7),
  data: "void *",
  error: "void *",
  handle: "void *",
});

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }

        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve()));
        file.on("error", (err) => {
          fs.unlink(dest).catch(() => {});
          reject(err);
        });
      })
      .on("error", (err) => {
        fs.unlink(dest).catch(() => {});
        reject(err);
      });
  });
}

async function downloadText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          downloadText(res.headers.location).then(resolve, reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }

        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
      })
      .on("error", reject);
  });
}

function parseSha256(text: string): string | null {
  const match = text.match(/([a-f0-9]{64})/i);
  return match?.[1]?.toLowerCase() ?? null;
}

async function sha256File(filePath: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  const bytes = await fs.readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyBinary(filePath: string, binaryUrl: string): Promise<boolean> {
  const expectedShaText = await downloadText(`${binaryUrl}.sha256`);
  const expectedSha = parseSha256(expectedShaText);
  if (!expectedSha) {
    throw new Error("Invalid .sha256 file format");
  }

  const actualSha = await sha256File(filePath);
  return actualSha === expectedSha;
}

async function ensureFffBinary(binDir: string): Promise<string | null> {
  const { url, localName } = getBinaryUrl();
  if (!url) {
    return null;
  }

  await fs.mkdir(binDir, { recursive: true });
  const target = path.join(binDir, localName);

  try {
    await fs.access(target);
    if (await verifyBinary(target, url)) {
      return target;
    }
    await fs.unlink(target).catch(() => {});
  } catch {
    // doesn't exist or failed verification, download it
  }

  try {
    await downloadFile(url, target);
    if (!(await verifyBinary(target, url))) {
      await fs.unlink(target).catch(() => {});
      throw new Error("SHA256 verification failed for downloaded FFF binary");
    }
    return target;
  } catch (err) {
    console.error("[pi-ckers] Failed to download/verify fff binary:", err);
    return null;
  }
}

type FffHandle = unknown;

interface SearchItem {
  relativePath: string;
  fileName: string;
}

interface FilePickerResponse {
  items: SearchItem[];
}

interface FffBindings {
  create(opts: Record<string, unknown>): { ok: boolean; handle?: FffHandle; error?: string };
  destroy(handle: FffHandle): void;
  search(
    handle: FffHandle,
    query: string,
    opts: Record<string, unknown>,
  ): { ok: boolean; value?: FilePickerResponse; error?: string };
  scanFiles(handle: FffHandle): Promise<{ ok: boolean; error?: string }>;
  liveGrep(
    handle: FffHandle,
    query: string,
    opts: Record<string, unknown>,
  ): { ok: boolean; value?: GrepResponse; error?: string };
}

interface GrepMatch {
  relativePath: string;
  fileName: string;
  lineNumber: number;
  lineContent: string;
  matchRanges: [number, number][];
  fuzzyScore?: number;
  gitStatus?: string;
}

interface GrepResponse {
  items: GrepMatch[];
  totalMatched: number;
  totalFilesSearched: number;
  totalFiles: number;
  filteredFileCount: number;
  nextCursor?: string;
  regexFallbackError?: string;
}

function decodeCString(ptr: unknown): string | null {
  if (!ptr) return null;
  return k.decode(ptr, "char", -1) as string;
}

function snakeToCamel(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(snakeToCamel);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    result[camelKey] = snakeToCamel(value);
  }
  return result;
}

function readResult(resultPtr: unknown): {
  success: boolean;
  data: string | null;
  error: string | null;
  handle: unknown | null;
} {
  if (!resultPtr) return { success: false, data: null, error: "Null result", handle: null };
  const raw = k.decode(resultPtr, fffResultStruct) as {
    success: boolean;
    data: unknown;
    error: unknown;
    handle: unknown;
  };
  return {
    success: Boolean(raw.success),
    data: decodeCString(raw.data),
    error: decodeCString(raw.error),
    handle: raw.handle ?? null,
  };
}

// Shared FFF manager with reference counting
class FffManager {
  private bindings: FffBindings | null = null;
  private handle: FffHandle | null = null;
  private refCount = 0;
  private binDir: string;
  private initPromise: Promise<void> | null = null;

  constructor(binDir: string) {
    this.binDir = binDir;
  }

  async init(cwd: string, notify: (msg: string, type: "info" | "error") => void): Promise<void> {
    if (this.initPromise) {
      this.refCount++;
      return this.initPromise;
    }

    this.refCount = 1;
    this.initPromise = this.doInit(cwd, notify);
    return this.initPromise;
  }

  private async doInit(cwd: string, notify: (msg: string, type: "info" | "error") => void): Promise<void> {
    const dylibPath = await ensureFffBinary(this.binDir);
    if (!dylibPath) {
      notify("FFF binary not available for this platform", "error");
      return;
    }

    try {
      const lib = k.load(dylibPath);

      const fffCreate = lib.func("void *fff_create(const char *opts_json)");
      const fffDestroy = lib.func("void fff_destroy(void *handle)");
      const fffSearch = lib.func(
        "void *fff_search(void *handle, const char *query, const char *opts_json)",
      );
      const fffScanFiles = lib.func("void *fff_scan_files(void *handle)") as {
        async: (handle: unknown, cb: (err: unknown, res: unknown) => void) => void;
      };
      // biome-ignore lint/correctness/noUnusedVariables: used in closure below
      const fffLiveGrep = lib.func(
        "void *fff_live_grep(void *handle, const char *query, const char *opts_json)",
      );
      const fffFreeResult = lib.func("void fff_free_result(void *result)");

      this.bindings = {
        create(opts) {
          const resultPtr = fffCreate(JSON.stringify(opts));
          const parsed = readResult(resultPtr);
          fffFreeResult(resultPtr);

          if (!parsed.success) return { ok: false, error: parsed.error ?? "Unknown error" };
          if (!parsed.handle) return { ok: false, error: "fff_create returned null handle" };
          return { ok: true, handle: parsed.handle };
        },

        destroy(handle) {
          fffDestroy(handle);
        },

        search(handle, query, opts) {
          const resultPtr = fffSearch(handle, query, JSON.stringify(opts));
          const parsed = readResult(resultPtr);
          fffFreeResult(resultPtr);

          if (!parsed.success) return { ok: false, error: parsed.error ?? "Unknown error" };
          try {
            const data = parsed.data
              ? (snakeToCamel(JSON.parse(parsed.data)) as FilePickerResponse)
              : { items: [] };
            return { ok: true, value: data };
          } catch {
            return { ok: false, error: "Failed to parse search result" };
          }
        },

        async scanFiles(handle) {
          return new Promise((resolve, reject) => {
            fffScanFiles.async(handle, (err, resultPtr) => {
              if (err) {
                reject(err);
                return;
              }
              const parsed = readResult(resultPtr);
              fffFreeResult(resultPtr);
              if (!parsed.success) {
                resolve({ ok: false, error: parsed.error ?? "Scan failed" });
              } else {
                resolve({ ok: true });
              }
            });
          });
        },

        liveGrep(handle, query, opts) {
          const resultPtr = fffLiveGrep(handle, query, JSON.stringify(opts));
          const parsed = readResult(resultPtr);
          fffFreeResult(resultPtr);

          if (!parsed.success) return { ok: false, error: parsed.error ?? "Unknown error" };
          try {
            const data = parsed.data
              ? (snakeToCamel(JSON.parse(parsed.data)) as GrepResponse)
              : { items: [], totalMatched: 0, totalFilesSearched: 0, totalFiles: 0, filteredFileCount: 0 };
            return { ok: true, value: data };
          } catch {
            return { ok: false, error: "Failed to parse grep result" };
          }
        },
      };

      const created = this.bindings.create({ base_path: cwd });
      if (!created.ok) {
        notify(`FFF initialization failed: ${created.error}`, "error");
        return;
      }

      this.handle = created.handle ?? null;
      if (!this.handle) {
        notify("FFF initialization failed: null handle", "error");
        return;
      }

      // Start scanning in background
      this.bindings
        .scanFiles(this.handle)
        .then((result) => {
          if (!result.ok) {
            console.error("[pi-ckers] FFF scan failed:", result.error);
          }
        })
        .catch((err) => {
          console.error("[pi-ckers] FFF scan error:", err);
        });
    } catch (err) {
      notify(`FFF initialization error: ${err}`, "error");
    }
  }

  getCompletions(query: string, maxResults: number): SearchItem[] | null {
    if (!this.bindings || !this.handle) {
      return null;
    }

    const result = this.bindings.search(this.handle, query, { pageSize: maxResults });
    if (!result.ok || !result.value) {
      return null;
    }

    return result.value.items.slice(0, maxResults);
  }

  liveGrep(query: string, maxResults: number): GrepMatch[] | null {
    if (!this.bindings || !this.handle) {
      return null;
    }

    const result = this.bindings.liveGrep(this.handle, query, {
      page_limit: maxResults,
      time_budget_ms: 5000,
      mode: "fuzzy",
    });
    if (!result.ok || !result.value) {
      return null;
    }

    return result.value.items.slice(0, maxResults);
  }

  release(): void {
    if (this.refCount > 0) {
      this.refCount--;
    }

    if (this.refCount <= 0) {
      if (this.bindings && this.handle) {
        this.bindings.destroy(this.handle);
      }
      this.bindings = null;
      this.handle = null;
      this.initPromise = null;
      this.refCount = 0;
    }
  }
}

// Singleton manager instance per module - cleared on hot reload
let globalFffManager: FffManager | null = null;

function getFffManager(): FffManager {
  if (!globalFffManager) {
    const binDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin");
    globalFffManager = new FffManager(binDir);
  }
  return globalFffManager;
}

/** Reset the FFF manager singleton - call on module reload to prevent memory leaks */
export function resetFffManager(): void {
  if (globalFffManager) {
    globalFffManager.release();
    globalFffManager = null;
  }
}

function getFffDirCompletions(
  query: string,
  isQuotedPrefix: boolean,
  maxResults: number,
): AutocompleteItem[] | null {
  const manager = getFffManager();
  // Query FFF with the actual query so it handles fuzzy scoring
  const items = manager.getCompletions(query, 1000);
  if (!items) {
    return null;
  }

  // Extract unique directories from file paths (already sorted by FFF's scoring)
  const seen = new Set<string>();
  const dirs: string[] = [];
  
  for (const item of items) {
    const cleanPath = item.relativePath.replace(/^\.\//, "");
    const lastSlash = cleanPath.lastIndexOf("/");
    if (lastSlash > 0) {
      // Add parent directories, preserving FFF's result order
      let dir = cleanPath.slice(0, lastSlash);
      while (dir) {
        if (!seen.has(dir)) {
          seen.add(dir);
          dirs.push(dir);
        }
        const slash = dir.lastIndexOf("/");
        if (slash <= 0) break;
        dir = dir.slice(0, slash);
      }
    }
  }

  return dirs.slice(0, maxResults).map((dir) => {
    const name = dir.includes("/") ? dir.slice(dir.lastIndexOf("/") + 1) : dir;

    if (!isQuotedPrefix && !dir.includes(" ")) {
      return {
        value: `@dir:${dir}/`,
        label: name + "/",
        description: dir,
      };
    }
    return {
      value: `@dir:"${dir}/"`,
      label: name + "/",
      description: dir,
    };
  });
}

export interface FilePickerOptions {
  /** Maximum number of results to return (default: 20) */
  maxResults?: number;
}

export interface DirPickerOptions {
  /** Maximum number of results to return (default: 20) */
  maxResults?: number;
}

/**
 * Create a file picker using fff (fast fuzzy finder).
 *
 * @example
 * ```typescript
 * import { filePicker } from "@elianiva/pi-ckers/builtin/file";
 *
 * const picker = filePicker({ maxResults: 50 });
 * ```
 */
export const filePicker = (opts: FilePickerOptions = {}) => {
  const maxResults = opts.maxResults ?? 20;
  let notify: (msg: string, type: "info" | "error") => void = console.error;

  return createPicker({
    type: "sync",
    prefix: "@file:",
    init: async (ctx) => {
      notify = ctx.ui.notify.bind(ctx.ui);
      const manager = getFffManager();
      await manager.init(ctx.cwd, notify);
    },
    search: (query: string, ctx: PickerContext) => {
      const manager = getFffManager();
      // Use empty query to get all files when query is empty
      const items = manager.getCompletions(query || "", maxResults * 2);
      if (!items) {
        return null;
      }

      return items.map((item) => {
        const isDirectory = item.relativePath.endsWith("/");
        const p = item.relativePath.replace(/^\.\//, "").replace(/\/$/, "");

        if (!ctx.isQuotedPrefix && !p.includes(" ")) {
          return {
            value: `@file:${p}`,
            label: item.fileName + (isDirectory ? "/" : ""),
            description: p,
          };
        }
        return {
          value: `@file:"${p}"`,
          label: item.fileName + (isDirectory ? "/" : ""),
          description: p,
        };
      });
    },
    clearCache: () => {
      // FFF doesn't have cache to clear
    },
    destroy: () => {
      const manager = getFffManager();
      manager.release();
    },
  });
};

/**
 * Create a directory picker using fff (fast fuzzy finder).
 * Shares the same fff instance as filePicker for efficiency.
 *
 * @example
 * ```typescript
 * import { dirPicker } from "@elianiva/pi-ckers/builtin/file";
 *
 * const picker = dirPicker({ maxResults: 50 });
 * ```
 */
export const dirPicker = (opts: DirPickerOptions = {}) => {
  const maxResults = opts.maxResults ?? 20;
  let notify: (msg: string, type: "info" | "error") => void = console.error;

  return createPicker({
    type: "sync",
    prefix: "@dir:",
    init: async (ctx) => {
      notify = ctx.ui.notify.bind(ctx.ui);
      const manager = getFffManager();
      await manager.init(ctx.cwd, notify);
    },
    search: (query: string, ctx: PickerContext) => {
      return getFffDirCompletions(query, ctx.isQuotedPrefix, maxResults);
    },
    clearCache: () => {
      // FFF doesn't have cache to clear
    },
    destroy: () => {
      const manager = getFffManager();
      manager.release();
    },
  });
};

// Re-export for use by other pickers like @grep:
export { getFffManager };
export type { GrepMatch };
