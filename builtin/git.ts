import type { AutocompleteItem } from "@mariozechner/pi-tui";
import {
  VcsCache,
  createVcsPicker,
  checkVcsAvailable,
  execVcs,
} from "./vcs-base";

interface GitRef {
  name: string;
  type: "branch" | "tag" | "commit";
  description?: string;
}

class GitCache extends VcsCache<GitRef> {
  protected async fetchItems(cwd: string): Promise<GitRef[]> {
    const refs: GitRef[] = [];

    try {
      // Get local and remote branches
      const branchesOutput = await execVcs(
        "git branch -a --format='%(refname:short)'",
        cwd,
      );
      branchesOutput.split("\n").forEach((line) => {
        const name = line.trim();
        if (!name || name.startsWith("HEAD ->")) return;
        refs.push({ name, type: "branch" });
      });

      // Get tags
      const tagsOutput = await execVcs("git tag -l", cwd);
      tagsOutput.split("\n").forEach((line) => {
        const name = line.trim();
        if (!name) return;
        refs.push({ name, type: "tag" });
      });

      // Get recent commits
      const logOutput = await execVcs(
        "git log --oneline --format='%h %s' -20",
        cwd,
      );
      logOutput.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const spaceIdx = trimmed.indexOf(" ");
        const sha = spaceIdx > 0 ? trimmed.slice(0, spaceIdx) : trimmed;
        const msg = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1) : "";

        refs.push({
          name: sha,
          type: "commit",
          description: msg.slice(0, 50),
        });
      });
    } catch (err) {
      console.error("[pi-ckers] Failed to fetch git data:", err);
    }

    return refs;
  }

  protected filterItems(query: string, items: GitRef[]): GitRef[] {
    const lowerQuery = query.toLowerCase();
    return items
      .filter((ref) => ref.name.toLowerCase().includes(lowerQuery))
      .slice(0, 20);
  }

  protected renderItem(ref: GitRef): AutocompleteItem {
    const typeLabel =
      ref.type === "branch" ? "🌿" : ref.type === "tag" ? "🏷️" : "📝";
    return {
      value: `@git:${ref.name}`,
      label: `${typeLabel} ${ref.name}`,
      description: ref.description ?? ref.type,
    };
  }
}

/**
 * Create a git picker for @git: completions.
 * Provides branches, tags, and recent commits using git CLI.
 *
 * @example
 * ```typescript
 * import { gitPicker } from "@elianiva/pi-ckers/builtin/git";
 *
 * const picker = gitPicker();
 * ```
 */
export const gitPicker = () =>
  createVcsPicker<GitRef>({
    prefix: "@git:",
    checkAvailable: () => checkVcsAvailable("git --version"),
    notAvailableMessage: "Git not available in PATH",
    createCache: () => new GitCache(),
  });
