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

## What you will see

Depending on the entry, Mynary can show:

- definitions grouped by part of speech;
- usage labels such as **Transitive**, **Intransitive**, **Countable**, and **Uncountable**;
- examples, pronunciation, Wiktionary audio, translations, synonyms, antonyms, and etymology.

When you look up an inflected form, Mynary tries to find its dictionary form while keeping the original word visible. For example:

```text
walked → walk
tries → try, trie
```

When more than one base form is possible, Mynary keeps the valid alternatives and makes them clickable. Select a base form to look it up directly. Results always include a link back to the original Wiktionary entry.

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
| `{{baseWord}}` | The base form or forms, when found |
| `{{inflection}}` | How the base form was detected |
| `{{language}}` | Wiktionary language code |
| `{{definition}}` | The first definition |
| `{{definitions}}` | All definitions, one per line |
| `{{definitionsMarkdown}}` | Definitions as a Markdown list |
| `{{meaningsMarkdown}}` | Definitions grouped by part of speech and labels |
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
