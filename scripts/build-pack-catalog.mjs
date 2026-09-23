import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const releaseDir = resolve(process.argv[2] || 'release');
const output = resolve(process.argv[3] || 'dictionary-catalog/catalog.json');
const baseUrl = (process.argv[4] || 'https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary/resolve/main').replace(/\/+$/u, '');
const packs = [];

for (const entry of await readdir(releaseDir, { withFileTypes: true })) {
	if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
	try {
		const manifest = JSON.parse(await readFile(join(releaseDir, entry.name, 'manifest.json'), 'utf8'));
		if (manifest.format !== 'mynary-pack-v1' || !manifest.kind || !manifest.language) continue;
		const indexPath = join(releaseDir, entry.name, manifest.indexFile || 'index.json');
		const entriesPath = join(releaseDir, entry.name, manifest.entriesFile || 'entries.jsonl');
		const indexSizeBytes = (await statOrZero(indexPath));
		const entriesSizeBytes = (await statOrZero(entriesPath));
		packs.push({
			id: manifest.id,
			kind: manifest.kind,
			language: manifest.language,
			targetLanguage: manifest.targetLanguage,
			name: manifest.name,
			version: manifest.version,
			entryCount: manifest.entryCount,
			indexSizeBytes,
			entriesSizeBytes,
			sizeBytes: indexSizeBytes + entriesSizeBytes,
			compressed: manifest.compressed === true,
			manifestUrl: `${baseUrl}/release/${entry.name}/manifest.json`,
		});
	} catch {
		// Ignore incomplete folders.
	}
}

async function statOrZero(path) {
	try { return (await stat(path)).size; } catch { return 0; }
}

packs.sort((left, right) => `${left.language}-${left.targetLanguage || ''}`.localeCompare(`${right.language}-${right.targetLanguage || ''}`));
await writeFile(output, `${JSON.stringify({ format: 'mynary-pack-catalog-v1', generatedAt: new Date().toISOString().slice(0, 10), source: 'https://kaikki.org/', packs }, null, 2)}\n`);
console.log(`Wrote ${packs.length} packs to ${output}`);
