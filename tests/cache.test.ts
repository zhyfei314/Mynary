/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { CacheManager, normalizeCacheData } from '../src/services/cache';
import { DictionaryEntry } from '../src/types';
import type { DictionarySettings } from '../src/settings';

const entry: DictionaryEntry = {
	word: 'test', language: 'en', phonetics: [], meanings: [], translations: [], synonyms: [], antonyms: [],
	source: { id: 'test', name: 'Test', url: 'https://example.com' }, fetchedAt: 1700000000000,
};

function fakePlugin(initial: Record<string, unknown> = {}) {
	let data: Record<string, unknown> = initial;
	return {
		loadData: async () => data,
		saveData: async (next: Record<string, unknown>) => { data = next; },
		read: () => data,
	} as never;
}

function settings(overrides: Partial<DictionarySettings> = {}): DictionarySettings {
	return { defaultLanguage: 'en', languages: [], noteFolder: '', filenameTemplate: '{{word}}', cacheTtlDays: 7, maxCacheEntries: 100, defaultTemplateId: 'basic', templates: [], existingNoteBehavior: 'ask', ttsEnabled: false, ttsAutoGenerate: false, ttsRuntime: 'web', supertonicEndpoint: 'http://127.0.0.1:7788/v1/tts', supertonicVoice: 'M1', supertonicSteps: 8, supertonicSpeed: 1.05, ...overrides };
}

describe('cache manager', () => {
	it('normalizes malformed persisted cache data', () => {
		const now = Date.now();
		const normalized = normalizeCacheData({ cache: {
			valid: { key: 'valid', entry, createdAt: now - 10, expiresAt: now + 10000 },
			malformed: { key: 'malformed', entry: { word: 'broken' }, createdAt: now, expiresAt: now + 10000 },
			expired: { key: 'expired', entry, createdAt: now - 20, expiresAt: now - 1 },
		} }, 100);

		expect(Object.keys(normalized)).toEqual(['valid']);
	});

	it('keeps only the newest normalized cache entries', () => {
		const now = Date.now();
		const normalized = normalizeCacheData({ cache: {
			one: { key: 'one', entry, createdAt: now - 30, expiresAt: now + 10000 },
			two: { key: 'two', entry, createdAt: now - 20, expiresAt: now + 10000 },
			three: { key: 'three', entry, createdAt: now - 10, expiresAt: now + 10000 },
		} }, 2);

		expect(Object.keys(normalized)).toEqual(['two', 'three']);
	});

	it('persists and returns a valid entry', async () => {
		const plugin = fakePlugin();
		const cache = new CacheManager(plugin, settings({ cacheTtlDays: 7 }));
		await cache.set('en:test', entry);

		expect(await cache.get('en:test')).toEqual(entry);
		expect((plugin as { read: () => Record<string, unknown> }).read().cache).toBeDefined();
	});

	it('expires entries according to TTL', async () => {
		const expired = { key: 'en:test', entry, createdAt: 1, expiresAt: 2 };
		const cache = new CacheManager(fakePlugin({ cache: { 'en:test': expired } }), settings());
		await new Promise((resolve) => window.setTimeout(resolve, 0));

		expect(await cache.get('en:test')).toBeUndefined();
	});

	it('evicts the oldest entry when the maximum is exceeded', async () => {
		const cache = new CacheManager(fakePlugin(), settings({ maxCacheEntries: 2 }));
		await cache.set('en:one', { ...entry, word: 'one' });
		await cache.set('en:two', { ...entry, word: 'two' });
		await cache.set('en:three', { ...entry, word: 'three' });

		expect(await cache.get('en:one')).toBeUndefined();
		expect((await cache.get('en:two'))?.word).toBe('two');
		expect((await cache.get('en:three'))?.word).toBe('three');
	});

	it('clears all entries', async () => {
		const cache = new CacheManager(fakePlugin(), settings());
		await cache.set('en:test', entry);
		await cache.clear();

		expect(await cache.get('en:test')).toBeUndefined();
	});
});
