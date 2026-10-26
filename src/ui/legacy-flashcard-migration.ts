import { App, Modal, Notice, TFile } from 'obsidian';
import type { TemplateDefinition } from '../types';
import { MAX_LEGACY_FLASHCARD_REFRESHES } from '../services/legacy-flashcards';

export interface LegacyFlashcardCandidate {
	file: TFile;
	word: string;
	language: string;
	refreshable: boolean;
	needsLanguageLabel: boolean;
	markdown?: string;
}

export type LegacyFlashcardUpgradeMode = 'tag' | 'refresh';

export class LegacyFlashcardMigrationModal extends Modal {
	constructor(
		app: App,
		private readonly candidates: LegacyFlashcardCandidate[],
		private readonly templates: TemplateDefinition[],
		private readonly defaultTemplateId: string,
		private readonly migrate: (candidates: LegacyFlashcardCandidate[], templateId: string, mode: LegacyFlashcardUpgradeMode) => Promise<void>,
	) { super(app); }

	onOpen() {
		this.modalEl.addClass('mynary-vocabulary-modal');
		this.titleEl.setText('Upgrade legacy flashcards');
		this.contentEl.createEl('p', { text: 'Select old flashcard notes and choose how to upgrade them. Add a language label to each note title without changing its content, or refresh from Wiktionary and create a separate card for each definition.' });
		const modeField = this.contentEl.createDiv('mynary-modal-field');
		modeField.createEl('label', { text: 'Upgrade action' });
		const mode = modeField.createEl('select');
		mode.createEl('option', { value: 'tag', text: 'Add language label to note title' });
		mode.createEl('option', { value: 'refresh', text: 'Refresh and split by definition' });
		this.contentEl.createEl('p', { text: `Refresh is limited to ${MAX_LEGACY_FLASHCARD_REFRESHES} notes per run to limit Wiktionary requests.` });
		const templateField = this.contentEl.createDiv('mynary-modal-field');
		templateField.createEl('label', { text: 'Flashcard template' });
		const template = templateField.createEl('select');
		this.templates.forEach((item) => template.createEl('option', { value: item.id, text: item.name }));
		template.value = this.templates.some((item) => item.id === this.defaultTemplateId) ? this.defaultTemplateId : this.templates[0]?.id ?? '';
		templateField.toggleClass('is-hidden', mode.value === 'tag');
		mode.addEventListener('change', () => { templateField.toggleClass('is-hidden', mode.value === 'tag'); updateChoices(); });
		const list = this.contentEl.createDiv('mynary-legacy-card-list');
		const choices: Array<{ candidate: LegacyFlashcardCandidate; input: HTMLInputElement }> = [];
		for (const candidate of this.candidates) {
			const row = list.createEl('label', { cls: 'mynary-legacy-card-row' });
			const input = row.createEl('input', { type: 'checkbox' });
			input.checked = true;
			const summary = row.createSpan();
			summary.createEl('strong', { text: candidate.word });
			summary.createSpan({ text: ` · ${candidate.language.toUpperCase()} · ${candidate.file.path}${candidate.refreshable ? '' : ' · label only'}` });
			choices.push({ candidate, input });
		}
		function updateChoices() {
			for (const { candidate, input } of choices) {
				const enabled = mode.value === 'refresh' ? candidate.refreshable : candidate.needsLanguageLabel;
				input.disabled = !enabled;
				input.checked = enabled;
			}
		}
		updateChoices();
		const actions = this.contentEl.createDiv('mynary-modal-actions');
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		actions.createEl('button', { text: 'Apply to selected', cls: 'mod-cta' }).addEventListener('click', () => {
			const selected = choices.filter((choice) => choice.input.checked).map((choice) => choice.candidate);
			if (!selected.length || (mode.value === 'refresh' && !template.value)) { new Notice('Select at least one note and a valid template.'); return; }
			if (mode.value === 'refresh' && selected.length > MAX_LEGACY_FLASHCARD_REFRESHES) { new Notice(`Select ${MAX_LEGACY_FLASHCARD_REFRESHES} or fewer notes to refresh at a time.`); return; }
			void this.migrate(selected, template.value, mode.value as LegacyFlashcardUpgradeMode).then(() => this.close());
		});
	}

	onClose() { this.contentEl.empty(); }
}
