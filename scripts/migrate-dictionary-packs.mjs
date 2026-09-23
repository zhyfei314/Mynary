import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

const gunzipAsync = promisify(gunzip);
const releaseDir = resolve(process.argv[2] || 'release');

for (const entry of await readdir(releaseDir, { withFileTypes: true })) {
	if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
	const packDir = join(releaseDir, entry.name);
	const manifestPath = join(packDir, 'manifest.json');
	try {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
		if (manifest.format !== 'mynary-pack-v1') continue;
		if (manifest.sourceLanguage && manifest.targetLanguage) {
			manifest.kind = 'bilingual';
			manifest.language = manifest.sourceLanguage;
			manifest.targetLanguage = manifest.targetLanguage;
		} else {
			manifest.kind = 'core';
		}
		const compressedEntries = join(packDir, 'entries.jsonl.gz');
		const plainEntries = join(packDir, 'entries.jsonl');
		if (await exists(compressedEntries)) {
			manifest.entriesFile = 'entries.jsonl.gz';
			manifest.compressed = true;
			manifest.entriesSha256 = hash(await readFile(compressedEntries));
		} else if (await exists(plainEntries)) {
			manifest.entriesFile = 'entries.jsonl';
			manifest.compressed = false;
			manifest.entriesSha256 = hash(await readFile(plainEntries));
		}
		const compressedIndex = join(packDir, 'index.json.gz');
		const plainIndex = join(packDir, 'index.json');
		if (!(await exists(plainIndex)) && await exists(compressedIndex)) {
			await writeFile(plainIndex, await gunzipAsync(await readFile(compressedIndex)));
		}
		if (await exists(plainIndex)) {
			manifest.indexFile = 'index.json';
			manifest.indexSha256 = hash(await readFile(plainIndex));
		}
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		console.log(`Migrated ${entry.name}`);
	} catch (error) {
		console.error(`Skipped ${entry.name}: ${error.message}`);
	}
}

async function exists(path) {
	try { await stat(path); return true; } catch { return false; }
}

function hash(data) {
	return createHash('sha256').update(data).digest('hex');
}
