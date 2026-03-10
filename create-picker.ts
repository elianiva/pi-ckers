import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { Picker, PickerContext } from "./types";

interface BasePickerOptions {
  /** The namespace prefix including @ and colon, e.g., "@file:" */
  prefix: string;

  /** Minimum query length before showing completions (default: 0) */
  minQueryLength?: number;

  /**
   * Initialize the picker. Called once when the editor is created.
   */
  init?: (ctx: ExtensionContext) => Promise<void> | void;

  /**
   * Clear any cached data. Called when user runs pickers-clear command.
   */
  clearCache?: () => void;

  /**
   * Cleanup when the picker is destroyed. Called when session ends.
   */
  destroy?: () => void;
}

/** Static list of items - picker handles filtering internally */
export interface StaticPickerOptions extends BasePickerOptions {
  type: "static";

  /** Static items to filter and display */
  items: Array<{
    value: string;
    label: string;
    description?: string;
  }>;

  /** Maximum results to return (default: 20) */
  maxResults?: number;

  /**
   * Custom filter function. Default: case-insensitive substring match on label.
   */
  filter?: (query: string, item: AutocompleteItem) => boolean;
}

/** Synchronous search - you provide the search function */
export interface SyncPickerOptions extends BasePickerOptions {
  type: "sync";

  /**
   * Search function that returns completions for the given query.
   * Called whenever the user types after the prefix.
   */
  search: (query: string, ctx: PickerContext) => AutocompleteItem[] | null;
}

export type CreatePickerOptions = StaticPickerOptions | SyncPickerOptions;

/** Default filter: case-insensitive substring match on label */
function defaultFilter(query: string, item: AutocompleteItem): boolean {
  return item.label.toLowerCase().includes(query.toLowerCase());
}

/** Create a picker from a static item list */
function createStaticPicker(options: StaticPickerOptions): Picker {
  const { prefix, items, maxResults = 20, filter = defaultFilter, minQueryLength = 0 } = options;

  return {
    prefix,
    minQueryLength,
    init: options.init,
    clearCache: options.clearCache,
    destroy: options.destroy,

    getCompletions(query: string, _ctx: PickerContext): AutocompleteItem[] | null {
      const filtered = items
        .filter((item) => filter(query, item))
        .slice(0, maxResults);

      return filtered.length > 0 ? filtered : null;
    },
  };
}

/** Create a picker from a synchronous search function */
function createSyncPicker(options: SyncPickerOptions): Picker {
  const { prefix, search, minQueryLength = 0 } = options;

  return {
    prefix,
    minQueryLength,
    init: options.init,
    clearCache: options.clearCache,
    destroy: options.destroy,

    getCompletions(query: string, ctx: PickerContext): AutocompleteItem[] | null {
      return search(query, ctx);
    },
  };
}

/**
 * Create a picker with a unified configuration interface using discriminated unions.
 *
 * @example
 * ```typescript
 * // Static picker - handles filtering internally
 * const staticPicker = createPicker({
 *   type: "static",
 *   prefix: "@emoji:",
 *   items: [
 *     { value: "@emoji:rocket", label: "🚀", description: "rocket" },
 *     { value: "@emoji:fire", label: "🔥", description: "fire" },
 *   ],
 * });
 *
 * // Sync picker - you provide the search
 * const syncPicker = createPicker({
 *   type: "sync",
 *   prefix: "@cmd:",
 *   search(query, ctx) {
 *     return commands
 *       .filter(c => c.includes(query))
 *       .map(c => ({ value: `@cmd:${c}`, label: c }));
 *   },
 * });
 * ```
 */
export function createPicker(options: CreatePickerOptions): Picker {
  switch (options.type) {
    case "static":
      return createStaticPicker(options);
    case "sync":
      return createSyncPicker(options);
    default:
      // TypeScript exhaustiveness check
      const _exhaustive: never = options;
      throw new Error(`Unknown picker type: ${(_exhaustive as CreatePickerOptions)?.type}`);
  }
}
