import { describe, expect, it } from 'vitest';
import { renderTemplate } from '../src/templates/renderer';
import { MANAGED_SECTION_END, MANAGED_SECTION_START, updateManagedSection } from '../src/templates/sections';
import { DEFAULT_TEMPLATES, FLASHCARD_TEMPLATE, migrateTemplates } from '../src/settings';
import { DictionaryEntry } from '../src/types';

const entry: DictionaryEntry = {
	word: 'example', language: 'en', phonetics: [{ text: '/ɪɡˈzɑːmpəl/' }],
	meanings: [{ partOfSpeech: 'Noun', definitions: [{ text: 'A representative instance.', examples: ['This is an example.'] }] }],
	translations: [{ language: 'vi', word: 'ví dụ' }], synonyms: ['sample'], antonyms: ['counterexample'], etymology: 'From Latin.',
	source: { id: 'wiktionary', name: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/example' }, fetchedAt: Date.parse('2023-11-14T00:00:00Z'),
};

describe('template renderer', () => {
	it('renders scalar, list and markdown variables', () => {
		const output = renderTemplate(entry, '# {{word}}\n{{IPA}}\n{{partOfSpeech}}\n{{definition}}\n{{definitionsMarkdown}}\n{{examplesMarkdown}}\n{{translationsMarkdown}}\n{{sourceUrl}}\n{{lookupDate}}');

		expect(output).toContain('# example');
		expect(output).toContain('/ɪɡˈzɑːmpəl/');
		expect(output).toContain('- A representative instance.');
		expect(output).toContain('- This is an example.');
		expect(output).toContain('- vi: ví dụ');
		expect(output).toContain('2023-11-14');
	});

	it('preserves Wiktionary links in generated Markdown', () => {
		const linked = {
			...entry,
			meanings: [{
				partOfSpeech: 'Verb',
				definitions: [{
					text: 'third-person singular simple present indicative of destroys',
					examples: [],
					links: [{ text: 'destroys', target: 'destroy', url: 'https://en.wiktionary.org/wiki/destroy' }],
				}],
			}],
		};

		expect(renderTemplate(linked, '{{definition}}\n{{definitionsMarkdown}}')).toContain('[[destroy|destroys]]');
	});

	it('replaces unknown variables with an empty string', () => {
		expect(renderTemplate(entry, '{{missing}}|{{word}}')).toBe('|example');
	});

	it('supports case-insensitive aliases used by custom templates', () => {
		expect(renderTemplate(entry, '{{Title}}|{{source_url}}|{{lookup_date}}|{{definitions_markdown}}')).toContain('example|https://en.wiktionary.org/wiki/example|2023-11-14|- A representative instance.');
	});

	it('adds numbered etymology headings to grouped definitions', () => {
		const grouped = { ...entry, meanings: [
			{ partOfSpeech: 'Noun', etymology: 'Etymology 1', definitions: [{ text: 'Affection.', examples: [] }] },
			{ partOfSpeech: 'Noun', etymology: 'Etymology 2', definitions: [{ text: 'A score of zero.', examples: [] }] },
		] };
		const output = renderTemplate(grouped, '{{meaningsMarkdown}}');

		expect(output).toContain('### Noun — Etymology 1');
		expect(output).toContain('### Noun — Etymology 2');
	});

	it('groups translations by sense instead of repeating the sense for every word', () => {
		const grouped = {
			...entry,
			translations: [
				{ languageCode: 'vi', languageName: 'Vietnamese', word: 'tình yêu', sense: 'strong affection' },
				{ languageCode: 'ja', languageName: 'Japanese', word: '愛', sense: 'strong affection' },
				{ languageCode: 'fr', languageName: 'French', word: 'aimer', sense: 'to have strong affection' },
			],
		};
		const output = renderTemplate(grouped, '{{translationsMarkdown}}');

		expect(output).toBe('- **strong affection**\n  - Vietnamese: tình yêu\n  - Japanese: 愛\n\n- **to have strong affection**\n  - French: aimer');
		expect(output).not.toContain('- strong affection:');
	});

	it('updates only the managed note section and preserves user content', () => {
		const existing = `# My notes\n\n${MANAGED_SECTION_START}\nold result\n${MANAGED_SECTION_END}\n\n## Personal notes\nKeep this.`;
		const output = updateManagedSection(existing, '# example\n\nnew result');

		expect(output).toContain('# My notes');
		expect(output).toContain('new result');
		expect(output).toContain('## Personal notes\nKeep this.');
		expect(output).not.toContain('old result');
	});

	it('appends a managed section when an existing note has no marker', () => {
		const output = updateManagedSection('# Existing note\n', 'new result');

		expect(output).toContain('# Existing note');
		expect(output).toContain(`${MANAGED_SECTION_START}\nnew result\n${MANAGED_SECTION_END}`);
	});

	it('renders conditional blocks only when values are present', () => {
		const output = renderTemplate(entry, '{{#if IPA}}IPA: {{IPA}}{{/if}}|{{#if translationsMarkdown}}T: {{translationsMarkdown}}{{/if}}|{{#if missing}}hidden{{/if}}');

		expect(output).toContain('IPA: /ɪɡˈzɑːmpəl/');
		expect(output).toContain('T: - vi: ví dụ');
		expect(output).not.toContain('hidden');
	});

	it('supports nested conditional blocks', () => {
		expect(renderTemplate(entry, '{{#if meaningsMarkdown}}A{{#if IPA}}B{{/if}}{{/if}}')).toBe('AB');
		expect(renderTemplate({ ...entry, phonetics: [] }, '{{#if meaningsMarkdown}}A{{#if IPA}}B{{/if}}{{/if}}')).toBe('A');
	});

	it('keeps the language-learning template compact for sparse entries', () => {
		const learning = DEFAULT_TEMPLATES.find((template) => template.id === 'learning');
		if (!learning) throw new Error('Learning template is missing.');
		const output = renderTemplate({ ...entry, phonetics: [], translations: [], meanings: [{ partOfSpeech: 'Noun', definitions: [{ text: 'A definition.', examples: [] }] }] }, learning.content);

		expect(output).toContain('## Meanings');
		expect(output).not.toContain('## Pronunciation');
		expect(output).not.toContain('## Translations');
		expect(output).not.toContain('## Source examples');
	});

	it('migrates untouched legacy templates but preserves custom edits', () => {
		const templates = [
			{ id: 'flashcard-old', name: 'Flashcard', content: `# flashcards/{{language}}_Definition\n\n{{Title}}()::\n\n### Pronunciation\n{{IPA}}\n\n### Usage\n\n**1. Context**\n{{definition}}\n\n**2. Collocations/Phrase**\n{{examplesMarkdown}}\n\n**3. Word Family**\n{{synonyms}}\n\n**4. Example**\n{{example}}` },
			{ id: 'flashcard-custom', name: 'Flashcard', content: 'custom {{word}}' },
		];

		expect(migrateTemplates(templates)).toBe(true);
		expect(templates[0]!.content).toBe(FLASHCARD_TEMPLATE);
		expect(templates[1]!.content).toBe('custom {{word}}');
	});
});
