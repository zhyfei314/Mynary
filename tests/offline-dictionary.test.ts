import { describe, expect, it } from 'vitest';
import { OfflineDictionaryProvider } from '../src/providers/offline-dictionary';

function adapter(files: Record<string, string | ArrayBuffer>) {
	return {
		exists: async (path: string) => path in files,
		read: async (path: string) => typeof files[path] === 'string' ? files[path] : '',
		readBinary: async (path: string) => files[path] instanceof ArrayBuffer ? files[path] : new TextEncoder().encode(String(files[path])).buffer,
	} as never;
}

describe('offline dictionary packs', () => {
	it('loads an indexed entry without parsing the whole dictionary', async () => {
		const entry = JSON.stringify({ word: 'hello', phonetics: [{ text: 'həˈləʊ' }], meanings: [{ partOfSpeech: 'noun', definitions: [{ text: 'A greeting.' }] }] });
		const provider = new OfflineDictionaryProvider(adapter({
			'dict/manifest.json': JSON.stringify({ format: 'mynary-pack-v1', id: 'en-core', language: 'en', name: 'English Core', version: '1', entryCount: 1, indexFile: 'index.json', entriesFile: 'entries.jsonl' }),
			'dict/index.json': JSON.stringify([{ word: 'hello', offset: 0, length: new TextEncoder().encode(entry).length }]),
			'dict/entries.jsonl': entry,
		}), 'dict');

		const result = await provider.lookup('Hello');
		expect(result?.word).toBe('hello');
		expect(result?.meanings[0]?.definitions[0]?.text).toBe('A greeting.');
		expect(result?.source.id).toBe('en-core');
	});

	it('returns no result for an unknown word', async () => {
		const provider = new OfflineDictionaryProvider(adapter({
			'dict/manifest.json': JSON.stringify({ format: 'mynary-pack-v1', id: 'en-core', language: 'en', name: 'English Core', version: '1', entryCount: 0, indexFile: 'index.json', entriesFile: 'entries.jsonl' }),
			'dict/index.json': '[]',
		}), 'dict');

		expect(await provider.lookup('missing')).toBeUndefined();
	});

	it('accepts the shared bilingual manifest schema', async () => {
		const entry = JSON.stringify({ word: 'hello', translations: [{ word: 'xin chào', languageCode: 'vi' }] });
		const provider = new OfflineDictionaryProvider(adapter({
			'dict/manifest.json': JSON.stringify({ format: 'mynary-pack-v1', id: 'en-vi-bilingual', kind: 'bilingual', language: 'en', targetLanguage: 'vi', name: 'English-Vietnamese', version: '1', entryCount: 1, indexFile: 'index.json', entriesFile: 'entries.jsonl' }),
			'dict/index.json': JSON.stringify([{ word: 'hello', offset: 0, length: new TextEncoder().encode(entry).length }]),
			'dict/entries.jsonl': entry,
		}), 'dict');

		await expect(provider.lookup('hello')).resolves.toMatchObject({ translations: [{ word: 'xin chào', languageCode: 'vi' }] });
	});
});
