# Mynary Dictionary

Mynary is an Obsidian plugin for looking up words and short phrases with Wiktionary and turning lookup results into vocabulary notes.

## What it does

- Looks up selected words or phrases and searches from a dictionary sidebar.
- Shows definitions, parts of speech, sense labels, examples, pronunciation, translations, synonyms, antonyms and etymology when available.
- Resolves many inflected forms to a dictionary form, such as `walked` → `walk` and `tries` → `try`.
- Preserves the original lookup word while showing the detected base form.
- Copies results, inserts them into the active note, or creates a vocabulary note.
- Provides editable Markdown templates and a local lookup cache.
- Works on desktop and mobile.

Mynary uses the public Wiktionary API. It does not include an offline dictionary or offline translation database.

## Installation

### Community Plugins

1. Open **Settings → Community plugins**.
2. Turn off Restricted mode if Obsidian asks you to do so.
3. Search for **Mynary Dictionary**.
4. Select **Install**, then **Enable**.

Normal dictionary lookup needs no Node.js, Python, model download or WASM file.

### Manual installation

Download `main.js`, `manifest.json` and `styles.css` from a GitHub release and copy them directly into:

```text
<Vault>/.obsidian/plugins/mynary/
```

Then enable Mynary under **Settings → Community plugins**. Reload Obsidian after replacing plugin files.

## Basic usage

### Look up selected text

Select a word or phrase in a Markdown note, then:

- Select **Lookup** from the editor context menu.
- Run **Mynary Dictionary: Lookup selected word** from the Command Palette.
- Use **Mod + Shift + L** (`Ctrl` on Windows/Linux, `Cmd` on macOS).
- Open the dictionary sidebar and select **Lookup selected text**.

On mobile, add **Mynary Dictionary: Lookup selected word** under **Settings → Mobile → Configure mobile toolbar**. The editor selection menu and sidebar also work on mobile.

### Search from the sidebar

Select the book icon in the ribbon, or run **Mynary Dictionary: Open dictionary sidebar**. Enter a word or phrase, choose the Wiktionary language, and press Enter.

The sidebar indicates whether a result came from the local cache. Select **Refresh** to bypass the cache. The default selection limit is 80 characters or 8 words.

## Understanding results

Wiktionary entries can contain several levels of information. Mynary keeps the hierarchy where possible:

```text
Verb
├── Transitive
│   └── Definitions
└── Intransitive
    └── Definitions
```

An inflected lookup may show:

```text
walked · Base form: walk (past tense)
```

Mynary first checks the exact Wiktionary entry. If it has no dictionary definitions, Mynary follows Wiktionary `form-of` information and then tries conservative English deinflection rules inspired by Yomitan. Candidate forms are looked up again before being accepted.

Available fields depend on the entry. Missing information is left empty rather than invented.

## Creating vocabulary notes

After a lookup, select **Copy**, **Insert** or **Create note**, then choose a template.

Configure these options under **Settings → Mynary Dictionary**:

- **Note folder** — destination folder; empty means the vault root.
- **Filename template** — for example `{{word}}` or `{{language}}-{{word}}`.
- **Default template** — template selected by default.
- **Existing note behavior** — ask before replacing, replace automatically, or update only the managed section.

Missing folders are created automatically and unsafe filename characters are replaced.

When using **Update section**, Mynary manages only the content between:

```markdown
<!-- mynary:lookup:start -->
Generated dictionary content
<!-- mynary:lookup:end -->
```

Keep personal content outside these markers. If the markers are missing, Mynary appends a new managed section.

## Templates

Open **Settings → Mynary Dictionary → Manage templates** to create, edit, duplicate, delete or restore templates. Variables are case-insensitive; `{{Title}}` is an alias for `{{word}}`.

| Variable | Description |
| --- | --- |
| `{{word}}` / `{{Title}}` | Original lookup word or phrase |
| `{{baseWord}}` | Base form when an inflected form was resolved |
| `{{inflection}}` | Detected inflection description |
| `{{language}}` | Wiktionary language code |
| `{{definition}}` | First definition |
| `{{definitions}}` | Definitions separated by new lines |
| `{{definitionsMarkdown}}` | Definitions as a Markdown list |
| `{{meaningsMarkdown}}` | Meanings grouped by part of speech, labels and etymology |
| `{{IPA}}` | Pronunciation information |
| `{{partOfSpeech}}` | Part-of-speech values |
| `{{example}}` | First example |
| `{{examples}}` | Examples separated by new lines |
| `{{examplesMarkdown}}` | Examples as a Markdown list |
| `{{translation}}` | Translations on one line |
| `{{translations}}` | Translations separated by new lines |
| `{{translationsMarkdown}}` | Translations grouped by sense |
| `{{synonyms}}` | Synonyms separated by commas |
| `{{antonyms}}` | Antonyms separated by commas |
| `{{etymology}}` | Etymology text |
| `{{source}}` | Source name |
| `{{sourceUrl}}` | Link to the source entry |
| `{{lookupDate}}` | Lookup date in `YYYY-MM-DD` format |

Optional sections can use conditional blocks:

```markdown
{{#if IPA}}
**IPA:** {{IPA}}
{{/if}}
```

## Optional Supertonic text-to-speech

Supertonic is disabled by default and is not required for dictionary lookup. Wiktionary pronunciation text and available Wiktionary audio work without it.

### Web runtime

1. Enable **Supertonic local TTS** under **Settings → Mynary Dictionary**.
2. Keep **Supertonic runtime** set to **Web**.
3. Download the matching `ort-wasm-simd-threaded.jsep.wasm` file from the `onnxruntime-web` package/release.
4. Place it next to `main.js` in the Mynary plugin folder.
5. Use **Generate TTS**, **Read selected text with supertonic**, or **Mod + Shift + R**.

The first Web runtime use downloads the Supertonic ONNX models from Hugging Face. These models may be large. If the WASM file is missing, Mynary shows an installation message and dictionary lookup continues to work.

### Local server runtime

Install Supertonic separately in a Python environment:

```bash
pip install supertonic
supertonic serve --host 127.0.0.1 --port 7788
```

Select **Local server** under **Settings → Mynary Dictionary → Supertonic runtime**. The default endpoint is `http://127.0.0.1:7788/v1/tts`.

The local server must be running whenever speech is generated. Supertonic supports fewer languages than Wiktionary; unsupported languages keep Wiktionary pronunciation and disable Supertonic generation.

## Supported dictionary languages

The language selector includes Arabic, Bulgarian, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, German, Greek, Hebrew, Hindi, Hungarian, Indonesian, Italian, Japanese, Korean, Latvian, Lithuanian, Norwegian, Polish, Portuguese, Romanian, Russian, Slovak, Slovenian, Spanish, Swedish, Thai, Turkish, Ukrainian and Vietnamese.

Coverage varies by language and entry. Every result links to its original Wiktionary page for verification.

## Cache and privacy

Lookup results and the Recent list are stored in Obsidian's local plugin data.

Default settings:

- Cache lifetime: 7 days
- Maximum cached entries: 100
- Recent lookup history: 20 words
- Request timeout: 15 seconds

Mynary has no telemetry, analytics, advertising or account system. It does not scan or index the vault. The requested word or phrase and selected language are sent to the public Wiktionary API; large entries may also request the public `/translations` subpage.

If Supertonic Web is enabled, model and voice assets are requested from Hugging Face. If Supertonic Local server is enabled, selected text is sent to the configured local endpoint.

## Development

Requirements: Node.js 18 or newer and npm.

```bash
npm install
npm test
npm run lint
npm run build
```

Use `npm run dev` for esbuild watch mode. The production build writes `main.js` to the plugin root. Standard release files are `main.js`, `manifest.json` and `styles.css`; the optional Web TTS WASM file is not part of the standard Community Plugin installation.

## Project structure

```text
src/
  main.ts                    Plugin lifecycle, commands and views
  providers/                 Wiktionary, language registry and TTS runtimes
  services/                  Local cache management
  templates/                 Template rendering and note generation
  ui/                        Modals and confirmation dialogs
  utils/                     Selection and result formatting
  settings.ts                Settings, defaults and migration
```

## License

Mynary is distributed under the MIT License. See [LICENSE](LICENSE).
