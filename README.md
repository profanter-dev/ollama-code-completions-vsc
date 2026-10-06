# Ollama Code Completions for Visual Studio Code

[![VS Marketplace Version](https://vsmarketplacebadges.dev/version-short/profanterdev.ollama-code-completions.png?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=profanterdev.ollama-code-completions) [![Installs](https://vsmarketplacebadges.dev/installs-short/profanterdev.ollama-code-completions.png?label=installs&color=brightgreen)](https://marketplace.visualstudio.com/items?itemName=profanterdev.ollama-code-completions) [![Rating](https://vsmarketplacebadges.dev/rating-short/profanterdev.ollama-code-completions.png?label=rating)](https://marketplace.visualstudio.com/items?itemName=profanterdev.ollama-code-completions) [![Open VSX Version](https://img.shields.io/open-vsx/v/profanterdev/ollama-code-completions?label=Open%20VSX&color=purple)](https://open-vsx.org/extension/profanterdev/ollama-code-completions) [![Build](https://img.shields.io/github/actions/workflow/status/profanter-dev/ollama-code-completions-vsc/build.yml?label=build)](https://github.com/profanter-dev/ollama-code-completions-vsc/actions) [![License](https://img.shields.io/badge/license-MIT-lightgrey)](https://github.com/profanter-dev/ollama-code-completions-vsc/blob/main/LICENSE)

**Also available for** [Visual Studio](https://marketplace.visualstudio.com/items?itemName=profanterdev.OllamaCodeCompletions)

---

Inline ghost-text autocomplete for VS Code, powered by a self-hosted [Ollama](https://ollama.com) instance.

Sends the code around your cursor to an Ollama model (e.g. `qwen2.5-coder`, `codellama`, `deepseek-coder-v2`, `starcoder2`, or a model without Ollama insert support) and shows the suggestion as ghost text. Press <kbd>Tab</kbd> to accept, <kbd>Esc</kbd> to dismiss.

## Features

- Inline completions via VS Code's native `InlineCompletionItemProvider` API
- Fill-in-the-middle prompting via Ollama's native `suffix` parameter for insert-capable models, or a configurable raw prompt for other models
- LRU completion cache with prefix-extension matching (instant suggestions when you backspace or keep typing)
- Post-processing: suffix overlap removal, bracket balancing, prefix-echo trimming
- Smart mid-line completions — allows completions inside JSX tag attributes and before closing punctuation; configurable via `midLineMode`
- JSON/JSONC string completions — completes inside string values in `.json` and `.jsonc` files, useful for translation files
- HTTP Basic auth support, with credentials stored in the OS keychain (Keychain / Credential Manager / libsecret)
- Diagnostic logging to an output channel and/or file, gated by settings
- "Pick Model", "Test Connection", "Show Log", "Set Credentials", "Clear Credentials" commands

## Requirements

- VS Code 1.85 or later
- An Ollama server reachable from your machine (default `http://localhost:11434`)
- A code-completion model installed on that server (e.g. `ollama pull qwen2.5-coder:1.5b`)

## Setup

1. Install the extension.
2. (Optional) Open Settings and set `ollamaCodeCompletions.serverUrl` if your Ollama instance is not at `localhost:11434`.
3. Run **Ollama Code Completions: Pick Model** from the command palette and choose a model.
4. Run **Ollama Code Completions: Test Connection** to verify everything is wired up.
5. Open a file in a supported language and start typing.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ollamaCodeCompletions.serverUrl` | `http://localhost:11434` | Base URL of the Ollama server. |
| `ollamaCodeCompletions.model` | `qwen2.5-coder:1.5b` | Model name. |
| `ollamaCodeCompletions.promptMode` | `"auto"` | `"auto"` chooses the best format for your model; `"template"` uses the model's built-in format; `"raw"` uses your custom `fimTemplate`. |
| `ollamaCodeCompletions.fimTemplate` | `"<\|fim_prefix\|>{prefix}<\|fim_suffix\|>{suffix}<\|fim_middle\|>"` | Raw prompt with `{prefix}` and `{suffix}` placeholders; ignored in template mode. |
| `ollamaCodeCompletions.useAuthentication` | `false` | Send HTTP Basic auth on each request. |
| `ollamaCodeCompletions.enabled` | `true` | Master toggle for inline completions. |
| `ollamaCodeCompletions.debounceMs` | `300` | Idle time after typing before a request is sent. |
| `ollamaCodeCompletions.maxPrefixChars` | `4096` | Maximum prefix length sent to the model. |
| `ollamaCodeCompletions.maxSuffixChars` | `1024` | Maximum suffix length sent to the model. |
| `ollamaCodeCompletions.maxPredict` | `128` | Maximum tokens for the model to generate. |
| `ollamaCodeCompletions.timeoutSeconds` | `30` | HTTP request timeout. |
| `ollamaCodeCompletions.logToFile` | `false` | Write logs to `OllamaCodeCompletions.log` in the OS temp directory. |
| `ollamaCodeCompletions.logToOutputChannel` | `false` | Write logs to the "Ollama Code Completions" output channel. |
| `ollamaCodeCompletions.showStatusBarItem` | `true` | Show the status bar indicator. |
| `ollamaCodeCompletions.midLineMode` | `"smart"` | `"smart"` allows mid-line completions inside JSX attributes and before closing punctuation. `"never"` restores the old behavior of skipping whenever there is any text after the cursor. |
| `ollamaCodeCompletions.multilineMode` | `"auto"` | `"auto"` allows multi-line completions only when context suggests they're appropriate (e.g. after `{` or `=>`). `"always"` allows multi-line everywhere. `"never"` limits all completions to a single line. |
| `ollamaCodeCompletions.maxCompletionLines` | `6` | Hard cap on the number of lines in any completion. Completions longer than this are truncated even in `always` mode. |

Username and password are **not** in settings - they go in the OS keychain, set via the **Set Credentials** command.

### Prompt formatting

The default `promptMode: "auto"` chooses a prompt format based on your model. Most users can leave this setting unchanged.

Choose `"template"` to use your model's built-in formatting, or `"raw"` to use a custom `fimTemplate`. If you choose `"raw"`, set `fimTemplate` to match your model. For example:

- Qwen Coder: `<|fim_prefix|>{prefix}<|fim_suffix|>{suffix}<|fim_middle|>`
- Code Llama: `<PRE>{prefix}<SUF>{suffix}<MID>`
- DeepSeek Coder V2: `<|fim_begin|>{prefix}<|fim_hole|>{suffix}<|fim_end|>`

## Commands

All commands are available through the command palette under the **Ollama Code Completions** category:

- **Set Credentials** - prompts for username and password, stores them in `SecretStorage`.
- **Clear Credentials** - removes stored credentials.
- **Pick Model** - lists installed models from `/api/tags` and writes the choice to settings.
- **Test Connection** - verifies the server is reachable and the configured model is installed.
- **Show Log** - reveals the output channel.

## Supported languages

JavaScript / TypeScript (incl. JSX/TSX), Python, C#, Go, Rust, Java, C/C++, PHP, Ruby, Swift, Kotlin, Scala, Dart, Lua, HTML, CSS/SCSS, JSON, YAML, Markdown, SQL, shell, PowerShell, Vue, Svelte.

The extension activates on these languages; you can add more by raising an issue.

## Tips

### React / JSX completions

With the default `midLineMode: "smart"`, completions trigger inside JSX tag attributes — e.g. placing the cursor inside `<Button onClick={|}>` or `<Card>{|}</Card>` will request a suggestion. The extension detects these positions heuristically; if you prefer the strict legacy behaviour, set `midLineMode` to `"never"`.

### Multi-line completion control

By default the extension uses `"auto"` multi-line mode: it allows multi-line completions only when context suggests they're useful (e.g. just after `{` or `=>`), and limits them to a single line in comments, strings, and JSX attribute values. If the model still occasionally produces too much, lower `maxCompletionLines` (default 6). If you want full multi-line everywhere, set `multilineMode` to `"always"`.

### JSON translation files

The extension completes inside string values in `.json` and `.jsonc` files. This is especially useful for translation / i18n files: with sibling keys already filled in, a good FIM-capable model can pattern-match and suggest the right phrase for an empty value.

```json
{
  "save": "Save",
  "cancel": "Cancel",
  "delete": "|"   ← cursor here triggers a completion
}
```

Completion quality for human-language text depends heavily on the model. Small coder models (e.g. `qwen2.5-coder:1.5b`) pattern-match well from nearby keys but are not real translators — treat their suggestions as a starting point, not a finished translation. Larger general-purpose models produce better prose but are slower.

## Privacy

All requests go to the Ollama server you configure. Nothing is sent anywhere else. The extension logs **lengths**, never contents, of the prefix and suffix. Credentials live in the OS-native secret store.

## Development

```bash
npm install
npm run watch         # tsc -w in the background
# Press F5 in VS Code to launch an Extension Development Host
```

Run unit tests:

```bash
npm test
```

Package locally:

```bash
npm run package       # produces ollama-code-completions-<version>.vsix
```

### Before publishing

The scaffold ships with placeholders that need to be filled in:

- `package.json` -> `publisher`: replace `your-publisher-id` with your VS Code Marketplace publisher ID.
- `package.json` -> `repository.url`: replace with your real GitHub URL.
- `icon.png`: the included icon is a placeholder; swap in your real one (256x256 PNG).
- A `VSCE_PAT` repository secret is required for the publish workflow. Generate one at `dev.azure.com/<org>/_usersSettings/tokens` with **Marketplace > Manage** scope.

## License

[MIT](LICENSE)
