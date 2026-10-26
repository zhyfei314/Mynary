# Mynary Dictionary

Look up words in Obsidian, save definitions as notes, and study them as flashcards. Mynary uses Wiktionary by default and can also use optional local dictionary packs, translation, and speech services.

Current release: [**1.3.1**](https://github.com/zhyfei314/Mynary/releases/tag/1.3.1).

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

Packs are published separately in the [Mynary Offline Dictionary dataset](https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary). Dictionary data comes from Wiktionary extracts supplied by [Kaikki.org](https://kaikki.org/). Data is distributed under the terms identified by each pack, including [CC BY-SA 3.0](LICENSE-CC-BY-SA-3.0.txt), [CC BY-SA 4.0](LICENSE-CC-BY-SA-4.0.txt), or [GFDL 1.3](LICENSE-GFDL-1.3.txt). The plugin source is MIT-licensed.

## Optional translation and speech

**Translation** uses a locally running [MTranServer](https://github.com/xxnuo/MTranServer). Enable it in **Settings → Mynary Dictionary → Translate**, set the local endpoint, and use **Translate selected text with MTranServer** or a translate action in the lookup UI. Text is sent only when you request a translation. You can set source and target languages, an optional bearer token, and a timeout.

**Speech** is off by default. Enable it in **Settings → Mynary Dictionary → TTS** and choose a runtime:

- **Offline system voices** uses local voices exposed through Obsidian's Web Speech API. Mynary does not download voice data. Voice availability varies by device; some Android WebViews do not expose installed system voices. Use **Refresh voices** to check, or choose the server runtime if no voice is available.
- **Local Supertonic server** sends speech text to the endpoint you configure, can generate audio files, and supports optional auto-generation during lookup. Install and start the server separately; the default endpoint is `http://127.0.0.1:7788/v1/tts`.

Use **Mynary Dictionary: Read selected text with offline speech** or **Mod + Shift + R** to read selected text. Lookups can also play Wiktionary audio when provided.

## Privacy

There is no telemetry, advertising, or account system. Online lookups send the searched word and selected language to Wiktionary; an installed pack can answer without a network lookup. Mynary scans Markdown files in the configured vocabulary folder to sync flashcards. It does not send vault content automatically. Translation text is sent to your configured MTranServer only on request; speech text goes to the configured Supertonic endpoint only when you use that runtime.

## Development

Requirements: Node.js 18+ and npm.

```bash
npm install
npm test
npm run lint
npm run build
```

`npm run dev` starts esbuild watch mode. Pushing a version tag such as `1.3.1` starts the release workflow, which runs tests, lint, and the production build, checks that the tag matches the manifest and package versions, then attaches `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

## License

Mynary is distributed under the [MIT License](LICENSE).
