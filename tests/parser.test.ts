import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { parseWikitext } from '../src/providers/wiktionary-parser';
import { parseWiktionaryHtml } from '../src/providers/wiktionary-html-parser';

function fixture(name: string) {
	return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

describe('Wiktionary parser', () => {
	it('keeps sense headings under their parent part of speech', () => {
		const entry = parseWiktionaryHtml('<h2>English</h2><h3>Verb</h3><h4>Transitive</h4><ol><li>To grapple with someone.</li></ol><h4>Intransitive</h4><ol><li>To struggle physically.</li></ol>', 'wrestle', 'en', 'wrestle', Date.now(), (value) => new JSDOM(value).window.document);

		expect(entry.meanings.map((meaning) => [meaning.partOfSpeech, meaning.labels])).toEqual([
			['Verb', ['Transitive']],
			['Verb', ['Intransitive']],
		]);
	});
	it('extracts the requested language section and core English fields', () => {
		const entry = parseWikitext('example', 'en', 'example', fixture('example-en.wikitext'), 1700000000000);

		expect(entry.meanings).toHaveLength(1);
		expect(entry.meanings[0]?.partOfSpeech).toBe('Noun');
		expect(entry.meanings[0]?.definitions[0]?.text).toContain('illustrate or explain');
		expect(entry.meanings[0]?.definitions[0]?.examples).toEqual(['This is an example sentence.']);
		expect(entry.phonetics).toEqual([{ text: '/ɪɡˈzɑːmpəl/' }]);
		expect(entry.translations).toContainEqual({ language: 'vi', word: 'ví dụ' });
		expect(entry.etymology).toContain('From Latin.');
		expect(entry.source.url).toContain('en.wiktionary.org/wiki/example');
	});

	it('handles non-English sections and multiple parts of speech', () => {
		const entry = parseWikitext('ví dụ', 'vi', 'ví dụ', fixture('example-vi.wikitext'), 1700000000000);

		expect(entry.meanings.map((meaning) => meaning.partOfSpeech)).toEqual(['Danh từ', 'Động từ']);
		expect(entry.meanings[0]?.definitions[0]?.examples).toEqual(['Đây là một ví dụ.']);
		expect(entry.meanings[1]?.definitions[0]?.text).toContain('rõ ràng hơn');
	});

	it('does not invent optional fields for sparse entries', () => {
		const entry = parseWikitext('sparse', 'en', 'sparse', fixture('sparse.wikitext'), 1700000000000);

		expect(entry.phonetics).toEqual([]);
		expect(entry.translations).toEqual([]);
		expect(entry.etymology).toBeUndefined();
		expect(entry.meanings[0]?.definitions).toHaveLength(1);
	});

	it('parses the current Wiktionary template shapes used by a real entry', () => {
		const entry = parseWikitext('example', 'en', 'example', fixture('example-real-en.wikitext'), 1700000000000);

		expect(entry.phonetics).toEqual([{ text: '/ɪɡˈzɑːm.pəl/' }, { text: '/ɪɡˈzam.pəl/' }]);
		expect(entry.meanings[0]?.definitions[1]?.text).toContain('illustrate');
		expect(entry.meanings[0]?.definitions[1]?.examples).toEqual(['Nelson Mandela was an example for many to follow.']);
		expect(entry.synonyms).toContain('exemplar');
		expect(entry.translations).toContainEqual({ language: 'af', word: 'voorbeeld' });
	});

	it('never exposes quote templates in definitions or examples', () => {
		const entry = parseWikitext('hello', 'en', 'hello', '==English==\n===Interjection===\n# A greeting.\n#: {{quote-book|en|passage=Hello there.}}\n#: A clean example.\n#* {{RQ:Example|text=Quoted text.}}', 1700000000000);

		const output = JSON.stringify(entry);
		expect(output).not.toContain('{{quote');
		expect(output).not.toContain('{{RQ:');
		expect(entry.meanings[0]?.definitions[0]?.examples).toEqual(['A clean example.']);
	});

	it('cleans citations, metadata tokens, and wiki links without losing labels', () => {
		const entry = parseWikitext('model', 'en', 'model', '==English==\n===Noun===\n# A [[model#Noun|model]] used as an example.\n#: This is a [[model#Noun]] in use.\n#* 2016, [https://web.archive.org/web/example VOA Learning English] (public domain)\n#* {{RQ:Example|text=Quoted text.}}', 1700000000000);

		const output = JSON.stringify(entry);
		expect(output).not.toContain('2016');
		expect(output).not.toContain('web.archive.org');
		expect(output).not.toContain('VOA Learning English');
		expect(output).not.toContain('en en');
		expect(entry.meanings[0]?.definitions[0]?.text).toBe('A model used as an example.');
		expect(entry.meanings[0]?.definitions[0]?.examples).toEqual(['This is a model in use.']);
	});
});
