# Mynary Dictionary

Mynary is an Obsidian plugin for looking up words with Wiktionary and turning the result into reusable vocabulary notes.

## What it does

- Look up selected words or short phrases from the editor.
- Open a dictionary sidebar for direct search, language selection and recent lookups.
- Show definitions, part of speech, etymology, pronunciation, examples, translations, synonyms and antonyms when available.
- Filter large translation results by language, sense or keyword.
- Copy or insert a formatted result, or create/update a vocabulary note.
- Use three built-in templates or create your own Markdown templates.
- Cache results locally with a configurable TTL and entry limit.

The first provider is Wiktionary. The provider layer is designed so additional dictionary sources can be added later.

## Installation

### Manual installation

1. Build the plugin with `npm run build`.
2. Create `.obsidian/plugins/mynary/` in your vault.
3. Copy `main.js`, `manifest.json` and `styles.css` into that folder.
4. Enable **Mynary Dictionary** in **Settings → Community plugins**.

### Development

```bash
npm install
npm run dev
```

Validation commands:

```bash
npm test -- --run
npm run build
npm run lint
```

## Looking up a word

From a Markdown editor, select a word or short phrase and press:

- **Ctrl+Shift+L** on Windows/Linux
- **Cmd+Shift+L** on macOS

You can also right-click the selection and choose **Lookup selected word**, or run the command from the Command Palette.

Selection handling is deliberately conservative. Mynary accepts up to 80 characters or 8 words. For a longer selection, the popup lets you look up the exact selection, only the first word, or cancel.

The sidebar is available from the ribbon icon or the **Open dictionary sidebar** command. Its search button uses the selected language code; hover or focus the language selector to see the full language name.

Results show whether they came from the local cache or a fresh request. Use **Refresh** to bypass the cache and fetch the current Wiktionary result. **Source: Wiktionary** opens the original page for verification.

## Templates

Open **Settings → Mynary Dictionary → Manage templates** to add, rename, edit, duplicate, delete and restore templates. Copy, Insert and Create note each show the same template picker, so the format can be chosen independently for every action.

The manager provides:

- A large Markdown editor.
- Live validation for unknown variables and malformed `{{#if ...}}` blocks.
- Preview data for rich entries, sparse entries, translation-heavy entries and the current lookup.
- A default-template selector.
- Safe migration of untouched legacy built-in and Flashcard templates. User-edited templates are preserved.

Templates use case-insensitive `{{variable}}` placeholders. `{{Title}}` is an alias for `{{word}}`.

Supported variables include:

```text
{{word}}             {{Title}}             {{language}}
{{definition}}       {{definitions}}       {{definitionsMarkdown}}
{{meaningsMarkdown}} {{IPA}}               {{partOfSpeech}}
{{example}}          {{examples}}          {{examplesMarkdown}}
{{translation}}      {{translations}}      {{translationsMarkdown}}
{{synonyms}}         {{antonyms}}          {{etymology}}
{{source}}           {{sourceUrl}}         {{lookupDate}}
```

Optional sections use:

```text
{{#if IPA}}
## Pronunciation
{{IPA}}
{{/if}}
```

Empty values omit the conditional section. Unknown variables render as empty strings, while the Template Manager reports them so they can be corrected before use.

## Creating and updating notes

After a lookup, choose **Create note** and select a template. The note filename is generated from the configurable filename template; unsafe filename characters are replaced automatically. The note folder is created when it does not exist.

When the target note already exists, choose one of these behaviors in Settings:

- **Ask before replacing**: confirm before replacing the whole file.
- **Replace automatically**: replace the whole file without asking.
- **Update section**: preserve personal content and replace only the managed section.

Managed sections use these markers:

```markdown
<!-- mynary:lookup:start -->
Generated dictionary content
<!-- mynary:lookup:end -->
```

If the markers are missing, Mynary appends them. Keep personal notes outside the managed section so future updates do not overwrite them.

## Cache

Results are stored in Obsidian's local plugin data, not in the vault. The default cache policy is 7 days and 100 entries. Both values can be changed in Settings. Use **Clear cache** to remove all cached lookup results.

Refreshing a result bypasses the existing cache and stores the new result under the same lookup key.

## Privacy and attribution

Mynary has no telemetry, analytics, account system or advertising. It does not scan, index or upload vault contents.

Only an explicitly requested word or phrase and the selected language are sent to the corresponding public Wiktionary API. Large entries may also request the public `/translations` subpage. Mynary does not send note content, vault contents, selection context, filenames or personal metadata.

Cached data remains in local Obsidian plugin storage and is removed according to the configured TTL or cache limit. Data is written to the vault only when the user chooses to create or update a note.

Results should be checked against the original source. Mynary displays and links to Wiktionary for attribution and verification.

## Supported languages

English (`en`), Vietnamese (`vi`), Japanese (`ja`), Korean (`ko`), Chinese (`zh`), French (`fr`), German (`de`), Spanish (`es`), Italian (`it`) and Russian (`ru`).

The available fields depend on what Wiktionary provides for a particular word and language. Missing fields are represented as empty values rather than fabricated data.
