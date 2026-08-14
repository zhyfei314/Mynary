import type { Plugin } from 'obsidian';
import { DictionaryEntry } from '../types';
import type { DictionarySettings } from '../settings';

interface CacheEntry { key: string; entry: DictionaryEntry; createdAt: number; expiresAt: number; }
export class CacheManager {
	private entries: Record<string, CacheEntry> = {};
	private ready: Promise<void>;
	constructor(private plugin: Plugin, private settings: DictionarySettings) { this.ready = this.load(); }
	private async load() { const data = await this.plugin.loadData() as { cache?: Record<string, CacheEntry> } | null; this.entries = data?.cache ?? {}; }
	async get(key: string) {
		await this.ready;
		const item = this.entries[key];
		if (!item || item.expiresAt <= Date.now()) {
			if (item) delete this.entries[key];
			return undefined;
		}
		return item.entry;
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
	private async persist() { const data = await this.plugin.loadData() as Record<string, unknown> | null ?? {}; await this.plugin.saveData({ ...data, cache: this.entries }); }
}
