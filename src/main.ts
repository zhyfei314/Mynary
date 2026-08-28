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
import { DictionarySettings, isRecord, migrateTemplates, normalizeSettings } from './settings';
import { WiktionaryProvider } from './providers/wiktionary';
import type { WiktionaryHttpResponse, WiktionaryRequester } from './providers/wiktionary';
import { CacheManager } from './services/cache';
import { SupertonicProvider } from './providers/supertonic';
import type { SupertonicRequester } from './providers/supertonic';
import { SupertonicWebProvider } from './providers/supertonic-web';
import { renderEntry } from './utils/format';
import { createVocabularyNote, renderTemplate } from './templates/template';
import { analyzeSelection, normalizeSelection } from './utils/selection';
import { openTemplatePicker, TemplateManagerModal } from './ui/template-modals';
import type { TemplateAction } from './ui/template-modals';
import type { DeclarativeSettingDefinition } from './settings-definitions';

export const VIEW_TYPE_DICTIONARY = 'mynary-dictionary-view';
const CACHE_FORMAT_VERSION = 'v6';
const requestWiktionary: WiktionaryRequester = async (url): Promise<WiktionaryHttpResponse> => {
	const response = await requestUrl(url);
	return { status: response.status, json: response.json as unknown };
};
const requestSupertonic: SupertonicRequester = async (url, body) => {
	const response = await requestUrl({ url, method: 'POST', headers: { 'content-type': 'application/json' }, body });
	return { status: response.status, arrayBuffer: response.arrayBuffer, mimeType: response.headers['content-type'] };
};
type LookupStatus = 'idle' | 'loading' | 'success' | 'error';
type LookupListener = (status: LookupStatus) => void;

function waitForAudioReady(player: HTMLAudioElement) {
	if (player.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
	return new Promise<void>((resolve, reject) => {
		let timeoutId: number | undefined;
		const cleanup = () => {
			player.removeEventListener('canplay', onReady);
			player.removeEventListener('loadeddata', onReady);
			player.removeEventListener('error', onError);
			if (timeoutId !== undefined) window.clearTimeout(timeoutId);
		};
		const onReady = () => { cleanup(); resolve(); };
		const onError = () => { cleanup(); reject(new Error('The generated audio could not be loaded.')); };
		player.addEventListener('canplay', onReady, { once: true });
		player.addEventListener('loadeddata', onReady, { once: true });
		player.addEventListener('error', onError, { once: true });
		timeoutId = window.setTimeout(() => { cleanup(); reject(new Error('The generated audio took too long to load.')); }, 10_000);
		player.load();
	});
}

export default class MynaryPlugin extends Plugin {
	settings!: DictionarySettings;
	cache!: CacheManager;
	provider!: WiktionaryProvider;
	lastEntry?: DictionaryEntry;
	private history: string[] = [];
	private lookupListeners = new Set<LookupListener>();
	private lookupSequence = 0;
	private readAudioCache = new Map<string, { url: string; mimeType?: string }>();
	private readAudioInFlight = new Map<string, Promise<{ url: string; mimeType?: string }>>();
	private activeReader?: HTMLAudioElement;
	lookupStatus: LookupStatus = 'idle';
	lookupError = '';
	currentQuery = '';
	lastLookupWasCached = false;
	private historySave: Promise<void> = Promise.resolve();

	async onload() {
		const raw = await this.loadData() as unknown;
		this.settings = normalizeSettings(raw);
		this.history = normalizeHistory(raw);
		if (migrateTemplates(this.settings.templates)) await this.saveSettings();
		this.cache = new CacheManager(this, this.settings);
		this.rebuildProvider();
		this.registerView(VIEW_TYPE_DICTIONARY, (leaf) => new DictionaryView(leaf, this));
		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			if (!editor.getSelection().trim()) return;
			menu.addItem((item) => item.setTitle('Lookup').setIcon('search').onClick(() => void this.lookupSelected(editor)));
			menu.addItem((item) => item.setTitle('Read with supertonic').setIcon('volume-2').onClick(() => void this.readSelected(editor)));
		}));

		this.addRibbonIcon('book-open', 'Open dictionary sidebar', () => this.activateView());
		this.addCommand({
			id: 'lookup-selected-word',
			name: 'Lookup selected word',
			icon: 'search',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'L' }],
			editorCallback: (editor) => void this.lookupSelected(editor),
		});
		this.addCommand({
			id: 'read-selected-word',
			name: 'Read selected text with supertonic',
			icon: 'volume-2',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'R' }],
			editorCallback: (editor) => void this.readSelected(editor),
		});
		this.addCommand({ id: 'open-dictionary-sidebar', name: 'Open dictionary sidebar', callback: () => this.activateView() });
		this.addCommand({ id: 'create-vocabulary-note', name: 'Create vocabulary note from lookup', checkCallback: (checking) => this.commandWithEntry(checking, () => this.createNote()) });
		this.addCommand({ id: 'insert-lookup-result', name: 'Insert lookup result', checkCallback: (checking) => this.commandWithEntry(checking, () => this.insertResult()) });
		this.addCommand({ id: 'clear-dictionary-cache', name: 'Clear dictionary cache', callback: async () => { await this.cache.clear(); new Notice('Dictionary cache cleared.'); } });
		this.addSettingTab(new DictionarySettingTab(this.app, this));

		// Cache loading is independent of the popup and the command lifecycle.
		// Keep history hydration in the background so a cold start does not make
		// lookup actions wait for the cache before they become available.
		void this.hydrateHistory();
	}

	private async hydrateHistory() {
		await this.cache.whenReady();
		if (this.history.length) return;
		this.history = this.cache.getRecentWords();
		this.notifyLookupListeners();
	}

	async saveSettings() {
		const raw = await this.loadData() as unknown;
		const existing = isRecord(raw) ? raw : {};
		await this.saveData({ ...existing, ...this.settings });
	}

	rebuildProvider() {
		this.clearReadAudioCache();
		const tts = this.settings.ttsEnabled
			? this.settings.ttsRuntime === 'server'
				? new SupertonicProvider(requestSupertonic, this.settings.supertonicEndpoint, this.settings.supertonicVoice, this.settings.supertonicSteps, this.settings.supertonicSpeed)
				: new SupertonicWebProvider(this.settings.supertonicVoice, this.settings.supertonicSteps, this.settings.supertonicSpeed, this.app.vault.adapter.getResourcePath(`${this.manifest.dir}/ort-wasm-simd-threaded.jsep.wasm`))
			: undefined;
		this.provider = new WiktionaryProvider(requestWiktionary, tts, this.settings.ttsAutoGenerate);
	}

	async generateTts(pronunciationIndex: number, word: string, language: string) {
		if (!this.provider.ttsAvailable) { new Notice('Enable supertonic in settings first.'); return; }
		if (!this.provider.ttsAvailableFor(language)) { new Notice(`Supertonic does not support ${language.toUpperCase()}; IPA remains available.`); return; }
		if (this.settings.ttsRuntime === 'web' && !(await this.hasWebTtsRuntime())) return;
		new Notice('Preparing supertonic… the first web runtime use may download the model.');
		try {
			const source = await this.provider.synthesizeTts(word, language);
			if (!this.lastEntry || this.lastEntry.word !== word || this.lastEntry.language !== language) return;
			const phonetics = this.lastEntry.phonetics.map((pronunciation, index) => index === pronunciationIndex
				? { ...pronunciation, audio: [...(pronunciation.audio ?? []).filter((audio) => audio.provider !== 'tts'), source] }
				: pronunciation);
			this.lastEntry = { ...this.lastEntry, phonetics };
			this.notifyLookupListeners();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Could not generate Supertonic audio.');
		}
	}

	async readSelected(editor: Editor) {
		const text = editor.getSelection().trim();
		if (!text) { new Notice('Select text first.'); return; }
		await this.readText(text);
	}

	async readCurrentSelection() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.editor.getSelection().trim()) { await this.readSelected(activeView.editor); return; }
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			if (leaf.view.editor.getSelection().trim()) { await this.readSelected(leaf.view.editor); return; }
		}
		new Notice('Select text first.');
	}

	private async readText(text: string) {
		if (!this.provider.ttsAvailable) { new Notice('Enable supertonic in settings first.'); return; }
		if (!this.provider.ttsAvailableFor(this.activeLanguage)) { new Notice(`Supertonic does not support ${this.activeLanguage.toUpperCase()}; IPA remains available.`); return; }
		if (this.settings.ttsRuntime === 'web' && !(await this.hasWebTtsRuntime())) return;
		const normalizedText = text.replace(/\s+/g, ' ').trim();
		if (!normalizedText) { new Notice('Select some text first.'); return; }
		const cacheKey = `${this.activeLanguage}:${normalizedText}`;
		try {
			let source = this.readAudioCache.get(cacheKey);
			if (!source) {
				new Notice('Generating speech…');
				let pending = this.readAudioInFlight.get(cacheKey);
				if (!pending) {
					pending = this.provider.synthesizeTts(normalizedText, this.activeLanguage).then((result) => ({ url: result.url, mimeType: result.mimeType }));
					this.readAudioInFlight.set(cacheKey, pending);
					void pending.finally(() => this.readAudioInFlight.delete(cacheKey));
				}
				source = await pending;
				this.readAudioCache.set(cacheKey, source);
			}
			this.activeReader?.pause();
			const player = new Audio();
			player.preload = 'auto';
			player.volume = 1;
			player.src = source.url;
			this.activeReader = player;
			await waitForAudioReady(player);
			await player.play();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Could not read the selected text.');
		}
	}

	private async hasWebTtsRuntime() {
		const path = `${this.manifest.dir}/ort-wasm-simd-threaded.jsep.wasm`;
		if (await this.app.vault.adapter.exists(path)) return true;
		new Notice('Web supertonic runtime is not installed. Add the optional wasm file to the Mynary plugin folder, or select local server in settings.');
		return false;
	}

	private clearReadAudioCache() {
		this.activeReader?.pause();
		this.activeReader = undefined;
		for (const source of this.readAudioCache.values()) URL.revokeObjectURL(source.url);
		this.readAudioCache.clear();
		this.readAudioInFlight.clear();
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

	async lookupCurrentSelection() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.editor.getSelection().trim()) {
			await this.lookupSelected(activeView.editor);
			return;
		}
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			if (leaf.view.editor.getSelection().trim()) {
				await this.lookupSelected(leaf.view.editor);
				return;
			}
		}
		new Notice('Select a word in a note first.');
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
		try {
			const cached = await this.cache.get(key);
			if (requestId !== this.lookupSequence) return undefined;
			if (cached && !forceRefresh) { this.lastLookupWasCached = true; await this.setEntry(cached, normalized); return cached; }
			const entry = await this.provider.lookup(normalized, language);
			if (requestId !== this.lookupSequence) return undefined;
			await this.cache.set(key, entry);
			if (requestId !== this.lookupSequence) return undefined;
			await this.setEntry(entry, normalized);
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

	private async setEntry(entry: DictionaryEntry, historyWord: string) {
		this.lastEntry = entry;
		this.lookupStatus = 'success';
		this.lookupError = '';
		this.history = [historyWord, ...this.history.filter((item) => item !== historyWord)].slice(0, 20);
		await this.persistHistory();
		this.notifyLookupListeners();
	}

	private async persistHistory() {
		this.historySave = this.historySave.then(async () => {
			const raw = await this.loadData() as unknown;
			const existing = isRecord(raw) ? raw : {};
			await this.saveData({ ...existing, history: this.history });
		});
		await this.historySave;
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
		if (!this.selectionChoice) {
			// Start the lookup before the first render so a cold popup shows its
			// loading state instead of briefly displaying "No result yet.".
			void this.plugin.lookup(this.word);
			return;
		}
		this.render();
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

function normalizeHistory(raw: unknown): string[] {
	if (!isRecord(raw) || !Array.isArray(raw.history)) return [];
	const history: string[] = [];
	for (const value of raw.history) {
		if (typeof value !== 'string') continue;
		const word = value.trim();
		if (word && !history.includes(word)) history.push(word);
	}
	return history.slice(0, 20);
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
		const selectionLookup = search.createEl('button', { text: 'Lookup selected text', cls: 'mynary-selection-lookup' });
		selectionLookup.addEventListener('click', () => void this.plugin.lookupCurrentSelection());
		const selectionRead = search.createEl('button', { text: 'Read selected text', cls: 'mynary-selection-read' });
		selectionRead.addEventListener('click', () => void this.plugin.readCurrentSelection());
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

	/** Obsidian 1.13+ uses this for native settings rendering and Settings Search. */
	getSettingDefinitions(): DeclarativeSettingDefinition[] {
		const languageOptions = Object.fromEntries(this.plugin.settings.languages.map((language) => [language.code, language.name]));
		const templateOptions = Object.fromEntries(this.plugin.settings.templates.map((template) => [template.id, template.name]));
		return [
			{
				name: 'Default language',
				desc: 'Wiktionary language section to search.',
				aliases: ['dictionary language', 'lookup language'],
				control: { type: 'dropdown', key: 'defaultLanguage', options: languageOptions, defaultValue: 'en' },
			},
			{
				name: 'Note folder',
				desc: 'Folder for vocabulary notes. Leave empty for the vault root.',
				aliases: ['vocabulary folder', 'notes folder'],
				control: { type: 'text', key: 'noteFolder', placeholder: 'Vault root' },
			},
			{
				name: 'Filename template',
				desc: 'Supports {{word}} and {{language}}.',
				aliases: ['note filename', 'file name'],
				control: { type: 'text', key: 'filenameTemplate', defaultValue: '{{word}}' },
			},
			{
				name: 'Cache TTL (days)',
				desc: 'How long lookup results remain cached.',
				aliases: ['cache duration', 'cache expiration'],
				control: { type: 'slider', key: 'cacheTtlDays', min: 1, max: 30, step: 1, defaultValue: 7, validate: (value) => typeof value === 'number' && value >= 1 ? undefined : 'Must be at least 1 day.' },
			},
			{
				name: 'Maximum cached entries',
				desc: 'Maximum number of lookup results stored locally.',
				aliases: ['cache limit', 'cache size'],
				control: { type: 'slider', key: 'maxCacheEntries', min: 1, max: 500, step: 1, defaultValue: 100, validate: (value) => typeof value === 'number' && value >= 1 ? undefined : 'Must be at least 1 entry.' },
			},
			{
				name: 'Enable Supertonic local TTS',
				desc: 'Enable the optional local TTS controls and selected-text reading.',
				aliases: ['text to speech', 'tts', 'offline speech'],
				control: { type: 'dropdown', key: 'ttsEnabled', options: { 'false': 'Disabled', 'true': 'Enabled' }, defaultValue: this.plugin.settings.ttsEnabled ? 'true' : 'false' },
			},
			{
				name: 'Auto-generate tts when audio is missing',
				desc: 'Generate a supertonic pronunciation during lookup when wiktionary has no audio.',
				aliases: ['automatic pronunciation', 'tts fallback'],
				control: { type: 'dropdown', key: 'ttsAutoGenerate', options: { 'false': 'Disabled', 'true': 'Enabled' }, defaultValue: this.plugin.settings.ttsAutoGenerate ? 'true' : 'false' },
			},
			{
				name: 'Supertonic runtime',
				desc: 'Web runs in the plugin without a terminal; server uses the advanced local bridge.',
				aliases: ['tts runtime', 'web tts', 'local tts server'],
				control: { type: 'dropdown', key: 'ttsRuntime', options: { web: 'Web (recommended)', server: 'Local server' }, defaultValue: this.plugin.settings.ttsRuntime },
			},
			{
				name: 'Supertonic endpoint',
				desc: 'Used only by the Local server runtime. Normally http://127.0.0.1:7788/v1/tts.',
				aliases: ['tts endpoint', 'speech server'],
				control: { type: 'text', key: 'supertonicEndpoint', placeholder: 'http://127.0.0.1:7788/v1/tts' },
			},
			{
				name: 'Supertonic voice',
				desc: 'Voice/style identifier accepted by the local server.',
				aliases: ['tts voice', 'speaker style'],
				control: { type: 'text', key: 'supertonicVoice', placeholder: 'M1' },
			},
			{
				name: 'Supertonic steps',
				desc: 'Quality/speed trade-off for local speech synthesis.',
				aliases: ['tts steps'],
				control: { type: 'slider', key: 'supertonicSteps', min: 4, max: 16, step: 1, defaultValue: 8 },
			},
			{
				name: 'Supertonic speed',
				desc: 'Playback speed sent to Supertonic.',
				aliases: ['tts speed'],
				control: { type: 'slider', key: 'supertonicSpeed', min: 0.7, max: 2, step: 0.05, defaultValue: 1.05 },
			},
			{
				name: 'Default template',
				desc: 'Template selected by default for copy, insert and note actions.',
				aliases: ['vocabulary template', 'note template'],
				control: { type: 'dropdown', key: 'defaultTemplateId', options: templateOptions },
			},
			{
				name: 'Existing note behavior',
				desc: 'What to do when the generated note already exists.',
				aliases: ['duplicate note', 'overwrite note', 'update note'],
				control: { type: 'dropdown', key: 'existingNoteBehavior', options: { ask: 'Ask before replacing', overwrite: 'Replace automatically', 'update-section': 'Update managed section' } },
			},
			{ name: 'Templates', desc: 'Create, edit, duplicate, preview and restore Markdown templates.', action: () => this.plugin.openTemplateManager() },
			{ name: 'Clear dictionary cache', desc: 'Remove all locally cached lookup results.', action: () => { void this.plugin.cache.clear().then(() => new Notice('Dictionary cache cleared.')); } },
		];
	}

	display() {
		const el = this.containerEl; el.empty();
		new Setting(el).setName('Default language').setDesc('Wiktionary language section to search.').addDropdown((dropdown) => { this.plugin.settings.languages.forEach((item) => { dropdown.addOption(item.code, item.name); }); dropdown.setValue(this.plugin.settings.defaultLanguage).onChange((value) => { this.plugin.settings.defaultLanguage = value; void this.plugin.saveSettings(); }); });
		new Setting(el).setName('Note folder').setDesc('Folder for vocabulary notes. Leave empty for the vault root.').addText((text) => text.setValue(this.plugin.settings.noteFolder).onChange((value) => { this.plugin.settings.noteFolder = value.trim(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Filename template').setDesc('Supports {{word}} and {{language}}.').addText((text) => text.setValue(this.plugin.settings.filenameTemplate).onChange((value) => { this.plugin.settings.filenameTemplate = value || '{{word}}'; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Cache ttl (days)').addText((text) => text.setValue(String(this.plugin.settings.cacheTtlDays)).onChange((value) => { const n = Math.max(1, Number(value) || 7); this.plugin.settings.cacheTtlDays = n; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Maximum cached entries').addText((text) => text.setValue(String(this.plugin.settings.maxCacheEntries)).onChange((value) => { const n = Math.max(1, Number(value) || 100); this.plugin.settings.maxCacheEntries = n; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Supertonic local tts').setDesc(`${this.plugin.settings.ttsEnabled ? 'Enabled' : 'Disabled'}. Optional audio supplement and selected-text reader.`).addToggle((toggle) => toggle.setValue(this.plugin.settings.ttsEnabled).onChange((value) => { this.plugin.settings.ttsEnabled = value; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); this.display(); }));
		new Setting(el).setName('Auto-generate tts when audio is missing').setDesc('Creates a supertonic audio source during lookup when wiktionary has ipa but no recording.').addToggle((toggle) => toggle.setValue(this.plugin.settings.ttsAutoGenerate).onChange((value) => { this.plugin.settings.ttsAutoGenerate = value; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Supertonic runtime').setDesc('Web is recommended and does not need a terminal.').addDropdown((dropdown) => dropdown.addOption('web', 'Web (recommended)').addOption('server', 'Local server').setValue(this.plugin.settings.ttsRuntime).onChange((value) => { this.plugin.settings.ttsRuntime = value === 'server' ? 'server' : 'web'; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Supertonic endpoint').setDesc('Used only by the local server runtime.').addText((text) => text.setValue(this.plugin.settings.supertonicEndpoint).onChange((value) => { this.plugin.settings.supertonicEndpoint = value.trim() || 'http://127.0.0.1:7788/v1/tts'; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Supertonic voice').addText((text) => text.setValue(this.plugin.settings.supertonicVoice).onChange((value) => { this.plugin.settings.supertonicVoice = value.trim() || 'M1'; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Supertonic steps').addText((text) => text.setValue(String(this.plugin.settings.supertonicSteps)).onChange((value) => { this.plugin.settings.supertonicSteps = Math.min(16, Math.max(4, Math.floor(Number(value) || 8))); this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Supertonic speed').addText((text) => text.setValue(String(this.plugin.settings.supertonicSpeed)).onChange((value) => { this.plugin.settings.supertonicSpeed = Math.min(2, Math.max(0.7, Number(value) || 1.05)); this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(el).setName('Default template').addDropdown((dropdown) => { this.plugin.settings.templates.forEach((template) => { dropdown.addOption(template.id, template.name); }); dropdown.setValue(this.plugin.settings.defaultTemplateId).onChange((value) => { this.plugin.settings.defaultTemplateId = value; void this.plugin.saveSettings(); }); });
		new Setting(el).setName('Existing note behavior').setDesc('Update section preserves content outside mynary markers and replaces only the generated section.').addDropdown((dropdown) => dropdown.addOption('ask', 'Ask before replacing').addOption('overwrite', 'Replace automatically').addOption('update-section', 'Update section').setValue(this.plugin.settings.existingNoteBehavior).onChange((value) => { this.plugin.settings.existingNoteBehavior = value as DictionarySettings['existingNoteBehavior']; void this.plugin.saveSettings(); }));
		new Setting(el).setName('Templates').setDesc('Choose a template separately each time you copy, insert or create a note. Manage names, content, variables and default template in a larger editor.').addButton((button) => button.setButtonText('Manage templates').onClick(() => this.plugin.openTemplateManager()));
		new Setting(el).setName('Clear cache').addButton((button) => button.setButtonText('Clear').setWarning().onClick(() => { void this.plugin.cache.clear().then(() => { new Notice('Dictionary cache cleared.'); this.display(); }); }));
	}
}
