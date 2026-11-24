# Building Mynary dictionary packs

Mynary packs use the `mynary-pack-v1` format and are generated with
`scripts/build-dictionary-packs.mjs`. The builder uses Node.js streams, so it
does not load a complete Kaikki dump into memory. It writes canonical fields
that the plugin reads (`kind`, `language`, `targetLanguage`, full entry keys,
and checksums of the exact downloadable files).

## Kaikki sources

The English Wiktionary raw dump contains entries for many headword languages
with English glosses. The builder filters it by `lang_code` to create core
packs and source-language-to-English packs. For other gloss languages, it
reads that language's non-English Wiktionary edition and filters by each
record's `lang_code`. For example, `zh-vi` is built from the Vietnamese
edition's Chinese headwords, while `vi-zh` is built from the Chinese edition's
Vietnamese headwords. Kaikki's non-English editions are a smaller,
work-in-progress set; only editions listed on its raw data page are configured.

- English edition: `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz`
- Other editions: `https://kaikki.org/dictionary/downloads/<code>/<code>-extract.jsonl.gz`
- Source index and current sizes: `https://kaikki.org/dictionary/rawdata.html`

The default build includes the 32 previously published core languages plus
10 additions (`bn`, `ca`, `el`, `fa`, `ms`, `sw`, `ta`, `tl`, `ur`, `yue`).
It uses those 42 codes as headword languages and combines them with 18
non-English gloss editions: `cs`, `de`, `el`, `es`, `fr`, `id`, `it`, `ja`,
`ko`, `ms`, `nl`, `pl`, `pt`, `ru`, `th`, `tr`, `vi`, `zh`, as well as the
English edition. This is at most 779 directed source/target candidates after
excluding same-language pairs. The builder skips candidates with fewer than
1,000 unique entries by default, so actual output depends on coverage in each
edition; it does not promise every combination exists.

## Build on Google Colab

Clone the plugin repository and confirm Node.js 20 or later is available:

```python
!git clone https://github.com/zhyfei314/Mynary.git /content/mynary
%cd /content/mynary
!node --version
```

Build all configured packs. Core packs with fewer than 1,000 unique headwords
fail by default; sparse bilingual combinations are skipped. Use
`--min-entries N` to choose a different floor. Downloads are cached under
`release/.cache`; each selected dump is scanned once for all requested
headword languages. The default matrix can produce a large number of packs
and needs substantial Colab disk space.

```python
!node scripts/build-dictionary-packs.mjs /content/mynary/release --core all --pairs all
```

`--pairs` selects non-English gloss editions; `--sources` selects headword
languages. To generate both Vietnamese↔Chinese directions (plus their English
directions) and the relevant core packs, use:

```python
!node scripts/build-dictionary-packs.mjs /content/mynary/release --core vi,zh --sources vi,zh,en --pairs vi,zh
```

To select sets, pass comma-separated codes. `--pairs none` disables
non-English editions; if `--pairs` is nonempty and `--sources` is omitted,
all configured headword languages are selected. `--source` can point to a
previously downloaded `.jsonl.gz` or `.jsonl` file, and can be repeated for
each source key (for example `viwiktionary=/content/vi-extract.jsonl.gz`). Add
`--refresh` to replace downloaded cache files.

```python
!node scripts/build-dictionary-packs.mjs /content/mynary/release --core en,vi,ja --pairs es,ru,th
```

The builder verifies newly generated packs before returning success. To verify
all folders in a release directory again, check manifest fields, checksums,
sorted indexes, offsets, gzip contents, JSON rows, and entry shapes, then
regenerate the small catalog:

```python
!node scripts/verify-dictionary-packs.mjs /content/mynary/release
!node scripts/build-pack-catalog.mjs /content/mynary/release /content/mynary/dictionary-catalog/catalog.json
```

Create a tarball without source caches or temporary build files:

```python
import os, tarfile
from google.colab import files

release = '/content/mynary/release'
archive = '/content/mynary-packs.tar.gz'
with tarfile.open(archive, 'w:gz') as tar:
    for name in sorted(os.listdir(release)):
        if name.startswith('.'):
            continue
        path = os.path.join(release, name)
        if os.path.isdir(path):
            tar.add(path, arcname=name)
files.download(archive)
```

## Stage, activate, and retire packs on Hugging Face

Do not build into or overwrite the current published tree. Build into a fresh,
versioned local directory and reuse the cached Kaikki archives separately:

```python
!node scripts/build-dictionary-packs.mjs /content/mynary/release-full --core all --pairs all --cache /content/mynary/release/.cache
!node scripts/verify-dictionary-packs.mjs /content/mynary/release-full
!node scripts/build-pack-catalog.mjs /content/mynary/release-full /content/mynary/catalog-1.4.0.json https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary/resolve/main release/1.4.0
```

Change the snapshot suffix for each publication. Install the upload dependency,
authenticate with a Hugging Face token that has write access to the Dataset
repository, then do a dry run before applying:

```python
!pip -q install -U huggingface_hub
from huggingface_hub import notebook_login
notebook_login()
!python scripts/publish-dictionary-packs.py --release-dir /content/mynary/release-full --catalog /content/mynary/catalog-1.4.0.json --snapshot 1.4.0
!python scripts/publish-dictionary-packs.py --release-dir /content/mynary/release-full --catalog /content/mynary/catalog-1.4.0.json --snapshot 1.4.0 --apply
```

The publisher checks local pack checksums and every catalog field, then uploads
the assets into a new `release/<snapshot>/` path. Before activating anything,
it verifies the exact remote file set, compares each remote manifest byte for
byte, checks asset sizes and SHA-256 values (using Hugging Face LFS metadata or
downloading and hashing non-LFS assets), and finally activates the Hugging Face
catalog and dataset card together. Snapshot paths are immutable: a path that
already exists is rejected. By default, the publisher requires at least 42
core packs, so a small smoke build cannot replace the catalog. For an
intentional partial release, pass `--allow-partial`.

After the Hugging Face catalog is live, copy the same catalog to the plugin
repository at `dictionary-catalog/catalog.json`, commit and push the GitHub
catalog and version metadata, then confirm GitHub serves the matching catalog.
Only after both active catalogs match should old top-level pack folders be
retired with the publisher's `--prune-only --apply` mode:

```python
!python scripts/publish-dictionary-packs.py --release-dir /content/mynary/release-full --catalog /content/mynary/catalog-1.4.0.json --snapshot 1.4.0 --prune-only --apply
```

Pruning rechecks that the GitHub fallback catalog and Hugging Face active
catalog both exactly match the local catalog, then deletes only old top-level
`release/<pack>/` folders whose manifest identifies a Mynary pack. It keeps
the new versioned snapshot and repository root files such as license notices.
Keep the generated pack archive and catalog as the release record. Users with
older installed packs keep their local copies; when they open **Offline
dictionaries**, the manager offers the matching pack update by ID and checksum.

## Pack layout

Each pack contains `manifest.json`, `index.json`, and `entries.jsonl.gz`.
Index offsets and lengths address UTF-8 JSON rows in the decompressed entries
file. Hashes cover the exact bytes of `index.json` and the compressed
`entries.jsonl.gz` file. Core packs provide definitions and pronunciation.
Bilingual packs store target-language glosses as definitions; Mynary exposes
them as translations when merging them with a core pack.

The pack content is derived from Wiktionary through Kaikki/Wiktextract. Source
snapshots and coverage change over time; the manifest records a build date,
the source URL, and SHA-256 of the source archive. Retain Wiktionary attribution
and the applicable CC BY-SA/GFDL notices when redistributing packs. Check the
source and license metadata before publishing.
