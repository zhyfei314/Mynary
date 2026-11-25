# Building Mynary dictionary packs

Mynary packs use the `mynary-pack-v1` format and are generated with
`scripts/build-dictionary-packs.mjs`. The builder uses Node.js streams, so it
does not load a complete Kaikki dump into memory. It writes canonical fields
that the plugin reads (`kind`, `language`, `targetLanguage`, full entry keys,
and checksums of the exact downloadable files).

## Core pack strategy

The builder separates core packs into two groups based on whether a native
Wiktionary edition exists for that language:

- **Native Wiktionary core** — 18 languages with their own Wiktionary edition
  (`cs`, `de`, `el`, `es`, `fr`, `id`, `it`, `ja`, `ko`, `ms`, `nl`, `pl`,
  `pt`, `ru`, `th`, `tr`, `vi`, `zh`): headwords AND definitions are both in
  that language, making them true monolingual dictionaries. Each is built from
  `<lang>wiktionary.jsonl.gz`.
- **English Wiktionary core** — 24 languages without a native edition (`ar`,
  `bg`, `bn`, `ca`, `da`, `en`, `et`, `fa`, `fi`, `he`, `hi`, `hu`, `lt`,
  `lv`, `ro`, `sk`, `sl`, `sv`, `sw`, `ta`, `tl`, `uk`, `ur`, `yue`),
  **plus English itself** (`en`): headwords are filtered from the English
  Wiktionary. The `en-core` pack is the English Wiktionary itself — headwords
  and definitions in English.

The 1.4.0 catalog ships **19 core packs** (18 native + 1 English) and
**448 bilingual packs** (467 total).

## Kaikki sources

The English Wiktionary raw dump contains entries for many headword languages
with English glosses. For languages with a native Wiktionary edition, the
builder downloads that edition and filters by `lang_code` to produce a true
monolingual pack. For other gloss languages, it reads that language's
non-English Wiktionary edition and filters by each record's `lang_code`. For
example, `zh-vi` is built from the Vietnamese edition's Chinese headwords,
while `vi-zh` is built from the Chinese edition's Vietnamese headwords.

- English edition: `https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz`
- Other editions: `https://kaikki.org/dictionary/downloads/<code>/<code>-extract.jsonl.gz`
- Source index and current sizes: `https://kaikki.org/dictionary/rawdata.html`

The default build includes all 42 configured core languages (`ar`, `bg`, `bn`,
`ca`, `cs`, `da`, `de`, `el`, `en`, `es`, `et`, `fa`, `fi`, `fr`, `he`, `hi`,
`hu`, `id`, `it`, `ja`, `ko`, `lt`, `lv`, `ms`, `nl`, `pl`, `pt`, `ro`, `ru`,
`sk`, `sl`, `sv`, `sw`, `ta`, `th`, `tl`, `tr`, `uk`, `ur`, `vi`, `yue`,
`zh`). It uses those 42 codes as headword languages and combines them with 18
non-English gloss editions: `cs`, `de`, `el`, `es`, `fr`, `id`, `it`, `ja`,
`ko`, `ms`, `nl`, `pl`, `pt`, `ru`, `th`, `tr`, `vi`, `zh`. This yields at
most 779 directed source/target candidates after excluding same-language pairs.
The builder skips candidates below the 1,000-entry floor, so actual output
depends on coverage in each edition.

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
!node scripts/build-dictionary-packs.mjs /content/mynary/release \
    --core vi,zh --sources vi,zh,en --pairs vi,zh
```

To build only the English core pack:

```python
!node scripts/build-dictionary-packs.mjs /content/mynary/release \
    --core en --pairs none --sources none
```

To select sets, pass comma-separated codes. `--pairs none` disables
non-English editions; if `--pairs` is nonempty and `--sources` is omitted,
all configured headword languages are selected. `--source` can point to a
previously downloaded `.jsonl.gz` or `.jsonl` file, and can be repeated for
each source key (for example `viwiktionary=/content/vi-extract.jsonl.gz`). Add
`--refresh` to replace downloaded cache files.

```python
!node scripts/build-dictionary-packs.mjs /content/mynary/release \
    --core en,vi,ja --pairs es,ru,th
```

The builder verifies newly generated packs before returning success. To verify
all folders in a release directory again, check manifest fields, checksums,
sorted indexes, offsets, gzip contents, JSON rows, and entry shapes, then
regenerate the small catalog:

```python
!node scripts/verify-dictionary-packs.mjs /content/mynary/release
!node scripts/build-pack-catalog.mjs /content/mynary/release \
    /content/mynary/dictionary-catalog/catalog.json
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
!node scripts/build-dictionary-packs.mjs /content/mynary/release-full \
    --core all --pairs all \
    --cache /content/mynary/release/.cache
!node scripts/verify-dictionary-packs.mjs /content/mynary/release-full
!node scripts/build-pack-catalog.mjs /content/mynary/release-full \
    /content/mynary/catalog-1.4.0.json \
    https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary/resolve/main \
    release/1.4.0
```

Change the snapshot suffix for each publication. Install the upload dependency,
authenticate with a Hugging Face token that has write access to the dataset
repository, then do a dry run before applying:

```python
!pip -q install -U huggingface_hub
from huggingface_hub import notebook_login
notebook_login()
!python scripts/publish-dictionary-packs.py \
    --release-dir /content/mynary/release-full \
    --catalog /content/mynary/catalog-1.4.0.json \
    --snapshot 1.4.0
!python scripts/publish-dictionary-packs.py \
    --release-dir /content/mynary/release-full \
    --catalog /content/mynary/catalog-1.4.0.json \
    --snapshot 1.4.0 --apply
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

### Adding a single pack to an existing snapshot

If a pack was missing from a published snapshot (for example `en-core` was
absent from `release/1.4.0`), build it in isolation, copy it into the existing
local staging directory, then upload directly with `huggingface_hub`:

```python
# Build only the missing pack
!node scripts/build-dictionary-packs.mjs /content/en-stage \
    --core en --pairs none --sources none \
    --cache /content/mynary/release/.cache

# Upload the pack folder to the existing snapshot
from huggingface_hub import HfApi
api = HfApi()
api.upload_folder(
    folder_path='/content/en-stage/en',
    path_in_repo='release/1.4.0/en',
    repo_id='zhyfei314/Mynary-Offline-Dictionary',
    repo_type='dataset',
    commit_message='Add en-core (1.4.0) monolingual pack',
)
```

After uploading, regenerate the catalog JSON locally to include the new pack,
then push the updated `catalog.json` to Hugging Face and commit it to the
GitHub repository:

```python
# Update catalog.json locally (Python example)
import json
from pathlib import Path

m = json.loads(Path('/content/en-stage/en/manifest.json').read_text())
idx = Path('/content/en-stage/en/' + m['indexFile'])
ent = Path('/content/en-stage/en/' + m['entriesFile'])
entry = {
    'id': m['id'], 'kind': m['kind'], 'language': m['language'],
    'name': m['name'], 'version': m['version'], 'entryCount': m['entryCount'],
    'indexSizeBytes': idx.stat().st_size, 'entriesSizeBytes': ent.stat().st_size,
    'sizeBytes': idx.stat().st_size + ent.stat().st_size,
    'compressed': m['compressed'],
    'indexSha256': m['indexSha256'], 'entriesSha256': m['entriesSha256'],
    'manifestUrl': 'https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary'
                   '/resolve/main/release/1.4.0/en/manifest.json',
}
cat_path = Path('/content/mynary/dictionary-catalog/catalog.json')
cat = json.loads(cat_path.read_text())
cat['packs'] = [p for p in cat['packs'] if p['id'] != entry['id']]
cat['packs'].append(entry)
cat['packs'].sort(key=lambda p: p['id'])
cat_path.write_text(json.dumps(cat, indent=2) + '\n')

# Push catalog to Hugging Face
api.upload_file(
    path_or_fileobj=str(cat_path),
    path_in_repo='catalog.json',
    repo_id='zhyfei314/Mynary-Offline-Dictionary',
    repo_type='dataset',
    commit_message='Update catalog.json with en-core (467 total)',
)
```

Then commit the catalog and README to the GitHub repository and push:

```bash
git add README.md dictionary-catalog/catalog.json
git commit -m "chore(catalog): add en-core monolingual pack (19 core packs, 467 total)"
git push
```

### Retiring old top-level packs

After both the GitHub and Hugging Face catalogs match, retire old top-level
pack folders from the Hugging Face dataset using the publisher's prune mode:

```python
!python scripts/publish-dictionary-packs.py \
    --release-dir /content/mynary/release-full \
    --catalog /content/mynary/catalog-1.4.0.json \
    --snapshot 1.4.0 --prune-only --apply
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
`entries.jsonl.gz` file.

- **Core packs** (`kind: "core"`) provide definitions and pronunciation.
  Native-edition core packs (e.g. `vi-core`, `de-core`) are true monolingual:
  headwords and definitions are both in the same language.
  English-fallback core packs (e.g. `ar-core`, `yue-core`) have English-Wiktionary
  glosses for those headwords.
  The `en-core` pack is the English Wiktionary itself.
- **Bilingual packs** (`kind: "bilingual"`) store target-language glosses as
  definitions; Mynary exposes them as translations when merging them with a
  core pack.

The pack content is derived from Wiktionary through Kaikki/Wiktextract. Source
snapshots and coverage change over time; the manifest records a build date,
the source URL, and SHA-256 of the source archive. Retain Wiktionary attribution
and the applicable CC BY-SA/GFDL notices when redistributing packs. Check the
source and license metadata before publishing.
