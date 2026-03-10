import { createPicker } from "../create-picker";
import type { PickerContext } from "../types";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getFffManager, type GrepMatch } from "./fff";

export interface GrepPickerOptions {
  /** Maximum number of results to return (default: 20) */
  maxResults?: number;
  /** Minimum query length before searching (default: 2) */
  minQueryLength?: number;
}

function formatGrepResult(match: GrepMatch): string {
  return `@grep:${match.relativePath}:${match.lineNumber}`;
}

function truncateLine(line: string, maxLen: number): string {
  if (line.length <= maxLen) return line;
  return line.slice(0, maxLen - 3) + "...";
}

/**
 * Create a grep picker using fff's live grep functionality.
 * Searches file contents and returns results in @grep:path:line format.
 *
 * @example
 * ```typescript
 * import { grepPicker } from "@elianiva/pi-ckers/builtin/grep";
 *
 * const picker = grepPicker({ maxResults: 30, minQueryLength: 3 });
 * // Type "foo" -> suggests @grep:src/utils.ts:42
 * ```
 */
export const grepPicker = (opts: GrepPickerOptions = {}) => {
  const maxResults = opts.maxResults ?? 20;
  const minQueryLength = opts.minQueryLength ?? 2;
  let notify: (msg: string, type: "info" | "error") => void = console.error;

  return createPicker({
    type: "sync",
    prefix: "@grep:",
    minQueryLength,
    init: async (ctx: ExtensionContext) => {
      notify = ctx.ui.notify.bind(ctx.ui);
      const manager = getFffManager();
      await manager.init(ctx.cwd, notify);
    },
    search: (query: string, _ctx: PickerContext): AutocompleteItem[] | null => {
      if (!query || query.length < minQueryLength) {
        return null;
      }

      const manager = getFffManager();
      const matches = manager.liveGrep(query, maxResults);
      if (!matches || matches.length === 0) {
        return null;
      }

      return matches.map((match) => {
        const value = formatGrepResult(match);
        // Show line content preview in label, truncate if too long
        const preview = truncateLine(match.lineContent.trim(), 50);
        const label = `${match.relativePath}:${match.lineNumber}`;

        return {
          value,
          label,
          description: preview,
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
