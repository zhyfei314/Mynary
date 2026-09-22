import type { DataAdapter } from 'obsidian';
import type { DictionaryEntry, DictionaryPackManifest, Definition, Meaning, Pronunciation, Translation } from '../types';

interface PackIndexItem { word: string; offset: number; length: number; }

/**
 * Reads the deliberately small Mynary pack format.
 *
	 * A pack contains manifest.json, index.json and entries.jsonl(.gz). The JSONL file
 * stores only normalized entry payloads; audio and source HTML never belong in
 * a pack. The index is kept in memory and definitions are read by byte range.
 */
export class OfflineDictionaryProvider {
	private manifest?: DictionaryPackManifest;
	private index?: PackIndexItem[];
	private entriesBuffer?: Uint8Array;

	constructor(private readonly adapter: DataAdapter, private readonly root: string) {}

	async load(): Promise<DictionaryPackManifest | undefined> {
		if (this.manifest && this.index) return this.manifest;
		const manifestPath = joinPath(this.root, 'manifest.json');
		if (!(await this.adapter.exists(manifestPath))) return undefined;
		const manifest = JSON.parse(await this.adapter.read(manifestPath)) as Partial<DictionaryPackManifest>;
		if (manifest.format !== 'mynary-pack-v1' || typeof manifest.id !== 'string' || typeof manifest.language !== 'string') {
			throw new Error('Invalid Mynary dictionary pack manifest.');
		}
		const indexFile = typeof manifest.indexFile === 'string' ? manifest.indexFile : 'index.json';
		const entriesFile = typeof manifest.entriesFile === 'string' ? manifest.entriesFile : 'entries.jsonl';
		const index = JSON.parse(await this.adapter.read(joinPath(this.root, indexFile))) as unknown;
		if (!Array.isArray(index) || !index.every(isIndexItem)) throw new Error('Invalid Mynary dictionary pack index.');
		this.manifest = { ...manifest, indexFile, entriesFile } as DictionaryPackManifest;
		this.index = index;
		return this.manifest;
	}

	async lookup(word: string): Promise<DictionaryEntry | undefined> {
		const manifest = await this.load();
		if (!manifest || !this.index) return undefined;
		const normalized = normalizeWord(word);
		const item = binarySearch(this.index, normalized);
		if (!item) return undefined;
		this.entriesBuffer ??= await readEntries(this.adapter, joinPath(this.root, manifest.entriesFile), manifest.compressed === true);
		const { offset, length } = item;
		const bytes = this.entriesBuffer.slice(offset, offset + length);
		const payload = JSON.parse(new TextDecoder().decode(bytes)) as OfflineEntryPayload;
		return toDictionaryEntry(payload, word, manifest);
	}
}

export interface OfflineEntryPayload {
	word?: string;
	phonetics?: Array<{ text: string; type?: string }>;
	meanings?: Array<{ partOfSpeech?: string; labels?: string[]; definitions: Array<{ text: string; examples?: string[] }> }>;
	translations?: Array<{ word: string; language?: string; languageCode?: string; languageName?: string; sense?: string; labels?: string[] }>;
	synonyms?: string[];
	antonyms?: string[];
	etymology?: string;
}

function toDictionaryEntry(payload: OfflineEntryPayload, requestedWord: string, manifest: DictionaryPackManifest): DictionaryEntry {
	const phonetics: Pronunciation[] = (payload.phonetics ?? []).filter((item) => item && typeof item.text === 'string').map((item) => ({ text: item.text, type: item.type }));
	const meanings: Meaning[] = (payload.meanings ?? []).map((meaning) => ({
		partOfSpeech: meaning.partOfSpeech,
		labels: meaning.labels ?? [],
		definitions: (meaning.definitions ?? []).filter((definition) => definition && typeof definition.text === 'string').map((definition): Definition => ({ text: definition.text, examples: definition.examples ?? [] })),
	}));
	const translations: Translation[] = (payload.translations ?? []).filter((item) => item && typeof item.word === 'string').map((item) => ({ ...item }));
	return {
		word: payload.word || requestedWord,
		language: manifest.language,
		phonetics,
		meanings,
		translations,
		synonyms: payload.synonyms ?? [],
		antonyms: payload.antonyms ?? [],
		etymology: payload.etymology,
		source: { id: manifest.id, name: manifest.name, url: manifest.source ?? '' },
		fetchedAt: Date.now(),
	};
}

function binarySearch(items: PackIndexItem[], target: string) {
	let low = 0;
	let high = items.length - 1;
	while (low <= high) {
		const middle = (low + high) >> 1;
		const comparison = items[middle]!.word.localeCompare(target);
		if (comparison === 0) return items[middle];
		if (comparison < 0) low = middle + 1;
		else high = middle - 1;
	}
	return undefined;
}

function normalizeWord(word: string) {
	return word.trim().normalize('NFKC').toLocaleLowerCase();
}

function isIndexItem(value: unknown): value is PackIndexItem {
	if (!value || typeof value !== 'object') return false;
	const item = value as Partial<PackIndexItem>;
	const offset = item.offset;
	const length = item.length;
	return typeof item.word === 'string' && typeof offset === 'number' && Number.isInteger(offset) && offset >= 0 && typeof length === 'number' && Number.isInteger(length) && length > 0;
}

async function readEntries(adapter: DataAdapter, path: string, compressed: boolean) {
	const bytes = new Uint8Array(await adapter.readBinary(path));
	if (!compressed) return bytes;
	if (typeof DecompressionStream === 'undefined') throw new Error('This Obsidian version cannot read gzip dictionary packs.');
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

function joinPath(root: string, file: string) {
	const cleanRoot = root.replace(/\\+$/g, '').replace(/\/+$/g, '');
	const cleanFile = file.replace(/^[/\\]+/g, '');
	if (cleanFile.split(/[\\/]/u).includes('..')) throw new Error('Invalid dictionary pack path.');
	return cleanRoot ? `${cleanRoot}/${cleanFile}` : cleanFile;
}
