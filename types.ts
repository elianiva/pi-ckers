import type { AutocompleteItem } from "@mariozechner/pi-tui";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

/**
 * Context passed to picker completion functions
 */
export interface PickerContext {
  /** Current working directory */
  cwd: string;
  /** Whether the prefix was quoted (e.g., @file:"...) */
  isQuotedPrefix: boolean;
}

/**
 * A picker provides completions for a specific namespace prefix.
 * Example: @file:, @git:, @jj:
 */
export interface Picker {
  /** The namespace prefix including @ and colon, e.g., "@file:" */
  prefix: string;

  /** Minimum query length before showing completions (default: 0) */
  minQueryLength?: number;

  /** Called once when the picker is initialized */
  init?: (ctx: ExtensionContext) => Promise<void> | void;

  /** Return completions for the given query, or null if none. Must be sync - use init() to populate caches async. */
  getCompletions: (query: string, ctx: PickerContext) => AutocompleteItem[] | null;

  /** Clear any cached data */
  clearCache?: () => void;

  /** Cleanup when the picker is destroyed */
  destroy?: () => void;
}
