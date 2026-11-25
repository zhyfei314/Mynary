# Mynary Dictionary

Look up words in Obsidian, save definitions as notes, and study them as flashcards. Mynary uses Wiktionary by default and can also use optional local dictionary packs, translation, and speech services.

Target release: **1.4.1**.

## Install

In Obsidian, open **Settings → Community plugins**, search for **Mynary Dictionary**, then install and enable it.

To install manually, download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/zhyfei314/Mynary/releases/latest), copy them into `<Vault>/.obsidian/plugins/mynary/`, then enable the plugin.

## Look up words

- Select a word in a note and choose **Lookup** from the editor menu, or run **Mynary Dictionary: Lookup selected word**. The default shortcut is **Mod + Shift + L** (`Ctrl` on Windows/Linux, `Cmd` on macOS).
- Open the dictionary sidebar from the ribbon or with **Mynary Dictionary: Open dictionary sidebar** to search directly.
- On mobile, add **Lookup selected word** to **Settings → Mobile → Configure mobile toolbar**. You can also search in the sidebar.
- Set the lookup language in **Settings → Mynary Dictionary → Dictionary**. Optional double-click lookup is in **Interaction**.

Entries can include definitions grouped by part of speech, usage labels, examples, pronunciation and Wiktionary audio, translations, synonyms, antonyms, etymology, and links to related words. Available details depend on the Wiktionary entry.

## Create notes with templates

From a lookup, use **Save** to copy the result, insert it into the current note, or create a vocabulary note. Choose a template for each action. Mynary can ask before replacing an existing note, replace it, or update only the section between its Mynary markers. Optional bilingual notes append available translations.

The built-in note templates are:

| Template | Includes |
| --- | --- |
| **Basic vocabulary** | Word, language and source metadata, meanings, and examples |
| **Detailed vocabulary** | Word, pronunciation, parts of speech, meanings, translations, and synonyms |

Open **Settings → Mynary Dictionary → Notes, templates, and cache → Manage templates** to edit or organize note and flashcard templates. Set their defaults separately. The manager supports custom templates, duplication, deletion, restore of built-ins, and a live preview.

Templates support dictionary values such as `{{word}}`, `{{language}}`, `{{IPA}}`, `{{definition}}`, `{{definitionsMarkdown}}`, `{{meaningsMarkdown}}`, `{{examplesMarkdown}}`, `{{translationsMarkdown}}`, `{{synonyms}}`, `{{antonyms}}`, `{{etymology}}`, `{{source}}`, `{{sourceUrl}}`, and `{{lookupDate}}`. `{{audio}}`, `{{partOfSpeech}}`, `{{translation}}`, `{{translations}}`, `{{sourceLanguage}}`, and `{{targetLanguage}}` are also available. Variable names are case-insensitive; underscore aliases such as `{{source_url}}` work too. Use `{{#if IPA}}…{{/if}}` to hide optional sections when a value is empty.

## Vocabulary and flashcards

Choose **Add to vocabulary** on a lookup to create one card for each definition. Each card is an editable Markdown note, and its title includes the dictionary language—for example, `hello [EN]`—so entries for the same word in different languages stay distinct.

The built-in flashcard templates are:

| Template | Front | Back |
| --- | --- | --- |
| **Basic flashcard** | Word | Meanings, optional translation, examples, and pronunciation |
| **Simple flashcard** | Word and pronunciation | Meaning and examples |

Open **Vocabulary study** from the ribbon or **Mynary Dictionary: Open vocabulary study**. You can browse and filter decks, create nested decks, edit card notes, move cards, set their status, and remove cards from the study list while keeping their notes. Study due cards with **Again**, **Hard**, **Good**, or **Easy**; each button shows the next review interval. Set the daily new-card limit in **Settings → Mynary Dictionary → Vocabulary study**. Notes and review progress are stored in the vault and can sync with your vault sync service.

### Upgrade older flashcards

Open **Review old cards** in the Vocabulary study settings or sidebar, or run **Mynary Dictionary: Upgrade active legacy flashcard** while viewing an old card. Select which notes to process and choose an action:

- **Add language label to note title** renames the note, for example to `hello [EN].md`, without changing its content. Mynary checks note properties, the old title, filename, and folder for the language; it uses the current dictionary language when it cannot find one.
- **Refresh and split by definition** looks up each selected word in Wiktionary using its detected language, applies the selected flashcard template, and creates a separate card for each definition. It preserves a legacy Notes section when present. Refresh up to 10 notes per run to limit requests.

### Export to Anki

In **Settings → Mynary Dictionary → Vocabulary study**, select **Create Anki import file**. In Anki, choose **File → Import**, select the exported `.txt` file, keep the **Basic** note type, and review the preview. The file declares tab-separated fields, HTML answers, and the deck column. Mynary also exports CSV and JSON. These are file exports; Mynary does not connect to AnkiWeb or read Anki's desktop collection.

## Offline dictionary packs

Install packs in **Settings → Mynary Dictionary → Offline dictionary** with **Choose language** or **Install from URL**. Core packs provide definitions and pronunciation; bilingual packs add translations. Mynary verifies downloaded files against their SHA-256 checksums and stores them in the vault. Installed packs are checked before Wiktionary; missing entries fall back to Wiktionary when online.

- **Smart matching & custom pack selection**: In **Auto** mode, bilingual packs match your active lookup/target language (for example, `en-vi` matches `vi`) while core packs remain available regardless of the selected lookup language. Switch to **Custom** mode, filter by source language, or set pack priority order in **Settings** or directly from the **Packs** picker in the lookup popup and sidebar.
- **Multi-pack results**: When multiple packs contain an entry, each pack's result is shown in its own collapsible section with per-pack note and vocabulary actions, plus a combined selector at the bottom to merge selected packs into a note or flashcard.
- **Synced Packs only & Online lookup**: Toggle **Packs only** in either the popup or sidebar (stays in sync across both, with an optional **session-only** setting), or click **Online** to search Wiktionary directly without disabling offline packs.

Packs are published separately in the [Mynary Offline Dictionary dataset](https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary). The 1.4.0 catalog release contains 42 core packs and 448 bilingual packs (490 total), covering 42 headword languages and 18 translation target languages. Its assets are stored under the versioned snapshot `release/1.4.0/`; each catalog URL points directly to that snapshot. Dictionary data comes from Wiktionary extracts supplied by [Kaikki.org](https://kaikki.org/). Data is distributed under the terms identified by each pack, including [CC BY-SA 3.0](LICENSE-CC-BY-SA-3.0.txt), [CC BY-SA 4.0](LICENSE-CC-BY-SA-4.0.txt), or [GFDL 1.3](LICENSE-GFDL-1.3.txt). The plugin source is MIT-licensed.

Pack maintainers can rebuild the current language set and validate pack compatibility with the streaming builder. See [PACK_BUILDING.md](PACK_BUILDING.md) for Kaikki source URLs and the Google Colab workflow.

## Optional translation and speech

**Translation** is optional and disabled by default. Enable it in **Settings → Mynary Dictionary → Translate**, choose a provider, then use **Translate selected text** or a translate action in the lookup UI. Mynary supports:

- **MTranServer**: a local [MTranServer](https://github.com/xxnuo/MTranServer) instance. Existing MTranServer endpoint, token, languages, timeout, and enabled state are retained when older settings are migrated.
- **LibreTranslate**: a local or remote [LibreTranslate API](https://docs.libretranslate.com/api/operations/translate/). Set the server base URL (for example, `http://127.0.0.1:5000`) and optional API key.
- **OpenAI-compatible server**: configure the server's `/v1` base URL, model name, and optional API key. The standard profile uses Chat Completions. The **PLaMo 3 Completions** profile sends the PFML3 translation prompt to `/completions`, for PLaMo 3 Translate served by [vLLM](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/) or [llama.cpp](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF). Install and run the model server separately; Mynary does not download models. Review the [PLaMo 3 model card and license](https://huggingface.co/pfnet/plamo-3-translate-2b) before use.

Use **Test connection** in settings to send a short sample request through the selected provider. Requests have a configurable timeout.

**Speech** is off by default. Enable it in **Settings → Mynary Dictionary → TTS** and choose a runtime:

- **Offline system voices** uses local voices exposed through Obsidian's Web Speech API. Mynary does not download voice data. Voice availability varies by device; some Android WebViews do not expose installed system voices. Use **Refresh voices** to check, or choose a server runtime if no voice is available.
- **Local Supertonic server** sends speech text to the endpoint you configure, can generate audio files, and supports optional auto-generation during lookup. Install and start the server separately; the default endpoint is `http://127.0.0.1:7788/v1/tts`.
- **OpenAI-compatible TTS server** sends speech text to any `/v1/audio/speech` endpoint (such as OpenAI TTS, Kokoro-FastAPI, OpenedAI-Speech, or Edge-TTS proxies). Configure the endpoint URL, optional API key, model, voice, and speed in settings.

Use **Mynary Dictionary: Read selected text with offline speech** or **Mod + Shift + R** to read selected text. Lookups can also play Wiktionary audio when provided.

## Privacy

There is no telemetry, advertising, or account system. Online lookups send the searched word and selected language to Wiktionary; an installed pack can answer without a network lookup. Mynary scans Markdown files in the configured vocabulary folder to sync flashcards. It does not send vault content automatically. Translation sends only the text you submit (or the short sample used by **Test connection**) to the selected MTranServer, LibreTranslate, or OpenAI-compatible endpoint. A remote endpoint receives that text and the source/target language codes; configure a local endpoint if you want the translation server to run on your device or network. API keys are stored with this plugin's settings in the vault and sent only to the corresponding configured provider as its API key or bearer token. Speech text goes to the configured Supertonic or OpenAI-compatible TTS endpoint only when you use that runtime.

## Development

Requirements: Node.js 18+ and npm.

```bash
npm install
npm test
npm run lint
npm run build
```

`npm run dev` starts esbuild watch mode. Pushing a version tag such as `1.4.0` starts the release workflow, which runs tests, lint, and the production build, checks that the tag matches the manifest and package versions, then attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

## License

Mynary is distributed under the [MIT License](LICENSE).
