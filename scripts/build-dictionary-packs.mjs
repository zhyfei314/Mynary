import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, closeSync, existsSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Transform } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const LANGUAGES = {
	ar: 'Arabic', bg: 'Bulgarian', bn: 'Bengali', ca: 'Catalan', cs: 'Czech', da: 'Danish', de: 'German', el: 'Greek',
	en: 'English', es: 'Spanish', et: 'Estonian', fa: 'Persian', fi: 'Finnish', fr: 'French', he: 'Hebrew', hi: 'Hindi',
	hu: 'Hungarian', id: 'Indonesian', it: 'Italian', ja: 'Japanese', ko: 'Korean', lt: 'Lithuanian', lv: 'Latvian',
	ms: 'Malay', nl: 'Dutch', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian',
	sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', th: 'Thai', tl: 'Tagalog', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu',
	vi: 'Vietnamese', yue: 'Cantonese', zh: 'Chinese',
};

const PREVIOUS_CORE = `ar bg cs da de en es et fi fr he hi hu id it ja ko lt lv nl pl pt ro ru sk sl sv th tr uk vi zh`.split(' ');
const ADDED_CORE = `bn ca el fa ms sw ta tl ur yue`.split(' ');
const PREVIOUS_BILINGUAL = `de es fr ja ko ru th vi zh`.split(' ');
const ADDED_BILINGUAL = `cs el id it ms nl pl pt tr`.split(' ');
const ALL_CORE = [...new Set([...PREVIOUS_CORE, ...ADDED_CORE])];
const ALL_BILINGUAL = [...new Set([...PREVIOUS_BILINGUAL, ...ADDED_BILINGUAL])];
const AVAILABLE_EDITIONS = new Set(`cs de el es fr id it ja ko ms nl pl pt ru th tr vi zh`.split(' '));
const ENWIKTIONARY = 'enwiktionary';
const DEFAULT_SOURCES = {
	[ENWIKTIONARY]: 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz',
};
const cliArgs = process.argv.slice(2);
const outputArgument = cliArgs[0]?.startsWith('--') ? undefined : cliArgs.shift();
const ROOT = resolve(outputArgument || 'release');
const options = parseOptions(cliArgs);
const cacheRoot = resolve(options.cache ?? join(ROOT, '.cache'));
const workBase = resolve(options.work ?? tmpdir());
const selectedCore = selectLanguages(options.core, ALL_CORE, 'core');
const selectedPairs = selectLanguages(options.pairs, ALL_BILINGUAL, 'pairs');
const selectedSources = options.sources === undefined
	? (selectedPairs.length ? [...ALL_CORE] : [])
	: selectLanguages(options.sources, ALL_CORE, 'sources');
const sourceOverrides = new Map((options.source ?? []).map(parseSourceOverride));
const version = options.version ?? new Date().toISOString().slice(0, 10);
const minimumEntries = Number(options['min-entries'] ?? 1000);
const builtFolders = new Set();
let skippedPairs = 0;

if (!/^\d{4}-\d{2}-\d{2}$/u.test(version)) throw new Error('--version must be YYYY-MM-DD.');
if (!Number.isSafeInteger(minimumEntries) || minimumEntries < 1) throw new Error('--min-entries must be a positive integer.');
if (!selectedCore.length && !selectedSources.length) throw new Error('Select at least one core language or bilingual source language.');

await mkdir(ROOT, { recursive: true });
await mkdir(cacheRoot, { recursive: true });
await mkdir(workBase, { recursive: true });
const workRoot = await mkdtemp(join(workBase, 'mynary-pack-build-'));

console.log(`Building ${selectedCore.length} core packs and a bilingual matrix from ${selectedSources.length} source languages across ${selectedPairs.length} target editions in ${ROOT}`);
console.log(`Headword languages: ${selectedSources.join(', ') || '(none)'}`);
console.log(`Gloss editions: en${selectedPairs.length ? `, ${selectedPairs.join(', ')}` : ''}`);

try {
	const englishRoutes = new Set([...selectedCore, ...selectedSources]);
	if (englishRoutes.size) {
		const englishSource = await getSource(ENWIKTIONARY);
		await routeSource(englishSource, ENWIKTIONARY, englishRoutes, async (language, artifacts, build) => {
			if (!build) {
				if (selectedCore.includes(language)) throw new Error(`${language}-core: no usable entries were found.`);
				return;
			}
			if (selectedCore.includes(language)) {
				if (build.entryCount < minimumEntries) throw new Error(`${language}-core: only ${build.entryCount} entries (minimum ${minimumEntries}).`);
				await publishPack(artifacts, coreSpec(language), englishSource, build);
			}
			if (selectedSources.includes(language) && language !== 'en') {
				if (build.entryCount < minimumEntries) {
					skippedPairs++;
					console.warn(`  skipping ${language}-en: ${build.entryCount} entries (minimum ${minimumEntries})`);
				} else await publishPack(artifacts, bilingualSpec(language, 'en'), englishSource, build);
			}
		});
	}

	for (const language of selectedPairs) {
		if (!selectedSources.some((sourceLanguage) => sourceLanguage !== language)) continue;
		const sourceKey = `${language}wiktionary`;
		const source = await getSource(sourceKey);
		const routeCodes = new Set(selectedSources.filter((sourceLanguage) => sourceLanguage !== language));
		await routeSource(source, sourceKey, routeCodes, async (sourceLanguage, artifacts, build) => {
			if (!build || build.entryCount < minimumEntries) {
				skippedPairs++;
				console.warn(`  skipping ${sourceLanguage}-${language}: ${build?.entryCount ?? 0} entries (minimum ${minimumEntries})`);
				return;
			}
			await publishPack(artifacts, bilingualSpec(sourceLanguage, language), source, build);
		});
	}

	console.log(`\nBilingual matrix: ${builtFolders.size - selectedCore.filter((code) => builtFolders.has(code)).length} packs created, ${skippedPairs} candidates skipped below the ${minimumEntries}-entry floor.`);
	console.log('\nVerifying the generated pack files before returning success.');
	await runVerifier([...builtFolders]);
	console.log('Pack generation and compatibility verification finished.');
} finally {
	await rm(workRoot, { recursive: true, force: true });
}

function parseOptions(args) {
	const result = { source: [] };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`);
		const [key, inlineValue] = arg.slice(2).split('=', 2);
		if (key === 'help') { printHelp(); process.exit(0); }
		if (key === 'refresh' && inlineValue === undefined) { result.refresh = true; continue; }
		const value = inlineValue ?? args[++i];
		if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}.`);
		if (key === 'source') result.source.push(value);
		else if (['core', 'pairs', 'sources', 'cache', 'work', 'version', 'min-entries'].includes(key)) result[key] = value;
		else throw new Error(`Unknown option --${key}.`);
	}
	return result;
}

function printHelp() {
	console.log(`Usage: node scripts/build-dictionary-packs.mjs [output-dir] [options]

Default rebuild: 42 core packs and a headword-language × gloss-edition matrix.
  --core all|en,vi,...       Core pack languages (default: all)
  --sources all|vi,zh,...    Headword languages for bilingual packs (default: all when --pairs is nonempty)
  --pairs all|es,ru,...      Non-English gloss editions to include (default: all; use none to disable)
  --source key=path          Use a local .jsonl or .jsonl.gz source; repeatable
  --cache path               Download cache (default: <output>/.cache)
  --work path                Temporary build parent (default: OS temporary folder)
  --version YYYY-MM-DD       Manifest version (default: build date)
  --min-entries N            Core packs fail below N; sparse bilingual pairs skip (default: 1000)
  --refresh                  Download sources again, replacing cached downloads

Sources: ${ENWIKTIONARY}, plus <language-code>wiktionary for each selected target edition.
The default sources are linked from https://kaikki.org/dictionary/rawdata.html.`);
}

function selectLanguages(value, defaults, label) {
	if (value === undefined || value === 'all') return [...defaults];
	if (value === 'none') return [];
	const selected = [...new Set(value.split(',').map((code) => code.trim()).filter(Boolean))];
	for (const code of selected) {
		if (!LANGUAGES[code]) throw new Error(`Unknown language code in --${label}: ${code}.`);
		if (code === 'en' && label === 'pairs') throw new Error('English cannot be a bilingual target.');
		if (label === 'pairs' && !AVAILABLE_EDITIONS.has(code)) throw new Error(`Kaikki has no configured non-English Wiktionary edition for ${code}.`);
	}
	return selected;
}

function parseSourceOverride(value) {
	const separator = value.indexOf('=');
	if (separator < 1) throw new Error('--source requires key=path.');
	return [value.slice(0, separator), resolve(value.slice(separator + 1))];
}

function sourceUrl(key) {
	if (DEFAULT_SOURCES[key]) return DEFAULT_SOURCES[key];
	const match = /^([a-z]{2,3})wiktionary$/u.exec(key);
	if (!match || !LANGUAGES[match[1]] || !AVAILABLE_EDITIONS.has(match[1])) throw new Error(`No Kaikki source is configured for ${key}.`);
	return `https://kaikki.org/dictionary/downloads/${match[1]}/${match[1]}-extract.jsonl.gz`;
}

async function getSource(key) {
	const override = sourceOverrides.get(key);
	if (override) {
		if (!existsSync(override)) throw new Error(`Source file does not exist: ${override}`);
		return { path: override, url: sourceUrl(key), sha256: await hashFile(override) };
	}
	const url = sourceUrl(key);
	const destination = join(cacheRoot, `${key}.jsonl.gz`);
	if (options.refresh && existsSync(destination)) await rm(destination, { force: true });
	if (!existsSync(destination) || (await stat(destination)).size === 0) await download(url, destination);
	return { path: destination, url, sha256: await hashFile(destination) };
}

async function download(url, destination) {
	const partial = `${destination}.part`;
	let lastError;
	for (let attempt = 1; attempt <= 4; attempt++) {
		try {
			console.log(`Downloading ${basename(destination)} (attempt ${attempt}/4)`);
			const response = await fetch(url, { redirect: 'follow' });
			if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
			await pipeline(response.body, createWriteStream(partial));
			if ((await stat(partial)).size === 0) throw new Error('Downloaded file is empty.');
			await rename(partial, destination);
			return;
		} catch (error) {
			lastError = error;
			await rm(partial, { force: true });
			if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 2000));
		}
	}
	throw new Error(`Download failed for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function hashFile(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
}

async function routeSource(source, sourceKey, routeCodes, onRouteBuilt) {
	const sourceWork = join(workRoot, sourceKey);
	await rm(sourceWork, { recursive: true, force: true });
	await mkdir(sourceWork, { recursive: true });
	const writer = createBucketWriter(sourceWork);
	const counts = new Map([...routeCodes].map((code) => [code, 0]));
	let lines = 0;
	let malformed = 0;
	const input = createReadStream(source.path);
	const decoded = source.path.endsWith('.gz') ? input.pipe(createGunzip()) : input;
	const reader = createInterface({ input: decoded, crlfDelay: Infinity });
	console.log(`\nScanning ${sourceKey}: ${source.path}`);
	try {
		for await (const line of reader) {
			if (!line.trim()) continue;
			lines++;
			let item;
			try { item = JSON.parse(line); } catch { malformed++; throw new Error(`${sourceKey}: invalid JSON at line ${lines}.`); }
			if (!item || typeof item !== 'object' || Array.isArray(item)) { malformed++; throw new Error(`${sourceKey}: expected an object at line ${lines}.`); }
			const language = item.lang_code;
			if (!routeCodes.has(language) || typeof item.word !== 'string') continue;
			const payload = toPayload(item);
			if (!payload.meanings.length) continue;
			const word = normalizeWord(item.word);
			if (!word) continue;
			const bucket = createHash('sha1').update(word).digest()[0];
			writer.write(language, bucket, JSON.stringify({ word, payload }) + '\n');
			counts.set(language, counts.get(language) + 1);
			if (lines % 1000000 === 0) process.stdout.write(`\r${sourceKey}: ${lines.toLocaleString()} lines`);
		}
	} finally {
		reader.close();
		writer.close();
	}
	console.log(`\n${sourceKey}: scanned ${lines.toLocaleString()} lines, ignored ${malformed.toLocaleString()} malformed lines.`);
	for (const language of routeCodes) {
		if (!counts.get(language)) {
			await onRouteBuilt(language, undefined, undefined);
			continue;
		}
		const artifacts = join(sourceWork, 'artifacts', language);
		await mkdir(artifacts, { recursive: true });
		const build = await buildArtifacts(sourceWork, language, artifacts);
		console.log(`${sourceKey}/${language}: ${build.entryCount.toLocaleString()} unique words`);
		await onRouteBuilt(language, artifacts, build);
	}
}

function createBucketWriter(root, maxOpen = 48) {
	const descriptors = new Map();
	const directories = new Set();
	return {
		write(language, bucket, text) {
			const folder = join(root, language);
			if (!directories.has(folder)) { mkdirSync(folder, { recursive: true }); directories.add(folder); }
			const path = join(folder, `${bucket.toString(16).padStart(2, '0')}.jsonl`);
			let fd = descriptors.get(path);
			if (fd === undefined) {
				if (descriptors.size >= maxOpen) {
					const [oldest, oldFd] = descriptors.entries().next().value;
					closeSync(oldFd);
					descriptors.delete(oldest);
				}
				fd = openSync(path, 'a');
			}
			descriptors.delete(path);
			descriptors.set(path, fd);
			const bytes = Buffer.from(text, 'utf8');
			let written = 0;
			while (written < bytes.length) written += writeSync(fd, bytes, written, bytes.length - written);
		},
		close() { for (const fd of descriptors.values()) closeSync(fd); descriptors.clear(); },
	};
}

function toPayload(item) {
	const meaningMap = new Map();
	for (const sense of Array.isArray(item.senses) ? item.senses : []) {
		const definitions = [];
		for (const gloss of Array.isArray(sense.glosses) ? sense.glosses : []) {
			const text = typeof gloss === 'string' ? gloss.trim() : '';
			if (text) definitions.push({ sense: text });
		}
		for (const example of Array.isArray(sense.examples) ? sense.examples : []) {
			const text = typeof example === 'string' ? example.trim() : typeof example?.text === 'string' ? example.text.trim() : '';
			if (text && definitions.length) definitions[definitions.length - 1].examples = [...(definitions[definitions.length - 1].examples ?? []), text];
		}
		if (!definitions.length) continue;
		const partOfSpeech = typeof item.pos === 'string' ? item.pos : undefined;
		const key = partOfSpeech ?? '';
		const meaning = meaningMap.get(key) ?? { ...(partOfSpeech ? { partOfSpeech } : {}), definitions: [] };
		meaning.definitions.push(...definitions);
		meaningMap.set(key, meaning);
	}
	const phonetics = unique((Array.isArray(item.sounds) ? item.sounds : [])
		.filter((sound) => typeof sound?.ipa === 'string' && sound.ipa.trim())
		.map((sound) => ({ text: sound.ipa.trim() })));
	const payload = { phonetics, meanings: [...meaningMap.values()] };
	if (typeof item.etymology_text === 'string' && item.etymology_text.trim()) payload.etymology = item.etymology_text.trim();
	return payload;
}

function unique(values) {
	const seen = new Set();
	return values.filter((value) => { const key = JSON.stringify(value); if (seen.has(key)) return false; seen.add(key); return true; });
}

function normalizeWord(value) { return value.normalize('NFKC').trim().toLocaleLowerCase('und'); }

async function buildArtifacts(sourceWork, language, output) {
	const entriesPath = join(output, 'entries.jsonl.gz');
	const indexPath = join(output, 'index.json');
	const entriesHash = createHash('sha256');
	const indexHash = createHash('sha256');
	const hashCompressed = new Transform({ transform(chunk, _encoding, callback) { entriesHash.update(chunk); callback(null, chunk); } });
	const gzip = createGzip({ level: 6, mtime: 0 });
	const entriesStream = createWriteStream(entriesPath);
	const indexStream = createWriteStream(indexPath);
	const entriesDone = pipeline(gzip, hashCompressed, entriesStream);
	let indexCount = 0;
	let offset = 0;
	async function writeIndex(text) {
		indexHash.update(text);
		if (!indexStream.write(text)) await waitForDrain(indexStream);
	}
	async function writeEntry(text) {
		if (!gzip.write(text)) await waitForDrain(gzip);
	}
	await writeIndex('[');
	const runs = [];
	for (let bucket = 0; bucket < 256; bucket++) {
		const path = join(sourceWork, language, `${bucket.toString(16).padStart(2, '0')}.jsonl`);
		if (!existsSync(path)) continue;
		const records = new Map();
		const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
		for await (const line of reader) {
			const record = JSON.parse(line);
			const previous = records.get(record.word);
			if (previous) mergePayload(previous.payload, record.payload);
			else records.set(record.word, record);
		}
		const sortedRun = join(output, `run-${bucket.toString(16).padStart(2, '0')}.jsonl`);
		const sorted = [...records.values()].sort((a, b) => a.word < b.word ? -1 : a.word > b.word ? 1 : 0);
		await writeFile(sortedRun, `${sorted.map((record) => JSON.stringify(record)).join('\n')}\n`);
		runs.push(sortedRun);
		records.clear();
	}
	const heap = [];
	for (const path of runs) {
		const reader = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
		const iterator = reader[Symbol.asyncIterator]();
		const next = await iterator.next();
		if (!next.done) heapPush(heap, { record: JSON.parse(next.value), iterator, reader });
	}
	while (heap.length) {
		const current = heapPop(heap);
		const payloadBytes = Buffer.from(JSON.stringify(current.record.payload), 'utf8');
		if (indexCount) await writeIndex(',');
		await writeIndex(JSON.stringify({ word: current.record.word, offset, length: payloadBytes.length }));
		await writeEntry(Buffer.concat([payloadBytes, Buffer.from('\n')]));
		offset += payloadBytes.length + 1;
		indexCount++;
		const next = await current.iterator.next();
		if (!next.done) {
			current.record = JSON.parse(next.value);
			heapPush(heap, current);
		} else current.reader.close();
	}
	await writeIndex(']');
	indexStream.end();
	gzip.end();
	await Promise.all([entriesDone, finished(indexStream)]);
	if (indexCount === 0) throw new Error(`${language}: no usable entries were found in this source.`);
	return { entryCount: indexCount, indexSha256: indexHash.digest('hex'), entriesSha256: entriesHash.digest('hex') };
}

function heapPush(heap, value) {
	let index = heap.length;
	heap.push(value);
	while (index > 0) {
		const parent = Math.floor((index - 1) / 2);
		if (heap[parent].record.word <= value.record.word) break;
		heap[index] = heap[parent];
		index = parent;
	}
	heap[index] = value;
}

function heapPop(heap) {
	const first = heap[0];
	const last = heap.pop();
	if (heap.length && last) {
		let index = 0;
		heap[0] = last;
		while (true) {
			const left = index * 2 + 1;
			const right = left + 1;
			let smallest = index;
			if (left < heap.length && heap[left].record.word < heap[smallest].record.word) smallest = left;
			if (right < heap.length && heap[right].record.word < heap[smallest].record.word) smallest = right;
			if (smallest === index) break;
			[heap[index], heap[smallest]] = [heap[smallest], heap[index]];
			index = smallest;
		}
	}
	return first;
}

function mergePayload(left, right) {
	left.phonetics = unique([...(left.phonetics ?? []), ...(right.phonetics ?? [])]);
	for (const meaning of right.meanings ?? []) {
		const existing = left.meanings.find((candidate) => candidate.partOfSpeech === meaning.partOfSpeech);
		if (existing) existing.definitions.push(...meaning.definitions);
		else left.meanings.push(meaning);
	}
	if (!left.etymology && right.etymology) left.etymology = right.etymology;
}

function waitForDrain(stream) {
	return new Promise((resolveDrain, reject) => {
		const cleanup = () => {
			stream.off('drain', onDrain);
			stream.off('error', onError);
			stream.off('close', onClose);
		};
		const onDrain = () => { cleanup(); resolveDrain(); };
		const onError = (error) => { cleanup(); reject(error); };
		const onClose = () => { cleanup(); reject(new Error('Stream closed before it drained.')); };
		stream.once('drain', onDrain);
		stream.once('error', onError);
		stream.once('close', onClose);
	});
}

function coreSpec(language) {
	return { folder: language, id: `${language}-core`, kind: 'core', language, name: `${LANGUAGES[language]} Core Dictionary` };
}

function bilingualSpec(language, targetLanguage) {
	return { folder: `${language}-${targetLanguage}`, id: `${language}-${targetLanguage}-bilingual`, kind: 'bilingual', language, targetLanguage, name: `${LANGUAGES[language]}-${LANGUAGES[targetLanguage]} Dictionary` };
}

async function publishPack(artifacts, spec, source, build) {
	const destination = join(ROOT, spec.folder);
	await rm(destination, { recursive: true, force: true });
	await mkdir(destination, { recursive: true });
	await Promise.all(['index.json', 'entries.jsonl.gz'].map((name) => copyFile(join(artifacts, name), join(destination, name))));
	const manifest = {
		format: 'mynary-pack-v1', id: spec.id, kind: spec.kind, language: spec.language,
		...(spec.targetLanguage ? { targetLanguage: spec.targetLanguage } : {}), name: spec.name, version,
		entryCount: build.entryCount, indexFile: 'index.json', entriesFile: 'entries.jsonl.gz', compressed: true,
		source: source.url, sourceSha256: source.sha256, license: 'CC BY-SA 4.0 / GFDL',
		indexSha256: build.indexSha256, entriesSha256: build.entriesSha256,
	};
	await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	console.log(`  wrote ${spec.folder}: ${build.entryCount.toLocaleString()} entries (${formatBytes((await stat(join(destination, 'entries.jsonl.gz'))).size)} gzip)`);
	builtFolders.add(spec.folder);
}

async function runVerifier(folders) {
	if (!folders.length) return;
	const verifier = fileURLToPath(new URL('./verify-dictionary-packs.mjs', import.meta.url));
	await new Promise((resolveProcess, reject) => {
		const child = spawn(process.execPath, [verifier, ROOT, ...folders], { stdio: 'inherit' });
		child.once('error', reject);
		child.once('exit', (status) => status === 0 ? resolveProcess() : reject(new Error(`Pack verification failed with status ${status}.`)));
	});
}

function formatBytes(bytes) {
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
