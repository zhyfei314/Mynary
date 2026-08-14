import type { TemplateDefinition } from './types';

export interface LanguageOption { code: string; name: string; }
export interface DictionarySettings {
	defaultLanguage: string;
	languages: LanguageOption[];
	noteFolder: string;
	filenameTemplate: string;
	cacheTtlDays: number;
	maxCacheEntries: number;
	defaultTemplateId: string;
	templates: TemplateDefinition[];
	existingNoteBehavior: 'ask' | 'overwrite' | 'update-section';
}

export const FLASHCARD_TEMPLATE = `# flashcards/{{language}}_Definition

{{Title}}()::

{{#if IPA}}### Pronunciation
{{IPA}}
{{/if}}
### Usage

**1. Meaning**

{{meaningsMarkdown}}

{{#if translationsMarkdown}}**2. Translation**

{{translationsMarkdown}}

{{/if}}{{#if examplesMarkdown}}**3. Examples**

{{examplesMarkdown}}

{{/if}}{{#if synonyms}}**4. Related words**

{{synonyms}}

{{/if}}**5. My example**

- 

{{#if sourceUrl}}[Source]({{sourceUrl}})
{{/if}}`;

export const LANGUAGES: LanguageOption[] = [
	{ code: 'en', name: 'English' }, { code: 'vi', name: 'Vietnamese' }, { code: 'ja', name: 'Japanese' },
	{ code: 'ko', name: 'Korean' }, { code: 'zh', name: 'Chinese' }, { code: 'fr', name: 'French' },
	{ code: 'de', name: 'German' }, { code: 'es', name: 'Spanish' }, { code: 'it', name: 'Italian' }, { code: 'ru', name: 'Russian' },
];

export const DEFAULT_TEMPLATES: TemplateDefinition[] = [
	{ id: 'basic', name: 'Basic vocabulary', content: '---\nword: {{word}}\nlanguage: {{language}}\nsource: {{source}}\nsource_url: {{sourceUrl}}\nlookup_date: {{lookupDate}}\n---\n\n# {{word}}\n\n{{meaningsMarkdown}}\n\n{{#if examplesMarkdown}}## Examples\n{{examplesMarkdown}}\n{{/if}}' },
	{ id: 'detailed', name: 'Detailed vocabulary', content: '---\nword: {{word}}\nlanguage: {{language}}\n---\n\n# {{word}}\n\n{{#if IPA}}**IPA:** {{IPA}}\n{{/if}}**Part of speech:** {{partOfSpeech}}\n\n## Meanings\n{{meaningsMarkdown}}\n\n{{#if translationsMarkdown}}## Translations\n{{translationsMarkdown}}\n{{/if}}{{#if synonyms}}## Synonyms\n{{synonyms}}\n{{/if}}' },
	{ id: 'learning', name: 'Language-learning vocabulary', content: '---\nword: {{word}}\nlanguage: {{language}}\n---\n\n# {{word}}\n\n## Meanings\n{{meaningsMarkdown}}\n\n{{#if IPA}}## Pronunciation\n{{IPA}}\n{{/if}}{{#if translationsMarkdown}}## Translations\n{{translationsMarkdown}}\n{{/if}}{{#if examplesMarkdown}}## Source examples\n{{examplesMarkdown}}\n{{/if}}\n## My example\n\n## Notes\n' },
];

const LEGACY_TEMPLATE_CONTENT: Record<string, string> = {
	basic: `---
word: {{word}}
language: {{language}}
source: {{source}}
source_url: {{sourceUrl}}
lookup_date: {{lookupDate}}
---

# {{word}}

{{definitionsMarkdown}}

## Examples
{{examplesMarkdown}}`,
	detailed: `---
word: {{word}}
language: {{language}}
ipa: {{IPA}}
part_of_speech: {{partOfSpeech}}
---

# {{word}}

**IPA:** {{IPA}}

**Part of speech:** {{partOfSpeech}}

## Definitions
{{definitionsMarkdown}}

## Translations
{{translationsMarkdown}}

## Synonyms
{{synonyms}}`,
	learning: `---
word: {{word}}
language: {{language}}
---

# {{word}}

> {{definition}}

## My example

## Source examples
{{examplesMarkdown}}

## Notes`,
	flashcard: `# flashcards/{{language}}_Definition

{{Title}}()::

### Pronunciation
{{IPA}}

### Usage

**1. Context**
{{definition}}

**2. Collocations/Phrase**
{{examplesMarkdown}}

**3. Word Family**
{{synonyms}}

**4. Example**
{{example}}`,
};

/** Updates only untouched templates from versions that predate the current defaults. */
export function migrateTemplates(templates: TemplateDefinition[]): boolean {
	let changed = false;
	const currentById = new Map(DEFAULT_TEMPLATES.map((template) => [template.id, template]));

	for (const template of templates) {
		const key = currentById.has(template.id) ? template.id : template.name === 'Flashcard' ? 'flashcard' : undefined;
		if (!key || template.content.trim() !== LEGACY_TEMPLATE_CONTENT[key]?.trim()) continue;

		const current = key === 'flashcard' ? FLASHCARD_TEMPLATE : currentById.get(key)?.content;
		if (current && template.content !== current) {
			template.content = current;
			changed = true;
		}
	}

	return changed;
}

export const DEFAULT_SETTINGS: DictionarySettings = { defaultLanguage: 'en', languages: LANGUAGES, noteFolder: '', filenameTemplate: '{{word}}', cacheTtlDays: 7, maxCacheEntries: 100, defaultTemplateId: 'basic', templates: DEFAULT_TEMPLATES, existingNoteBehavior: 'ask' };

export function normalizeSettings(raw: unknown): DictionarySettings {
	const data = isRecord(raw) ? raw : {};
	const languages = normalizeLanguages(data.languages);
	const templates = normalizeTemplates(data.templates);
	const defaultLanguage = typeof data.defaultLanguage === 'string' && languages.some((language) => language.code === data.defaultLanguage) ? data.defaultLanguage : languages.find((language) => language.code === 'en')?.code ?? languages[0]?.code ?? 'en';
	const defaultTemplateId = typeof data.defaultTemplateId === 'string' && templates.some((template) => template.id === data.defaultTemplateId) ? data.defaultTemplateId : templates[0]?.id ?? 'basic';
	const existingNoteBehavior = data.existingNoteBehavior === 'overwrite' || data.existingNoteBehavior === 'update-section' ? data.existingNoteBehavior : 'ask';

	return {
		defaultLanguage,
		languages,
		noteFolder: typeof data.noteFolder === 'string' ? data.noteFolder : '',
		filenameTemplate: typeof data.filenameTemplate === 'string' && data.filenameTemplate.trim() ? data.filenameTemplate : '{{word}}',
		cacheTtlDays: positiveNumber(data.cacheTtlDays, DEFAULT_SETTINGS.cacheTtlDays),
		maxCacheEntries: Math.floor(positiveNumber(data.maxCacheEntries, DEFAULT_SETTINGS.maxCacheEntries)),
		defaultTemplateId,
		templates,
		existingNoteBehavior,
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeLanguages(value: unknown): LanguageOption[] {
	if (!Array.isArray(value)) return LANGUAGES.map((language) => ({ ...language }));
	const seen = new Set<string>();
	const languages = value.filter(isRecord).map((item) => ({ code: typeof item.code === 'string' ? item.code.trim().toLowerCase() : '', name: typeof item.name === 'string' ? item.name.trim() : '' })).filter((item) => item.code && item.name).filter((item) => {
		if (seen.has(item.code)) return false;
		seen.add(item.code);
		return true;
	});
	return languages.length ? languages : LANGUAGES.map((language) => ({ ...language }));
}

function normalizeTemplates(value: unknown): TemplateDefinition[] {
	if (!Array.isArray(value)) return DEFAULT_TEMPLATES.map((template) => ({ ...template }));
	const seen = new Set<string>();
	const templates = value.filter(isRecord).map((item) => ({ id: typeof item.id === 'string' ? item.id.trim() : '', name: typeof item.name === 'string' ? item.name.trim() || 'Untitled template' : 'Untitled template', content: typeof item.content === 'string' ? item.content : '' })).filter((item) => item.id && item.content.trim()).filter((item) => {
		if (seen.has(item.id)) return false;
		seen.add(item.id);
		return true;
	});
	return templates.length ? templates : DEFAULT_TEMPLATES.map((template) => ({ ...template }));
}

function positiveNumber(value: unknown, fallback: number) {
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}
