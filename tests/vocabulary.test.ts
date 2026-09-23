import { describe, expect, it } from 'vitest';
import { addVocabularyCard, dueVocabularyCards, exportVocabulary, formatVocabularyInterval, normalizeVocabulary, reviewVocabularyCard, setVocabularyStatus, vocabularyQueueCounts, vocabularyRatingInterval } from '../src/services/vocabulary';
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
		expect(exportVocabulary([card], 'anki')).toContain('study\thọc<br><br>To learn.\ten');
		expect(JSON.parse(exportVocabulary([card], 'json'))).toHaveLength(1);
	});

	it('marks status while preserving review scheduling', () => {
		const card = addVocabularyCard([], entry)[0]!;
		expect(setVocabularyStatus(card, 'review').status).toBe('review');
		expect(setVocabularyStatus(card, 'known').dueAt).toBe(0);
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
