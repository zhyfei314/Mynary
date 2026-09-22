import type { TemplateDefinition } from './types';
import { WIKTIONARY_LANGUAGES } from './providers/language-registry';

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
	ttsEnabled: boolean;
	ttsAutoGenerate: boolean;
	ttsRuntime: 'web' | 'server';
	supertonicEndpoint: string;
	supertonicVoice: string;
	supertonicSteps: number;
	supertonicSpeed: number;
	offlineDictionaryEnabled?: boolean;
	mtranServerEnabled: boolean;
	mtranServerEndpoint: string;
	mtranServerToken: string;
	mtranServerTimeoutMs: number;
	mtranSourceLanguage: 'current' | 'auto';
	mtranTargetLanguage: string;
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

export const LANGUAGES: LanguageOption[] = WIKTIONARY_LANGUAGES.map(({ code, displayName }) => ({ code, name: displayName }));

// MTranServer uses this major-language set for its downloadable translation models.
export const MTRAN_LANGUAGE_OPTIONS: LanguageOption[] = [
	{ code: 'ar', name: 'Arabic' }, { code: 'bg', name: 'Bulgarian' }, { code: 'cs', name: 'Czech' }, { code: 'da', name: 'Danish' }, { code: 'de', name: 'German' }, { code: 'el', name: 'Greek' },
	{ code: 'en', name: 'English' }, { code: 'es', name: 'Spanish' }, { code: 'fi', name: 'Finnish' }, { code: 'fr', name: 'French' }, { code: 'he', name: 'Hebrew' }, { code: 'hi', name: 'Hindi' },
	{ code: 'hu', name: 'Hungarian' }, { code: 'id', name: 'Indonesian' }, { code: 'it', name: 'Italian' }, { code: 'ja', name: 'Japanese' }, { code: 'ko', name: 'Korean' }, { code: 'nl', name: 'Dutch' },
	{ code: 'no', name: 'Norwegian' }, { code: 'pl', name: 'Polish' }, { code: 'pt', name: 'Portuguese' }, { code: 'ro', name: 'Romanian' }, { code: 'ru', name: 'Russian' }, { code: 'sk', name: 'Slovak' },
	{ code: 'sv', name: 'Swedish' }, { code: 'th', name: 'Thai' }, { code: 'tr', name: 'Turkish' }, { code: 'uk', name: 'Ukrainian' }, { code: 'vi', name: 'Vietnamese' }, { code: 'zh', name: 'Chinese' },
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

export const DEFAULT_SETTINGS: DictionarySettings = { defaultLanguage: 'en', languages: LANGUAGES, noteFolder: '', filenameTemplate: '{{word}}', cacheTtlDays: 7, maxCacheEntries: 100, defaultTemplateId: 'basic', templates: DEFAULT_TEMPLATES, existingNoteBehavior: 'ask', ttsEnabled: false, ttsAutoGenerate: false, ttsRuntime: 'web', supertonicEndpoint: 'http://127.0.0.1:7788/v1/tts', supertonicVoice: 'M1', supertonicSteps: 8, supertonicSpeed: 1.05, offlineDictionaryEnabled: true, mtranServerEnabled: false, mtranServerEndpoint: 'http://127.0.0.1:8989', mtranServerToken: '', mtranServerTimeoutMs: 15000, mtranSourceLanguage: 'current', mtranTargetLanguage: 'en' };

export function normalizeSettings(raw: unknown): DictionarySettings {
	const data = isRecord(raw) ? raw : {};
	const languages = normalizeLanguages(data.languages);
	const templates = normalizeTemplates(data.templates);
	const defaultLanguage = typeof data.defaultLanguage === 'string' && languages.some((language) => language.code === data.defaultLanguage) ? data.defaultLanguage : languages.find((language) => language.code === 'en')?.code ?? languages[0]?.code ?? 'en';
	const defaultTemplateId = typeof data.defaultTemplateId === 'string' && templates.some((template) => template.id === data.defaultTemplateId) ? data.defaultTemplateId : templates[0]?.id ?? 'basic';
	const existingNoteBehavior = data.existingNoteBehavior === 'overwrite' || data.existingNoteBehavior === 'update-section' ? data.existingNoteBehavior : 'ask';
	const requestedMtranTarget = typeof data.mtranTargetLanguage === 'string' ? data.mtranTargetLanguage.trim().toLowerCase() : '';
	const mtranTargetLanguage = MTRAN_LANGUAGE_OPTIONS.some((language) => language.code === requestedMtranTarget) ? requestedMtranTarget : DEFAULT_SETTINGS.mtranTargetLanguage;
	const requestedMtranTimeout = typeof data.mtranServerTimeoutMs === 'number' && Number.isFinite(data.mtranServerTimeoutMs) && data.mtranServerTimeoutMs > 0 ? data.mtranServerTimeoutMs : DEFAULT_SETTINGS.mtranServerTimeoutMs;

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
		ttsEnabled: isEnabledSetting(data.ttsEnabled),
		ttsAutoGenerate: isEnabledSetting(data.ttsAutoGenerate),
		ttsRuntime: data.ttsRuntime === 'server' ? 'server' : 'web',
		supertonicEndpoint: typeof data.supertonicEndpoint === 'string' && data.supertonicEndpoint.trim() ? data.supertonicEndpoint.trim() : DEFAULT_SETTINGS.supertonicEndpoint,
		supertonicVoice: typeof data.supertonicVoice === 'string' && data.supertonicVoice.trim() ? data.supertonicVoice.trim() : DEFAULT_SETTINGS.supertonicVoice,
		supertonicSteps: Math.min(16, Math.max(4, Math.floor(positiveNumber(data.supertonicSteps, DEFAULT_SETTINGS.supertonicSteps)))),
		supertonicSpeed: Math.min(2, Math.max(0.7, positiveNumber(data.supertonicSpeed, DEFAULT_SETTINGS.supertonicSpeed))),
		offlineDictionaryEnabled: data.offlineDictionaryEnabled !== false,
		mtranServerEnabled: data.mtranServerEnabled === true,
		mtranServerEndpoint: typeof data.mtranServerEndpoint === 'string' && data.mtranServerEndpoint.trim() ? data.mtranServerEndpoint.trim().replace(/\/+$/u, '') : DEFAULT_SETTINGS.mtranServerEndpoint,
		mtranServerToken: typeof data.mtranServerToken === 'string' ? data.mtranServerToken : '',
		mtranServerTimeoutMs: Math.min(120000, Math.max(1000, Math.floor(requestedMtranTimeout))),
		mtranSourceLanguage: data.mtranSourceLanguage === 'auto' ? 'auto' : 'current',
		mtranTargetLanguage,
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
	if (languages.length && isLegacyDefaultLanguageList(languages)) return LANGUAGES.map((language) => ({ ...language }));
	return languages.length ? languages : LANGUAGES.map((language) => ({ ...language }));
}

function isLegacyDefaultLanguageList(languages: LanguageOption[]) {
	const legacyCodes = ['en', 'vi', 'ja', 'ko', 'zh', 'fr', 'de', 'es', 'it', 'ru'];
	return languages.length === legacyCodes.length && languages.every((language, index) => language.code === legacyCodes[index]);
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

function isEnabledSetting(value: unknown) {
	return value === true || (typeof value === 'string' && ['true', 'enabled', 'on'].includes(value.toLocaleLowerCase()));
}
