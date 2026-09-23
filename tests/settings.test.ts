import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATES, LANGUAGES, normalizeSettings } from '../src/settings';

describe('settings normalization', () => {
	it('falls back safely when persisted settings are malformed', () => {
		const settings = normalizeSettings({ defaultLanguage: 'missing', languages: 'en', templates: [{ id: 'basic', name: 'Broken' }], cacheTtlDays: -1, maxCacheEntries: 'many', existingNoteBehavior: 'invalid' });

		expect(settings.defaultLanguage).toBe('en');
		expect(settings.languages).toEqual(LANGUAGES);
		expect(settings.templates).toEqual(DEFAULT_TEMPLATES);
		expect(settings.cacheTtlDays).toBe(7);
		expect(settings.maxCacheEntries).toBe(100);
		expect(settings.existingNoteBehavior).toBe('ask');
	});

	it('preserves valid custom settings and removes duplicate ids', () => {
		const settings = normalizeSettings({
			defaultLanguage: 'vi', languages: [{ code: 'vi', name: 'Vietnamese' }, { code: 'vi', name: 'Duplicate' }],
			noteFolder: 'Vocabulary', filenameTemplate: '{{language}}/{{word}}', cacheTtlDays: 14, maxCacheEntries: 25,
			defaultTemplateId: 'custom', templates: [{ id: 'custom', name: 'Custom', content: '# {{word}}' }, { id: 'custom', name: 'Duplicate', content: 'bad' }], existingNoteBehavior: 'update-section',
		});

		expect(settings.defaultLanguage).toBe('vi');
		expect(settings.languages).toEqual([{ code: 'vi', name: 'Vietnamese' }]);
		expect(settings.templates.find((template) => template.id === 'custom')).toEqual({ id: 'custom', name: 'Custom', content: '# {{word}}' });
		expect(settings.templates.some((template) => template.type === 'flashcard')).toBe(true);
		expect(settings.defaultTemplateId).toBe('custom');
		expect(settings.existingNoteBehavior).toBe('update-section');
	});

	it('migrates the previous default language list to the expanded registry', () => {
		const settings = normalizeSettings({ languages: [
			{ code: 'en', name: 'English' }, { code: 'vi', name: 'Vietnamese' }, { code: 'ja', name: 'Japanese' },
			{ code: 'ko', name: 'Korean' }, { code: 'zh', name: 'Chinese' }, { code: 'fr', name: 'French' },
			{ code: 'de', name: 'German' }, { code: 'es', name: 'Spanish' }, { code: 'it', name: 'Italian' }, { code: 'ru', name: 'Russian' },
		] });

		expect(settings.languages).toEqual(LANGUAGES);
	});

	it('accepts string booleans written by legacy settings controls', () => {
		const settings = normalizeSettings({ ttsEnabled: 'true', ttsAutoGenerate: 'true', ttsRuntime: 'server' });

		expect(settings.ttsEnabled).toBe(true);
		expect(settings.ttsAutoGenerate).toBe(true);
		expect(settings.ttsRuntime).toBe('server');
	});

	it('migrates legacy Flashcard templates into the flashcard template group', () => {
		const settings = normalizeSettings({ templates: [
			{ id: 'basic', name: 'Basic', content: '# {{word}}' },
			{ id: 'flashcard-custom', name: 'Flashcard', content: '{{word}}()::\n{{definition}}' },
		] });

		expect(settings.templates.find((template) => template.id === 'flashcard-custom')?.type).toBe('flashcard');
		expect(settings.defaultVocabularyTemplateId).toBe('flashcard-basic');
	});

	it('keeps the complete built-in card template and replaces an incomplete marker default', () => {
		const settings = normalizeSettings({
			defaultVocabularyTemplateId: 'flashcard-legacy',
			templates: [{ id: 'flashcard-legacy', name: 'Flashcard', type: 'flashcard', content: '# {{word}}\n<!-- mynary:front:start -->' }],
		});
		const builtIn = settings.templates.find((template) => template.id === 'flashcard-basic');
		expect(settings.defaultVocabularyTemplateId).toBe('flashcard-basic');
		expect(builtIn?.content).toContain('<!-- mynary:front:start -->');
		expect(builtIn?.content).toContain('<!-- mynary:front:end -->');
		expect(builtIn?.content).toContain('<!-- mynary:back:start -->');
		expect(builtIn?.content).toContain('<!-- mynary:back:end -->');
	});
});
