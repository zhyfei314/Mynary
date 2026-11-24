import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
const root = resolve(args[0] || 'release');
const selectedFolders = new Set(args.slice(1));
let packCount = 0;
let assetCount = 0;
let failures = [];
const verifiedFolders = new Set();

for (const folder of await readdir(root, { withFileTypes: true })) {
	if (!folder.isDirectory() || folder.name.startsWith('.')) continue;
	if (selectedFolders.size && !selectedFolders.has(folder.name)) continue;
	const packRoot = join(root, folder.name);
	try {
		const manifest = JSON.parse(await readFile(join(packRoot, 'manifest.json'), 'utf8'));
		validateManifest(manifest, folder.name);
		const indexBytes = await readFile(join(packRoot, manifest.indexFile));
		assertHash(indexBytes, manifest.indexSha256, manifest.indexFile);
		assetCount++;
		const entriesBytes = await readFile(join(packRoot, manifest.entriesFile));
		assertHash(entriesBytes, manifest.entriesSha256 ?? manifest.sha256, manifest.entriesFile);
		assetCount++;
		const index = JSON.parse(indexBytes.toString('utf8'));
		if (!Array.isArray(index) || index.length !== manifest.entryCount) throw new Error('index count does not match manifest entryCount');
		for (let i = 0; i < index.length; i++) {
			const item = index[i];
			if (!item || typeof item.word !== 'string' || !item.word || !Number.isSafeInteger(item.offset) || item.offset < 0 || !Number.isSafeInteger(item.length) || item.length < 1) throw new Error(`invalid index item ${i}`);
			if (i && index[i - 1].word >= item.word) throw new Error(`index is not strictly sorted at ${item.word}`);
		}
		await validateEntries(join(packRoot, manifest.entriesFile), manifest, index);
		packCount++;
		verifiedFolders.add(folder.name);
		console.log(`OK ${folder.name}: ${index.length.toLocaleString()} entries`);
	} catch (error) {
		failures.push(`${folder.name}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

for (const folder of selectedFolders) {
	if (!verifiedFolders.has(folder) && !failures.some((failure) => failure.startsWith(`${folder}:`))) failures.push(`${folder}: directory or valid manifest was not found`);
}

if (failures.length) {
	console.error(failures.join('\n'));
	process.exitCode = 1;
} else {
	console.log(`Verified ${packCount} packs and ${assetCount} SHA-256 checksums.`);
}

function validateManifest(manifest, folder) {
	if (!manifest || manifest.format !== 'mynary-pack-v1') throw new Error('unsupported manifest format');
	if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/u.test(manifest.id)) throw new Error('invalid id');
	if (!['core', 'bilingual'].includes(manifest.kind)) throw new Error('kind must be core or bilingual');
	if (typeof manifest.language !== 'string' || !/^[a-z]{2,3}$/u.test(manifest.language)) throw new Error('invalid language');
	if (manifest.kind === 'bilingual' && (typeof manifest.targetLanguage !== 'string' || !/^[a-z]{2,3}$/u.test(manifest.targetLanguage) || manifest.language === manifest.targetLanguage)) throw new Error('invalid targetLanguage');
	if (typeof manifest.name !== 'string' || !manifest.name.trim()) throw new Error('missing name');
	if (typeof manifest.version !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(manifest.version)) throw new Error('invalid version');
	if (!Number.isSafeInteger(manifest.entryCount) || manifest.entryCount < 1) throw new Error('entryCount must be a positive integer');
	for (const filename of [manifest.indexFile, manifest.entriesFile]) {
		if (typeof filename !== 'string' || filename === '.' || filename === '..' || !/^[\w.-]+$/u.test(filename)) throw new Error(`unsafe asset filename: ${filename}`);
	}
	if (typeof manifest.compressed !== 'boolean') throw new Error('compressed must be boolean');
	if (manifest.entriesFile.endsWith('.gz') !== manifest.compressed) throw new Error('entriesFile extension and compressed flag disagree');
	if (typeof manifest.indexSha256 !== 'string' || !/^[a-f\d]{64}$/iu.test(manifest.indexSha256)) throw new Error('invalid indexSha256');
	if (typeof (manifest.entriesSha256 ?? manifest.sha256) !== 'string' || !/^[a-f\d]{64}$/iu.test(manifest.entriesSha256 ?? manifest.sha256)) throw new Error('invalid entriesSha256');
	if (folder !== manifest.language && folder !== `${manifest.language}-${manifest.targetLanguage}` && folder !== manifest.id) {
		throw new Error('folder name does not match language or pack id');
	}
}

function assertHash(bytes, expected, filename) {
	const actual = createHash('sha256').update(bytes).digest('hex');
	if (actual.toLowerCase() !== String(expected).toLowerCase()) throw new Error(`${filename} checksum mismatch`);
}

async function validateEntries(path, manifest, index) {
	const input = createReadStream(path);
	const decoded = manifest.compressed ? input.pipe(createGunzip()) : input;
	const reader = createInterface({ input: decoded, crlfDelay: Infinity });
	let offset = 0;
	let count = 0;
	for await (const line of reader) {
		if (!line) throw new Error(`empty JSONL row ${count}`);
		const bytes = Buffer.from(line, 'utf8');
		const item = index[count];
		if (!item || item.offset !== offset || item.length !== bytes.length) throw new Error(`index offset/length mismatch at row ${count}`);
		const entry = JSON.parse(line);
		if (!entry || typeof entry !== 'object' || !Array.isArray(entry.meanings) || !entry.meanings.length) throw new Error(`entry ${item.word} has no meanings`);
		for (const meaning of entry.meanings) {
			if (!meaning || !Array.isArray(meaning.definitions) || !meaning.definitions.length) throw new Error(`entry ${item.word} has an empty meaning`);
			if (meaning.definitions.some((definition) => typeof (definition?.text ?? definition?.sense) !== 'string' || !(definition.text ?? definition.sense).trim())) throw new Error(`entry ${item.word} has an invalid definition`);
		}
		offset += bytes.length + 1;
		count++;
	}
	if (count !== index.length) throw new Error(`entries row count ${count} does not match index count ${index.length}`);
}
