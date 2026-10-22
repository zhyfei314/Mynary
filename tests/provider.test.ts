import { describe, expect, it } from 'vitest';
import { parseWikitext } from '../src/providers/wiktionary-parser';

describe('Wiktionary provider title resolution contract', () => {
	it('keeps the user spelling while using the resolved page title for the source', () => {
		const entry = parseWikitext('Hello', 'en', 'hello', '==English==\n===Noun===\n# A greeting.', 1700000000000);

		expect(entry.word).toBe('Hello');
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('A greeting.');
		expect(entry.source.url).toBe('https://en.wiktionary.org/wiki/hello');
	});
});
