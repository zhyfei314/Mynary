---
license: other
license_name: per-pack-source-licenses
license_link: https://github.com/zhyfei314/Mynary/blob/master/LICENSE-CC-BY-SA-4.0.txt
task_categories:
- text-retrieval
language:
- ar
- bg
- cs
- da
- de
- en
- es
- et
- fi
- fr
- he
- hi
- hu
- id
- it
- ja
- ko
- lt
- lv
- nl
- pl
- pt
- ro
- ru
- sk
- sl
- sv
- th
- tr
- uk
- vi
- zh
pretty_name: Mynary Offline Dictionary
tags:
- dictionary
- wiktionary
- offline
- multilingual
- bilingual
- obsidian
---

# Mynary Offline Dictionary

This dataset contains compact, downloadable offline dictionary packs for the
[Mynary Dictionary](https://github.com/zhyfei314/Mynary) Obsidian plugin.

The packs are generated from Wiktionary extracts published by
[Kaikki.org](https://kaikki.org/). They are intended for local lookup and
language-learning workflows. The dataset is not a language model and is not
intended for training or benchmarking without additional preprocessing.

## Repository layout

Each pack is stored under `release/<pack-id>/` and contains only the files
needed by the plugin:

```text
release/<pack-id>/
├── manifest.json
├── index.json
└── entries.jsonl.gz
```

The current catalog contains 50 packs covering core dictionaries and selected
bilingual dictionaries. Large compressed entry files are kept in this Dataset
repository; the small catalog used by the plugin is maintained separately in
the GitHub repository under `dictionary-catalog/catalog.json`.

## Pack format

Every `manifest.json` uses the `mynary-pack-v1` schema. Core and bilingual
packs share the same fields:

```json
{
  "format": "mynary-pack-v1",
  "id": "en-core",
  "language": "en",
  "name": "English Core Dictionary",
  "version": "2026-09-09",
  "entryCount": 1355096,
  "indexFile": "index.json",
  "entriesFile": "entries.jsonl.gz",
  "compressed": true,
  "source": "https://kaikki.org/",
  "license": "CC BY-SA 4.0 / GFDL",
  "indexSha256": "...",
  "entriesSha256": "...",
  "kind": "core"
}
```

For a bilingual pack, `kind` is `bilingual` and `targetLanguage` identifies
the translation direction. For example, an English-Vietnamese pack has
`language: "en"` and `targetLanguage: "vi"`.

`index.json` contains a compact list of words and byte offsets. Each line in
the UTF-8 `entries.jsonl.gz` file is one JSON entry. The SHA-256 values in the
manifest are calculated over the exact downloadable bytes, including the gzip
file itself. Consumers should verify both checksums before installing a pack.

## Use with Mynary

1. Open **Settings → Mynary Dictionary**.
2. Enable **Use offline dictionary packs**.
3. Open **Offline dictionary packs** and select **Choose language**.
4. Select a pack and choose **Install**.

Mynary downloads the selected manifest, index, and compressed entries file,
verifies the checksums, and stores the pack inside the vault. If an installed
pack does not contain a requested word, Mynary can fall back to Wiktionary
when online.

## Data and licensing

The dictionary content is derived from Wiktionary and follows the applicable
source licensing terms. License requirements can vary by source snapshot and
pack; always check the `license` field in the pack's `manifest.json` before
redistributing a pack.

The repository includes reference copies of the relevant license texts:

- [CC BY-SA 3.0](https://github.com/zhyfei314/Mynary/blob/master/LICENSE-CC-BY-SA-3.0.txt)
- [CC BY-SA 4.0](https://github.com/zhyfei314/Mynary/blob/master/LICENSE-CC-BY-SA-4.0.txt)
- [GNU Free Documentation License 1.3](https://github.com/zhyfei314/Mynary/blob/master/LICENSE-GFDL-1.3.txt)

When redistributing these files, retain attribution to Wiktionary and the
relevant source providers, preserve license notices, and provide the required
license text or a link to it. Do not assume that the MIT license of the Mynary
plugin applies to the dictionary data.

## Citation and attribution

Suggested attribution:

> Dictionary data derived from Wiktionary, processed from Kaikki.org extracts,
> and packaged for Mynary Offline Dictionary.

Useful links:

- [Wiktionary](https://www.wiktionary.org/)
- [Kaikki.org Wiktionary extracts](https://kaikki.org/dictionary/)
- [Mynary Dictionary plugin](https://github.com/zhyfei314/Mynary)

## Limitations

- Coverage and quality vary by language and Wiktionary entry.
- This dataset contains dictionary entries, not audio files or source HTML.
- Pack versions correspond to the source snapshot recorded in each manifest.
- The compressed JSONL files are optimized for the Mynary client and may need
  conversion before use in other tools.
