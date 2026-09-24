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
import { DictionaryEntry, DictionaryPackManifest } from './types';
import { DictionarySettings, isRecord, migrateTemplates, MTRAN_LANGUAGE_OPTIONS, normalizeSettings } from './settings';
import { WiktionaryProvider } from './providers/wiktionary';
import type { WiktionaryHttpResponse, WiktionaryRequester } from './providers/wiktionary';
import { CacheManager } from './services/cache';
import { SupertonicProvider } from './providers/supertonic';
import type { SupertonicRequester } from './providers/supertonic';
import { SupertonicWebProvider } from './providers/supertonic-web';
import { OfflineDictionaryProvider } from './providers/offline-dictionary';
import { MTranServerProvider } from './providers/mtranserver';
import { AssetManager } from './services/asset-manager';
import { renderEntry } from './utils/format';
import { createVocabularyNote, renderTemplate } from './templates/template';
import { prepareFlashcardNote } from './templates/flashcard-renderer';
import { analyzeSelection, normalizeSelection } from './utils/selection';
import { openTemplatePicker, TemplateManagerModal } from './ui/template-modals';
import type { TemplateAction } from './ui/template-modals';
import type { DeclarativeSettingDefinition } from './settings-definitions';
import { TranslationModal } from './ui/translation-modal';
import { VocabularyView, VIEW_TYPE_VOCABULARY } from './ui/vocabulary-view';
import { addVocabularyCard, exportVocabulary, normalizeVocabulary, reviewVocabularyCard, setVocabularyStatus } from './services/vocabulary';
import type { ReviewRating, VocabularyCard, VocabularyStatus } from './services/vocabulary';
import { hasFlashcardSide, extractFlashcardSide } from './services/flashcard-markers';

export const VIEW_TYPE_DICTIONARY = 'mynary-dictionary-view';
const CACHE_FORMAT_VERSION = 'v7';
const SUPERTONIC_WASM_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/ort-wasm-simd-threaded.jsep.wasm';
const SUPERTONIC_WASM_SHA256 = '78feeeb3d08f6bcee94d938ed322f69073bb8076b5f9d34697a574ffba8deb48';
const PACK_CATALOG_URLS = [
	'https://raw.githubusercontent.com/zhyfei314/Mynary/master/dictionary-catalog/catalog.json',
	'https://huggingface.co/datasets/zhyfei314/Mynary-Offline-Dictionary/resolve/main/catalog.json',
];
const requestWiktionary: WiktionaryRequester = async (url): Promise<WiktionaryHttpResponse> => {
	const response = await requestUrl(url);
	return { status: response.status, json: response.json as unknown };
};
const requestSupertonic: SupertonicRequester = async (url, body) => {
	const response = await requestUrl({ url, method: 'POST', headers: { 'content-type': 'application/json' }, body });
	return { status: response.status, arrayBuffer: response.arrayBuffer, mimeType: response.headers['content-type'] };
};
const requestMTranServer = async (url: string, body: string, token: string) => {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
	const response = await requestUrl({ url, method: 'POST', headers, body });
	return { status: response.status, json: response.json as unknown };
};

async function downloadPackAsset(url: string, notice: Notice, fileName: string) {
	const chunkSize = 16 * 1024 * 1024;
	const chunks: Uint8Array[] = [];
	let received = 0;
	let total = 0;
	while (true) {
		let response;
		try {
			response = await requestUrl({ url, headers: { Range: `bytes=${received}-${received + chunkSize - 1}` }, throw: false });
		} catch {
			throw new Error(`Could not connect to the dictionary file host while downloading ${fileName}. Check your internet connection and pack URL.`);
		}
		if (response.status < 200 || response.status >= 300) throw new Error(`Could not download ${fileName} (HTTP ${response.status}).`);
		const chunk = new Uint8Array(response.arrayBuffer);
		const contentRange = Object.entries(response.headers).find(([key]) => key.toLowerCase() === 'content-range')?.[1];
		const match = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/iu);
		if (response.status === 206 && match) total = Number(match[3]);
		chunks.push(chunk);
		received += chunk.byteLength;
		const progress = total ? ` ${Math.min(100, Math.round((received / total) * 100))}% (${formatBytes(received)} / ${formatBytes(total)})` : ` ${formatBytes(received)}`;
		notice.setMessage(`Downloading ${fileName}${progress}`);
		if (response.status !== 206 || !match || received >= total || chunk.byteLength === 0) break;
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
	return bytes.buffer;
}

function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let value = bytes / 1024;
	let unit = units[0]!;
	for (let index = 1; value >= 1024 && index < units.length; index++) { value /= 1024; unit = units[index]!; }
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}
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
	private vocabulary: VocabularyCard[] = [];
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
		this.vocabulary = normalizeVocabulary(isRecord(raw) ? raw.vocabulary : undefined);
		if (migrateTemplates(this.settings.templates)) await this.saveSettings();
		this.cache = new CacheManager(this, this.settings);
		this.rebuildProvider();
		this.registerView(VIEW_TYPE_DICTIONARY, (leaf) => new DictionaryView(leaf, this));
		this.registerView(VIEW_TYPE_VOCABULARY, (leaf) => new VocabularyView(leaf, this));
		this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
			let changed = false;
			this.vocabulary = this.vocabulary.map((card) => {
				const previousPath = card.filePath;
				if (!previousPath || previousPath !== oldPath && !previousPath.startsWith(`${oldPath}/`)) return card;
				changed = true;
				const filePath = `${file.path}${previousPath.slice(oldPath.length)}`;
				const root = `${this.settings.vocabularyFolder ?? 'Vocabulary'}/`;
				const relative = filePath.startsWith(root) ? filePath.slice(root.length) : '';
				const deck = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
				return { ...card, filePath, ...(deck ? { deck } : {}) };
			});
			if (changed) { void this.persistVocabulary(); this.refreshVocabularyView(); }
		}));
		this.registerEvent(this.app.vault.on('delete', (file) => {
			const remaining = this.vocabulary.filter((card) => card.filePath !== file.path && !card.filePath?.startsWith(`${file.path}/`));
			if (remaining.length !== this.vocabulary.length) {
				this.vocabulary = remaining;
				void this.persistVocabulary();
				this.refreshVocabularyView();
			}
		}));
		this.registerEvent(this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
			if (!editor.getSelection().trim()) return;
			menu.addItem((item) => item.setTitle('Lookup').setIcon('search').onClick(() => void this.lookupSelected(editor)));
			menu.addItem((item) => item.setTitle('Read with supertonic').setIcon('volume-2').onClick(() => void this.readSelected(editor)));
			menu.addItem((item) => item.setTitle('Translate with MTranServer').setIcon('languages').onClick(() => void this.translateSelected(editor)));
		}));
		this.registerDomEvent(document, 'dblclick', (event) => {
			if (!this.settings.doubleClickLookup) return;
			const target = event.target;
			if (!(target instanceof HTMLElement) || !target.closest('.markdown-source-view, .markdown-preview-view')) return;
			window.setTimeout(() => {
				const selection = window.getSelection()?.toString().trim();
				if (selection) new LookupModal(this.app, this, selection, analyzeSelection(selection).tooLong).open();
			}, 0);
		});

		this.addRibbonIcon('book-open', 'Open dictionary sidebar', () => this.activateView());
		this.addRibbonIcon('library', 'Open vocabulary study', () => this.activateVocabularyView());
		this.addCommand({
			id: 'lookup-selected-word',
			name: 'Lookup selected word',
			icon: 'search',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'L' }],
			editorCallback: (editor) => void this.lookupSelected(editor),
		});
		this.addCommand({
			id: 'translate-selected-text',
			name: 'Translate selected text with MTranServer',
			icon: 'languages',
			editorCallback: (editor) => void this.translateSelected(editor),
		});
		this.addCommand({
			id: 'read-selected-word',
			name: 'Read selected text with supertonic',
			icon: 'volume-2',
			hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'R' }],
			editorCallback: (editor) => void this.readSelected(editor),
		});
		this.addCommand({ id: 'open-dictionary-sidebar', name: 'Open dictionary sidebar', callback: () => this.activateView() });
		this.addCommand({ id: 'open-vocabulary-study', name: 'Open vocabulary study', callback: () => this.activateVocabularyView() });
		this.addCommand({ id: 'review-due-vocabulary', name: 'Review due vocabulary', callback: () => this.activateVocabularyView(true) });
		this.addCommand({ id: 'create-vocabulary-note', name: 'Create vocabulary note from lookup', checkCallback: (checking) => this.commandWithEntry(checking, () => this.createNote()) });
		this.addCommand({ id: 'insert-lookup-result', name: 'Insert lookup result', checkCallback: (checking) => this.commandWithEntry(checking, () => this.insertResult()) });
		this.addCommand({ id: 'clear-dictionary-cache', name: 'Clear dictionary cache', callback: async () => { await this.cache.clear(); new Notice('Dictionary cache cleared.'); } });
		this.addCommand({ id: 'install-dictionary-pack', name: 'Install offline dictionary pack from URL', callback: () => void this.installDictionaryPackFromUrl() });
		this.addCommand({ id: 'install-supertonic-web-runtime', name: 'Install supertonic web runtime', callback: () => void this.installWebTtsRuntime() });
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
		const offline = this.settings.offlineDictionaryEnabled
			? async (language: string) => (await this.getInstalledDictionaryPacks())
				.filter((pack) => pack.language === language)
				.map((pack) => new OfflineDictionaryProvider(this.app.vault.adapter, pack.storagePath))
			: undefined;
		this.provider = new WiktionaryProvider(requestWiktionary, tts, this.settings.ttsAutoGenerate, offline);
	}

	dictionaryPackPath(packId: string) { return `.mynary/dictionaries/${packId}`; }

	async installDictionaryPackFromUrl(onComplete?: () => void) {
		const manifestUrl = await requestDictionaryManifestUrl(this.app);
		if (!manifestUrl) return;
		await this.installDictionaryPack(manifestUrl, onComplete);
	}

	async installDictionaryPackFromCatalog(onComplete?: () => void) {
		try {
			let response: Awaited<ReturnType<typeof requestUrl>> | undefined;
			let lastError: unknown;
			for (const catalogUrl of PACK_CATALOG_URLS) {
				try {
					response = await requestUrl(catalogUrl);
					break;
				} catch (error) {
					lastError = error;
				}
			}
			if (!response) throw lastError instanceof Error ? lastError : new Error('Could not load the dictionary catalog.');
			const catalog = response.json as { packs?: CatalogPackOption[] };
			const packs = (catalog.packs ?? []).filter((pack) => typeof pack.manifestUrl === 'string' && typeof pack.language === 'string');
			if (!packs.length) throw new Error('The dictionary catalog is empty.');
			new DictionaryPackCatalogModal(this.app, packs, (url) => void this.installDictionaryPack(url, onComplete)).open();
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Could not load the dictionary catalog.');
		}
	}

	private async installDictionaryPack(manifestUrl: string, onComplete?: () => void) {
		let downloadNotice: Notice | undefined;
		try {
			new Notice('Downloading dictionary pack manifest…');
			const manifestResponse = await requestUrl(manifestUrl.trim());
			const manifest = manifestResponse.json as Partial<DictionaryPackManifest>;
		if (manifest.format !== 'mynary-pack-v1' || (manifest.kind !== 'core' && manifest.kind !== 'bilingual') || typeof manifest.language !== 'string' || !/^[a-z]{2,3}$/u.test(manifest.language) || (manifest.kind === 'bilingual' && (typeof manifest.targetLanguage !== 'string' || !/^[a-z]{2,3}$/u.test(manifest.targetLanguage))) || typeof manifest.indexFile !== 'string' || !/^[\w.-]+$/u.test(manifest.indexFile) || typeof manifest.entriesFile !== 'string' || !/^[\w.-]+$/u.test(manifest.entriesFile) || typeof manifest.indexSha256 !== 'string' || !/^[a-f\d]{64}$/iu.test(manifest.indexSha256) || typeof (manifest.entriesSha256 ?? manifest.sha256) !== 'string' || !/^[a-f\d]{64}$/iu.test((manifest.entriesSha256 ?? manifest.sha256)!)) throw new Error('The URL is not a valid Mynary pack manifest or is missing required SHA-256 checksums.');
			const baseUrl = manifestUrl.trim().replace(/\/[^/]*$/u, '/');
			downloadNotice = new Notice(`Preparing ${manifest.name ?? 'dictionary pack'}…`, 0);
			const fetchAsset = (file: string) => downloadPackAsset(new URL(file, baseUrl).toString(), downloadNotice!, file);
			const index = await fetchAsset(manifest.indexFile);
			const entries = await fetchAsset(manifest.entriesFile);
			const manager = new AssetManager(this.app.vault.adapter);
			const packId = typeof manifest.id === 'string' && /^[a-z0-9][a-z0-9._-]*$/u.test(manifest.id) ? manifest.id : `${manifest.language}-${manifest.targetLanguage ?? 'core'}`;
			const root = this.dictionaryPackPath(packId);
			const previousPaths = (await this.getInstalledDictionaryPacks()).filter((pack) => pack.id === packId && pack.storagePath !== root).map((pack) => pack.storagePath);
			await manager.install({ id: `${packId}-index`, url: 'inline', destination: `${root}/${manifest.indexFile}`, sha256: manifest.indexSha256 }, async () => index);
			await manager.install({ id: `${packId}-entries`, url: 'inline', destination: `${root}/${manifest.entriesFile}`, sha256: manifest.entriesSha256 ?? manifest.sha256 }, async () => entries);
			await this.app.vault.adapter.write(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
			for (const previousPath of previousPaths) await this.app.vault.adapter.rmdir(previousPath, true);
			this.rebuildProvider();
			await this.cache.clear();
			downloadNotice.hide();
			downloadNotice = undefined;
			new Notice(`Installed offline ${manifest.name ?? manifest.language} dictionary.`);
			onComplete?.();
		} catch (error) {
			downloadNotice?.hide();
			new Notice(error instanceof Error ? error.message : 'Could not install dictionary pack.');
		}
	}

	async getInstalledDictionaryPacks() {
		const root = '.mynary/dictionaries';
		if (!(await this.app.vault.adapter.exists(root))) return [];
		const listing = await this.app.vault.adapter.list(root);
		const packs: Array<DictionaryPackManifest & { storagePath: string }> = [];
		for (const folder of listing.folders) {
			try {
				const manifest = JSON.parse(await this.app.vault.adapter.read(`${folder}/manifest.json`)) as DictionaryPackManifest;
				if (manifest.format === 'mynary-pack-v1' && typeof manifest.language === 'string') packs.push({ ...manifest, storagePath: folder });
			} catch {
				// Ignore incomplete or manually removed packs.
			}
		}
		return packs.sort((left, right) => `${left.language}-${left.targetLanguage ?? ''}-${left.id}`.localeCompare(`${right.language}-${right.targetLanguage ?? ''}-${right.id}`));
	}

	async hasInstalledOfflinePack(language = this.activeLanguage) {
		return this.settings.offlineDictionaryEnabled !== false && (await this.getInstalledDictionaryPacks()).some((pack) => pack.language === language);
	}

	async lookupFromOfflinePack(word: string, pack: DictionaryPackManifest & { storagePath: string }) {
		const query = normalizeSelection(word);
		if (!query) return;
		const requestId = ++this.lookupSequence;
		this.lastEntry = undefined;
		this.currentQuery = query;
		this.lookupStatus = 'loading';
		this.lookupError = '';
		this.lastLookupWasCached = false;
		this.notifyLookupListeners();
		try {
			const provider = new OfflineDictionaryProvider(this.app.vault.adapter, pack.storagePath);
			const entry = await provider.lookup(query);
			if (requestId !== this.lookupSequence) return;
			if (!entry) throw new Error(`“${query}” is not available in ${pack.name}.`);
			await this.setEntry(entry, query);
		} catch (error) {
			if (requestId !== this.lookupSequence) return;
			this.lookupStatus = 'error';
			this.lookupError = error instanceof Error ? error.message : 'Offline pack lookup failed.';
			this.notifyLookupListeners();
		}
	}

	async removeDictionaryPack(packId: string, storagePath?: string) {
		if (!/^[a-z0-9][a-z0-9._-]*$/u.test(packId)) return;
		const path = storagePath ?? this.dictionaryPackPath(packId);
		if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.rmdir(path, true);
		this.rebuildProvider();
		await this.cache.clear();
		new Notice(`Removed offline ${packId} dictionary pack.`);
	}

	async updateDictionaryPack(installed: DictionaryPackManifest) {
		try {
			let catalogResponse: Awaited<ReturnType<typeof requestUrl>> | undefined;
			for (const catalogUrl of PACK_CATALOG_URLS) {
				try { catalogResponse = await requestUrl(catalogUrl); break; } catch { /* Try the next public catalog mirror. */ }
			}
			if (!catalogResponse) throw new Error('Could not load the dictionary catalog to check for updates.');
			const packs = (catalogResponse.json as { packs?: Array<CatalogPackOption> }).packs ?? [];
			const latest = packs.find((pack) => pack.id === installed.id);
			if (!latest?.manifestUrl || latest.version === installed.version) { new Notice(`${installed.name} is up to date.`); return; }
			await this.installDictionaryPack(latest.manifestUrl);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Could not check for dictionary updates.');
		}
	}

	async testMTranServerConnection() {
		try {
			const provider = new MTranServerProvider(requestMTranServer, this.settings.mtranServerEndpoint, this.settings.mtranServerToken, this.settings.mtranServerTimeoutMs);
			const result = await provider.translate('Hello', 'en', 'vi');
			new Notice(`MTranServer connected. Test result: ${result}`, 8000);
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Could not connect to MTranServer.', 8000);
		}
	}

	openDictionaryPackManager() {
		new DictionaryPackManagerModal(this.app, this).open();
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
		new Notice('Installing the supertonic web runtime…');
		return this.installWebTtsRuntime();
	}

	async installWebTtsRuntime(): Promise<boolean> {
		const path = `${this.manifest.dir}/ort-wasm-simd-threaded.jsep.wasm`;
		try {
			new Notice('Downloading supertonic web runtime…');
			const manager = new AssetManager(this.app.vault.adapter);
			await manager.install({ id: 'supertonic-web-wasm', url: SUPERTONIC_WASM_URL, destination: path, sha256: SUPERTONIC_WASM_SHA256 }, async (url) => (await requestUrl(url)).arrayBuffer);
			new Notice('Supertonic web runtime installed.');
			return true;
		} catch (error) {
			new Notice(error instanceof Error ? error.message : 'Could not install the Supertonic web runtime.');
			return false;
		}
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
	getVocabulary() { return this.vocabulary; }
	getVocabularyDecks() { return [...new Set([...(this.settings.vocabularyDecks ?? []), ...this.vocabulary.map((card) => card.deck), 'General'])].sort((a, b) => a.localeCompare(b)); }
	getNewCardsPerDay() { return this.settings.newCardsPerDay ?? 20; }

	async addVocabulary(entry: DictionaryEntry, status: VocabularyStatus = 'learning', requestedDeck?: string) {
		const choice = requestedDeck ? { deck: requestedDeck } : await this.chooseVocabularyDeck();
		if (!choice) return;
		const deck = choice.deck;
		this.settings.vocabularyDecks ??= ['General'];
		if (!this.settings.vocabularyDecks.includes(deck)) this.settings.vocabularyDecks.push(deck);
		this.vocabulary = addVocabularyCard(this.vocabulary, entry, status, Date.now(), deck);
		const card = this.vocabulary.find((item) => item.id === `${entry.language.toLocaleLowerCase()}:${entry.word.trim().toLocaleLowerCase()}`)!;
		if (!card.filePath) card.filePath = await this.createVocabularyCardNote(card, choice.templateId);
		await this.saveSettings();
		await this.persistVocabulary();
		new Notice(`Added “${entry.word}” to ${deck}.`);
	}

	async createVocabularyDeck() {
		const choice = await this.chooseVocabularyDeck(true);
		if (!choice) return;
		const deck = choice.deck;
		this.settings.vocabularyDecks ??= ['General'];
		if (!this.settings.vocabularyDecks.includes(deck)) this.settings.vocabularyDecks.push(deck);
		await this.ensureVaultFolder(`${this.settings.vocabularyFolder ?? 'Vocabulary'}/${deck}`);
		await this.saveSettings();
		this.refreshVocabularyView();
	}

	private chooseVocabularyDeck(createOnly = false): Promise<{ deck: string; templateId?: string } | undefined> {
		const templates = this.settings.templates.filter((template) => template.type === 'flashcard');
		return new Promise((resolve) => new VocabularyDeckModal(this.app, this.getVocabularyDecks(), this.settings.defaultVocabularyDeck ?? 'General', templates, this.settings.defaultVocabularyTemplateId ?? templates[0]?.id ?? '', resolve, createOnly).open());
	}

	async setVocabularyCardStatus(card: VocabularyCard, status: VocabularyStatus) {
		this.vocabulary = this.vocabulary.map((item) => item.id === card.id ? setVocabularyStatus(item, status) : item);
		await this.persistVocabulary();
		this.refreshVocabularyView();
	}

	async moveVocabularyCard(card: VocabularyCard, deck: string) {
		const updated = { ...card, deck };
		if (card.filePath) {
			const source = this.app.vault.getAbstractFileByPath(card.filePath);
			if (source && 'extension' in source) {
				const folder = `${this.settings.vocabularyFolder ?? 'Vocabulary'}/${deck}`;
				await this.ensureVaultFolder(folder);
				let destination = `${folder}/${card.entry.word.replace(/[\\/:*?"<>|]/gu, '-')}.md`;
				let suffix = 2;
				while (await this.app.vault.adapter.exists(destination) && destination !== card.filePath) destination = `${folder}/${card.entry.word.replace(/[\\/:*?"<>|]/gu, '-')}-${suffix++}.md`;
				await this.app.fileManager.renameFile(source, destination);
				updated.filePath = destination;
			}
		}
		this.vocabulary = this.vocabulary.map((item) => item.id === card.id ? updated : item);
		this.settings.vocabularyDecks ??= ['General'];
		if (!this.settings.vocabularyDecks.includes(deck)) this.settings.vocabularyDecks.push(deck);
		await this.saveSettings();
		await this.persistVocabulary();
		this.refreshVocabularyView();
	}

	async rateVocabularyCard(card: VocabularyCard, rating: ReviewRating) {
		this.vocabulary = this.vocabulary.map((item) => item.id === card.id ? reviewVocabularyCard(item, rating) : item);
		await this.persistVocabulary();
		this.refreshVocabularyView();
	}

	async removeVocabularyCard(card: VocabularyCard) {
		this.vocabulary = this.vocabulary.filter((item) => item.id !== card.id);
		await this.persistVocabulary();
		this.refreshVocabularyView();
	}

	async openVocabularyNote(card: VocabularyCard) {
		const file = card.filePath ? this.app.vault.getAbstractFileByPath(card.filePath) : null;
		if (file && 'extension' in file) await this.app.workspace.getLeaf(false).openFile(file as import('obsidian').TFile);
		else new Notice('Card note is missing. Add this word again to create a note.');
	}

	async readVocabularyNote(card: VocabularyCard, side: 'front' | 'back' = 'back') {
		const file = card.filePath ? this.app.vault.getAbstractFileByPath(card.filePath) : null;
		if (!file || !('extension' in file)) return undefined;
		const text = await this.app.vault.cachedRead(file as import('obsidian').TFile);
		const extracted = extractFlashcardSide(text, side);
		// Older generated notes accidentally nested the complete card body inside the back markers.
		if (side === 'back' && extracted && hasFlashcardSide(extracted, 'front')) return undefined;
		return extracted;
	}

	private async createVocabularyCardNote(card: VocabularyCard, templateId?: string) {
		const folder = `${this.settings.vocabularyFolder ?? 'Vocabulary'}/${card.deck}`;
		await this.ensureVaultFolder(folder);
		const base = card.entry.word.replace(/[\\/:*?"<>|]/gu, '-').trim() || 'Vocabulary';
		let path = `${folder}/${base}.md`;
		let suffix = 2;
		while (await this.app.vault.adapter.exists(path)) path = `${folder}/${base}-${suffix++}.md`;
		const template = this.settings.templates.find((item) => item.id === templateId && item.type === 'flashcard') ?? this.settings.templates.find((item) => item.type === 'flashcard');
		const targetLanguage = this.settings.vocabularyAnswerLanguage ?? '';
		let content = prepareFlashcardNote(card.entry, template?.content ?? '', targetLanguage).content;
		if (!content.startsWith('---')) content = `---\nmynary-vocabulary-id: ${JSON.stringify(card.id)}\nmynary-language: ${JSON.stringify(card.entry.language)}\nmynary-deck: ${JSON.stringify(card.deck)}\n---\n\n${content}`;
		await this.app.vault.create(path, content);
		return path;
	}

	private async ensureVaultFolder(path: string) {
		let current = '';
		for (const part of path.split('/').filter(Boolean)) {
			current = current ? `${current}/${part}` : part;
			if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.createFolder(current);
		}
	}

	async exportVocabularyFile(format: 'json' | 'csv' | 'anki') {
		if (!this.vocabulary.length) { new Notice('Your vocabulary list is empty.'); return; }
		const extension = format === 'anki' ? 'txt' : format;
		const base = `Mynary-vocabulary-${new Date().toISOString().slice(0, 10)}.${extension}`;
		let path = base;
		let suffix = 2;
		while (await this.app.vault.adapter.exists(path)) path = base.replace(`.${extension}`, `-${suffix++}.${extension}`);
		await this.app.vault.create(path, exportVocabulary(this.vocabulary, format));
		new Notice(`Exported vocabulary to ${path}.`);
	}

	async createVocabularyNotes(cards: VocabularyCard[]) {
		let created = 0;
		const failed: string[] = [];
		for (const card of cards) {
			try {
				const templateId = this.settings.languageTemplateIds?.[card.entry.language] ?? this.settings.defaultTemplateId;
				const noteSettings = { ...this.settings, noteFolder: `${this.settings.vocabularyFolder ?? 'Vocabulary'}/${card.deck}` };
				await createVocabularyNote(this.app, card.entry, noteSettings, templateId, { targetLanguage: this.settings.mtranTargetLanguages[card.entry.language] ?? this.settings.mtranTargetLanguage });
				created++;
			} catch (error) {
				failed.push(`${card.entry.word}: ${error instanceof Error ? error.message : 'failed'}`);
			}
		}
		new Notice(`Created ${created} vocabulary note${created === 1 ? '' : 's'}${failed.length ? `. ${failed.length} skipped or failed: ${failed.join('; ')}` : '.'}`, 8000);
	}

	async activateVocabularyView(dueOnly = false) {
		let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_VOCABULARY)[0];
		if (!leaf) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (rightLeaf) { leaf = rightLeaf; await leaf.setViewState({ type: VIEW_TYPE_VOCABULARY, active: true }); }
		}
		if (leaf) {
			(leaf.view as VocabularyView).setDueOnly(dueOnly);
			await this.app.workspace.revealLeaf(leaf);
		}
	}

	private async persistVocabulary() {
		const raw = await this.loadData() as unknown;
		await this.saveData({ ...(isRecord(raw) ? raw : {}), vocabulary: this.vocabulary });
	}

	private refreshVocabularyView() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_VOCABULARY).forEach((leaf) => (leaf.view as VocabularyView).render());
	}

	async removeHistoryItem(word: string) {
		this.history = this.history.filter((item) => item !== word);
		await this.persistHistory();
		this.notifyLookupListeners();
	}

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

	async translateSelected(editor: Editor) {
		const text = editor.getSelection().trim();
		if (!text) { new Notice('Select text first.'); return; }
		if (!this.settings.mtranServerEnabled) { new Notice('Enable MTranServer in Mynary settings first.'); return; }
		new TranslationModal(this.app, this, text).open();
	}

	async translateCurrentSelection() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (activeView?.editor.getSelection().trim()) { this.openTranslation(activeView.editor.getSelection()); return; }
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			if (!(leaf.view instanceof MarkdownView)) continue;
			const selection = leaf.view.editor.getSelection().trim();
			if (selection) { this.openTranslation(selection); return; }
		}
		new Notice('Select text in a note first.');
	}

	openTranslation(text: string) {
		const normalized = text.trim();
		if (!normalized) { new Notice('Select text first.'); return; }
		if (!this.settings.mtranServerEnabled) { new Notice('Enable MTranServer in Mynary settings first.'); return; }
		new TranslationModal(this.app, this, normalized).open();
	}

	async translate(text: string, targetLanguage = this.settings.mtranTargetLanguage) {
		const provider = new MTranServerProvider(requestMTranServer, this.settings.mtranServerEndpoint, this.settings.mtranServerToken, this.settings.mtranServerTimeoutMs);
		const sourceLanguage = this.settings.mtranSourceLanguage === 'auto' ? 'auto' : this.activeLanguage;
		return provider.translate(text, sourceLanguage, targetLanguage);
	}

	async lookup(word: string, language = this.activeLanguage, forceRefresh = false, offlineOnly = false): Promise<DictionaryEntry | undefined> {
		const normalized = normalizeSelection(word);
		if (!normalized) return undefined;
		const requestId = ++this.lookupSequence;
		this.lastEntry = undefined;
		this.currentQuery = normalized;
		this.lookupStatus = 'loading';
		this.lookupError = '';
		this.lastLookupWasCached = false;
		this.notifyLookupListeners();
		const key = `${CACHE_FORMAT_VERSION}:${offlineOnly ? 'offline:' : ''}${language}:${normalized.toLowerCase()}`;
		try {
			const cached = await this.cache.get(key);
			if (requestId !== this.lookupSequence) return undefined;
			if (cached && !forceRefresh) { this.lastLookupWasCached = true; await this.setEntry(cached, normalized); return cached; }
			const entry = offlineOnly
				? await this.provider.lookupOffline(normalized, language).then((result) => {
					if (!result) throw new Error(`No offline entry found for “${normalized}” in ${language.toUpperCase()}. Install a matching pack or use regular lookup.`);
					return result;
				})
				: await this.provider.lookup(normalized, language);
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
		const selectedTemplateId = action === 'note' ? this.settings.languageTemplateIds?.[entry.language] ?? templateId : templateId;
		const template = this.settings.templates.find((item) => item.id === selectedTemplateId);
		if (!template) { new Notice('Template not found.'); return; }
		try {
			const content = renderTemplate(entry, template.content, { targetLanguage: this.settings.mtranTargetLanguages[entry.language] ?? this.settings.mtranTargetLanguage });
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
			const file = await createVocabularyNote(this.app, entry, this.settings, template.id, { targetLanguage: this.settings.mtranTargetLanguages[entry.language] ?? this.settings.mtranTargetLanguage });
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

	renderLookupActions(container: HTMLElement, entry: DictionaryEntry) {
		const actions = container.createDiv('mynary-actions');
		const save = actions.createEl('details', { cls: 'mynary-action-menu' });
		const summary = save.createEl('summary', { attr: { title: 'Copy, insert, or create a note', 'aria-label': 'Save lookup result' } });
		setIcon(summary, 'save'); summary.createSpan({ text: ' Save' });
		for (const [action, icon, label] of [['copy', 'copy', 'Copy'], ['insert', 'text-cursor-input', 'Insert'], ['note', 'file-plus-2', 'Create note']] as const) {
			const option = save.createEl('button', { cls: 'mynary-action-menu-item' });
			setIcon(option, icon); option.createSpan({ text: label });
			option.addEventListener('click', () => { save.open = false; this.openTemplatePickerForEntry(entry, action); });
		}
		const iconButton = (icon: string, label: string, handler: (button: HTMLButtonElement) => void) => {
			const button = actions.createEl('button', { cls: 'mynary-icon-action', attr: { title: label, 'aria-label': label } });
			setIcon(button, icon); button.addEventListener('click', () => handler(button)); return button;
		};
		iconButton('refresh-cw', 'Refresh lookup', () => void this.refreshLookup());
		iconButton('languages', 'Translate this word or phrase', () => this.openTranslation(entry.word));
		iconButton('bookmark-plus', 'Add to vocabulary', () => void this.addVocabulary(entry));
		const offline = iconButton('hard-drive-download', 'Choose an installed offline pack', (button) => {
			void this.getInstalledDictionaryPacks().then((packs) => {
				const matching = packs.filter((pack) => pack.language === entry.language);
				if (!matching.length) { button.disabled = true; return; }
				const menu = new Menu();
				matching.forEach((pack) => menu.addItem((item) => item.setTitle(`${pack.name} (${pack.language.toUpperCase()}${pack.targetLanguage ? ` → ${pack.targetLanguage.toUpperCase()}` : ''})`).onClick(() => void this.lookupFromOfflinePack(entry.word, pack))));
				const bounds = button.getBoundingClientRect();
				menu.showAtPosition({ x: bounds.left, y: bounds.bottom, width: bounds.width });
			});
		});
		offline.disabled = true;
		void this.getInstalledDictionaryPacks().then((packs) => { offline.disabled = !packs.some((pack) => pack.language === entry.language); });
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
		const offline = el.createEl('button', { text: 'Look up using offline packs only', cls: 'mynary-secondary-action' });
		offline.disabled = true;
		void this.plugin.hasInstalledOfflinePack().then((available) => {
			if (!offline.isConnected) return;
			offline.disabled = !available;
			offline.title = available ? 'Search installed packs without contacting Wiktionary.' : 'Install and enable a matching offline dictionary pack first.';
		});
		offline.addEventListener('click', () => void this.plugin.lookup(this.word, this.plugin.activeLanguage, false, true));
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

async function requestDictionaryManifestUrl(app: App): Promise<string | undefined> {
	return new Promise((resolve) => new DictionaryPackUrlModal(app, resolve).open());
}

class VocabularyDeckModal extends Modal {
	private completed = false;
	private select?: HTMLSelectElement;
	private newDeck?: HTMLInputElement;
	private templateSelect?: HTMLSelectElement;

	constructor(app: App, private decks: string[], private defaultDeck: string, private templates: DictionarySettings['templates'], private defaultTemplateId: string, private resolveDeck: (choice?: { deck: string; templateId?: string }) => void, private createOnly = false) { super(app); }

	onOpen() {
		this.modalEl.addClass('mynary-vocabulary-modal');
		this.titleEl.setText(this.createOnly ? 'Create vocabulary deck' : 'Add to vocabulary');
		this.contentEl.createEl('p', { text: 'Choose a deck or create a nested deck using /, for example english/verbs.' });
		if (!this.createOnly) {
			const deckGroup = this.contentEl.createDiv('mynary-modal-field');
			deckGroup.createEl('label', { text: 'Deck' });
			this.select = deckGroup.createEl('select');
			this.decks.forEach((deck) => this.select!.createEl('option', { value: deck, text: deck }));
			this.select.value = this.decks.includes(this.defaultDeck) ? this.defaultDeck : this.decks[0] ?? 'General';
		}
		const deckInput = this.contentEl.createDiv('mynary-modal-field');
		deckInput.createEl('label', { text: this.createOnly ? 'Deck name' : 'Or create a deck' });
		this.newDeck = deckInput.createEl('input', { type: 'text', placeholder: 'New deck or subdeck (optional)' });
		if (!this.createOnly && this.templates.length) {
			const templateField = this.contentEl.createDiv('mynary-modal-field');
			templateField.createEl('label', { text: 'Flashcard template' });
			this.templateSelect = templateField.createEl('select');
			this.templates.forEach((template) => this.templateSelect!.createEl('option', { value: template.id, text: template.name }));
			this.templateSelect.value = this.templates.some((template) => template.id === this.defaultTemplateId) ? this.defaultTemplateId : this.templates[0]!.id;
		}
		const actions = this.contentEl.createDiv('mynary-modal-actions');
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		actions.createEl('button', { text: this.createOnly ? 'Create deck' : 'Add word', cls: 'mod-cta' }).addEventListener('click', () => this.submit());
	}

	onClose() { if (!this.completed) this.resolveDeck(); this.contentEl.empty(); }

	private submit() {
		const requested = this.newDeck?.value.trim() || this.select?.value || '';
		const deck = requested.split('/').map((part) => part.trim()).filter(Boolean).join('/');
		if (!deck || deck.split('/').some((part) => part === '.' || part === '..' || /[\\:*?"<>|]/u.test(part))) {
			new Notice('Enter a valid deck name.');
			return;
		}
		this.completed = true;
		this.resolveDeck({ deck, ...(this.templateSelect?.value ? { templateId: this.templateSelect.value } : {}) });
		this.close();
	}
}

class DictionaryPackUrlModal extends Modal {
	private input?: HTMLInputElement;

	constructor(app: App, private resolveUrl: (url?: string) => void) { super(app); }

	onOpen() {
		this.modalEl.addClass('mynary-pack-modal');
		this.titleEl.setText('Install offline dictionary pack');
		this.contentEl.createEl('p', { text: 'Enter a URL to the pack manifest.json.' });
		this.input = this.contentEl.createEl('input', { type: 'url', placeholder: 'https://example.com/manifest.json' });
		this.input.addClass('mynary-pack-url-input');
		const actions = this.contentEl.createDiv('mynary-modal-actions');
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => { this.resolveUrl(); this.close(); });
		const install = actions.createEl('button', { text: 'Install', cls: 'mod-cta' });
		install.addEventListener('click', () => this.submit());
		this.input.addEventListener('keydown', (event) => { if (event.key === 'Enter') this.submit(); });
		window.setTimeout(() => this.input?.focus(), 0);
	}

	onClose() {
		this.resolveUrl = () => undefined;
		this.contentEl.empty();
	}

	private submit() {
		const value = this.input?.value.trim();
		if (!value) return;
		try { new URL(value); } catch { new Notice('Enter a valid manifest URL.'); return; }
		const resolve = this.resolveUrl;
		this.resolveUrl = () => undefined;
		resolve(value);
		this.close();
	}
}

interface CatalogPackOption { id?: string; kind?: string; language?: string; targetLanguage?: string; name?: string; entryCount?: number; sizeBytes?: number; version?: string; manifestUrl?: string; }

class DictionaryPackCatalogModal extends Modal {
	constructor(app: App, private readonly packs: CatalogPackOption[], private readonly install: (url: string) => void) { super(app); }

	onOpen() {
		this.modalEl.addClass('mynary-pack-modal');
		this.titleEl.setText('Choose offline dictionary');
		this.contentEl.createEl('p', { text: 'Choose one pack. Packs are downloaded from Hugging Face and verified with SHA-256.' });
		const select = this.contentEl.createEl('select');
		for (const pack of this.packs) {
			if (!pack.manifestUrl || !pack.language) continue;
			const direction = pack.targetLanguage ? ` ${pack.language.toUpperCase()} → ${pack.targetLanguage.toUpperCase()}` : ` ${pack.language.toUpperCase()}`;
			const sizeLabel = typeof pack.sizeBytes === 'number' && pack.sizeBytes > 0 ? ` · ${formatBytes(pack.sizeBytes)} download` : '';
			const label = `${pack.name ?? pack.id ?? 'Dictionary'} ·${direction} · ${(pack.entryCount ?? 0).toLocaleString()} entries${sizeLabel}`;
			select.createEl('option', { value: pack.manifestUrl, text: label });
		}
		const actions = this.contentEl.createDiv('mynary-modal-actions');
		actions.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
		actions.createEl('button', { text: 'Install', cls: 'mod-cta' }).addEventListener('click', () => { const url = select.value; if (!url) return; this.install(url); this.close(); });
	}

	onClose() { this.contentEl.empty(); }
}

class DictionaryPackManagerModal extends Modal {
	constructor(app: App, private readonly plugin: MynaryPlugin) { super(app); }

	onOpen() {
		this.modalEl.addClass('mynary-pack-modal');
		this.titleEl.setText('Offline dictionaries');
		void this.render();
	}

	onClose() { this.contentEl.empty(); }

	private async render() {
		this.contentEl.empty();
		this.contentEl.createEl('p', { text: 'Installed packs are used before wiktionary when offline dictionaries are enabled.' });
		const installActions = this.contentEl.createDiv('mynary-modal-actions');
		installActions.createEl('button', { text: 'Choose language', cls: 'mod-cta' }).addEventListener('click', () => { void this.plugin.installDictionaryPackFromCatalog(() => { void this.render(); }); });
		installActions.createEl('button', { text: 'Install from URL' }).addEventListener('click', () => { void this.plugin.installDictionaryPackFromUrl(() => { void this.render(); }); });
		const list = this.contentEl.createDiv('mynary-pack-manager');
		new Setting(list).setName('Installed dictionaries').setHeading();
		const packs = await this.plugin.getInstalledDictionaryPacks();
		if (!packs.length) {
			list.createDiv({ cls: 'mynary-empty', text: 'No offline dictionary packs installed.' });
			return;
		}
		for (const pack of packs) {
			const row = list.createDiv('mynary-pack-row');
			const details = row.createDiv('mynary-pack-details');
			details.createEl('strong', { text: pack.name || pack.id });
			const active = this.plugin.settings.offlineDictionaryEnabled !== false && pack.language === this.plugin.settings.defaultLanguage;
			details.createDiv({ text: `${pack.language.toUpperCase()}${pack.targetLanguage ? ` → ${pack.targetLanguage.toUpperCase()}` : ''} · ${pack.entryCount.toLocaleString()} entries · ${pack.version}${active ? ' · Used for current lookup language' : ''}` });
			const actions = row.createDiv('mynary-pack-actions');
			actions.createEl('button', { text: 'Check for updates' }).addEventListener('click', () => void this.plugin.updateDictionaryPack(pack));
			actions.createEl('button', { text: 'Remove' }).addEventListener('click', () => void this.plugin.removeDictionaryPack(pack.id, pack.storagePath).then(() => this.render()));
		}
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
		const selectionLookup = search.createEl('button', { text: 'Lookup selected text', cls: 'mynary-selection-lookup' });
		selectionLookup.addEventListener('click', () => void this.plugin.lookupCurrentSelection());
		const selectionTranslate = search.createEl('button', { text: 'Translate selected text', cls: 'mynary-selection-lookup' });
		selectionTranslate.addEventListener('click', () => void this.plugin.translateCurrentSelection());
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
			const history = el.createDiv('mynary-history'); history.createEl('h4', { text: 'Recent lookups' });
			const historySearch = history.createEl('input', { type: 'search', placeholder: 'Search history…' });
			const historyItems = history.createDiv('mynary-history-items');
			const drawHistory = () => {
				historyItems.empty();
				this.plugin.getHistory().filter((word) => word.toLocaleLowerCase().includes(historySearch.value.trim().toLocaleLowerCase())).forEach((word) => {
					const row = historyItems.createDiv('mynary-history-row');
					const button = row.createEl('button', { text: word }); button.addEventListener('click', () => void this.plugin.lookup(word));
					const remove = row.createEl('button', { text: '×', attr: { 'aria-label': `Remove ${word} from history`, title: 'Remove from history' } });
					remove.addEventListener('click', () => void this.plugin.removeHistoryItem(word));
				});
			};
			historySearch.addEventListener('input', drawHistory);
			drawHistory();
		}
	}
}

class DictionarySettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: MynaryPlugin) { super(app, plugin); }

	/** Obsidian 1.13+ uses this for native settings rendering and Settings Search. */
	getSettingDefinitions(): DeclarativeSettingDefinition[] {
		// Keep the standard PluginSettingTab display as the single source of truth.
		// The declarative renderer flattens these settings and hides the grouped UI.
		return [];

		/*
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
				name: 'Use offline dictionary packs',
				desc: 'Use installed local packs before requesting Wiktionary online.',
				aliases: ['local dictionary', 'offline dictionary'],
				control: { type: 'dropdown', key: 'offlineDictionaryEnabled', options: { 'false': 'Disabled', 'true': 'Enabled' }, defaultValue: this.plugin.settings.offlineDictionaryEnabled === false ? 'false' : 'true' },
			},
			{ name: 'Manage offline dictionaries', desc: 'Install or remove local dictionary packs.', aliases: ['dictionary packs', 'local dictionaries'], action: () => this.plugin.openDictionaryPackManager() },
			{ name: 'MTranServer endpoint', desc: 'Base URL of the local translation server, normally http://127.0.0.1:8989.', aliases: ['translation endpoint', 'translation api'], control: { type: 'text', key: 'mtranServerEndpoint', placeholder: 'http://127.0.0.1:8989' } },
			{ name: 'MTranServer token', desc: 'Optional bearer token for a protected local server.', aliases: ['translation token', 'translation api key'], control: { type: 'text', key: 'mtranServerToken', placeholder: 'Optional token' } },
			{ name: 'MTranServer timeout', desc: 'Maximum request time in seconds.', aliases: ['translation timeout'], control: { type: 'slider', key: 'mtranServerTimeoutMs', min: 1000, max: 120000, step: 1000, defaultValue: 15000 } },
			{ name: 'Translation source language', desc: 'Use the current dictionary language or send auto to MTranServer.', aliases: ['source language', 'auto detect'], control: { type: 'dropdown', key: 'mtranSourceLanguage', options: { current: 'Current dictionary language', auto: 'Auto detect' }, defaultValue: this.plugin.settings.mtranSourceLanguage } },
			{ name: 'MTranServer target language', desc: 'Default supported target language; the translation panel can override it per request.', aliases: ['translation target', 'translate to'], control: { type: 'dropdown', key: 'mtranTargetLanguage', options: Object.fromEntries(MTRAN_LANGUAGE_OPTIONS.map((language) => [language.code, `${language.name} (${language.code})`])) , defaultValue: 'en' } },
			{
				name: 'Enable MTranServer translation',
				desc: 'Translate selected text through a local MTranServer instance.',
				aliases: ['offline translation', 'local translation'],
				control: { type: 'dropdown', key: 'mtranServerEnabled', options: { 'false': 'Disabled', 'true': 'Enabled' }, defaultValue: this.plugin.settings.mtranServerEnabled ? 'true' : 'false' },
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
			{ name: 'Install supertonic web runtime', desc: 'Download the required WASM runtime automatically.', aliases: ['install wasm', 'tts runtime file'], action: () => void this.plugin.installWebTtsRuntime() },
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
		*/
	}

	display() {
		const el = this.containerEl; el.empty();
		const createGroup = (title: string, description: string, open = false) => {
			const group = el.createEl('details', { cls: 'mynary-settings-group' });
			group.open = open;
			const summary = group.createEl('summary');
			summary.createEl('strong', { text: title });
			group.createEl('p', { cls: 'mynary-settings-group-description', text: description });
			return group;
		};

		const dictionary = createGroup('Dictionary', 'Choose the language used for dictionary lookup.', true);
		new Setting(dictionary).setName('Default language').setDesc('Wiktionary language section to search.').addDropdown((dropdown) => { this.plugin.settings.languages.forEach((item) => { dropdown.addOption(item.code, item.name); }); dropdown.setValue(this.plugin.settings.defaultLanguage).onChange((value) => { this.plugin.settings.defaultLanguage = value; void this.plugin.saveSettings(); }); });

		const interaction = createGroup('Interaction', 'Choose how text selection triggers a lookup.');
		new Setting(interaction).setName('Look up on double-click').setDesc('Automatically open a dictionary lookup when you double-click a word in a note.').addToggle((toggle) => toggle.setValue(this.plugin.settings.doubleClickLookup === true).onChange((value) => { this.plugin.settings.doubleClickLookup = value; void this.plugin.saveSettings(); }));

		const offline = createGroup('Offline dictionary', 'Install, verify, and manage local dictionary packs.');
		new Setting(offline).setName('Use installed packs').setDesc('Installed packs are checked before Wiktionary. Core packs provide definitions; bilingual packs add translations.').addToggle((toggle) => toggle.setValue(this.plugin.settings.offlineDictionaryEnabled !== false).onChange((value) => { this.plugin.settings.offlineDictionaryEnabled = value; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		const offlineActions = offline.createDiv('mynary-offline-actions');
		offlineActions.createEl('button', { text: 'Choose language' }).addEventListener('click', () => void this.plugin.installDictionaryPackFromCatalog(() => this.display()));
		offlineActions.createEl('button', { text: 'Install from URL' }).addEventListener('click', () => void this.plugin.installDictionaryPackFromUrl(() => this.display()));
		const packPanel = offline.createDiv('mynary-pack-manager');
		new Setting(packPanel).setName('Installed dictionaries').setHeading();
		packPanel.createEl('p', { text: 'How to install: select Choose language to load the catalog, pick a language, and select Install. Use Install from URL only for a custom manifest. Packs are verified with SHA-256. If a word is missing, Mynary falls back to Wiktionary when online.' });
		packPanel.createDiv({ cls: 'mynary-state mynary-loading', text: 'Checking installed packs…' });
		void this.renderInstalledPacks(packPanel);

		const translate = createGroup('Translate', 'Configure the local MTranServer connection and translation defaults.');
		new Setting(translate).setName('MTranServer translation').setDesc('Translate selected text using a local MTranServer instance.').addToggle((toggle) => toggle.setValue(this.plugin.settings.mtranServerEnabled).onChange((value) => { this.plugin.settings.mtranServerEnabled = value; void this.plugin.saveSettings(); this.display(); }));
		new Setting(translate).setName('MTranServer endpoint').setDesc('Usually http://127.0.0.1:8989').addText((text) => text.setValue(this.plugin.settings.mtranServerEndpoint).onChange((value) => { this.plugin.settings.mtranServerEndpoint = value.trim().replace(/\/+$/u, '') || 'http://127.0.0.1:8989'; void this.plugin.saveSettings(); }));
		new Setting(translate).setName('Test connection').setDesc('Send a short English to Vietnamese test phrase to the configured local server.').addButton((button) => button.setButtonText('Test connection').onClick(() => void this.plugin.testMTranServerConnection()));
		new Setting(translate).setName('MTranServer token').setDesc('Optional bearer token configured on the local server.').addText((text) => text.setPlaceholder('Optional token').setValue(this.plugin.settings.mtranServerToken).onChange((value) => { this.plugin.settings.mtranServerToken = value; void this.plugin.saveSettings(); }));
		new Setting(translate).setName('Translation source language').setDesc('Use the current dictionary language, or send auto for servers that support automatic detection.').addDropdown((dropdown) => dropdown.addOption('current', 'Current dictionary language').addOption('auto', 'Auto detect').setValue(this.plugin.settings.mtranSourceLanguage).onChange((value) => { this.plugin.settings.mtranSourceLanguage = value === 'auto' ? 'auto' : 'current'; void this.plugin.saveSettings(); }));
		const translationSourceLanguage = this.plugin.settings.defaultLanguage;
		new Setting(translate).setName(`Default target for ${translationSourceLanguage.toUpperCase()}`).setDesc('Saved separately by source dictionary language; the translation panel can override it per request.').addDropdown((dropdown) => {
			for (const language of MTRAN_LANGUAGE_OPTIONS) dropdown.addOption(language.code, `${language.name} (${language.code})`);
			dropdown.setValue(this.plugin.settings.mtranTargetLanguages[translationSourceLanguage] ?? this.plugin.settings.mtranTargetLanguage);
			dropdown.onChange((value) => {
				this.plugin.settings.mtranTargetLanguage = value;
				this.plugin.settings.mtranTargetLanguages[translationSourceLanguage] = value;
				void this.plugin.saveSettings();
			});
		});
		new Setting(translate).setName('Translation request timeout').setDesc('Maximum wait time in seconds for the local server.').addText((text) => text.setValue(String(this.plugin.settings.mtranServerTimeoutMs / 1000)).onChange((value: string) => { const seconds = Math.min(120, Math.max(1, Number(value) || 15)); this.plugin.settings.mtranServerTimeoutMs = Math.round(seconds * 1000); void this.plugin.saveSettings(); }));

		const tts = createGroup('TTS', 'Configure optional local speech generation and reading.', false);
		new Setting(tts).setName('Supertonic local TTS').setDesc(`${this.plugin.settings.ttsEnabled ? 'Enabled' : 'Disabled'}. Optional audio supplement and selected-text reader.`).addToggle((toggle) => toggle.setValue(this.plugin.settings.ttsEnabled).onChange((value) => { this.plugin.settings.ttsEnabled = value; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); this.display(); }));
		new Setting(tts).setName('Auto-generate TTS when audio is missing').setDesc('Creates a Supertonic audio source during lookup when Wiktionary has IPA but no recording.').addToggle((toggle) => toggle.setValue(this.plugin.settings.ttsAutoGenerate).onChange((value) => { this.plugin.settings.ttsAutoGenerate = value; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(tts).setName('Supertonic runtime').setDesc('Web is recommended and does not need a terminal.').addDropdown((dropdown) => dropdown.addOption('web', 'Web (recommended)').addOption('server', 'Local server').setValue(this.plugin.settings.ttsRuntime).onChange((value) => { this.plugin.settings.ttsRuntime = value === 'server' ? 'server' : 'web'; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(tts).setName('Supertonic web runtime file').setDesc('Downloads the required WASM runtime automatically into the plugin folder.').addButton((button) => button.setButtonText('Install WASM').onClick(() => void this.plugin.installWebTtsRuntime()));
		new Setting(tts).setName('Supertonic endpoint').setDesc('Used only by the local server runtime.').addText((text) => text.setValue(this.plugin.settings.supertonicEndpoint).onChange((value) => { this.plugin.settings.supertonicEndpoint = value.trim() || 'http://127.0.0.1:7788/v1/tts'; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(tts).setName('Supertonic voice').addText((text) => text.setValue(this.plugin.settings.supertonicVoice).onChange((value) => { this.plugin.settings.supertonicVoice = value.trim() || 'M1'; this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(tts).setName('Supertonic steps').addText((text) => text.setValue(String(this.plugin.settings.supertonicSteps)).onChange((value) => { this.plugin.settings.supertonicSteps = Math.min(16, Math.max(4, Math.floor(Number(value) || 8))); this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));
		new Setting(tts).setName('Supertonic speed').addText((text) => text.setValue(String(this.plugin.settings.supertonicSpeed)).onChange((value) => { this.plugin.settings.supertonicSpeed = Math.min(2, Math.max(0.7, Number(value) || 1.05)); this.plugin.rebuildProvider(); void this.plugin.saveSettings(); }));

		const vocabulary = createGroup('Vocabulary study', 'Add looked-up words to nested decks, review flashcards, and export them for Anki or spreadsheets.', false);
		new Setting(vocabulary).setName('Vocabulary notes folder').setDesc('Bulk-created vocabulary notes are organized under this folder and its deck subfolders.').addText((text) => text.setValue(this.plugin.settings.vocabularyFolder ?? 'Vocabulary').onChange((value) => { this.plugin.settings.vocabularyFolder = value.trim() || 'Vocabulary'; void this.plugin.saveSettings(); }));
		new Setting(vocabulary).setName('Optional translation language').setDesc('Flashcard answers default to the dictionary definition. Add a translation in this language when the lookup provides one; otherwise the definition remains the answer.').addDropdown((dropdown) => {
			dropdown.addOption('', 'Definition only');
			for (const language of MTRAN_LANGUAGE_OPTIONS) dropdown.addOption(language.code, `${language.name} (${language.code})`);
			dropdown.setValue(this.plugin.settings.vocabularyAnswerLanguage ?? '').onChange((value) => { this.plugin.settings.vocabularyAnswerLanguage = value; void this.plugin.saveSettings(); });
		});
		new Setting(vocabulary).setName('Default flashcard deck').setDesc('Suggested destination when adding a lookup. Use / for nested decks, for example english/verbs.').addText((text) => text.setValue(this.plugin.settings.defaultVocabularyDeck ?? 'General').onChange((value) => { this.plugin.settings.defaultVocabularyDeck = value.trim() || 'General'; void this.plugin.saveSettings(); }));
		new Setting(vocabulary).setName('New flashcards per day').setDesc('Maximum new cards introduced in a study session; due reviews are not limited.').addText((text) => text.setValue(String(this.plugin.settings.newCardsPerDay ?? 20)).onChange((value) => { this.plugin.settings.newCardsPerDay = Math.min(200, Math.max(1, Math.floor(Number(value) || 20))); void this.plugin.saveSettings(); }));

		const notes = createGroup('Notes, templates, and cache', 'Manage generated notes and local lookup storage.', false);
		new Setting(notes).setName('Note folder').setDesc('Folder for vocabulary notes. Leave empty for the vault root.').addText((text) => text.setValue(this.plugin.settings.noteFolder).onChange((value) => { this.plugin.settings.noteFolder = value.trim(); void this.plugin.saveSettings(); }));
		new Setting(notes).setName('Filename template').setDesc('Supports {{word}} and {{language}}.').addText((text) => text.setValue(this.plugin.settings.filenameTemplate).onChange((value) => { this.plugin.settings.filenameTemplate = value || '{{word}}'; void this.plugin.saveSettings(); }));
		new Setting(notes).setName('Default template').addDropdown((dropdown) => { this.plugin.settings.templates.forEach((template) => { dropdown.addOption(template.id, template.name); }); dropdown.setValue(this.plugin.settings.defaultTemplateId).onChange((value) => { this.plugin.settings.defaultTemplateId = value; void this.plugin.saveSettings(); }); });
		new Setting(notes).setName(`Template for ${this.plugin.activeLanguage.toUpperCase()} notes`).setDesc('Overrides the global default for notes in the current dictionary language.').addDropdown((dropdown) => {
			dropdown.addOption('', 'Use global default');
			this.plugin.settings.templates.forEach((template) => { dropdown.addOption(template.id, template.name); });
			dropdown.setValue(this.plugin.settings.languageTemplateIds?.[this.plugin.activeLanguage] ?? '').onChange((value) => {
				this.plugin.settings.languageTemplateIds ??= {};
				if (value) this.plugin.settings.languageTemplateIds[this.plugin.activeLanguage] = value;
				else delete this.plugin.settings.languageTemplateIds[this.plugin.activeLanguage];
				void this.plugin.saveSettings();
			});
		});
		new Setting(notes).setName('Existing note behavior').setDesc('Update section preserves content outside Mynary markers and replaces only the generated section.').addDropdown((dropdown) => dropdown.addOption('ask', 'Ask before replacing').addOption('overwrite', 'Replace automatically').addOption('update-section', 'Update section').setValue(this.plugin.settings.existingNoteBehavior).onChange((value) => { this.plugin.settings.existingNoteBehavior = value as DictionarySettings['existingNoteBehavior']; void this.plugin.saveSettings(); }));
		new Setting(notes).setName('Create bilingual notes').setDesc('Append the available translations as a managed translation section when creating or updating notes.').addToggle((toggle) => toggle.setValue(this.plugin.settings.bilingualNotes === true).onChange((value) => { this.plugin.settings.bilingualNotes = value; void this.plugin.saveSettings(); }));
		new Setting(notes).setName('Templates').setDesc('Choose a template separately each time you copy, insert or create a note.').addButton((button) => button.setButtonText('Manage templates').onClick(() => this.plugin.openTemplateManager()));
		new Setting(notes).setName('Cache TTL (days)').addText((text) => text.setValue(String(this.plugin.settings.cacheTtlDays)).onChange((value) => { const n = Math.max(1, Number(value) || 7); this.plugin.settings.cacheTtlDays = n; void this.plugin.saveSettings(); }));
		new Setting(notes).setName('Maximum cached entries').addText((text) => text.setValue(String(this.plugin.settings.maxCacheEntries)).onChange((value) => { const n = Math.max(1, Number(value) || 100); this.plugin.settings.maxCacheEntries = n; void this.plugin.saveSettings(); }));
		new Setting(notes).setName('Clear dictionary cache').addButton((button) => button.setButtonText('Clear').setWarning().onClick(() => { void this.plugin.cache.clear().then(() => { new Notice('Dictionary cache cleared.'); this.display(); }); }));
	}

	private async renderInstalledPacks(panel: HTMLElement) {
		const packs = await this.plugin.getInstalledDictionaryPacks();
		panel.empty();
		new Setting(panel).setName('Installed dictionaries').setHeading();
		if (!packs.length) {
			panel.createDiv({ cls: 'mynary-empty', text: 'No offline dictionary packs installed.' });
			return;
		}
		for (const pack of packs) {
			const row = panel.createDiv('mynary-pack-row');
			const details = row.createDiv('mynary-pack-details');
			details.createEl('strong', { text: pack.name || pack.id });
			const active = this.plugin.settings.offlineDictionaryEnabled !== false && pack.language === this.plugin.settings.defaultLanguage;
			details.createDiv({ text: `${pack.language.toUpperCase()}${pack.targetLanguage ? ` → ${pack.targetLanguage.toUpperCase()}` : ''} · ${pack.entryCount.toLocaleString()} entries · ${pack.version}${active ? ' · Used for current lookup language' : ''}` });
			const actions = row.createDiv('mynary-pack-actions');
			actions.createEl('button', { text: 'Check for updates' }).addEventListener('click', () => void this.plugin.updateDictionaryPack(pack));
			actions.createEl('button', { text: 'Remove' }).addEventListener('click', () => {
				void this.plugin.removeDictionaryPack(pack.id, pack.storagePath).then(() => this.display());
			});
		}
	}
}
