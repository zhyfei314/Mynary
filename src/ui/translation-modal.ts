import { App, Modal, Notice } from 'obsidian';
import type MynaryPlugin from '../main';
import { MTRAN_LANGUAGE_OPTIONS } from '../settings';

export class TranslationModal extends Modal {
	constructor(app: App, private readonly plugin: MynaryPlugin, private readonly text: string) { super(app); }

	onOpen() {
		this.titleEl.setText('Translate with MTranServer');
		this.contentEl.createDiv({ cls: 'mynary-selection-preview', text: this.text });
		const controls = this.contentEl.createDiv('mynary-translation-controls');
		controls.createEl('label', { text: 'Target language' });
		const target = controls.createEl('select');
		const options = MTRAN_LANGUAGE_OPTIONS;
		for (const language of options) target.createEl('option', { value: language.code, text: `${language.name} (${language.code})` });
		const sourceCode = this.plugin.activeLanguage;
		const savedTarget = this.plugin.settings.mtranTargetLanguages[sourceCode] ?? this.plugin.settings.mtranTargetLanguage;
		if (!options.some((language) => language.code === savedTarget)) target.createEl('option', { value: savedTarget, text: savedTarget.toUpperCase() });
		target.value = savedTarget;
		const source = controls.createEl('select');
		source.setAttribute('aria-label', 'Source language');
		source.createEl('option', { value: 'current', text: `Source: ${this.plugin.activeLanguage.toUpperCase()}` });
		source.createEl('option', { value: 'auto', text: 'Source: Auto detect' });
		source.value = this.plugin.settings.mtranSourceLanguage;
		const translate = controls.createEl('button', { text: 'Translate', cls: 'mod-cta' });
		const result = this.contentEl.createDiv({ cls: 'mynary-state mynary-loading', text: 'Translating…' });
		const copy = controls.createEl('button', { text: 'Copy translation' });
		copy.disabled = true;
		let translatedText = '';
		const run = () => {
			result.addClass('mynary-loading');
			result.removeClass('mynary-error');
			result.setText('Translating…');
			copy.disabled = true;
			void this.plugin.translate(this.text, target.value).then((translation) => {
				translatedText = translation;
				copy.disabled = false;
				result.removeClass('mynary-loading');
				result.setText(translation);
			}).catch((error: unknown) => {
				result.removeClass('mynary-loading');
				result.addClass('mynary-error');
				result.setText(error instanceof Error ? error.message : 'Translation failed.');
			});
		};
		source.addEventListener('change', () => { this.plugin.settings.mtranSourceLanguage = source.value === 'auto' ? 'auto' : 'current'; void this.plugin.saveSettings(); });
		target.addEventListener('change', () => { this.plugin.settings.mtranTargetLanguage = target.value; this.plugin.settings.mtranTargetLanguages[sourceCode] = target.value; void this.plugin.saveSettings(); run(); });
		translate.addEventListener('click', run);
		copy.addEventListener('click', () => {
			if (!translatedText) return;
			void navigator.clipboard.writeText(translatedText).then(() => new Notice('Translation copied.')).catch(() => new Notice('Could not copy translation to the clipboard.'));
		});
		run();
	}

	onClose() { this.contentEl.empty(); }
}
