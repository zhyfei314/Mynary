import { describe, expect, it } from 'vitest';
import {
	isPackMatchingAutoLanguage,
	mergeDictionaryEntries,
	selectOfflinePacks,
	type InstalledDictionaryPack,
} from '../src/providers/offline-pack-selection';
import { WiktionaryProvider } from '../src/providers/wiktionary';
import type { DictionaryEntry } from '../src/types';

function makePack(overrides: Partial<InstalledDictionaryPack> & Pick<InstalledDictionaryPack, 'id' | 'kind' | 'language'>): InstalledDictionaryPack {
	return {
		format: 'mynary-pack-v1',
		name: overrides.name ?? overrides.id,
		version: '1.0.0',
		entryCount: 100,
		indexFile: 'index.json',
		entriesFile: 'entries.jsonl',
		storagePath: `.mynary/dictionaries/${overrides.id}`,
		filesReady: true,
		...overrides,
	};
}

describe('offline pack selection', () => {
	const enVi = makePack({ id: 'en-vi', kind: 'bilingual', language: 'en', targetLanguage: 'vi', name: 'English → Vietnamese' });
	const frVi = makePack({ id: 'fr-vi', kind: 'bilingual', language: 'fr', targetLanguage: 'vi', name: 'French → Vietnamese' });
	const esEn = makePack({ id: 'es-en', kind: 'bilingual', language: 'es', targetLanguage: 'en', name: 'Spanish → English' });
	const enCore = makePack({ id: 'en-core', kind: 'core', language: 'en', name: 'English Core' });
	const brokenPack = makePack({ id: 'broken', kind: 'core', language: 'en', filesReady: false });

	it('matches bilingual packs by targetLanguage and leaves core packs unrestricted in auto mode', () => {
		expect(isPackMatchingAutoLanguage(enVi, 'vi')).toBe(true);
		expect(isPackMatchingAutoLanguage(esEn, 'vi')).toBe(false);
		expect(isPackMatchingAutoLanguage(enCore, 'vi')).toBe(true);

		const selected = selectOfflinePacks([esEn, enCore, enVi, brokenPack], {
			activeLanguage: 'vi',
			mode: 'auto',
			selectedPackIds: [],
			priority: 'bilingual-first',
		});
		expect(selected.map((pack) => pack.id)).toEqual(['en-vi', 'en-core']);
	});

	it('allows custom pack selection regardless of active language', () => {
		const selected = selectOfflinePacks([enVi, esEn, enCore], {
			activeLanguage: 'vi',
			mode: 'custom',
			selectedPackIds: ['es-en', 'en-vi'],
			priority: 'alphabetical',
		});
		expect(selected.map((pack) => pack.id)).toEqual(['en-vi', 'es-en']);
	});

	it('filters by source language and orders by input language priority', () => {
		const filtered = selectOfflinePacks([enVi, frVi, esEn, enCore], {
			activeLanguage: 'vi',
			mode: 'auto',
			selectedPackIds: [],
			sourceLanguage: 'en',
			priority: 'input-language',
		});
		expect(filtered.map((pack) => pack.id)).toEqual(['en-vi', 'en-core']);

		const prioritized = selectOfflinePacks([frVi, enCore], {
			activeLanguage: 'vi',
			mode: 'custom',
			selectedPackIds: ['fr-vi', 'en-core'],
			sourceLanguage: '',
			priority: 'input-language',
		});
		expect(prioritized.map((pack) => pack.id)).toEqual(['fr-vi', 'en-core']);
	});

	it('returns all matching offline entries in WiktionaryProvider.lookupOfflineEntries without dropping cross-language entries', async () => {
		const enViEntry: DictionaryEntry = {
			word: 'hello',
			language: 'en',
			phonetics: [],
			meanings: [{ partOfSpeech: 'interjection', definitions: [{ text: 'xin chào', examples: [] }] }],
			translations: [{ word: 'xin chào', languageCode: 'vi' }],
			synonyms: [],
			antonyms: [],
			source: { id: 'en-vi', name: 'English → Vietnamese', url: '' },
			fetchedAt: 100,
		};
		const esEnEntry: DictionaryEntry = {
			word: 'hello',
			language: 'es',
			phonetics: [],
			meanings: [{ partOfSpeech: 'noun', definitions: [{ text: 'greeting', examples: [] }] }],
			translations: [{ word: 'greeting', languageCode: 'en' }],
			synonyms: [],
			antonyms: [],
			source: { id: 'es-en', name: 'Spanish → English', url: '' },
			fetchedAt: 200,
		};
		const provider = new WiktionaryProvider(
			async () => ({ status: 404, json: {} }),
			undefined,
			false,
			() => [
				{ lookup: async () => enViEntry, releaseEntriesBuffer: () => undefined } as never,
				{ lookup: async () => esEnEntry, releaseEntriesBuffer: () => undefined } as never,
			],
		);

		const entries = await provider.lookupOfflineEntries('hello', 'vi');
		expect(entries).toHaveLength(2);
		expect(entries.map((entry) => entry.source.id)).toEqual(['en-vi', 'es-en']);

		const merged = mergeDictionaryEntries(entries);
		expect(merged?.meanings).toHaveLength(2);
		expect(merged?.translations).toHaveLength(2);
		expect(merged?.source.name).toBe('English → Vietnamese + Spanish → English');
	});
});
