# Mynary Dictionary

Look up a word while you are reading, understand how it is used, and save it as a vocabulary note — without leaving Obsidian.

Mynary uses Wiktionary for dictionary data and is designed to stay out of your way. Select a word, look it up, and keep going.

## Get started

### Install from Community Plugins

1. Open **Settings → Community plugins**.
2. If Obsidian asks, turn off Restricted mode.
3. Search for **Mynary Dictionary**, then select **Install** and **Enable**.

That is all you need for dictionary lookups. Node.js, Python, model downloads, and the optional TTS WASM file are not required.

### Install manually

Download `main.js`, `manifest.json`, and `styles.css` from a GitHub release. Copy them into:

```text
<Vault>/.obsidian/plugins/mynary/
```

Then enable Mynary under **Settings → Community plugins**. Reload Obsidian after replacing plugin files.

## Look up a word

The quickest way is to select a word or short phrase in a Markdown note and choose one of these options:

- Select **Lookup** from the editor context menu.
- Run **Mynary Dictionary: Lookup selected word** from the Command Palette.
- Press **Mod + Shift + L** (`Ctrl` on Windows/Linux, `Cmd` on macOS).
- Open the dictionary sidebar and search there.

On mobile, add **Mynary Dictionary: Lookup selected word** to **Settings → Mobile → Configure mobile toolbar**. The selection menu and sidebar work there too.

To keep the sidebar open, select the book icon in the ribbon or run **Mynary Dictionary: Open dictionary sidebar**. Type a word or phrase, choose a Wiktionary language, and press Enter.

Mynary accepts selections up to 80 characters or 8 words by default. Longer selections can still be looked up exactly or reduced to their first word.

## Optional offline dictionary packs

Mynary can use a small local dictionary pack before falling back to Wiktionary. Run **Mynary Dictionary: Install offline dictionary pack from URL**, then enter a pack `manifest.json` URL. Packs contain only indexed definitions, pronunciation, examples, and selected translations; audio is not included. A missing pack or missing entry falls back to the normal Wiktionary lookup.

Pack files are installed under `.mynary/dictionaries/<language>/`. Downloads are written to temporary files and verified with SHA-256 when the manifest provides checksums. To build a pack from a Kaikki JSONL dump:

```bash
npm run build:pack -- path/to/vi-extract.jsonl ./dist/vi vi "Vietnamese Core Dictionary"
```

Pack manifests use the same schema for core and bilingual packs. Core packs use `kind: "core"` and `language`; bilingual packs use `kind: "bilingual"`, `language` as the source language, and `targetLanguage` as the translation language. `entriesFile` may end in `.gz`; its checksum is always the SHA-256 of the exact downloadable bytes.

The small GitHub-side catalog is [dictionary-catalog/catalog.json](dictionary-catalog/catalog.json). It points to the large pack assets in the Hugging Face Dataset repository. The current local release set can be uploaded with `hf upload zhyfei314/Mynary-Offline-Dictionary ./release --repo-type dataset` after `hf auth login`.

## Optional local translation

Mynary can send selected text to a locally running [MTranServer](https://github.com/xxnuo/MTranServer). Enable **MTranServer translation** in settings, configure the local endpoint (normally `http://127.0.0.1:8989`), and use **Translate selected text with MTranServer**. The plugin sends text only when this command is used; it does not send vault content automatically.

## What you will see

Depending on the entry, Mynary can show:

- definitions grouped by part of speech;
- usage labels such as **Transitive**, **Intransitive**, **Countable**, and **Uncountable**;
- examples, pronunciation, Wiktionary audio, translations, synonyms, antonyms, and etymology.

Mynary keeps each entry exactly as Wiktionary presents it. It does not silently replace an inflected or ambiguous word with a guessed root. When Wiktionary provides a link such as `destroy` or `run`, Mynary keeps that link available in the result. In generated Markdown, those links become Obsidian links:

```text
third-person singular simple present indicative of [[destroy]]
plural of [[run]]
```

Select a linked word to look it up directly in Mynary. The popup and dictionary sidebar use the same result renderer, so definitions, labels, examples, and Wiktionary links stay consistent between both views.

## Translate text locally

Mynary provides a separate translation action powered by a local [MTranServer](https://github.com/xxnuo/MTranServer). It does not send vault content automatically.

1. Install and start MTranServer locally. The default endpoint is `http://127.0.0.1:8989`.
2. Open **Settings → Mynary Dictionary** and enable **MTranServer translation**.
3. Check the endpoint, optional bearer token, source-language mode, timeout, and default target language.
4. Select text in a note and choose **Translate selected text with MTranServer**, or use **Translate selected text** in the dictionary sidebar.
5. In the translation panel, choose a supported target language and select **Translate**.

The lookup popup also includes **Translate this text**, while the sidebar includes **Translate current query**. The default target language is English (`en`). The source can use the current dictionary language or `auto` for MTranServer builds that support automatic detection.

## Offline dictionary packs

Open **Settings → Mynary Dictionary → Offline dictionary packs** and select **Choose language**. Mynary loads the public catalog from GitHub, with a Hugging Face fallback, lets you choose a language and pack, downloads only the pack files, verifies SHA-256 checksums, and stores the pack in the vault under `.mynary/dictionaries/<language>/`.

Core packs contain definitions and pronunciation. Bilingual packs contain translations for a specific direction such as English → Vietnamese. Only one pack can be active for a source language; installing another pack for that source replaces the previous one. If an installed pack has no matching entry, Mynary falls back to Wiktionary when online.

## Data and licenses

Dictionary data is generated from Wiktionary extracts provided by Kaikki.org and is distributed according to the applicable source terms. Pack manifests identify the source snapshot and license. The repository includes the full license texts used by the data catalog:

- [CC BY-SA 3.0](LICENSE-CC-BY-SA-3.0.txt)
- [CC BY-SA 4.0](LICENSE-CC-BY-SA-4.0.txt)
- [GNU Free Documentation License 1.3](LICENSE-GFDL-1.3.txt)

The plugin source itself remains MIT-licensed. Do not add audio, source HTML, or third-party data unless its redistribution terms are documented in the relevant pack manifest.

## Save what you learned

After a lookup, choose **Copy**, **Insert**, or **Create note**, then select a template.

You can manage this workflow under **Settings → Mynary Dictionary**:

- **Note folder** — where new vocabulary notes go. Leave it empty to use the vault root.
- **Filename template** — for example `{{word}}` or `{{language}}-{{word}}`.
- **Default template** — the template selected first.
- **Existing note behavior** — ask before replacing, replace automatically, or update only Mynary's managed section.

Mynary creates missing folders automatically and replaces unsafe filename characters.

When you choose **Update section**, only the content between these markers is managed:

```markdown
<!-- mynary:lookup:start -->
Generated dictionary content
<!-- mynary:lookup:end -->
```

Anything outside the markers is left alone. If the markers are not present, Mynary appends a new managed section.

## Make the notes yours with templates

Open **Settings → Mynary Dictionary → Manage templates** to create, edit, duplicate, delete, or restore templates. Variable names are case-insensitive, so `{{Title}}` is the same as `{{word}}`.

| Variable | What it contains |
| --- | --- |
| `{{word}}` / `{{Title}}` | The original word or phrase |
| `{{language}}` | Wiktionary language code |
| `{{definition}}` | The first definition, including Wiktionary links |
| `{{definitions}}` | All definitions, one per line, including Wiktionary links |
| `{{definitionsMarkdown}}` | Definitions as a Markdown list with Wiktionary links |
| `{{meaningsMarkdown}}` | Definitions grouped by part of speech and labels, with Wiktionary links |
| `{{IPA}}` | Pronunciation information |
| `{{partOfSpeech}}` | Part-of-speech values |
| `{{example}}` | The first example |
| `{{examples}}` | All examples, one per line |
| `{{examplesMarkdown}}` | Examples as a Markdown list |
| `{{translation}}` | Translations on one line |
| `{{translations}}` | Translations, one per line |
| `{{translationsMarkdown}}` | Translations grouped by sense |
| `{{synonyms}}` | Synonyms separated by commas |
| `{{antonyms}}` | Antonyms separated by commas |
| `{{etymology}}` | Etymology text |
| `{{source}}` | Source name |
| `{{sourceUrl}}` | Link to the source entry |
| `{{lookupDate}}` | Lookup date in `YYYY-MM-DD` format |

You can hide optional sections when they are empty:

```markdown
{{#if IPA}}
**IPA:** {{IPA}}
{{/if}}
```

## Optional text-to-speech

Dictionary lookup does not need Supertonic. It is an optional feature for generating pronunciation audio or reading selected text aloud.

### Web runtime

1. Enable **Supertonic local TTS** in **Settings → Mynary Dictionary**.
2. Keep **Supertonic runtime** set to **Web**.
3. Download `ort-wasm-simd-threaded.jsep.wasm` from the matching `onnxruntime-web` package or release.
4. Place it next to `main.js` in the Mynary plugin folder.
5. Use **Generate TTS**, **Read selected text with supertonic**, or **Mod + Shift + R**.

The first Web runtime use downloads the Supertonic ONNX models from Hugging Face, so it may take a little longer and use a substantial amount of storage. If the WASM file is missing, dictionary lookup continues to work and Mynary shows a setup message when speech is requested.

### Local server runtime

Install Supertonic in a Python environment:

```bash
pip install supertonic
supertonic serve --host 127.0.0.1 --port 7788
```

Select **Local server** under **Settings → Mynary Dictionary → Supertonic runtime**. The default endpoint is `http://127.0.0.1:7788/v1/tts`.

The server must be running whenever speech is generated. Supertonic supports fewer languages than Wiktionary; for unsupported languages, Mynary keeps the Wiktionary pronunciation and disables Supertonic generation.

## Languages

The language selector includes Arabic, Bulgarian, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Norwegian, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian, and Vietnamese.

Wiktionary coverage varies by language and by entry. When in doubt, follow the source link in the result and verify the original entry.

## Cache and privacy

Mynary stores lookup results and recent searches in Obsidian's local plugin data. The defaults are:

- cache lifetime: 7 days;
- maximum cached entries: 100;
- recent searches: 20 words;
- request timeout: 15 seconds.

There is no telemetry, advertising, analytics, or account system. Mynary does not scan or index your vault. The word or phrase you look up, along with the selected language, is sent to the public Wiktionary API. Large entries may also request their public `/translations` subpage.

If Web Supertonic is enabled, model and voice assets are requested from Hugging Face. If Local server is enabled, selected text is sent only to the endpoint configured in Mynary's settings.

## For contributors

Requirements: Node.js 18 or newer and npm.

```bash
npm install
npm test
npm run lint
npm run build
```

Use `npm run dev` for esbuild watch mode. The production build writes `main.js` to the plugin root.

The main source folders are:

```text
src/
  main.ts          Plugin lifecycle, commands, and views
  providers/       Wiktionary parsing and TTS runtimes
  services/        Local cache management
  templates/       Template rendering and note generation
  ui/              Modals and dialogs
  utils/           Selection and result formatting
```

## License

Mynary is distributed under the MIT License. See [LICENSE](LICENSE).
