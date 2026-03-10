/**
 * pi-ckers - Modular namespace pickers for pi
 *
 * Compose your own picker set:
 *
 * ```typescript
 * import { withPickers } from "@elianiva/pi-ckers";
 * import { filePicker } from "@elianiva/pi-ckers/builtin/file";
 * import { gitPicker } from "@elianiva/pi-ckers/builtin/git";
 *
 * const Editor = withPickers(StarshipEditor, [
 *   filePicker(),
 *   gitPicker(),
 * ]);
 * ```
 */

import type {
  ExtensionContext,
  KeybindingsManager,
} from "@mariozechner/pi-coding-agent";
import type { AutocompleteProvider, EditorOptions, EditorTheme, TUI } from "@mariozechner/pi-tui";
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import type { Picker } from "./types";

// Type for constructor
interface CustomEditorConstructor {
  new (
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    options?: any,
    ctx?: ExtensionContext,
  ): CustomEditor;
}

/**
 * Higher-order function that adds pickers autocomplete to any CustomEditor.
 *
 * @param BaseEditor - The editor class to extend
 * @param pickers - Array of pickers to use
 * @returns A new class with pickers autocomplete support
 *
 * @example
 * ```typescript
 * import { CustomEditor } from "@mariozechner/pi-coding-agent";
 * import { withPickers } from "@elianiva/pi-ckers";
 * import { filePicker } from "@elianiva/pi-ckers/builtin/file";
 *
 * const EditorWithPickers = withPickers(CustomEditor, [filePicker()]);
 * ```
 */
export function withPickers<T extends CustomEditorConstructor>(
  BaseEditor: T,
  pickers: readonly Picker[],
): T {
  // Create a class that composes the BaseEditor instead of extending
  // This avoids TypeScript mixin constraints
  const MixedEditor = class extends (BaseEditor as CustomEditorConstructor) {
    private pickerCtx: ExtensionContext | null = null;
    private readonly pickerInstances: readonly Picker[];
    private destroyed = false;

    constructor(
      tui: TUI,
      theme: EditorTheme,
      keybindings: KeybindingsManager,
      options?: EditorOptions,
      ctx?: ExtensionContext,
    ) {
      super(tui, theme, keybindings, options, ctx);
      this.pickerInstances = pickers;

      // Auto-initialize if context passed as 5th argument
      if (ctx) {
        this.initPickers(ctx);
      }
    }

    /** Initialize pickers with ExtensionContext - call this after construction */
    initPickers(ctx: ExtensionContext): void {
      // Prevent double initialization
      if (this.pickerCtx) return;
      this.pickerCtx = ctx;

      // Initialize pickers
      for (const picker of this.pickerInstances) {
        if (picker.init) {
          Promise.resolve(picker.init(ctx)).catch((err) => {
            console.error(`[pi-ckers] Failed to initialize picker "${picker.prefix}":`, err);
            ctx.ui.notify(`Failed to initialize ${picker.prefix} picker`, "error");
          });
        }
      }
    }

    setAutocompleteProvider(defaultProvider: AutocompleteProvider): void {
      const pickersProvider: AutocompleteProvider = {
        getSuggestions: (lines, cursorLine, cursorCol) => {
          const currentLine = lines[cursorLine] ?? "";
          const textBeforeCursor = currentLine.slice(0, cursorCol);

          for (const picker of this.pickerInstances) {
            const prefixIndex = textBeforeCursor.lastIndexOf(picker.prefix);
            if (prefixIndex === -1) continue;

            const afterPrefix = textBeforeCursor.slice(prefixIndex + picker.prefix.length);
            const isQuotedPrefix = afterPrefix.startsWith('"');
            const query = isQuotedPrefix ? afterPrefix.slice(1) : afterPrefix;

            if (!isQuotedPrefix && afterPrefix.includes(" ")) {
              continue;
            }

            const minLength = picker.minQueryLength ?? 0;
            if (query.length < minLength) {
              continue;
            }

            const completions = picker.getCompletions(query, {
              cwd: this.pickerCtx?.cwd ?? process.cwd(),
              isQuotedPrefix,
            });

            if (completions && completions.length > 0) {
              return {
                items: completions,
                prefix: picker.prefix + afterPrefix,
              };
            }
          }

          return defaultProvider.getSuggestions(lines, cursorLine, cursorCol);
        },

        applyCompletion: (lines, cursorLine, cursorCol, item, prefix) => {
          const currentLine = lines[cursorLine] ?? "";
          const textBeforeCursor = currentLine.slice(0, cursorCol);

          const isNamespaceCompletion = this.pickerInstances.some((p) =>
            prefix.startsWith(p.prefix),
          );

          if (!isNamespaceCompletion) {
            return defaultProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
          }

          const prefixIndex = textBeforeCursor.lastIndexOf(prefix);
          if (prefixIndex === -1) {
            return defaultProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
          }

          const beforePrefix = textBeforeCursor.slice(0, prefixIndex);
          const afterPrefixIndex = prefixIndex + prefix.length;
          const afterCursor = currentLine.slice(afterPrefixIndex);
          const wordEndMatch = afterCursor.match(/^(\S*)/);
          const wordEndLen = wordEndMatch?.[1]?.length ?? 0;
          const afterWord = currentLine.slice(afterPrefixIndex + wordEndLen);

          const newLine = beforePrefix + item.value + " " + afterWord;
          const newLines = [...lines];
          newLines[cursorLine] = newLine;

          return {
            lines: newLines,
            cursorLine,
            cursorCol: beforePrefix.length + item.value.length + 1,
          };
        },
      };

      super.setAutocompleteProvider(pickersProvider);
    }

    clearCaches(): void {
      if (this.destroyed) return;
      for (const picker of this.pickerInstances) {
        picker.clearCache?.();
      }
    }

    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;

      for (const picker of this.pickerInstances) {
        try {
          picker.destroy?.();
        } catch (err) {
          console.error(`[pi-ckers] Error destroying picker "${picker.prefix}":`, err);
        }
      }
    }
  };

  return MixedEditor as unknown as T;
}

export { createPicker } from "./create-picker";
export type { Picker, PickerContext } from "./types";
export type { CreatePickerOptions } from "./create-picker";
