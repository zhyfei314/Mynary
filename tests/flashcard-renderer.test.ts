import { describe, expect, it } from 'vitest';
import { prepareFlashcardNote } from '../src/templates/flashcard-renderer';
import type { DictionaryEntry } from '../src/types';

const entry: DictionaryEntry = {
	word: 'beyond', language: 'en', phonetics: [],
	meanings: [{ partOfSpeech: 'Preposition', definitions: [{ text: 'Farther than.', examples: [] }] }],
	translations: [{ word: 'vượt quá', languageCode: 'vi' }], synonyms: [], antonyms: [],
	source: { id: 'test', name: 'Test', url: 'https://example.com' }, fetchedAt: 0,
};

describe('flashcard template rendering', () => {
	it('uses custom marker aliases and renders only the defined front and back', () => {
		const template = `---\nmynary-language: {{language}}\n---\n\n<!-- mynary:question:begin -->\n{{word}}\n<!-- mynary:prompt:close -->\n\n<!-- mynary:answer:open -->\n{{meaningsMarkdown}}\n<!-- mynary:reverse:stop -->`;
		const rendered = prepareFlashcardNote(entry, template);
		expect(rendered.front).toBe('beyond');
		expect(rendered.back).toContain('Farther than.');
		expect(rendered.back).not.toContain('mynary:front');
		expect(rendered.content).not.toContain('## Answer');
	});

	it('adds safe front/back sections and definition fallback for templates without markers', () => {
		const rendered = prepareFlashcardNote(entry, '# {{word}}\n\n{{definitionsMarkdown}}');
		expect(rendered.front).toBe('beyond');
		expect(rendered.back).toContain('Farther than.');
		expect(rendered.content).toContain('<!-- mynary:front:start -->');
		expect(rendered.content).toContain('<!-- mynary:back:start -->');
	});
});
