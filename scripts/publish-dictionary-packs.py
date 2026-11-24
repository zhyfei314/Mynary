#!/usr/bin/env python3
"""Stage a verified Mynary pack set on Hugging Face, activate its catalog, then optionally prune old packs."""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


REPO_ID = "zhyfei314/Mynary-Offline-Dictionary"
BASE_URL = f"https://huggingface.co/datasets/{REPO_ID}/resolve/main"


def sha256(path: Path) -> str:
	result = hashlib.sha256()
	with path.open("rb") as stream:
		for chunk in iter(lambda: stream.read(1024 * 1024), b""):
			result.update(chunk)
	return result.hexdigest()


def load_release(release_dir: Path, catalog_path: Path, remote_prefix: str, repo_id: str):
	if not release_dir.is_dir():
		raise ValueError(f"Pack directory does not exist: {release_dir}")
	catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
	if catalog.get("format") != "mynary-pack-catalog-v1" or not isinstance(catalog.get("packs"), list):
		raise ValueError("Catalog has an unsupported format.")
	pack_dirs = [entry for entry in release_dir.iterdir() if entry.is_dir() and not entry.name.startswith(".")]
	if not pack_dirs:
		raise ValueError("No pack directories were found.")
	manifests = {}
	for directory in pack_dirs:
		manifest_path = directory / "manifest.json"
		if not manifest_path.is_file():
			raise ValueError(f"Missing manifest: {manifest_path}")
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
		if manifest.get("format") != "mynary-pack-v1" or not manifest.get("id"):
			raise ValueError(f"Invalid pack manifest: {manifest_path}")
		for field, hash_field, fallback in (
			("indexFile", "indexSha256", None),
			("entriesFile", "entriesSha256", "sha256"),
		):
			name = manifest.get(field)
			if not isinstance(name, str) or Path(name).name != name:
				raise ValueError(f"Unsafe {field} in {manifest_path}")
			asset = directory / name
			expected = manifest.get(hash_field) or (manifest.get(fallback) if fallback else None)
			if not asset.is_file() or not isinstance(expected, str) or sha256(asset) != expected.lower():
				raise ValueError(f"Missing or checksum-invalid asset: {asset}")
		if manifest["id"] in manifests:
			raise ValueError(f"Duplicate pack id: {manifest['id']}")
		manifests[manifest["id"]] = (directory, manifest)

	catalog_by_id = {pack.get("id"): pack for pack in catalog["packs"] if isinstance(pack, dict)}
	if set(catalog_by_id) != set(manifests):
		raise ValueError("Catalog pack IDs do not match the local pack directories.")
	for pack_id, (directory, manifest) in manifests.items():
		catalog_pack = catalog_by_id[pack_id]
		expected_url = f"https://huggingface.co/datasets/{repo_id}/resolve/main/{remote_prefix}/{directory.name}/manifest.json"
		if catalog_pack.get("manifestUrl") != expected_url:
			raise ValueError(f"Catalog URL for {pack_id} must be {expected_url}")
		index_path = directory / manifest["indexFile"]
		entries_path = directory / manifest["entriesFile"]
		expected_catalog = {
			"kind": manifest["kind"], "language": manifest["language"], "name": manifest["name"],
			"version": manifest["version"], "entryCount": manifest["entryCount"],
			"indexSizeBytes": index_path.stat().st_size, "entriesSizeBytes": entries_path.stat().st_size,
			"sizeBytes": index_path.stat().st_size + entries_path.stat().st_size,
			"compressed": manifest["compressed"], "indexSha256": manifest["indexSha256"],
			"entriesSha256": manifest.get("entriesSha256") or manifest.get("sha256"),
		}
		if manifest.get("targetLanguage"):
			expected_catalog["targetLanguage"] = manifest["targetLanguage"]
		for field, expected in expected_catalog.items():
			if catalog_pack.get(field) != expected:
				raise ValueError(f"Catalog field {field} does not match manifest/assets for {pack_id}")
	return pack_dirs, catalog


def repo_files(api, repo_id: str, path: str, revision: str = "main"):
	try:
		return {item.path: item for item in api.list_repo_tree(repo_id, path_in_repo=path, recursive=True, repo_type="dataset", revision=revision) if hasattr(item, "size")}
	except Exception as error:
		if "not found" in str(error).lower() or "404" in str(error):
			return {}
		raise


def verify_remote_snapshot(api, repo_id: str, remote_prefix: str, pack_dirs, local_files, release_dir: Path, revision: str):
	from huggingface_hub import hf_hub_download

	remote = repo_files(api, repo_id, remote_prefix, revision)
	expected_paths = {f"{remote_prefix}/{relative}" for relative in local_files}
	if set(remote) != expected_paths:
		missing = sorted(expected_paths - set(remote))
		extra = sorted(set(remote) - expected_paths)
		raise RuntimeError(f"Remote snapshot file set mismatch (missing={missing[:5]}, extra={extra[:5]}).")
	checked = 0
	for directory in pack_dirs:
		manifest_path = directory / "manifest.json"
		manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
		remote_manifest_path = f"{remote_prefix}/{directory.name}/manifest.json"
		downloaded_manifest = Path(hf_hub_download(repo_id=repo_id, filename=remote_manifest_path, repo_type="dataset", revision=revision, force_download=True))
		if downloaded_manifest.read_bytes() != manifest_path.read_bytes():
			raise RuntimeError(f"Remote manifest differs from the validated local manifest: {directory.name}")
		for field, hash_field, fallback in (("indexFile", "indexSha256", None), ("entriesFile", "entriesSha256", "sha256")):
			name = manifest[field]
			expected_hash = (manifest.get(hash_field) or (manifest.get(fallback) if fallback else None)).lower()
			remote_path = f"{remote_prefix}/{directory.name}/{name}"
			remote_file = remote[remote_path]
			local_path = directory / name
			if remote_file.size != local_path.stat().st_size:
				raise RuntimeError(f"Remote asset size mismatch: {remote_path}")
			lfs = getattr(remote_file, "lfs", None)
			remote_hash = getattr(lfs, "sha256", None) if lfs else None
			if remote_hash is None:
				downloaded = Path(hf_hub_download(repo_id=repo_id, filename=remote_path, repo_type="dataset", revision=revision, force_download=True))
				remote_hash = sha256(downloaded)
			if remote_hash.lower() != expected_hash:
				raise RuntimeError(f"Remote asset SHA-256 mismatch: {remote_path}")
			checked += 1
	return checked


def main():
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--release-dir", type=Path, required=True, help="Validated local directory containing pack folders")
	parser.add_argument("--catalog", type=Path, required=True, help="Catalog whose URLs point to the selected snapshot path")
	parser.add_argument("--snapshot", required=True, help="New immutable remote folder name under release/, for example 1.4.0")
	parser.add_argument("--repo-id", default=REPO_ID)
	parser.add_argument("--minimum-core-packs", type=int, default=42, help="Require this many core packs before publishing; use --allow-partial for a deliberate subset")
	parser.add_argument("--allow-partial", action="store_true", help="Allow a partial language set, including the 3-language Colab smoke build")
	parser.add_argument("--apply", action="store_true", help="Apply the upload/activation or prune-only operation")
	parser.add_argument("--prune-only", action="store_true", help="After both live catalogs match, retire old top-level release pack folders")
	args = parser.parse_args()
	if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,80}", args.snapshot):
		parser.error("--snapshot must be one safe path segment.")
	remote_prefix = f"release/{args.snapshot}"
	pack_dirs, catalog = load_release(args.release_dir.resolve(), args.catalog.resolve(), remote_prefix, args.repo_id)
	core_count = sum(1 for directory in pack_dirs if json.loads((directory / "manifest.json").read_text(encoding="utf-8")).get("kind") == "core")
	if args.minimum_core_packs < 0:
		parser.error("--minimum-core-packs cannot be negative.")
	if not args.allow_partial and core_count < args.minimum_core_packs:
		raise ValueError(f"Refusing to publish only {core_count} core packs; expected at least {args.minimum_core_packs}. Use --allow-partial only for an intentional partial release.")
	local_files = set()
	for directory in pack_dirs:
		manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
		local_files.add(f"{directory.name}/manifest.json")
		local_files.add(f"{directory.name}/{manifest['indexFile']}")
		local_files.add(f"{directory.name}/{manifest['entriesFile']}")
	for relative in local_files:
		if not (args.release_dir.resolve() / relative).is_file():
			raise ValueError(f"Required pack asset is missing: {args.release_dir.resolve() / relative}")

	from huggingface_hub import CommitOperationDelete, HfApi, hf_hub_download

	api = HfApi()
	remote_snapshot_paths = repo_files(api, args.repo_id, remote_prefix)
	new_paths = {f"{remote_prefix}/{relative}" for relative in local_files}
	if args.prune_only:
		active_catalog_path = hf_hub_download(repo_id=args.repo_id, filename="catalog.json", repo_type="dataset", force_download=True)
		if json.loads(Path(active_catalog_path).read_text(encoding="utf-8")) != catalog:
			raise ValueError("The active Hugging Face catalog does not match the selected release catalog.")
		verify_remote_snapshot(api, args.repo_id, remote_prefix, pack_dirs, local_files, args.release_dir.resolve(), "main")
		from urllib.request import urlopen
		github_catalog_url = "https://raw.githubusercontent.com/zhyfei314/Mynary/master/dictionary-catalog/catalog.json"
		try:
			with urlopen(github_catalog_url, timeout=30) as response:
				github_catalog = json.loads(response.read().decode("utf-8"))
		except Exception as error:
			raise RuntimeError("Cannot verify the GitHub fallback catalog; push the matching catalog before retiring old packs.") from error
		if github_catalog != catalog:
			raise ValueError("The GitHub fallback catalog does not exactly match the selected release catalog.")
		children = list(api.list_repo_tree(args.repo_id, path_in_repo="release", recursive=False, repo_type="dataset"))
		old_pack_paths = []
		for child in children:
			path = child.path
			if path == remote_prefix or not hasattr(child, "tree_id") or path.count("/") != 1:
				continue
			files = repo_files(api, args.repo_id, path)
			manifest_path = f"{path}/manifest.json"
			if manifest_path not in files:
				continue
			remote_manifest = hf_hub_download(repo_id=args.repo_id, filename=manifest_path, repo_type="dataset")
			try:
				manifest = json.loads(Path(remote_manifest).read_text(encoding="utf-8"))
			except (OSError, json.JSONDecodeError):
				continue
			if manifest.get("format") == "mynary-pack-v1":
				old_pack_paths.append(path)
		print(f"Both live catalogs match. Found {len(old_pack_paths)} old top-level Mynary pack folders to retire.")
		if not args.apply:
			print("Dry run: no remote files were changed. Add --apply to retire these folders.")
			for path in old_pack_paths:
				print(f"  {path}")
			return
		if old_pack_paths:
			api.create_commit(
				repo_id=args.repo_id,
				operations=[CommitOperationDelete(path_in_repo=f"{path}/", is_folder=True) for path in old_pack_paths],
				repo_type="dataset",
				commit_message=f"Retire old Mynary packs after {args.snapshot} activation",
			)
		remaining = [path for path in old_pack_paths if repo_files(api, args.repo_id, path)]
		if remaining:
			raise RuntimeError(f"Some retired pack folders remain: {remaining[:8]}")
		print(f"Retired {len(old_pack_paths)} old pack folders. Versioned snapshots and root license files remain.")
		return
	if remote_snapshot_paths:
		raise ValueError(f"Snapshot path already exists and is immutable; choose a new --snapshot: {sorted(remote_snapshot_paths)[:8]}")
	print(f"Prepared {len(pack_dirs)} packs ({core_count} core; {len(local_files)} files) for {args.repo_id}/{remote_prefix}.")
	print(f"Catalog contains {len(catalog['packs'])} packs and points to the new snapshot.")
	if not args.apply:
		print("Dry run: no remote files were changed. Add --apply to stage the packs and activate catalog.json.")
		return

	staged = api.upload_folder(
		folder_path=str(args.release_dir.resolve()),
		path_in_repo=remote_prefix,
		repo_id=args.repo_id,
		repo_type="dataset",
		allow_patterns=sorted(local_files),
		commit_message=f"Stage Mynary dictionary packs {args.snapshot}",
	)
	verified_assets = verify_remote_snapshot(api, args.repo_id, remote_prefix, pack_dirs, local_files, args.release_dir.resolve(), staged.oid)
	print(f"Verified all {len(new_paths)} remote files, {len(pack_dirs)} exact manifests, and {verified_assets} remote asset SHA-256 checksums.")
	print("Activating the catalog and dataset card together.")
	from huggingface_hub import CommitOperationAdd
	activation = api.create_commit(
		repo_id=args.repo_id,
		repo_type="dataset",
		operations=[
			CommitOperationAdd(path_in_repo="catalog.json", path_or_fileobj=str(args.catalog.resolve())),
			CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=str((Path(__file__).resolve().parent.parent / "HUGGINGFACE_DATASET_CARD.md")))
		],
		commit_message=f"Activate Mynary dictionary release {args.snapshot}",
	)
	from huggingface_hub import hf_hub_download
	remote_catalog_path = hf_hub_download(repo_id=args.repo_id, filename="catalog.json", repo_type="dataset", revision=activation.oid, force_download=True)
	remote_catalog = json.loads(Path(remote_catalog_path).read_text(encoding="utf-8"))
	if remote_catalog != catalog:
		raise RuntimeError("The active Hugging Face catalog does not exactly match the local catalog.")
	remote_card_path = hf_hub_download(repo_id=args.repo_id, filename="README.md", repo_type="dataset", revision=activation.oid, force_download=True)
	local_card_path = Path(__file__).resolve().parent.parent / "HUGGINGFACE_DATASET_CARD.md"
	if Path(remote_card_path).read_bytes() != local_card_path.read_bytes():
		raise RuntimeError("The active Hugging Face dataset card does not match the local release metadata.")
	print("Catalog and dataset card activation verified.")


if __name__ == "__main__":
	try:
		main()
	except Exception as error:
		print(f"ERROR: {error}", file=sys.stderr)
		sys.exit(1)
