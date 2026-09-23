import { ItemView, MarkdownRenderer, WorkspaceLeaf } from 'obsidian';
import type { DictionaryEntry } from '../types';
import type { ReviewRating, VocabularyCard, VocabularyStatus } from '../services/vocabulary';
import { dueVocabularyCards, formatVocabularyInterval, vocabularyQueueCounts, vocabularyRatingInterval } from '../services/vocabulary';

export const VIEW_TYPE_VOCABULARY = 'mynary-vocabulary-view';

export interface VocabularyController {
	getVocabulary(): VocabularyCard[];
	getVocabularyDecks(): string[];
	getNewCardsPerDay(): number;
	createVocabularyDeck(): Promise<void>;
	moveVocabularyCard(card: VocabularyCard, deck: string): Promise<void>;
	addVocabulary(entry: DictionaryEntry, status?: VocabularyStatus): Promise<void>;
	setVocabularyCardStatus(card: VocabularyCard, status: VocabularyStatus): Promise<void>;
	rateVocabularyCard(card: VocabularyCard, rating: ReviewRating): Promise<void>;
	removeVocabularyCard(card: VocabularyCard): Promise<void>;
	exportVocabularyFile(format: 'json' | 'csv' | 'anki'): Promise<void>;
	createVocabularyNotes(cards: VocabularyCard[]): Promise<void>;
	openVocabularyNote(card: VocabularyCard): Promise<void>;
	readVocabularyNote(card: VocabularyCard, side?: 'front' | 'back'): Promise<string | undefined>;
}

export class VocabularyView extends ItemView {
	private dueOnly = false;
	private studyMode = false;
	private revealed = false;
	private studyIndex = 0;
	private selected = new Set<string>();
	private selectedDeck = '';
	private noteAnswer?: { id: string; text: string };
	private noteFront?: { id: string; text: string };
	private frontReads = new Set<string>();

	constructor(leaf: WorkspaceLeaf, private controller: VocabularyController) { super(leaf); }
	getViewType() { return VIEW_TYPE_VOCABULARY; }
	getDisplayText() { return 'Vocabulary study'; }
	getIcon() { return 'library'; }
	onOpen() { this.render(); return Promise.resolve(); }
	onClose() { this.contentEl.empty(); return Promise.resolve(); }
	setDueOnly(value: boolean) { this.dueOnly = value; this.studyMode = value; this.studyIndex = 0; this.revealed = false; this.render(); }

	render() {
		const el = this.contentEl;
		el.empty();
		el.addClass('mynary-vocabulary-view');
		const cards = this.controller.getVocabulary();
		const matchingCards = this.filterByDeck(cards);
		const due = dueVocabularyCards(matchingCards, Date.now(), this.controller.getNewCardsPerDay());
		const header = el.createDiv('mynary-vocabulary-header');
		header.createEl('h2', { text: 'Vocabulary study' });
		const controls = header.createDiv('mynary-vocabulary-controls');
		if (this.selectedDeck) controls.createEl('button', { text: '← All decks' }).addEventListener('click', () => { this.selectedDeck = ''; this.render(); });
		controls.createEl('button', { text: 'New deck' }).addEventListener('click', () => void this.controller.createVocabularyDeck());
		const study = controls.createEl('button', { text: `Study due (${due.length})` });
		study.addEventListener('click', () => { this.studyMode = true; this.dueOnly = true; this.studyIndex = 0; this.revealed = false; this.render(); });
		const list = controls.createEl('button', { text: 'Vocabulary list' });
		list.addEventListener('click', () => { this.studyMode = false; this.dueOnly = false; this.render(); });
		const exports = controls.createDiv('mynary-vocabulary-exports');
		for (const [format, label] of [['anki', 'Export Anki'], ['csv', 'Export CSV'], ['json', 'Export JSON']] as const) {
			exports.createEl('button', { text: label }).addEventListener('click', () => void this.controller.exportVocabularyFile(format));
		}
		if (this.selectedDeck && !this.studyMode) {
			const queue = vocabularyQueueCounts(matchingCards, Date.now(), this.controller.getNewCardsPerDay());
			const overview = el.createDiv('mynary-vocabulary-queue-overview');
			overview.createSpan({ text: 'Today' });
			for (const [kind, label, count] of [['new', 'New', queue.newCards], ['learning', 'Learning', queue.learningCards], ['review', 'Review', queue.reviewCards]] as const) {
				const badge = overview.createSpan({ cls: `mynary-queue-count mynary-queue-${kind}` });
				badge.createEl('strong', { text: String(count) });
				badge.createSpan({ text: label });
			}
		}
		if (this.studyMode) { this.renderFlashcard(el, due); return; }
		if (!this.selectedDeck) {
			const decks = el.createDiv('mynary-vocabulary-decks');
			for (const deck of this.controller.getVocabularyDecks()) {
				const deckCards = cards.filter((card) => card.deck === deck || card.deck.startsWith(`${deck}/`));
				const queue = vocabularyQueueCounts(deckCards, Date.now(), this.controller.getNewCardsPerDay());
				const item = decks.createEl('button', { cls: 'mynary-vocabulary-deck' });
				item.createEl('strong', { text: deck });
				const counts = item.createDiv('mynary-vocabulary-deck-counts');
				for (const [kind, label, count] of [['new', 'New', queue.newCards], ['learning', 'Learning', queue.learningCards], ['review', 'Review', queue.reviewCards]] as const) {
					const badge = counts.createSpan({ cls: `mynary-queue-count mynary-queue-${kind}` });
					badge.createEl('strong', { text: String(count) });
					badge.createSpan({ text: label });
				}
				item.createSpan({ cls: 'mynary-vocabulary-deck-total', text: `${deckCards.length} ${deckCards.length === 1 ? 'card' : 'cards'}` });
				item.addEventListener('click', () => { this.selectedDeck = deck; this.render(); });
			}
			if (!this.controller.getVocabularyDecks().length) decks.createDiv({ text: 'Create a deck, then add words from a dictionary lookup.', cls: 'mynary-empty' });
			return;
		}
		const search = el.createEl('input', { type: 'search', placeholder: 'Filter vocabulary…', cls: 'mynary-vocabulary-search' });
		const listEl = el.createDiv('mynary-vocabulary-list');
		const selectedAction = el.createDiv('mynary-vocabulary-batch');
		const makeNotes = selectedAction.createEl('button', { text: 'Open notes for selected' });
		makeNotes.disabled = this.selected.size === 0;
		makeNotes.addEventListener('click', () => {
			const chosen = cards.filter((card) => this.selected.has(card.id));
				chosen.forEach((card) => void this.controller.openVocabularyNote(card));
		});
		const draw = () => {
			listEl.empty();
			const term = search.value.trim().toLocaleLowerCase();
			const shown = matchingCards.filter((card) => (!this.dueOnly || card.status !== 'known' && card.dueAt <= Date.now()) && (!term || `${card.entry.word} ${card.entry.language} ${card.entry.translations.map((item) => item.word).join(' ')}`.toLocaleLowerCase().includes(term)));
			if (!shown.length) { listEl.createDiv({ text: cards.length ? 'No matching vocabulary.' : 'Add words from dictionary lookups to start learning.', cls: 'mynary-empty' }); return; }
			for (const card of shown) {
				const row = listEl.createDiv('mynary-vocabulary-row');
				const check = row.createEl('input', { type: 'checkbox' });
				check.checked = this.selected.has(card.id);
				check.setAttribute('aria-label', `Select ${card.entry.word}`);
				check.addEventListener('change', () => { if (check.checked) this.selected.add(card.id); else this.selected.delete(card.id); makeNotes.disabled = this.selected.size === 0; });
				const info = row.createDiv('mynary-vocabulary-info');
				info.createEl('strong', { text: card.entry.word });
				info.createDiv({ text: `${card.entry.language.toUpperCase()} · ${card.entry.meanings[0]?.definitions[0]?.text ?? card.entry.translations[0]?.word ?? 'No definition'}` });
				const openNote = row.createEl('button', { text: 'Edit note', cls: 'mynary-vocabulary-edit' });
				openNote.addEventListener('click', () => void this.controller.openVocabularyNote(card));
				const status = row.createEl('select');
				for (const [value, label] of [['learning', 'Learning'], ['review', 'Needs review'], ['known', 'Known']] as const) status.createEl('option', { value, text: label });
				status.value = card.status;
				status.addEventListener('change', () => void this.controller.setVocabularyCardStatus(card, status.value as VocabularyStatus));
				const deck = row.createEl('select', { attr: { 'aria-label': `Move ${card.entry.word} to deck` } });
				this.controller.getVocabularyDecks().forEach((name) => deck.createEl('option', { value: name, text: name }));
				deck.value = card.deck;
				deck.addEventListener('change', () => void this.controller.moveVocabularyCard(card, deck.value));
				const remove = row.createEl('button', { text: '×', attr: { title: 'Remove card; keep the note', 'aria-label': `Remove ${card.entry.word} from the study list (keep note)` } });
				remove.addEventListener('click', () => { this.selected.delete(card.id); void this.controller.removeVocabularyCard(card); });
			}
		};
		search.addEventListener('input', draw);
		draw();
	}

	private filterByDeck(cards: VocabularyCard[]) {
		return this.selectedDeck ? cards.filter((card) => card.deck === this.selectedDeck || card.deck.startsWith(`${this.selectedDeck}/`)) : cards;
	}

	private renderFlashcard(container: HTMLElement, due: VocabularyCard[]) {
		if (!due.length) { container.createDiv({ cls: 'mynary-empty', text: 'Nothing due. Add words or come back later.' }); return; }
		const card = due[Math.min(this.studyIndex, due.length - 1)]!;
		if (!this.frontReads.has(card.id)) {
			this.frontReads.add(card.id);
			void this.controller.readVocabularyNote(card, 'front').then((front) => {
				if (!front) return;
				this.noteFront = { id: card.id, text: front };
				this.render();
			});
		}
		const panel = container.createDiv('mynary-flashcard');
		panel.createDiv({ cls: 'mynary-flashcard-progress', text: `${Math.min(this.studyIndex + 1, due.length)} of ${due.length} due` });
		const front = panel.createDiv('mynary-flashcard-front');
		void MarkdownRenderer.render(this.app, this.noteFront?.id === card.id ? this.noteFront.text : `# ${card.entry.word}`, front, card.filePath ?? '', this);
		panel.createDiv({ cls: 'mynary-entry-metadata', text: card.entry.language.toUpperCase() });
		if (this.revealed) {
			const translations = card.entry.translations.map((item) => item.word).join(', ');
			const fallback = card.entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.text)).join('\n') || translations || 'No definition or translation in this pack yet.';
			const answer = panel.createDiv('mynary-flashcard-answer');
			void MarkdownRenderer.render(this.app, this.noteAnswer?.id === card.id ? this.noteAnswer.text : fallback, answer, card.filePath ?? '', this);
			panel.createEl('button', { text: 'Edit card note' }).addEventListener('click', () => void this.controller.openVocabularyNote(card));
			const ratings = panel.createDiv('mynary-flashcard-ratings');
			for (const [rating, label] of [['again', 'Again'], ['hard', 'Hard'], ['good', 'Good'], ['easy', 'Easy']] as const) {
				const button = ratings.createEl('button', { cls: `mynary-rating-button mynary-rating-${rating}` });
				button.createSpan({ cls: 'mynary-rating-label', text: label });
				button.createSpan({ cls: 'mynary-rating-interval', text: formatVocabularyInterval(vocabularyRatingInterval(card, rating)) });
				button.title = `${label}: next review in ${formatVocabularyInterval(vocabularyRatingInterval(card, rating))}`;
				button.addEventListener('click', () => {
					void this.controller.rateVocabularyCard(card, rating).then(() => {
						this.studyIndex = Math.min(this.studyIndex, Math.max(0, dueVocabularyCards(this.filterByDeck(this.controller.getVocabulary()), Date.now(), this.controller.getNewCardsPerDay()).length - 1));
						this.revealed = false;
						this.render();
					});
				});
			}
		} else {
			const reveal = panel.createEl('button', { text: 'Show answer', cls: 'mod-cta' });
			reveal.addEventListener('click', () => {
				void this.controller.readVocabularyNote(card).then((answer) => {
					this.noteAnswer = answer ? { id: card.id, text: answer } : undefined;
					this.revealed = true;
					this.render();
				});
			});
		}
	}
}
