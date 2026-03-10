# @elianiva/pi-ckers

Namespace-prefixed pickers for pi. This is a **library package**, not an auto-loading extension.

## Why Namespaced Pickers?

Dumb models struggle to differentiate between directories and files purely based on trailing `/`. By using explicit prefixes like `@dir:` and `@file:`, you give the agent a clear hint about what you're referring to. No more ambiguous paths. This also allows me to scope my suggestions, when I want to search for dirs I don't want to also get file suggestions.

This also makes it extensible because you can have different namespaces, for example I use `@git:` or `@jj:` to point the agent to changes/revisions so it can review the diff, without having me to copy/paste the ID myself.

## Why a Library Package?

**Extensibility**: This is intentionally designed as a library you compose, not a ready-to-use extension. You build your own editor by combining pickers with other packages.

**No hard dependencies**: This extension was made alongside my other extension, [@elianiva/pi-starship](https://github.com/elianiva/pi-starship), which also overrides the editor, but I want to compose them and not have them have hard dependencies for each other.

**Overrides editor**: Since this wraps/replaces the editor component, it can't be an auto-loading extension because you may have other extension that already overrides the editor. The extension loading in Pi have no particular order, so you can't stack overriding editors. The way you use this extension is explicitly opt-in by wrapping your editor with `withPickers()`.

See how I use it [in my configuration](https://github.com/elianiva/dotfiles/blob/main/agents/pi/extensions/composed-editor).

## Installation

```bash
bun add @elianiva/pi-ckers
```

## Usage

Create your own extension in `~/.pi/extensions/my-extension/`:

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { withPickers } from "@elianiva/pi-ckers";
import { filePicker, dirPicker } from "@elianiva/pi-ckers/builtin/fff";
import { grepPicker } from "@elianiva/pi-ckers/builtin/grep";
import { gitPicker } from "@elianiva/pi-ckers/builtin/git";
import { jjPicker } from "@elianiva/pi-ckers/builtin/jj";

// Wrap any editor with picker support
const EditorWithPickers = withPickers(YourEditorClass, [
  filePicker(),
  dirPicker(),
  grepPicker(),
  gitPicker(),
  jjPicker(),
]);

export default function myExtension(pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;
    ctx.ui.setEditorComponent(
      // Pass ExtensionContext as 5th argument to initialize pickers
      (tui, theme, kb) => new EditorWithPickers(tui, theme, kb, undefined, ctx)
    );
  });
}
```

## Features

Type any namespace prefix in the editor:

| Prefix | Description | Example |
|--------|-------------|---------|
| `@file:` | Fuzzy file picker | `@file:src/index` |
| `@dir:` | Fuzzy directory picker | `@dir:components` |
| `@grep:` | Grep file contents | `@grep:foo` |
| `@git:` | Git revision picker | `@git:main` |
| `@jj:` | Jujutsu change picker | `@jj:abc` |

## API

### `withPickers(EditorClass, pickers)`

Higher-order function that adds picker autocomplete to any editor that extends CustomEditor. Make sure the constructor receives `ctx` as the 5th parameter.

```typescript
import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { withPickers } from "@elianiva/pi-ckers";
import { filePicker, grepPicker } from "@elianiva/pi-ckers/builtin/fff";

const MyEditor = withPickers(CustomEditor, [
  filePicker(),
  grepPicker(),
  gitPicker(),
]);
```

### `createPicker(config)`

```typescript
import { createPicker } from "@elianiva/pi-ckers";

// Static picker - handles filtering internally
const staticPicker = createPicker({
  type: "static",
  prefix: "@emoji:",
  items: [
    { value: "@emoji:rocket", label: "🚀", description: "rocket" },
    { value: "@emoji:fire", label: "🔥", description: "fire" },
  ],
  maxResults: 20,
});

// Sync picker - you provide the search function
const syncPicker = createPicker({
  type: "sync",
  prefix: "@my:",
  search(query, ctx) {
    return [
      { value: "@my:result", label: "Result", description: "Details" }
    ];
  },
  init(ctx) {
    // Optional: setup cache, watchers, etc.
  },
  clearCache() {
    // Optional: clear cached data
  },
  destroy() {
    // Optional: cleanup when session ends
  }
});
```

Picker types:
- `type: "static"` - Provide `items` array, picker handles filtering
- `type: "sync"` - Provide `search(query, ctx)` function

Common options for all types:
- `prefix` - The namespace prefix (e.g., `"@my:"`)
- `minQueryLength` - Minimum query length before showing completions (default: 0)
- `init(ctx)` - Called once when picker is initialized
- `clearCache()` - Called to clear cached data
- `destroy()` - Called when session ends

## Built-in Pickers

### `filePicker()` / `dirPicker()`

```typescript
import { filePicker, dirPicker } from "@elianiva/pi-ckers/builtin/fff";

filePicker({
  maxResults?: 20,  // Maximum results to show
})
```

Uses [`fff`](https://github.com/dmtrKovalenko/fff.nvim) (fast fuzzy finder by [Dmitriy Kovalenko](https://github.com/dmtrKovalenko)) for fast file searching and typo-resistant algorithm.

The native binary is **auto-downloaded** on first use from the [fff.nvim releases](https://github.com/dmtrKovalenko/fff.nvim/releases), verified against upstream `sha256`, and cached in `node_modules/@elianiva/pi-ckers/bin/`.

**Supported Platforms:**

| Architecture | OS | Binary |
|--------------|-----|--------|
| aarch64 | macOS | `c-lib-aarch64-apple-darwin.dylib` |
| x86_64 | macOS | `c-lib-x86_64-apple-darwin.dylib` |
| aarch64 | Linux | `c-lib-aarch64-unknown-linux-gnu.so` |
| x86_64 | Linux | `c-lib-x86_64-unknown-linux-gnu.so` |
| aarch64 | Android | `c-lib-aarch64-linux-android.so` |
| x86_64 | Android | `c-lib-x86_64-linux-android.so` |
| x86_64 | Windows | `c-lib-x86_64-pc-windows-msvc.dll` |

If your platform is not supported, the picker will gracefully fall back to a basic implementation.

> **Testing Status:** Currently only tested on **macOS ARM64 (aarch64)**. Other platforms should work but may have issues. Please report any problems if you have any.

### `grepPicker()`

```typescript
import { grepPicker } from "@elianiva/pi-ckers/builtin/grep";

grepPicker({
  maxResults?: 20,      // Maximum results to show
  minQueryLength?: 2,   // Minimum query length before searching
})
```

Searches file contents using fff's live grep. Returns results in `@grep:path:line` format. Requires fff binary (same as file/dir pickers).

### `gitPicker()`

```typescript
import { gitPicker } from "@elianiva/pi-ckers/builtin/git";

gitPicker()
```

Shows branches, tags, and recent commits. Requires `git` in PATH.

### `jjPicker()`

```typescript
import { jjPicker } from "@elianiva/pi-ckers/builtin/jj";

jjPicker()
```

Shows Jujutsu changes. Requires `jj` in `$PATH`.

## Credits

- **[fff.nvim](https://github.com/dmtrKovalenko/fff.nvim)** — Fast fuzzy file finder by [Dmitriy Kovalenko](https://github.com/dmtrKovalenko). The file/directory picker uses `fff` binaries which are auto-downloaded from the upstream releases.

## License

[MIT](./LICENSE)
