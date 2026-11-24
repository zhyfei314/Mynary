# Mynary dictionary catalog

This small catalog is intended to stay in the GitHub plugin repository. The large dictionary assets live in the Hugging Face Dataset repository:

`https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary`

In Obsidian, copy a `manifestUrl` from `catalog.json`, then open **Settings → Mynary Dictionary → Offline dictionary packs → Install from URL**.

The catalog contains metadata and URLs only. It does not contain dictionary entries.

For the Mynary 1.4.0 release, the active catalog points to the immutable
`release/1.4.0/` dataset snapshot. The GitHub copy is kept byte-for-byte in sync
with the Hugging Face root catalog; the publisher verifies the uploaded pack
manifests, asset sizes, and SHA-256 checksums before changing the active
catalog.
