import { describe, expect, it } from 'vitest';
import { addVocabularyCard, addVocabularyCardsByMeaning, compactVocabularyAnswer, dueVocabularyCards, exportVocabulary, formatVocabularyInterval, mergeSyncedVocabularyCard, normalizeVocabulary, reviewVocabularyCard, setVocabularyStatus, vocabularyQueueCounts, vocabularyRatingInterval } from '../src/services/vocabulary';
import type { DictionaryEntry } from '../src/types';

const entry: DictionaryEntry = {
	word: 'study', language: 'en', phonetics: [], meanings: [{ definitions: [{ text: 'To learn.', examples: [] }] }], translations: [{ language: 'vi', word: 'học' }], synonyms: [], antonyms: [],
	source: { id: 'test', name: 'Test', url: 'https://example.com' }, fetchedAt: 1,
};

describe('vocabulary scheduler', () => {
	it('adds, updates, normalizes, and selects due cards', () => {
		const added = addVocabularyCard([], entry, 'learning', 1_000);
		expect(dueVocabularyCards(added, 1_000)).toHaveLength(1);
		expect(addVocabularyCard(added, entry, 'known', 2_000)).toHaveLength(1);
		expect(dueVocabularyCards(addVocabularyCard(added, entry, 'known', 2_000), 3_000)).toHaveLength(0);
		expect(normalizeVocabulary([{ ...added[0], status: 'invalid' }])[0]?.status).toBe('learning');
	});

	it('schedules ratings and exports JSON, CSV, and Anki text', () => {
		const card = addVocabularyCard([], entry, 'learning', 10_000)[0]!;
		const reviewed = reviewVocabularyCard(card, 'good', 10_000);
		expect(reviewed.dueAt).toBe(10_000 + 86_400_000);
		expect(reviewVocabularyCard(reviewed, 'again', 20_000).dueAt).toBe(20_000 + 600_000);
		expect(exportVocabulary([card], 'csv')).toContain('"study"');
		expect(exportVocabulary([card], 'anki')).toContain('#columns:Word\tAnswer\tDeck');
		expect(exportVocabulary([card], 'anki')).toContain('study\tTo learn.\tGeneral');
		expect(exportVocabulary([card], 'anki')).toContain('#deck column:3');
		const unsafeEntry = { ...entry, meanings: [{ definitions: [{ text: '<img src=x onerror=alert(1)> & value', examples: [] }] }] };
		expect(exportVocabulary([addVocabularyCard([], unsafeEntry)[0]!], 'anki')).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; value');
		const multiMeaning = { ...entry, meanings: [{ definitions: [{ text: 'To learn.', examples: ['I study every day.'] }, { text: 'To study a subject.', examples: ['She studies biology.'] }] }] };
		const splitCards = addVocabularyCardsByMeaning([], multiMeaning);
		expect(splitCards).toHaveLength(2);
		expect(splitCards[0]?.entry.meanings[0]?.definitions[0]?.text).toBe('To study a subject.');
		expect(splitCards[1]?.entry.meanings[0]?.definitions[0]?.text).toBe('To learn.');
		expect(splitCards[0]?.entry.meanings[0]?.definitions[0]?.examples).toEqual(['She studies biology.']);
		expect(splitCards[1]?.entry.meanings[0]?.definitions[0]?.examples).toEqual(['I study every day.']);
		expect(compactVocabularyAnswer(splitCards[1]!)).toBe('To learn.\n\n**Example:** I study every day.');
		expect(splitCards.every((item) => item.entry.translations.length === 0)).toBe(true);
		const childExport = exportVocabulary(splitCards, 'anki');
		expect(childExport).toContain('study (1)\tTo learn.<br><br>I study every day.\tGeneral');
		expect(childExport).toContain('study (2)\tTo study a subject.<br><br>She studies biology.\tGeneral');
		expect(childExport).not.toContain('học');
		expect(JSON.parse(exportVocabulary([card], 'json'))).toHaveLength(1);
	});

	it('marks status while preserving review scheduling', () => {
		const card = addVocabularyCard([], entry)[0]!;
		expect(setVocabularyStatus(card, 'review').status).toBe('review');
		expect(setVocabularyStatus(card, 'known').dueAt).toBe(0);
	});

	it('links a synced note to an existing card and preserves review progress when the note has no progress fields', () => {
		const existing = reviewVocabularyCard(addVocabularyCard([], entry, 'learning', 10_000)[0]!, 'good', 20_000);
		const syncedNote = { ...existing, filePath: 'Vocabulary/General/study.md', entry: { ...entry, meanings: [{ definitions: [{ text: 'Edited from another device.', examples: [] }] }] }, dueAt: 1_000 };
		const result = mergeSyncedVocabularyCard([existing], syncedNote);

		expect(result.changed).toBe(true);
		expect(result.cards).toHaveLength(1);
		expect(result.cards[0]?.filePath).toBe('Vocabulary/General/study.md');
		expect(result.cards[0]?.dueAt).toBe(existing.dueAt);
		expect(result.cards[0]?.repetitions).toBe(existing.repetitions);
		expect(result.cards[0]?.entry.meanings[0]?.definitions[0]?.text).toBe('Edited from another device.');
	});

	it('does not switch a card between duplicate note files in different decks', () => {
		const existing = { ...addVocabularyCard([], entry, 'learning', 10_000)[0]!, filePath: 'Vocabulary/English/study.md' };
		const duplicate = { ...existing, filePath: 'Vocabulary/Imported/study.md' };
		const result = mergeSyncedVocabularyCard([existing], duplicate);

		expect(result.changed).toBe(false);
		expect(result.cards[0]?.filePath).toBe(existing.filePath);
	});

	it('shows accurate next-review intervals and Anki-style daily queues', () => {
		const now = new Date(2025, 0, 2, 12).getTime();
		const newCard = { ...addVocabularyCard([], entry, 'learning', now)[0]!, id: 'new', dueAt: now };
		const learningCard = { ...newCard, id: 'learning', firstReviewedAt: now - 30_000, lastReviewedAt: now - 30_000, dueAt: now - 1 };
		const reviewCard = { ...newCard, id: 'review', status: 'review' as const, firstReviewedAt: now - 86_400_000, lastReviewedAt: now - 86_400_000, repetitions: 1, dueAt: now - 1 };
		expect(formatVocabularyInterval(vocabularyRatingInterval(newCard, 'again', now))).toBe('10m');
		expect(formatVocabularyInterval(vocabularyRatingInterval(newCard, 'good', now))).toBe('1d');
		expect(formatVocabularyInterval(vocabularyRatingInterval(newCard, 'easy', now))).toBe('4d');
		expect(vocabularyQueueCounts([newCard, learningCard, reviewCard], now, 2)).toEqual({ newCards: 1, learningCards: 1, reviewCards: 1 });
	});
});
