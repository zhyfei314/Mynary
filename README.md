# Mynary Dictionary

Mynary is an Obsidian community plugin for looking up words and short phrases with Wiktionary, then turning the result into reusable Markdown vocabulary notes.

## Features

- Look up selected text from the editor or search from the dictionary sidebar.
- Display definitions, pronunciation, part of speech, examples, translations, synonyms, antonyms and etymology when available.
- Copy, insert or create a note using a reusable Markdown template.
- Update only a managed section of an existing note while preserving personal content.
- Cache results locally with configurable expiration and size limits, including a persistent **Recent** lookup list.
- Work on desktop and mobile.

## Installation

### Manual installation

1. Download or build the plugin files: `main.js`, `manifest.json` and `styles.css`.
2. Create this folder inside your vault:

   ```text
   <Vault>/.obsidian/plugins/mynary/
   ```

3. Copy the three files into that folder.
4. Open **Settings → Community plugins**.
5. Enable **Mynary Dictionary**.

Reload Obsidian after replacing `main.js` or `styles.css`.

## Looking up a word

### Desktop

Select a word or short phrase in a Markdown note and use one of these options:

- Press **Mod + Shift + L**. `Mod` means **Ctrl** on Windows/Linux and **Cmd** on macOS.
- Open the editor context menu and select **Lookup**.
- Run **Mynary Dictionary: Lookup selected word** from the Command Palette.
- Open the dictionary sidebar and search directly.

The default selection limit is 80 characters or 8 words. For a longer selection, Mynary lets you look up the exact selection, look up the first word, or cancel.

### Mobile

Obsidian supports adding editor commands to the mobile toolbar. To add the lookup action:

1. Open **Settings → Mobile → Configure mobile toolbar**.
2. Add **Mynary Dictionary: Lookup selected word**.
3. The command uses the `search` icon.

You can also select text, open the editor selection menu and choose **Lookup**. If the command is placed under the menu's overflow button, use the mobile toolbar command above. The sidebar also provides a **Lookup selected text** button for opening the lookup popup after selecting text in a note.

The sidebar can search independently of the popup. Results indicate whether they came from the local cache or from a fresh Wiktionary request. **Refresh** bypasses the cache.

## Templates

Open **Settings → Mynary Dictionary → Manage templates** to create, edit, duplicate, delete and restore templates. The template picker is available independently for **Copy**, **Insert** and **Create note**.

Templates are Markdown strings containing case-insensitive variables such as `{{word}}`. `{{Title}}` is an alias for `{{word}}`.

### Available variables

| Variable | Description |
| --- | --- |
| `{{word}}`, `{{Title}}` | Looked-up word or phrase |
| `{{language}}` | Wiktionary language code |
| `{{definition}}` | First definition |
| `{{definitions}}` | Definitions separated by new lines |
| `{{definitionsMarkdown}}` | Definitions as a Markdown list |
| `{{meaningsMarkdown}}` | Meanings grouped by part of speech and etymology |
| `{{IPA}}` | Pronunciation information |
| `{{partOfSpeech}}` | Part of speech values |
| `{{example}}` | First usage example |
| `{{examples}}` | Examples separated by new lines |
| `{{examplesMarkdown}}` | Examples as a Markdown list |
| `{{translation}}` | Translated words on one line |
| `{{translations}}` | Translations separated by new lines |
| `{{translationsMarkdown}}` | Translations grouped by sense as a Markdown list; each sense is shown once |
| `{{synonyms}}` | Synonyms separated by commas |
| `{{antonyms}}` | Antonyms separated by commas |
| `{{etymology}}` | Etymology text |
| `{{source}}` | Source name |
| `{{sourceUrl}}` | Source URL |
| `{{lookupDate}}` | Lookup date in `YYYY-MM-DD` format |

Empty or unavailable values render as empty strings. The Template Manager validates unknown variables and malformed conditional blocks before use.

## Conditional blocks

Use `{{#if variable}}` and `{{/if}}` to include a section only when its value is not empty:

```markdown
{{#if IPA}}
## Pronunciation

{{IPA}}
{{/if}}
```

This is useful for optional translations, examples and source links:

```markdown
{{#if translationsMarkdown}}
## Translations

{{translationsMarkdown}}
{{/if}}

{{#if examplesMarkdown}}
## Examples

{{examplesMarkdown}}
{{/if}}
```

Conditional blocks can be nested. Conditions use the same case-insensitive variable names as normal placeholders. If a condition is empty, the entire block—including its contents—is omitted.

## Creating and updating notes

After a lookup, select **Create note** and choose a template. Mynary uses these settings:

- **Note folder** — destination folder; leave empty for the vault root.
- **Filename template** — for example `{{word}}` or `{{language}}-{{word}}`.
- **Existing note behavior** — what to do when the target note already exists.

Unsafe filename characters are replaced automatically. Missing folders are created when needed.

### Existing note behavior

- **Ask before replacing** — ask for confirmation before replacing the complete note.
- **Replace automatically** — replace the complete note without confirmation.
- **Update section** — preserve the rest of the note and replace only the Mynary-managed section.

Managed sections use these markers:

```markdown
<!-- mynary:lookup:start -->
Generated dictionary content
<!-- mynary:lookup:end -->
```

When the markers are not present, Mynary appends a new managed section. Keep personal notes outside these markers so future updates do not overwrite them.

## Cache

Lookup results are stored in Obsidian's local plugin data, not as files in the vault.

Default settings:

- Cache lifetime: **7 days**
- Maximum entries: **100**
- Request timeout: **15 seconds**

The cache key includes the language and normalized lookup text. **Refresh** bypasses the cached value and stores the new result. Use **Clear cache** in settings to remove all cached results.

The **Recent** list stores the last 20 looked-up words in local plugin data and is restored when Obsidian is reopened. Existing cached entries are used to restore the list after upgrading from an earlier version.

## Privacy and attribution

Mynary is local-first:

- No telemetry, analytics, advertising or account system.
- No vault scanning or indexing.
- No note content, filenames or personal metadata are uploaded.
- Only the explicitly requested word or phrase and selected language are sent to the public Wiktionary API.
- Cached lookup data remains in local Obsidian plugin storage.

Large Wiktionary entries may also request the entry's public `/translations` subpage. Network access is used only to retrieve the requested dictionary result.

Mynary uses and links to [Wiktionary](https://www.wiktionary.org/) as its dictionary source. Results should be checked against the linked original page, especially for translations and usage examples.

## Supported languages

The built-in language options are:

- English (`en`)
- Vietnamese (`vi`)
- Japanese (`ja`)
- Korean (`ko`)
- Chinese (`zh`)
- French (`fr`)
- German (`de`)
- Spanish (`es`)
- Italian (`it`)
- Russian (`ru`)

Available fields depend on the selected Wiktionary entry. Mynary does not invent missing data.

## Development

Requirements:

- Node.js 18 or newer
- npm

Install dependencies:

```bash
npm install
```

Start esbuild in watch mode:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Run tests:

```bash
npm test
```

Run ESLint:

```bash
npm run lint
```

The build generates `main.js` at the plugin root. Build artifacts and `node_modules/` should not be committed to source control. For manual testing, reload Obsidian after rebuilding and enable the plugin from **Settings → Community plugins**.

## Project structure

```text
src/
  main.ts                    Plugin lifecycle, commands and views
  providers/                 Wiktionary requests and parsers
  services/                  Local cache management
  templates/                 Rendering and note generation
  ui/                        Modals and confirmation dialogs
  utils/                     Selection and result formatting
  settings.ts                Settings, defaults and migration
```

## License

Mynary is distributed under the MIT License. See [LICENSE](LICENSE).
