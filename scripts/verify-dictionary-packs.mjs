import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'release');
let checked = 0;
const failures = [];

for (const folder of await readdir(root, { withFileTypes: true })) {
	if (!folder.isDirectory()) continue;
	const packRoot = join(root, folder.name);
	try {
		let manifestText;
		try { manifestText = await readFile(join(packRoot, 'manifest.json'), 'utf8'); } catch (error) {
			if (error?.code === 'ENOENT') continue;
			throw error;
		}
		const manifest = JSON.parse(manifestText);
		if (manifest.format !== 'mynary-pack-v1') throw new Error('unsupported manifest format');
		for (const [filename, expected] of [[manifest.indexFile, manifest.indexSha256], [manifest.entriesFile, manifest.entriesSha256 ?? manifest.sha256]]) {
			if (!filename || !expected) throw new Error('missing asset filename or SHA-256');
			if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) throw new Error(`unsafe asset path: ${filename}`);
			const bytes = await readFile(join(packRoot, filename));
			const actual = createHash('sha256').update(bytes).digest('hex');
			if (actual.toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${filename} checksum mismatch`);
			checked++;
		}
	} catch (error) {
		failures.push(`${folder.name}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

if (failures.length) {
	console.error(failures.join('\n'));
	process.exitCode = 1;
} else {
	console.log(`Verified ${checked} dictionary asset checksums.`);
}
