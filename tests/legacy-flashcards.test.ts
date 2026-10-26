import { describe, expect, it } from 'vitest';
import { getLegacyFlashcardLanguage, getLegacyFlashcardWord, hasLanguageLabelInFilename, isLegacyFlashcardNote, isMynaryFlashcardNote, languageLabeledNotePath, MAX_LEGACY_FLASHCARD_REFRESHES } from '../src/services/legacy-flashcards';

describe('legacy flashcards', () => {
	it('recognizes old inline cards even when modern side markers are present', () => {
		const note = `---\nmynary-language: en\n---\n\n<!-- mynary:front:start -->\nproject\n<!-- mynary:front:end -->\n\n# flashcards/en_Definition\n\nproject()::\n`;
		expect(isLegacyFlashcardNote(note)).toBe(true);
		expect(getLegacyFlashcardWord(note)).toBe('project');
	});

	it('gets the word from the marked front when an old note has no language or word property', () => {
		const note = `<!-- mynary:front:start -->\n[[desperation]]\n<!-- mynary:front:end -->\n\n# flashcards/vi_Definition`;
		expect(isLegacyFlashcardNote(note)).toBe(true);
		expect(getLegacyFlashcardWord(note)).toBe('desperation');
	});

	it('does not classify a regular modern card as legacy', () => {
		const note = `---\nmynary-language: en\n---\n<!-- mynary:front:start -->\nhello\n<!-- mynary:front:end -->\n<!-- mynary:back:start -->\nhi\n<!-- mynary:back:end -->`;
		expect(isLegacyFlashcardNote(note)).toBe(false);
		expect(isMynaryFlashcardNote(note)).toBe(true);
	});

	it('detects modern cards that still need a language label and infers language from their card id', () => {
		const note = `---\nmynary-vocabulary-id: vi:chao\n---\n<!-- mynary:front:start -->\nchào\n<!-- mynary:front:end -->\n<!-- mynary:back:start -->\nhello\n<!-- mynary:back:end -->`;
		expect(hasLanguageLabelInFilename('Vocabulary/General/chao.md')).toBe(false);
		expect(getLegacyFlashcardLanguage(note, 'Vocabulary/General/chao.md', ['en', 'vi'], 'en')).toBe('vi');
	});

	it('caps each refresh run at ten notes', () => {
		expect(MAX_LEGACY_FLASHCARD_REFRESHES).toBe(10);
	});

	it('adds the language label to the note title path without touching note contents', () => {
		expect(languageLabeledNotePath('Vocabulary/General/hello.md', 'hello', 'en')).toBe('Vocabulary/General/hello [EN].md');
		expect(languageLabeledNotePath('Vocabulary/General/hello [EN]-2.md', 'hello', 'en')).toBe('Vocabulary/General/hello [EN]-2.md');
		expect(languageLabeledNotePath('Vocabulary/General/hello-2.md', 'hello', 'en')).toBe('Vocabulary/General/hello [EN]-2.md');
	});
});
