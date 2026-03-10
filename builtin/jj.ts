import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { VcsCache, createVcsPicker, checkVcsAvailable, execVcs } from "./vcs-base";

interface JjChange {
  changeId: string;
  commitId?: string;
  bookmarks: string[];
  description: string;
}

class JjCache extends VcsCache<JjChange> {
  protected async fetchItems(cwd: string): Promise<JjChange[]> {
    const changes: JjChange[] = [];

    try {
      const log = await execVcs(
        'jj log --no-graph --limit 20 -T \'change_id.shortest() ++ "|" ++ commit_id.shortest() ++ "|" ++ bookmarks.join(",") ++ "|" ++ description.first_line()\'',
        cwd,
      );

      log.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const parts = trimmed.split("|");
        if (parts.length < 4) return;

        const changeId = parts[0];
        const commitId = parts[1];
        const bookmarks = parts[2] ? parts[2].split(",").filter(b => b) : [];
        const description = parts[3] || "(no description)";

        changes.push({ changeId, commitId, bookmarks, description });
      });
    } catch (err) {
      console.error("[pi-ckers] Failed to fetch jj changes:", err);
    }

    return changes;
  }

  protected filterItems(query: string, items: JjChange[]): JjChange[] {
    const lowerQuery = query.toLowerCase();
    return items
      .filter(
        (c) =>
          c.changeId.toLowerCase().includes(lowerQuery) ||
          c.bookmarks.some(b => b.toLowerCase().includes(lowerQuery)) ||
          c.description.toLowerCase().includes(lowerQuery),
      )
      .slice(0, 20);
  }

  protected renderItem(change: JjChange): AutocompleteItem {
    const bookmarkLabel = change.bookmarks.length > 0
      ? ` (${change.bookmarks.join(", ")})`
      : "";

    return {
      value: `@jj:${change.changeId}`,
      label: `🍋 ${change.changeId}${bookmarkLabel}`,
      description: change.description,
    };
  }
}

/**
 * Create a Jujutsu picker for @jj: completions.
 * Provides recent changes.
 *
 * @example
 * ```typescript
 * import { jjPicker } from "@elianiva/pi-ckers/builtin/jj";
 *
 * const picker = jjPicker();
 * ```
 */
export const jjPicker = () =>
  createVcsPicker<JjChange>({
    prefix: "@jj:",
    checkAvailable: () => checkVcsAvailable("jj --version"),
    notAvailableMessage: "Jujutsu (jj) not available in PATH",
    createCache: () => new JjCache(),
  });
