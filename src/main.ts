import {
	App,
	Editor,
	ItemView,
	MarkdownView,
	Menu,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	setIcon,
	requestUrl,
	WorkspaceLeaf,
} from 'obsidian';
import { DictionaryEntry } from './types';
import { DEFAULT_SETTINGS, DictionarySettings, migrateTemplates } from './settings';
import { WiktionaryProvider } from './providers/wiktionary';
import { CacheManager } from './services/cache';
import { renderEntry } from './utils/format';
import { createVocabularyNote, renderTemplate } from './templates/template';
import { analyzeSelection, normalizeSelection } from './utils/selection';
import { openTemplatePicker, TemplateManagerModal } from './ui/template-modals';
import type { TemplateAction } from './ui/template-modals';

export const VIEW_TYPE_DICTIONARY = 'mynary-dictionary-view';
const CACHE_FORMAT_VERSION = 'v5';
type LookupStatus = 'idle' | 'loading' | 'success' | 'error';
type LookupListener = (status: LookupStatus) => void;

export default class MynaryPlugin extends Plugin {
	settings!: DictionarySettings;
	cache!: CacheManager;
	provider!: WiktionaryProvider;
	lastEntry?: DictionaryEntry;
	private history: string[] = [];
	private lookupListeners = new Set<LookupListener>();
	private lookupSequence = 0;
	lookupStatus: LookupStatus = 'idle';
	lookupError = '';
	currentQuery = '';
	lastLookupWasCached = false;

	async onload() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<DictionarySettings>);
		if (migrateTemplates(this.settings.templates)) await this.saveSettings();
		this.cache = new CacheManager(this, this.settings);
		this.provider = new WiktionaryProvider(requestUrl);
		this.registerView(VIEW_TYPE_DICTIONARY, (leaf) => new DictionaryView(leaf, this));
		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			if (!editor.getSelection().trim()) return;
			menu.addItem((item) => item.setTitle('Lookup selected word').setIcon('search').onClick(() => void this.lookupSelected(editor)));
		}));

		this.addRibbonIcon('book-open', 'Open dictionary sidebar', () => this.activateView());
		this.addCommand({ id: 'lookup-selected-word', name: 'Lookup selected word', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'L' }], editorCallback: (editor) => void this.lookupSelected(editor) });
		this.addCommand({ id: 'open-dictionary-sidebar', name: 'Open dictionary sidebar', callback: () => this.activateView() });
		this.addCommand({ id: 'create-vocabulary-note', name: 'Create vocabulary note from lookup', checkCallback: (checking) => this.commandWithEntry(checking, () => this.createNote()) });
		this.addCommand({ id: 'insert-lookup-result', name: 'Insert lookup result', checkCallback: (checking) => this.commandWithEntry(checking, () => this.insertResult()) });
		this.addCommand({ id: 'clear-dictionary-cache', name: 'Clear dictionary cache', callback: async () => { await this.cache.clear(); new Notice('Dictionary cache cleared.'); } });
		this.addSettingTab(new DictionarySettingTab(this.app, this));
	}

	async saveSettings() {
		const existing = await this.loadData() as Record<string, unknown> | null ?? {};
		await this.saveData({ ...existing, ...this.settings });
	}
	get activeLanguage() { return this.settings.defaultLanguage; }
	getHistory() { return this.history; }

	private commandWithEntry(checking: boolean, action: () => Promise<void>) {
		if (!this.lastEntry) return false;
		if (!checking) void action();
		return true;
	}

	async lookupSelected(editor: Editor) {
		const selection = analyzeSelection(editor.getSelection());
		if (!selection.text) { new Notice('Select a word first.'); return; }
		new LookupModal(this.app, this, selection.text, selection.tooLong).open();
	}

	async lookup(word: string, language = this.activeLanguage, forceRefresh = false): Promise<DictionaryEntry | undefined> {
		const normalized = normalizeSelection(word);
		if (!normalized) return undefined;
		const requestId = ++this.lookupSequence;
		this.lastEntry = undefined;
		this.currentQuery = normalized;
		this.lookupStatus = 'loading';
		this.lookupError = '';
		this.lastLookupWasCached = false;
		this.notifyLookupListeners();
		const key = `${CACHE_FORMAT_VERSION}:${language}:${normalized.toLowerCase()}`;
		const cached = await this.cache.get(key);
		if (requestId !== this.lookupSequence) return undefined;
		if (cached && !forceRefresh) { this.lastLookupWasCached = true; this.setEntry(cached, normalized); return cached; }
		try {
			const entry = await this.provider.lookup(normalized, language);
			if (requestId !== this.lookupSequence) return undefined;
			await this.cache.set(key, entry);
			if (requestId !== this.lookupSequence) return undefined;
			this.setEntry(entry, normalized);
			return entry;
		} catch (error) {
			if (requestId !== this.lookupSequence) return undefined;
			this.lookupStatus = 'error';
			this.lookupError = error instanceof Error ? error.message : 'Dictionary lookup failed.';
			this.notifyLookupListeners();
			return undefined;
		}
	}

	async refreshLookup() {
		if (!this.currentQuery) return;
		await this.lookup(this.currentQuery, this.lastEntry?.language ?? this.activeLanguage, true);
	}

	private setEntry(entry: DictionaryEntry, historyWord: string) {
		this.lastEntry = entry;
		this.lookupStatus = 'success';
		this.lookupError = '';
		this.history = [historyWord, ...this.history.filter((item) => item !== historyWord)].slice(0, 20);
		this.notifyLookupListeners();
	}

	subscribeLookup(listener: LookupListener) {
		this.lookupListeners.add(listener);
		return () => this.lookupListeners.delete(listener);
	}

	private notifyLookupListeners() {
		this.lookupListeners.forEach((listener) => listener(this.lookupStatus));
		this.app.workspace.getLeavesOfType(VIEW_TYPE_DICTIONARY).forEach((leaf) => (leaf.view as DictionaryView).render());
	}

	async activateView() {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_DICTIONARY)[0];
		if (!leaf) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (rightLeaf) {
				leaf = rightLeaf;
				await leaf.setViewState({ type: VIEW_TYPE_DICTIONARY, active: true });
			}
		}
		if (leaf) await this.app.workspace.revealLeaf(leaf);
	}

	async insertResult() {
		if (this.lastEntry) { openTemplatePicker(this.app, this, this.lastEntry, 'insert'); return; }
	}

	async applyTemplateAction(action: TemplateAction, templateId: string, entry: DictionaryEntry) {
		const template = this.settings.templates.find((item) => item.id === templateId);
		if (!template) { new Notice('Template not found.'); return; }
		try {
			const content = renderTemplate(entry, template.content);
			if (action === 'copy') {
				await navigator.clipboard.writeText(content);
				new Notice(`Copied using “${template.name}”.`);
				return;
			}
			if (action === 'insert') {
				const editor = this.app.workspace.getActiveViewOfType(MarkdownView)?.editor;
				if (!editor) { new Notice('Open a Markdown note before inserting.'); return; }
				editor.replaceSelection(content);
				new Notice(`Inserted using “${template.name}”.`);
				return;
			}
			const file = await createVocabularyNote(this.app, entry, this.settings, template.id);
			new Notice(`Created ${file.path} using “${template.name}”.`);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Template action failed.');
		}
	}

	async createNote() {
		if (this.lastEntry) openTemplatePicker(this.app, this, this.lastEntry, 'note');
	}

	openTemplateManager() {
		new TemplateManagerModal(this.app, this).open();
	}

	openTemplatePickerForEntry(entry: DictionaryEntry, action: TemplateAction) {
		openTemplatePicker(this.app, this, entry, action);
	}
}

export class LookupModal extends Modal {
	private unsubscribe?: () => void;
	private selectionChoice: boolean;

	constructor(app: App, private plugin: MynaryPlugin, private word: string, selectionTooLong = false) {
		super(app);
		this.selectionChoice = selectionTooLong;
	}

	onOpen() {
		this.modalEl.addClass('mynary-lookup-modal');
		this.unsubscribe = this.plugin.subscribeLookup(() => this.render());
		this.render();
		void this.plugin.lookup(this.word);
	}

	onClose() {
		this.unsubscribe?.();
		this.contentEl.empty();
	}

	private render() {
		const el = this.contentEl;
		el.empty();
		el.createEl('h2', { text: `Lookup: ${this.word}` });
		if (this.selectionChoice) {
			el.createDiv({ cls: 'mynary-state', text: 'The selected text is longer than 80 characters or 8 words.' });
			el.createDiv({ cls: 'mynary-selection-preview', text: this.word });
			const actions = el.createDiv('mynary-selection-actions');
			const exact = actions.createEl('button', { text: 'Look up exact selection' });
			exact.addEventListener('click', () => this.startLookup(this.word));
			const firstWord = actions.createEl('button', { text: 'Look up first word' });
			firstWord.addEventListener('click', () => this.startLookup(this.word.split(' ')[0] ?? this.word));
			const cancel = actions.createEl('button', { text: 'Cancel' });
			cancel.addEventListener('click', () => this.close());
			return;
		}
		if (this.plugin.lookupStatus === 'loading') {
			el.createDiv({ cls: 'mynary-state mynary-loading', text: 'Looking up…' });
			return;
		}
		if (this.plugin.lookupStatus === 'error') {
			el.createDiv({ cls: 'mynary-state mynary-error', text: this.plugin.lookupError });
			const retry = el.createEl('button', { text: 'Try again' });
			retry.addEventListener('click', () => void this.plugin.lookup(this.word));
			return;
		}
		if (this.plugin.lastEntry) {
			renderEntry(el, this.plugin.lastEntry, this.plugin);
			const sidebar = el.createEl('button', { text: 'Open in sidebar', cls: 'mynary-secondary-action' });
			sidebar.addEventListener('click', () => { this.close(); void this.plugin.activateView(); });
		} else {
			el.createDiv({ cls: 'mynary-state mynary-empty', text: 'No result yet.' });
		}
	}

	private startLookup(word: string) {
		this.word = word;
		this.selectionChoice = false;
		void this.plugin.lookup(word);
	}
}

export class DictionaryView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: MynaryPlugin) { super(leaf); }
	getViewType() { return VIEW_TYPE_DICTIONARY; }
	getDisplayText() { return 'Dictionary'; }
	getIcon() { return 'book-open'; }

	onOpen() { this.render(); return Promise.resolve(); }
	onClose() { this.contentEl.empty(); return Promise.resolve(); }

	render() {
		const el = this.contentEl; el.empty(); el.addClass('mynary-sidebar');
		const search = el.createDiv('mynary-search');
		const input = search.createEl('input', { type: 'text', placeholder: 'Search a word…' });
		input.value = this.plugin.currentQuery;
		const submit = search.createEl('button', { cls: 'mynary-search-button' });
		submit.setAttribute('aria-label', 'Search dictionary');
		submit.setAttribute('title', 'Search dictionary');
		setIcon(submit, 'search');
		const submitLookup = () => { void this.plugin.lookup(input.value); };
		input.addEventListener('keydown', (event) => { if (event.key === 'Enter') submitLookup(); });
		submit.addEventListener('click', submitLookup);
		const language = search.createEl('select');
		this.plugin.settings.languages.forEach((item) => language.createEl('option', { value: item.code, text: item.code.toUpperCase(), attr: { 'aria-label': item.name, title: item.name } }));
		language.setAttribute('aria-label', 'Dictionary language');
		language.setAttribute('title', this.plugin.settings.languages.find((item) => item.code === this.plugin.activeLanguage)?.name ?? this.plugin.activeLanguage.toUpperCase());
		language.value = this.plugin.activeLanguage;
		language.addEventListener('change', () => {
			this.plugin.settings.defaultLanguage = language.value;
			language.setAttribute('title', this.plugin.settings.languages.find((item) => item.code === language.value)?.name ?? language.value.toUpperCase());
			void this.plugin.saveSettings();
		});
		if (this.plugin.lookupStatus === 'loading') {
			el.createDiv({ text: `Looking up “${this.plugin.currentQuery}”…`, cls: 'mynary-state mynary-loading' });
		} else if (this.plugin.lookupStatus === 'error') {
			el.createDiv({ text: this.plugin.lookupError, cls: 'mynary-state mynary-error' });
			const retry = el.createEl('button', { text: 'Try again' });
			retry.addEventListener('click', submitLookup);
		} else if (this.plugin.lastEntry) {
			renderEntry(el, this.plugin.lastEntry, this.plugin);
		} else {
			el.createDiv({ text: 'Select a word in a note or search above.', cls: 'mynary-empty' });
		}
		if (this.plugin.getHistory().length) {
			const history = el.createDiv('mynary-history'); history.createEl('h4', { text: 'Recent' });
			this.plugin.getHistory().forEach((word) => { const button = history.createEl('button', { text: word }); button.addEventListener('click', () => void this.plugin.lookup(word)); });
		}
	}
}

class DictionarySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MynaryPlugin) { super(app, plugin); }
	display() {
		const el = this.containerEl; el.empty();
		new Setting(el).setName('Default language').setDesc('Wiktionary language section to search.').addDropdown((dropdown) => { this.plugin.settings.languages.forEach((item) => { dropdown.addOption(item.code, item.name); }); dropdown.setValue(this.plugin.settings.defaultLanguage).onChange((value) => { this.plugin.settings.defaultLanguage = value; void this.plugin.saveSettings(); }); });
		new Setting(el).setName('Note folder').setDesc('Folder for vocabulary notes. Leave empty for the vault root.').addText((text) => text.setValue(this.plugin.settings.noteFolder).onChange((value) => { this.plugin.settings.noteFolder = value.trim(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Filename template').setDesc('Supports {{word}} and {{language}}.').addText((text) => text.setValue(this.plugin.settings.filenameTemplate).onChange((value) => { this.plugin.settings.filenameTemplate = value || '{{word}}'; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Cache ttl (days)').addText((text) => text.setValue(String(this.plugin.settings.cacheTtlDays)).onChange((value) => { const n = Math.max(1, Number(value) || 7); this.plugin.settings.cacheTtlDays = n; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Maximum cached entries').addText((text) => text.setValue(String(this.plugin.settings.maxCacheEntries)).onChange((value) => { const n = Math.max(1, Number(value) || 100); this.plugin.settings.maxCacheEntries = n; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Default template').addDropdown((dropdown) => { this.plugin.settings.templates.forEach((template) => { dropdown.addOption(template.id, template.name); }); dropdown.setValue(this.plugin.settings.defaultTemplateId).onChange((value) => { this.plugin.settings.defaultTemplateId = value; void this.plugin.saveSettings(); }); });
		new Setting(el).setName('Existing note behavior').setDesc('Update section preserves content outside mynary markers and replaces only the generated section.').addDropdown((dropdown) => dropdown.addOption('ask', 'Ask before replacing').addOption('overwrite', 'Replace automatically').addOption('update-section', 'Update section').setValue(this.plugin.settings.existingNoteBehavior).onChange((value) => { this.plugin.settings.existingNoteBehavior = value as DictionarySettings['existingNoteBehavior']; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Templates').setDesc('Choose a template separately each time you copy, insert or create a note. Manage names, content, variables and default template in a larger editor.').addButton((button) => button.setButtonText('Manage templates').onClick(() => this.plugin.openTemplateManager()));
		new Setting(el).setName('Clear cache').addButton((button) => button.setButtonText('Clear').setWarning().onClick(() => { void this.plugin.cache.clear().then(() => { new Notice('Dictionary cache cleared.'); this.display(); }); }));
	}
}
