import { describe, expect, it } from 'vitest';
import { getLanguageHeadingAliases, getSectionAliases, WIKTIONARY_LANGUAGES } from '../src/providers/language-registry';
import { LANGUAGES } from '../src/settings';

describe('Wiktionary language registry', () => {
	it('uses one registry for settings and parser language headings', () => {
		expect(LANGUAGES.map((language) => language.code)).toEqual(WIKTIONARY_LANGUAGES.map((language) => language.code));
		expect(new Set(LANGUAGES.map((language) => language.code)).size).toBe(LANGUAGES.length);
	});

	it.each(WIKTIONARY_LANGUAGES)('has aliases for the %s Wiktionary section', (language) => {
		const aliases = getLanguageHeadingAliases(language.code);
		expect(aliases).toContain(language.displayName);
		expect(aliases).toContain(language.nativeName);
		expect(aliases.length).toBeGreaterThan(0);
	});

	it.each(WIKTIONARY_LANGUAGES)('has complete metadata for %s', (language) => {
		expect(language.code).toMatch(/^[a-z]{2}$/);
		expect(language.displayName).toBeTruthy();
		expect(language.nativeName).toBeTruthy();
		expect(language.wiktionarySubdomain).toBe(`${language.code}.wiktionary.org`);
		expect(language.languageHeadingAliases.length).toBeGreaterThan(0);
		expect(language.partOfSpeechAliases.length).toBeGreaterThan(0);
		expect(language.translationAliases.length).toBeGreaterThan(0);
		expect(language.pronunciationAliases.length).toBeGreaterThan(0);
		expect(getSectionAliases(language.code, 'partOfSpeech')).toEqual(language.partOfSpeechAliases);
		expect(getSectionAliases(language.code, 'translations')).toEqual(language.translationAliases);
		expect(getSectionAliases(language.code, 'pronunciation')).toEqual(language.pronunciationAliases);
	});
});
