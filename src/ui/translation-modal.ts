import { App, MarkdownView, Modal, Notice } from 'obsidian';
import type MynaryPlugin from '../main';
import { MTRAN_LANGUAGE_OPTIONS } from '../settings';

export class TranslationModal extends Modal {
	constructor(app: App, private readonly plugin: MynaryPlugin, private readonly text: string) { super(app); }

	onOpen() {
		this.titleEl.setText('Translate with MTranServer');
		this.modalEl.addClass('mynary-translation-modal');
		const sourceField = this.contentEl.createDiv('mynary-translation-field');
		sourceField.createEl('label', { text: 'Source language' });
		const source = sourceField.createEl('select');
		source.setAttribute('aria-label', 'Source language');
		source.createEl('option', { value: 'current', text: `Current (${this.plugin.activeLanguage.toUpperCase()})` });
		source.createEl('option', { value: 'auto', text: 'Auto detect' });
		source.value = this.plugin.settings.mtranSourceLanguage;
		const sourceText = this.contentEl.createDiv('mynary-translation-source');
		sourceText.createEl('label', { text: 'Source content' });
		sourceText.createDiv({ cls: 'mynary-selection-preview', text: this.text });
		const targetField = this.contentEl.createDiv('mynary-translation-field');
		targetField.createEl('label', { text: 'Target language' });
		const target = targetField.createEl('select');
		const options = MTRAN_LANGUAGE_OPTIONS;
		for (const language of options) target.createEl('option', { value: language.code, text: `${language.name} (${language.code})` });
		const sourceCode = this.plugin.activeLanguage;
		const savedTarget = this.plugin.settings.mtranTargetLanguages[sourceCode] ?? this.plugin.settings.mtranTargetLanguage;
		if (!options.some((language) => language.code === savedTarget)) target.createEl('option', { value: savedTarget, text: savedTarget.toUpperCase() });
		target.value = savedTarget;
		const resultSection = this.contentEl.createDiv('mynary-translation-result-section');
		resultSection.createEl('label', { text: 'Translation' });
		const result = resultSection.createDiv({ cls: 'mynary-translation-result mynary-loading', text: 'Translating…' });
		const insert = resultSection.createEl('button', { text: 'Insert into note', cls: 'mynary-translation-copy' });
		insert.disabled = true;
		let translatedText = '';
		const run = () => {
			result.addClass('mynary-loading');
			result.removeClass('mynary-error');
			result.setText('Translating…');
			insert.disabled = true;
			void this.plugin.translate(this.text, target.value).then((translation) => {
				translatedText = translation;
				insert.disabled = false;
				result.removeClass('mynary-loading');
				result.setText(translation);
			}).catch((error: unknown) => {
				result.removeClass('mynary-loading');
				result.addClass('mynary-error');
				result.setText(error instanceof Error ? error.message : 'Translation failed.');
			});
		};
		source.addEventListener('change', () => { this.plugin.settings.mtranSourceLanguage = source.value === 'auto' ? 'auto' : 'current'; void this.plugin.saveSettings(); run(); });
		target.addEventListener('change', () => { this.plugin.settings.mtranTargetLanguage = target.value; this.plugin.settings.mtranTargetLanguages[sourceCode] = target.value; void this.plugin.saveSettings(); run(); });
		insert.addEventListener('click', () => {
			if (!translatedText) return;
			const editor = this.plugin.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
			if (!editor) { new Notice('Open a Markdown note before inserting.'); return; }
			editor.replaceSelection(translatedText);
			new Notice('Translation inserted.');
		});
		run();
	}

	onClose() { this.contentEl.empty(); }
}
