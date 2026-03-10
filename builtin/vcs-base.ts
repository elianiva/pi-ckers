import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createPicker } from "../create-picker";
import type { Picker } from "../types";

export const execAsync = promisify(exec);

const availabilityCache = new Map<string, boolean>();

export async function checkVcsAvailable(command: string): Promise<boolean> {
  const cached = availabilityCache.get(command);
  if (cached !== undefined) return cached;
  try {
    await execAsync(command);
    availabilityCache.set(command, true);
    return true;
  } catch {
    availabilityCache.set(command, false);
    return false;
  }
}

export async function execVcs(command: string, cwd: string): Promise<string> {
  const { stdout } = await execAsync(command, { cwd, encoding: "utf8" });
  return stdout;
}

/**
 * Base cache class for VCS pickers (git, jj, etc).
 * Handles cwd change detection and item storage.
 * Subclasses implement fetch/render logic.
 */
export abstract class VcsCache<T> {
  protected items: T[] = [];
  private lastCwd: string | null = null;

  async refresh(cwd: string): Promise<void> {
    if (cwd !== this.lastCwd) {
      this.lastCwd = cwd;
      this.items = [];
    }
    this.items = await this.fetchItems(cwd);
  }

  /**
   * Fetch items from the VCS. Called during refresh.
   */
  protected abstract fetchItems(cwd: string): Promise<T[]>;

  /**
   * Filter items based on query. Called during getCompletions.
   */
  protected abstract filterItems(query: string, items: T[]): T[];

  /**
   * Convert an item to an AutocompleteItem.
   */
  protected abstract renderItem(item: T): AutocompleteItem;

  getCompletions(query: string): AutocompleteItem[] | null {
    if (this.items.length === 0) return null;

    const filtered = this.filterItems(query, this.items);
    if (filtered.length === 0) return null;

    return filtered.map((item) => this.renderItem(item));
  }

  clear(): void {
    this.items = [];
    this.lastCwd = null;
  }
}

export interface VcsPickerConfig<T> {
  /** The namespace prefix (e.g., "@git:", "@jj:") */
  prefix: string;

  /** Check if the VCS CLI is available */
  checkAvailable: () => Promise<boolean>;

  /** Message shown when VCS is not available */
  notAvailableMessage: string;

  /** Factory function to create the cache instance */
  createCache: () => VcsCache<T>;
}

/**
 * Create a VCS picker with shared infrastructure.
 * Handles: availability check, cache lifecycle, cleanup.
 * Cache is populated on init and refreshed lazily when cwd changes.
 */
export function createVcsPicker<T>(config: VcsPickerConfig<T>): Picker {
  const { prefix, checkAvailable, notAvailableMessage, createCache } = config;

  const cache = createCache();
  let notify: (msg: string, type: "info" | "error") => void = console.error;
  let lastCwd: string | null = null;

  return createPicker({
    type: "sync",
    prefix,
    init: async (ctx) => {
      notify = ctx.ui.notify.bind(ctx.ui);
      lastCwd = ctx.cwd;

      if (!(await checkAvailable())) {
        notify(notAvailableMessage, "error");
        return;
      }

      await cache.refresh(ctx.cwd);
    },
    search: (query, ctx) => {
      // Refresh cache if cwd has changed
      if (ctx.cwd !== lastCwd) {
        lastCwd = ctx.cwd;
        // Fire-and-forget refresh - don't block UI
        cache.refresh(ctx.cwd).catch((err) => {
          console.error(`[pi-ckers] ${prefix} cache refresh failed:`, err);
        });
      }
      return cache.getCompletions(query);
    },
    clearCache: () => cache.clear(),
    destroy: () => {
      cache.clear();
      lastCwd = null;
    },
  });
}
