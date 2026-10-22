import type { DictionaryEntry } from '../types';

export type VocabularyStatus = 'known' | 'learning' | 'review';
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface VocabularyCard {
	id: string;
	entry: DictionaryEntry;
	status: VocabularyStatus;
	deck: string;
	addedAt: number;
	dueAt: number;
	lastReviewedAt?: number;
	firstReviewedAt?: number;
	intervalDays: number;
	ease: number;
	repetitions: number;
	filePath?: string;
	senseIndex?: number;
	senseCount?: number;
}

export function vocabularyId(entry: Pick<DictionaryEntry, 'word' | 'language'>, senseIndex?: number) {
	const base = `${entry.language.toLocaleLowerCase()}:${entry.word.trim().toLocaleLowerCase()}`;
	return senseIndex && senseIndex > 0 ? `${base}:sense:${senseIndex}` : base;
}

export function normalizeVocabulary(value: unknown): VocabularyCard[] {
	if (!Array.isArray(value)) return [];
	const cards: VocabularyCard[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		if (!item || typeof item !== 'object') continue;
		const card = item as Partial<VocabularyCard>;
		if (!card.entry || typeof card.entry.word !== 'string' || typeof card.entry.language !== 'string') continue;
		const senseIndex = Number.isInteger(card.senseIndex) && (card.senseIndex ?? 0) > 0 ? card.senseIndex : undefined;
		const id = vocabularyId(card.entry, senseIndex);
		if (seen.has(id)) continue;
		seen.add(id);
		cards.push({
			id,
			entry: card.entry,
			status: card.status === 'known' || card.status === 'review' ? card.status : 'learning',
			deck: normalizeDeck(card.deck),
			addedAt: finiteNumber(card.addedAt, Date.now()),
			dueAt: finiteNumber(card.dueAt, Date.now()),
			...(typeof card.lastReviewedAt === 'number' ? { lastReviewedAt: card.lastReviewedAt } : {}),
			...(typeof card.firstReviewedAt === 'number' ? { firstReviewedAt: card.firstReviewedAt } : {}),
				...(typeof card.filePath === 'string' ? { filePath: card.filePath } : {}),
				...(senseIndex ? { senseIndex } : {}),
				...(Number.isInteger(card.senseCount) && (card.senseCount ?? 0) > 1 ? { senseCount: card.senseCount } : {}),
			intervalDays: Math.max(0, finiteNumber(card.intervalDays, 0)),
			ease: Math.max(1.3, finiteNumber(card.ease, 2.5)),
			repetitions: Math.max(0, Math.floor(finiteNumber(card.repetitions, 0))),
		});
	}
	return cards;
}

/** Merge a synced Markdown card into local scheduling data without losing review history. */
export function mergeSyncedVocabularyCard(cards: VocabularyCard[], incoming: VocabularyCard, hasSyncedState = false): { cards: VocabularyCard[]; changed: boolean } {
	const index = cards.findIndex((card) => card.filePath === incoming.filePath && Boolean(incoming.filePath));
	const idIndex = cards.findIndex((card) => card.id === incoming.id);
	if (index < 0 && idIndex >= 0 && cards[idIndex]?.filePath && incoming.filePath && cards[idIndex]?.filePath !== incoming.filePath) return { cards, changed: false };
	const matchIndex = index >= 0 ? index : idIndex;
	if (matchIndex < 0) return { cards: [incoming, ...cards].slice(0, 1000), changed: true };
	const current = cards[matchIndex]!;
	const merged: VocabularyCard = {
		...current,
		...incoming,
		entry: {
			...current.entry,
			...incoming.entry,
			phonetics: incoming.entry.phonetics.length ? incoming.entry.phonetics : current.entry.phonetics,
			translations: incoming.entry.translations.length ? incoming.entry.translations : current.entry.translations,
			synonyms: incoming.entry.synonyms.length ? incoming.entry.synonyms : current.entry.synonyms,
			antonyms: incoming.entry.antonyms.length ? incoming.entry.antonyms : current.entry.antonyms,
			source: incoming.entry.source.id === 'synced-vocabulary-note' ? current.entry.source : incoming.entry.source,
		},
		status: hasSyncedState ? incoming.status : current.status,
		dueAt: hasSyncedState ? incoming.dueAt : current.dueAt,
		lastReviewedAt: hasSyncedState ? incoming.lastReviewedAt : current.lastReviewedAt,
		firstReviewedAt: hasSyncedState ? incoming.firstReviewedAt : current.firstReviewedAt,
		intervalDays: hasSyncedState ? incoming.intervalDays : current.intervalDays,
		ease: hasSyncedState ? incoming.ease : current.ease,
		repetitions: hasSyncedState ? incoming.repetitions : current.repetitions,
	};
	if (JSON.stringify(current) === JSON.stringify(merged)) return { cards, changed: false };
	const next = [...cards];
	next[matchIndex] = merged;
	return { cards: next, changed: true };
}

export function addVocabularyCard(cards: VocabularyCard[], entry: DictionaryEntry, status: VocabularyStatus = 'learning', now = Date.now(), deck = 'General'): VocabularyCard[] {
	const id = vocabularyId(entry);
	const existing = cards.find((card) => card.id === id);
	if (existing) return cards.map((card) => card.id === id ? { ...card, entry, status, deck: normalizeDeck(deck), ...(status === 'known' ? { dueAt: 0 } : {}) } : card);
	return [{ id, entry, status, deck: normalizeDeck(deck), addedAt: now, dueAt: status === 'known' ? 0 : now, intervalDays: 0, ease: 2.5, repetitions: 0 }, ...cards].slice(0, 1000);
}

export function addVocabularyCardsByMeaning(cards: VocabularyCard[], entry: DictionaryEntry, status: VocabularyStatus = 'learning', now = Date.now(), deck = 'General'): VocabularyCard[] {
	const senses = entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => ({ partOfSpeech: meaning.partOfSpeech, labels: meaning.labels, definition })));
	if (senses.length < 2) return addVocabularyCard(cards, { ...entry, translations: [] }, status, now, deck);
	const count = senses.length;
	let next = [...cards];
	senses.forEach((sense, index) => {
		const senseIndex = index + 1;
		const childEntry: DictionaryEntry = { ...entry, translations: [], meanings: [{ ...(sense.partOfSpeech ? { partOfSpeech: sense.partOfSpeech } : {}), ...(sense.labels ? { labels: sense.labels } : {}), definitions: [sense.definition] }] };
		const id = vocabularyId(entry, senseIndex);
		const existing = next.find((card) => card.id === id);
		if (existing) {
			next = next.map((card) => card.id === id ? { ...card, entry: childEntry, deck: normalizeDeck(deck), senseCount: count } : card);
		} else {
			next.unshift({ id, entry: childEntry, status, deck: normalizeDeck(deck), addedAt: now, dueAt: status === 'known' ? 0 : now, intervalDays: 0, ease: 2.5, repetitions: 0, senseIndex, senseCount: count });
		}
	});
	return next.slice(0, 1000);
}

export function setVocabularyStatus(card: VocabularyCard, status: VocabularyStatus): VocabularyCard {
	return { ...card, status, dueAt: status === 'known' ? 0 : Math.min(card.dueAt || Date.now(), Date.now()) };
}

export function reviewVocabularyCard(card: VocabularyCard, rating: ReviewRating, now = Date.now()): VocabularyCard {
	const firstReviewedAt = card.firstReviewedAt ?? (card.lastReviewedAt === undefined ? now : undefined);
	if (rating === 'again') return { ...card, status: 'learning', dueAt: now + 10 * 60_000, intervalDays: 0, repetitions: 0, lastReviewedAt: now, ...(firstReviewedAt === undefined ? {} : { firstReviewedAt }), ease: Math.max(1.3, card.ease - 0.2) };
	const easeDelta = rating === 'easy' ? 0.15 : rating === 'hard' ? -0.15 : 0;
	const ease = Math.max(1.3, card.ease + easeDelta);
	const intervalDays = card.repetitions === 0 ? (rating === 'easy' ? 4 : 1) : card.repetitions === 1 ? (rating === 'easy' ? 4 : 3) : Math.max(1, Math.round(card.intervalDays * ease * (rating === 'hard' ? 0.7 : rating === 'easy' ? 1.3 : 1)));
	return { ...card, status: 'review', ease, intervalDays, repetitions: card.repetitions + 1, lastReviewedAt: now, ...(firstReviewedAt === undefined ? {} : { firstReviewedAt }), dueAt: now + intervalDays * 86_400_000 };
}

export function dueVocabularyCards(cards: VocabularyCard[], now = Date.now(), newCardLimit = 20) {
	const due = cards.filter((card) => card.status !== 'known' && card.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
	const reviews = due.filter((card) => card.repetitions > 0 || Boolean(card.lastReviewedAt));
	const dayStart = new Date(now).setHours(0, 0, 0, 0);
	const introducedToday = cards.filter((card) => card.firstReviewedAt !== undefined && card.firstReviewedAt >= dayStart).length;
	const remainingNew = Math.max(0, newCardLimit - introducedToday);
	const newCards = due.filter((card) => card.repetitions === 0 && !card.lastReviewedAt).slice(0, remainingNew);
	return [...reviews, ...newCards];
}

export interface VocabularyQueueCounts { newCards: number; learningCards: number; reviewCards: number; }

export function vocabularyQueueCounts(cards: VocabularyCard[], now = Date.now(), newCardLimit = 20): VocabularyQueueCounts {
	const dayStart = new Date(now).setHours(0, 0, 0, 0);
	const tomorrow = dayStart + 86_400_000;
	const introducedToday = cards.filter((card) => card.firstReviewedAt !== undefined && card.firstReviewedAt >= dayStart).length;
	const remainingNewLimit = Math.max(0, newCardLimit - introducedToday);
	const unintroduced = cards.filter((card) => card.status !== 'known' && card.repetitions === 0 && card.lastReviewedAt === undefined && card.dueAt < tomorrow);
	const newCards = Math.min(unintroduced.length, remainingNewLimit);
	const learningCards = cards.filter((card) => card.status === 'learning' && (card.firstReviewedAt !== undefined || card.lastReviewedAt !== undefined) && card.dueAt < tomorrow).length;
	const reviewCards = cards.filter((card) => card.status === 'review' && card.dueAt < tomorrow).length;
	return { newCards, learningCards, reviewCards };
}

export function vocabularyRatingInterval(card: VocabularyCard, rating: ReviewRating, now = Date.now()) {
	return Math.max(0, reviewVocabularyCard(card, rating, now).dueAt - now);
}

export function compactVocabularyAnswer(card: VocabularyCard) {
	const definition = card.entry.meanings.flatMap((meaning) => meaning.definitions)[0];
	if (!definition) return '';
	return [definition.text, ...(definition.examples ?? []).map((example) => `**Example:** ${example}`)].filter(Boolean).join('\n\n');
}

export function formatVocabularyInterval(durationMs: number) {
	const minutes = Math.max(1, Math.round(durationMs / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = durationMs / 86_400_000;
	if (days < 30) return `${Math.max(1, Math.round(days))}d`;
	if (days < 365) return `${compactInterval(days / 30)}mo`;
	return `${compactInterval(days / 365)}y`;
}

export function exportVocabulary(cards: VocabularyCard[], format: 'json' | 'csv' | 'anki') {
	if (format === 'json') return JSON.stringify(cards.map(exportRow), null, 2);
	const rows = cards.map((card) => [card.entry.word, card.entry.language, card.entry.translations.map((translation) => translation.word).join('; '), card.entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.text)).join('; '), card.status, card.deck]);
	if (format === 'anki') {
		const ankiRows = cards.flatMap((card) => {
			const definitions = card.entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.text)).filter(Boolean);
			const word = card.senseCount && card.senseCount > 1 ? `${card.entry.word} (${card.senseIndex})` : card.entry.word;
			return [[word, [...definitions, ...card.entry.meanings.flatMap((meaning) => meaning.definitions.flatMap((definition) => definition.examples ?? []))].filter(Boolean).map(escapeField).join('<br><br>'), card.deck]];
		});
		return ['#separator:Tab', '#html:true', '#columns:Word\tAnswer\tDeck', '#deck column:3', ...ankiRows.map((row) => `${escapeField(row[0] ?? '')}\t${row[1] ?? ''}\t${escapeField(row[2] ?? '')}`)].join('\n');
	}
	return [['word', 'language', 'translation', 'definition', 'status', 'deck'], ...rows].map((row) => row.map((field) => `"${field.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

function exportRow(card: VocabularyCard) {
	return { word: card.entry.word, language: card.entry.language, translations: card.entry.translations, definitions: card.entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.text)), status: card.status, deck: card.deck, addedAt: card.addedAt, dueAt: card.dueAt, intervalDays: card.intervalDays, repetitions: card.repetitions, ...(card.firstReviewedAt === undefined ? {} : { firstReviewedAt: card.firstReviewedAt }) };
}

function escapeField(value: string) { return value.replace(/[\t\r\n]/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function finiteNumber(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function compactInterval(value: number) { return Number(value.toFixed(1)).toString(); }
function normalizeDeck(value: unknown) {
	if (typeof value !== 'string' || !value.trim()) return 'General';
	const parts = value.trim().split('/').map((part) => part.trim()).filter((part) => part && part !== '.' && part !== '..' && !/[\\:*?"<>|]/u.test(part));
	return parts.join('/') || 'General';
}
