import type { Plugin } from 'obsidian';
import type { DictionaryEntry } from '../types';
import { isRecord } from '../settings';
import type { DictionarySettings } from '../settings';

export interface CacheEntry { key: string; entry: DictionaryEntry; createdAt: number; expiresAt: number; }
export class CacheManager {
	private entries: Record<string, CacheEntry> = {};
	private ready: Promise<void>;
	constructor(private plugin: Plugin, private settings: DictionarySettings) { this.ready = this.load(); }
	private async load() {
		try {
			this.entries = normalizeCacheData(await this.plugin.loadData() as unknown, this.settings.maxCacheEntries);
		} catch {
			this.entries = {};
		}
	}
	async whenReady() { await this.ready; }
	async get(key: string) {
		await this.ready;
		const item = this.entries[key];
		if (!item || item.expiresAt <= Date.now()) {
			if (item) delete this.entries[key];
			return undefined;
		}
		return item.entry;
	}
	getRecentWords(limit = 20): string[] {
		return Object.values(this.entries)
			.sort((left, right) => right.createdAt - left.createdAt)
			.map((item) => item.entry.word)
			.filter((word, index, words) => words.indexOf(word) === index)
			.slice(0, limit);
	}
	async set(key: string, entry: DictionaryEntry) {
		await this.ready;
		const now = Date.now();
		this.entries[key] = { key, entry, createdAt: now, expiresAt: now + this.settings.cacheTtlDays * 86400000 };
		const keys = Object.keys(this.entries).sort((a, b) => (this.entries[a]?.createdAt ?? 0) - (this.entries[b]?.createdAt ?? 0));
		while (keys.length > this.settings.maxCacheEntries) {
			const oldest = keys.shift();
			if (oldest) delete this.entries[oldest];
		}
		await this.persist();
	}
	async clear() { await this.ready; this.entries = {}; await this.persist(); }
	private async persist() { const raw = await this.plugin.loadData() as unknown; const data = isRecord(raw) ? raw : {}; await this.plugin.saveData({ ...data, cache: this.entries }); }
}

export function normalizeCacheData(raw: unknown, maxEntries = 100): Record<string, CacheEntry> {
	const data = isRecord(raw) && isRecord(raw.cache) ? raw.cache : {};
	const entries = Object.entries(data).map(([key, value]) => parseCacheEntry(key, value)).filter((item): item is CacheEntry => Boolean(item)).sort((left, right) => left.createdAt - right.createdAt);
	return Object.fromEntries(entries.slice(-Math.max(1, Math.floor(maxEntries))).map((entry) => [entry.key, entry] as const));
}

function parseCacheEntry(key: string, value: unknown): CacheEntry | undefined {
	if (!key || !isRecord(value) || typeof value.key !== 'string' || typeof value.createdAt !== 'number' || typeof value.expiresAt !== 'number' || value.expiresAt <= Date.now() || !isDictionaryEntry(value.entry)) return undefined;
	return { key: value.key, entry: value.entry, createdAt: value.createdAt, expiresAt: value.expiresAt };
}

function isDictionaryEntry(value: unknown): value is DictionaryEntry {
	if (!isRecord(value) || typeof value.word !== 'string' || typeof value.language !== 'string' || !Array.isArray(value.phonetics) || !Array.isArray(value.meanings) || !Array.isArray(value.translations) || !Array.isArray(value.synonyms) || !Array.isArray(value.antonyms) || !isRecord(value.source)) return false;
	return typeof value.source.id === 'string' && typeof value.source.name === 'string' && typeof value.source.url === 'string' && typeof value.fetchedAt === 'number';
}
