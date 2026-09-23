import { App, Component, MarkdownRenderer, Modal } from 'obsidian';
import { renderTemplate } from '../templates/renderer';
import { validateTemplate } from '../templates/validation';
import { DEFAULT_TEMPLATES, FLASHCARD_TEMPLATE } from '../settings';
import { confirmAction } from './confirm';
import { prepareFlashcardNote } from '../templates/flashcard-renderer';
import type MynaryPlugin from '../main';
import type { DictionaryEntry } from '../types';

export type TemplateAction = 'copy' | 'insert' | 'note';

const TEMPLATE_VARIABLES = [
	['{{word}}', 'Từ hoặc cụm từ'],
	['{{Title}}', 'Alias của word, tiện dùng với template cũ'],
	['{{language}}', 'Mã ngôn ngữ, ví dụ en'],
	['{{sourceLanguage}}', 'Mã ngôn ngữ nguồn'],
	['{{targetLanguage}}', 'Mã ngôn ngữ đích được cấu hình'],
	['{{audio}}', 'URL audio pronunciation đầu tiên nếu có'],
	['{{definition}}', 'Definition đầu tiên'],
	['{{definitionsMarkdown}}', 'Tất cả definition dạng danh sách Markdown'],
	['{{meaningsMarkdown}}', 'Meaning nhóm theo từ loại và etymology dạng Markdown'],
	['{{IPA}}', 'Phát âm IPA'],
	['{{partOfSpeech}}', 'Từ loại'],
	['{{example}}', 'Example đầu tiên'],
	['{{examplesMarkdown}}', 'Tất cả example dạng danh sách Markdown'],
	['{{translation}}', 'Các bản dịch trên một dòng'],
	['{{translationsMarkdown}}', 'Bản dịch dạng danh sách Markdown'],
	['{{synonyms}}', 'Synonym, phân cách bằng dấu phẩy'],
	['{{antonyms}}', 'Antonym, phân cách bằng dấu phẩy'],
	['{{etymology}}', 'Từ nguyên'],
	['{{source}}', 'Tên nguồn'],
	['{{sourceUrl}}', 'URL nguồn'],
	['{{lookupDate}}', 'Ngày tra cứu dạng YYYY-MM-DD'],
] as const;

const PREVIEW_ENTRY: DictionaryEntry = {
	word: 'example', language: 'en', phonetics: [{ text: '/ɪɡˈzɑːmpəl/' }],
	meanings: [{ partOfSpeech: 'Noun', etymology: 'Etymology 1', definitions: [{ text: 'A representative instance.', examples: ['This is an example.'] }] }],
	translations: [{ languageCode: 'vi', languageName: 'Vietnamese', word: 'ví dụ', sense: 'sample' }],
	synonyms: ['sample'], antonyms: [], etymology: 'From Latin.',
	source: { id: 'preview', name: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/example' }, fetchedAt: Date.parse('2023-11-14T00:00:00Z'),
};

const SPARSE_PREVIEW_ENTRY: DictionaryEntry = {
	word: 'small', language: 'en', phonetics: [], meanings: [{ partOfSpeech: 'Adjective', definitions: [{ text: 'Not large in size.', examples: [] }] }],
	translations: [], synonyms: [], antonyms: [], source: { id: 'preview', name: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/small' }, fetchedAt: Date.parse('2023-11-14T00:00:00Z'),
};

const TRANSLATION_PREVIEW_ENTRY: DictionaryEntry = {
	word: 'love', language: 'en', phonetics: [{ text: '/lʌv/' }], meanings: [
		{ partOfSpeech: 'Noun', etymology: 'Etymology 1', definitions: [{ text: 'A strong feeling of affection.', examples: ['Love makes the world better.'] }] },
		{ partOfSpeech: 'Verb', etymology: 'Etymology 2', definitions: [{ text: 'To have strong affection for someone.', examples: [] }] },
	], translations: [
		{ languageCode: 'vi', languageName: 'Vietnamese', word: 'tình yêu', sense: 'strong affection' },
		{ languageCode: 'ja', languageName: 'Japanese', word: '愛', sense: 'strong affection' },
		{ languageCode: 'fr', languageName: 'French', word: 'aimer', sense: 'to have strong affection' },
	], synonyms: ['affection'], antonyms: [], etymology: 'From Middle English.', source: { id: 'preview', name: 'Wiktionary', url: 'https://en.wiktionary.org/wiki/love' }, fetchedAt: Date.parse('2023-11-14T00:00:00Z'),
};

const PREVIEW_ENTRIES: Record<string, DictionaryEntry> = {
	rich: PREVIEW_ENTRY,
	sparse: SPARSE_PREVIEW_ENTRY,
	translations: TRANSLATION_PREVIEW_ENTRY,
};

export class TemplatePickerModal extends Modal {
	private selectedId: string;

	constructor(app: App, private plugin: MynaryPlugin, private entry: DictionaryEntry, private action: TemplateAction) {
		super(app);
		this.selectedId = plugin.settings.languageTemplateIds?.[entry.language] ?? plugin.settings.defaultTemplateId;
	}

	onOpen() {
		this.modalEl.addClass('mynary-template-picker');
		this.render();
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		const actionName = this.action === 'copy' ? 'Copy' : this.action === 'insert' ? 'Insert' : 'Create note';
		el.createEl('h2', { text: `${actionName}: choose template` });
		el.createEl('p', { text: 'Choose how the lookup result should be formatted. The default template is preselected.' });

		const select = el.createEl('select', { cls: 'mynary-template-select' });
	this.plugin.settings.templates.filter((template) => template.type !== 'flashcard').forEach((template) => select.createEl('option', { value: template.id, text: template.name }));
		select.value = this.selectedId;
		if (select.value !== this.selectedId) this.selectedId = select.value;
		const preview = el.createEl('pre', { cls: 'mynary-template-preview' });
		if (this.action === 'note') {
			const folder = this.plugin.settings.noteFolder.trim() || 'Vault root';
			const filename = renderTemplate(this.entry, this.plugin.settings.filenameTemplate).replace(/[\\/:*?"<>|]/g, '-').trim() || this.entry.word;
			const destination = el.createDiv('mynary-note-destination');
			destination.createEl('strong', { text: 'Target note' });
			destination.createDiv({ text: `${folder}/${filename}.md` });
			destination.createEl('small', { text: noteBehaviorLabel(this.plugin.settings.existingNoteBehavior) });
		}
		const updatePreview = () => {
			this.selectedId = select.value;
			const template = this.getSelectedTemplate();
			preview.setText(template ? renderTemplate(this.entry, template.content) : 'No template configured.');
		};
		select.addEventListener('change', updatePreview);
		updatePreview();

		const actions = el.createDiv('mynary-template-modal-actions');
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
		const apply = actions.createEl('button', { text: actionName, cls: 'mod-cta' });
		apply.addEventListener('click', () => {
			void this.plugin.applyTemplateAction(this.action, this.selectedId, this.entry).then(() => this.close());
		});
	}

	private getSelectedTemplate() {
		return this.plugin.settings.templates.find((template) => template.id === this.selectedId);
	}
}

function noteBehaviorLabel(behavior: MynaryPlugin['settings']['existingNoteBehavior']): string {
	if (behavior === 'overwrite') return 'Existing notes will be replaced automatically.';
	if (behavior === 'update-section') return 'Only the managed lookup section will be updated in an existing note.';
	return 'You will be asked before replacing an existing note.';
}

export class TemplateManagerModal extends Modal {
	private selectedId: string;
	private selectedType: 'note' | 'flashcard' = 'note';
	private previewComponent?: Component;

	constructor(app: App, private plugin: MynaryPlugin) {
		super(app);
		this.selectedId = plugin.settings.defaultTemplateId || plugin.settings.templates[0]?.id || '';
	}

	onOpen() {
		this.modalEl.addClass('mynary-template-manager');
		this.render();
	}

	private render() {
		this.previewComponent?.unload();
		this.previewComponent = undefined;
		const el = this.contentEl;
		el.empty();
		el.createEl('h2', { text: 'Template manager' });
		el.createEl('p', { text: 'Manage note and flashcard templates separately. Both support dictionary variables; flashcards also use front/back markers for study.' });
		const typeTabs = el.createDiv('mynary-template-type-tabs');
		for (const [type, label] of [['note', 'Note templates'], ['flashcard', 'Flashcard templates']] as const) {
			const tab = typeTabs.createEl('button', { text: label, cls: this.selectedType === type ? 'is-active' : '' });
				tab.addEventListener('click', () => {
					this.selectedType = type;
					const defaultId = type === 'flashcard' ? this.plugin.settings.defaultVocabularyTemplateId : this.plugin.settings.defaultTemplateId;
					this.selectedId = this.templatesForType().some((template) => template.id === defaultId) ? defaultId ?? '' : this.templatesForType()[0]?.id ?? '';
					this.render();
				});
		}

		const toolbar = el.createDiv('mynary-template-toolbar');
		const select = toolbar.createEl('select', { cls: 'mynary-template-select' });
		this.templatesForType().forEach((template) => select.createEl('option', { value: template.id, text: template.name }));
		select.value = this.selectedId;
		if (select.value !== this.selectedId) this.selectedId = select.value;
		const selected = () => this.plugin.settings.templates.find((template) => template.id === this.selectedId);
		const defaultLabel = toolbar.createSpan({ cls: 'mynary-template-default-label' });
		const activeDefaultId = () => this.selectedType === 'flashcard' ? this.plugin.settings.defaultVocabularyTemplateId : this.plugin.settings.defaultTemplateId;
		const updateDefaultLabel = () => { defaultLabel.setText(activeDefaultId() === this.selectedId ? 'Default template' : ''); };
		updateDefaultLabel();
		select.addEventListener('change', () => { this.selectedId = select.value; this.render(); });

		const add = toolbar.createEl('button', { text: 'Add template' });
		add.addEventListener('click', () => {
			const id = `custom-${Date.now()}`;
			this.plugin.settings.templates.push({ id, name: 'Custom template', type: this.selectedType, content: this.selectedType === 'flashcard' ? DEFAULT_TEMPLATES.find((item) => item.id === 'flashcard-basic')?.content ?? FLASHCARD_TEMPLATE : '# {{word}}\n\n{{definitionsMarkdown}}' });
			this.selectedId = id;
			void this.plugin.saveSettings().then(() => this.render());
		});
		const duplicate = toolbar.createEl('button', { text: 'Duplicate' });
		duplicate.disabled = !selected();
		duplicate.addEventListener('click', () => {
			const source = selected();
			if (!source) return;
			const id = `custom-${Date.now()}`;
			this.plugin.settings.templates.push({ id, name: `${source.name} copy`, type: this.selectedType, content: source.content });
			this.selectedId = id;
			void this.plugin.saveSettings().then(() => this.render());
		});
		const restore = toolbar.createEl('button', { text: 'Restore built-ins' });
		restore.addEventListener('click', () => { void this.restoreBuiltIns(); });

		const template = selected();
		if (!template) {
			el.createDiv({ text: 'No template configured.', cls: 'mynary-empty' });
			return;
		}
		const editor = el.createDiv('mynary-template-editor-layout');
		const form = editor.createDiv('mynary-template-editor-form');
		let preview: HTMLElement | undefined;
		let previewEntry = this.plugin.lastEntry ?? PREVIEW_ENTRY;
		const updatePreview = () => {
			if (!preview) return;
			this.previewComponent?.unload();
			const rendererComponent = new Component();
			rendererComponent.load();
			this.previewComponent = rendererComponent;
			preview.empty();
			if (this.selectedType === 'flashcard') {
				const rendered = prepareFlashcardNote(previewEntry, template.content, this.plugin.settings.vocabularyAnswerLanguage ?? '');
				const front = preview.createDiv('mynary-template-preview-face mynary-template-preview-front');
				front.createEl('strong', { text: 'Front' });
				const frontContent = front.createDiv();
				const back = preview.createDiv('mynary-template-preview-face mynary-template-preview-back');
				back.createEl('strong', { text: 'Back' });
				const backContent = back.createDiv();
				void MarkdownRenderer.render(this.app, rendered.front, frontContent, '', rendererComponent);
				void MarkdownRenderer.render(this.app, rendered.back, backContent, '', rendererComponent);
				return;
			}
			let markdown = hideFrontmatter(renderTemplate(previewEntry, template.content));
			if (this.plugin.settings.bilingualNotes && previewEntry.translations.length) markdown += `\n\n## Translation\n\n${previewEntry.translations.map((item) => `- ${item.word}`).join('\n')}`;
			void MarkdownRenderer.render(this.app, markdown, preview, '', rendererComponent);
		};
		const validation = form.createDiv('mynary-template-validation');
		const updateValidation = () => {
			validation.empty();
			const issues = validateTemplate(template.content);
			if (!issues.length) {
				validation.addClass('is-valid');
				validation.setText('Template is valid.');
				return;
			}
			validation.removeClass('is-valid');
			validation.createEl('strong', { text: `Template has ${issues.length} issue${issues.length === 1 ? '' : 's'}:` });
			const list = validation.createEl('ul');
			issues.forEach((issue) => list.createEl('li', { text: issue.message }));
		};
		form.createEl('label', { text: 'Template name' });
		const name = form.createEl('input', { type: 'text', value: template.name });
		name.addEventListener('input', () => { template.name = name.value || 'Untitled template'; void this.plugin.saveSettings(); });
		form.createEl('label', { text: 'Template content' });
		if (this.selectedType === 'flashcard') {
			const markerTools = form.createDiv('mynary-template-marker-tools');
			markerTools.createEl('p', { text: 'Place a marker at the insertion point. Matching start/end markers define each card side.' });
			for (const [label, marker] of [
				['Front start', '<!-- mynary:front:start -->'], ['Front end', '<!-- mynary:front:end -->'],
				['Back start', '<!-- mynary:back:start -->'], ['Back end', '<!-- mynary:back:end -->'],
			] as const) {
				const button = markerTools.createEl('button', { text: label, attr: { title: marker } });
				button.addEventListener('click', () => {
					const start = textarea.selectionStart;
					const end = textarea.selectionEnd;
					textarea.value = `${textarea.value.slice(0, start)}${marker}${textarea.value.slice(end)}`;
					textarea.selectionStart = textarea.selectionEnd = start + marker.length;
					textarea.focus();
					template.content = textarea.value;
					updateValidation();
					updatePreview();
					void this.plugin.saveSettings();
				});
			}
		}
		const textarea = form.createEl('textarea', { cls: 'mynary-template-textarea' });
		textarea.value = template.content;
		textarea.addEventListener('input', () => { template.content = textarea.value; updateValidation(); updatePreview(); void this.plugin.saveSettings(); });

		const controls = form.createDiv('mynary-template-editor-actions');
		const setDefault = controls.createEl('button', { text: 'Set as default' });
		setDefault.disabled = activeDefaultId() === template.id;
		setDefault.addEventListener('click', () => {
			if (this.selectedType === 'flashcard') this.plugin.settings.defaultVocabularyTemplateId = template.id;
			else this.plugin.settings.defaultTemplateId = template.id;
			void this.plugin.saveSettings().then(() => { updateDefaultLabel(); this.render(); });
		});
		const remove = controls.createEl('button', { text: 'Delete template' });
		remove.disabled = this.templatesForType().length <= 1;
		remove.addEventListener('click', () => {
			void confirmAction(this.app, 'Delete template?', `Delete “${template.name}”?`).then((confirmed) => {
				if (!confirmed) return;
			this.plugin.settings.templates = this.plugin.settings.templates.filter((item) => item.id !== template.id);
			if (this.selectedType === 'flashcard' && this.plugin.settings.defaultVocabularyTemplateId === template.id) this.plugin.settings.defaultVocabularyTemplateId = this.plugin.settings.templates.find((item) => item.type === 'flashcard')?.id ?? '';
			if (this.selectedType === 'note' && this.plugin.settings.defaultTemplateId === template.id) this.plugin.settings.defaultTemplateId = this.plugin.settings.templates.find((item) => item.type !== 'flashcard')?.id ?? '';
			this.selectedId = this.selectedType === 'flashcard' ? this.plugin.settings.defaultVocabularyTemplateId ?? '' : this.plugin.settings.defaultTemplateId;
			void this.plugin.saveSettings().then(() => this.render());
			});
		});

		const previewPane = editor.createDiv('mynary-template-preview-pane');
		previewPane.createEl('h3', { text: 'Preview' });
		const previewControls = previewPane.createDiv('mynary-template-preview-controls');
		const previewSelect = previewControls.createEl('select', { attr: { 'aria-label': 'Preview data' } });
		previewSelect.createEl('option', { value: 'rich', text: 'Rich entry' });
		previewSelect.createEl('option', { value: 'sparse', text: 'Sparse entry' });
		previewSelect.createEl('option', { value: 'translations', text: 'Many meanings and translations' });
		if (this.plugin.lastEntry) previewSelect.createEl('option', { value: 'current', text: 'Current lookup' });
		previewSelect.value = this.plugin.lastEntry ? 'current' : 'rich';
		previewSelect.addEventListener('change', () => {
			previewEntry = previewSelect.value === 'current' && this.plugin.lastEntry ? this.plugin.lastEntry : PREVIEW_ENTRIES[previewSelect.value] ?? PREVIEW_ENTRY;
			updatePreview();
		});
		preview = previewPane.createDiv('mynary-template-live-preview');

		const guide = editor.createDiv('mynary-template-guide');
		guide.createEl('h3', { text: 'Available variables' });
		guide.createEl('p', { text: 'Click a variable to insert it at the cursor. Names are case-insensitive; {{Title}} is an alias for {{word}}. Optional blocks use {{#if variable}}...{{/if}}.' });
		if (this.selectedType === 'flashcard') {
			guide.createEl('h3', { text: 'Study markers' });
			guide.createEl('p', { text: 'Wrap the question and answer in paired markers. Front aliases: front, question, prompt. Back aliases: back, answer, reverse. Start/end also accept begin/close and open/stop.' });
			guide.createEl('pre', { text: '<!-- mynary:front:start -->\n{{word}}\n<!-- mynary:front:end -->\n\n<!-- mynary:back:start -->\n{{definitionsMarkdown}}\n<!-- mynary:back:end -->' });
		}
		const variableList = guide.createDiv('mynary-template-variable-list');
		TEMPLATE_VARIABLES.forEach(([variable, description]) => {
			const button = variableList.createEl('button', { text: variable, attr: { title: description } });
			button.addEventListener('click', () => {
				const start = textarea.selectionStart;
				const end = textarea.selectionEnd;
				textarea.value = `${textarea.value.slice(0, start)}${variable}${textarea.value.slice(end)}`;
				textarea.selectionStart = textarea.selectionEnd = start + variable.length;
				textarea.focus();
				template.content = textarea.value;
				updateValidation();
				updatePreview();
				void this.plugin.saveSettings();
			});
		});
		guide.createEl('h3', { text: 'Example' });
		guide.createEl('pre', { text: '{{word}} ({{IPA}})\n\n{{meaningsMarkdown}}\n\nSource: {{sourceUrl}}' });
		updateValidation();
		updatePreview();
	}

	onClose() {
		this.previewComponent?.unload();
		this.previewComponent = undefined;
		this.contentEl.empty();
	}

	private async restoreBuiltIns() {
		if (!(await confirmAction(this.app, 'Restore built-in templates?', 'This resets the built-in note and flashcard templates. Custom templates are kept.'))) return;
		DEFAULT_TEMPLATES.forEach((defaultTemplate) => {
			const existing = this.plugin.settings.templates.find((template) => template.id === defaultTemplate.id);
			if (existing) Object.assign(existing, defaultTemplate);
			else this.plugin.settings.templates.push({ ...defaultTemplate });
		});
		if (!this.plugin.settings.templates.some((template) => template.id === this.plugin.settings.defaultTemplateId)) this.plugin.settings.defaultTemplateId = DEFAULT_TEMPLATES[0]?.id ?? '';
		await this.plugin.saveSettings();
		this.selectedId = this.selectedType === 'flashcard' ? this.plugin.settings.defaultVocabularyTemplateId ?? 'flashcard-basic' : this.plugin.settings.defaultTemplateId;
		this.render();
	}

	private templatesForType() {
		return this.plugin.settings.templates.filter((template) => (template.type === 'flashcard' ? 'flashcard' : 'note') === this.selectedType);
	}
}

export function openTemplatePicker(app: App, plugin: MynaryPlugin, entry: DictionaryEntry, action: TemplateAction) {
	new TemplatePickerModal(app, plugin, entry, action).open();
}

function hideFrontmatter(markdown: string) {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u, '');
}
