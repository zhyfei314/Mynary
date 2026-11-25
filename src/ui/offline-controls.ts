import { setIcon } from 'obsidian';
import type MynaryPlugin from '../main';
import { mergeDictionaryEntries, type OfflinePackPriority } from '../providers/offline-pack-selection';
import type { DictionaryEntry } from '../types';
import { renderEntry } from '../utils/format';

export interface OfflineToolbarOptions {
	onRelookup: () => void;
	onOnlineLookup?: () => void;
}

/**
 * Renders the synced "Packs only" toggle and quick pack/filter picker
 * shared by both the lookup popup modal and the dictionary sidebar.
 */
export function renderOfflineToolbar(container: HTMLElement, plugin: MynaryPlugin, options: OfflineToolbarOptions) {
	const bar = container.createDiv('mynary-offline-toolbar');
	const offlineOnly = plugin.isOfflineOnly();

	const toggleBtn = bar.createEl('button', {
		cls: `mynary-offline-toggle${offlineOnly ? ' is-active' : ''}`,
		attr: {
			'aria-pressed': String(offlineOnly),
			title: offlineOnly
				? 'Packs only is ON: searches only installed offline packs. Click to allow online Wiktionary.'
				: 'Packs only is OFF: falls back to online Wiktionary when packs miss. Click to search offline packs only.',
		},
	});
	setIcon(toggleBtn, offlineOnly ? 'wifi-off' : 'hard-drive');
	toggleBtn.createSpan({ text: 'Packs only' });
	toggleBtn.addEventListener('click', () => {
		void plugin.setOfflineOnly(!plugin.isOfflineOnly()).then(() => {
			if (plugin.currentQuery) options.onRelookup();
		});
	});

	if (options.onOnlineLookup) {
		const onlineBtn = bar.createEl('button', {
			cls: 'mynary-online-search-btn',
			attr: { title: 'Search Wiktionary online (bypass offline packs)' },
		});
		setIcon(onlineBtn, 'globe');
		onlineBtn.createSpan({ text: 'Online' });
		onlineBtn.addEventListener('click', () => {
			options.onOnlineLookup?.();
		});
	}

	const picker = bar.createEl('details', { cls: 'mynary-pack-picker' });
	const mode = plugin.settings.offlineDictionaryPackMode ?? 'auto';
	const selectedIds = plugin.settings.offlineDictionarySelectedPacks ?? [];
	const sourceLang = plugin.settings.offlineDictionarySourceLanguage ?? '';
	const summaryLabel = mode === 'custom'
		? `Packs: ${selectedIds.length} selected`
		: sourceLang
			? `Packs: Auto (${sourceLang.toUpperCase()})`
			: 'Packs: Auto';
	const summary = picker.createEl('summary', { cls: 'mynary-pack-picker-summary', text: summaryLabel });
	summary.setAttribute('title', 'Select which offline dictionary packs to search');

	const panel = picker.createDiv('mynary-pack-picker-panel');
	panel.createDiv({ cls: 'mynary-state mynary-loading', text: 'Loading installed packs…' });

	let loaded = false;
	const drawPickerPanel = async () => {
		const packs = await plugin.getInstalledDictionaryPacks();
		if (!panel.isConnected) return;
		panel.empty();

		const rowMode = panel.createDiv('mynary-pack-picker-row');
		rowMode.createEl('label', { text: 'Selection mode' });
		const modeSelect = rowMode.createEl('select');
		modeSelect.createEl('option', { value: 'auto', text: 'Auto (target language + core)' });
		modeSelect.createEl('option', { value: 'custom', text: 'Custom (selected packs)' });
		modeSelect.value = plugin.settings.offlineDictionaryPackMode ?? 'auto';
		modeSelect.addEventListener('change', () => {
			plugin.settings.offlineDictionaryPackMode = modeSelect.value === 'custom' ? 'custom' : 'auto';
			void plugin.updateOfflinePackPreferences().then(() => {
				if (plugin.currentQuery) options.onRelookup();
			});
		});

		const sourceLanguages = [...new Set(packs.map((pack) => pack.language.toLowerCase()))].sort();
		const rowSource = panel.createDiv('mynary-pack-picker-row');
		rowSource.createEl('label', { text: 'Source language' });
		const sourceSelect = rowSource.createEl('select');
		sourceSelect.createEl('option', { value: '', text: 'All source languages' });
		for (const code of sourceLanguages) sourceSelect.createEl('option', { value: code, text: code.toUpperCase() });
		sourceSelect.value = plugin.settings.offlineDictionarySourceLanguage ?? '';
		sourceSelect.addEventListener('change', () => {
			plugin.settings.offlineDictionarySourceLanguage = sourceSelect.value;
			void plugin.updateOfflinePackPreferences().then(() => {
				if (plugin.currentQuery) options.onRelookup();
			});
		});

		const rowPriority = panel.createDiv('mynary-pack-picker-row');
		rowPriority.createEl('label', { text: 'Priority order' });
		const prioritySelect = rowPriority.createEl('select');
		prioritySelect.createEl('option', { value: 'bilingual-first', text: 'Bilingual matching target first' });
		prioritySelect.createEl('option', { value: 'input-language', text: 'Input language first' });
		prioritySelect.createEl('option', { value: 'alphabetical', text: 'Alphabetical' });
		prioritySelect.value = plugin.settings.offlineDictionaryPriority ?? 'bilingual-first';
		prioritySelect.addEventListener('change', () => {
			plugin.settings.offlineDictionaryPriority = prioritySelect.value as OfflinePackPriority;
			void plugin.updateOfflinePackPreferences().then(() => {
				if (plugin.currentQuery) options.onRelookup();
			});
		});

		if (!packs.length) {
			panel.createDiv({ cls: 'mynary-empty', text: 'No offline packs installed yet.' });
			return;
		}

		const listHeader = panel.createDiv('mynary-pack-picker-actions');
		const selectAllBtn = listHeader.createEl('button', { text: 'Select all' });
		selectAllBtn.addEventListener('click', () => {
			plugin.settings.offlineDictionaryPackMode = 'custom';
			plugin.settings.offlineDictionarySelectedPacks = packs.map((pack) => pack.id);
			void plugin.updateOfflinePackPreferences().then(() => {
				if (plugin.currentQuery) options.onRelookup();
			});
		});
		const clearBtn = listHeader.createEl('button', { text: 'Clear' });
		clearBtn.addEventListener('click', () => {
			plugin.settings.offlineDictionaryPackMode = 'custom';
			plugin.settings.offlineDictionarySelectedPacks = [];
			void plugin.updateOfflinePackPreferences().then(() => {
				if (plugin.currentQuery) options.onRelookup();
			});
		});

		const list = panel.createDiv('mynary-pack-picker-list');
		const currentSelected = new Set(plugin.settings.offlineDictionarySelectedPacks ?? []);
		for (const pack of packs) {
			const item = list.createEl('label', { cls: 'mynary-pack-picker-item' });
			const checkbox = item.createEl('input', { type: 'checkbox' });
			checkbox.checked = currentSelected.has(pack.id);
			checkbox.addEventListener('change', () => {
				const next = new Set(plugin.settings.offlineDictionarySelectedPacks ?? []);
				if (checkbox.checked) next.add(pack.id);
				else next.delete(pack.id);
				plugin.settings.offlineDictionaryPackMode = 'custom';
				plugin.settings.offlineDictionarySelectedPacks = [...next];
				void plugin.updateOfflinePackPreferences().then(() => {
					if (plugin.currentQuery) options.onRelookup();
				});
			});
			const badge = pack.targetLanguage ? `${pack.language.toUpperCase()} → ${pack.targetLanguage.toUpperCase()}` : `${pack.language.toUpperCase()} · Core`;
			item.createSpan({ text: `${pack.name || pack.id} `, cls: 'mynary-pack-picker-name' });
			item.createSpan({ text: badge, cls: 'mynary-pack-picker-badge' });
		}
	};

	picker.addEventListener('toggle', () => {
		if (picker.open && !loaded) {
			loaded = true;
			void drawPickerPanel();
		}
	});
}

/**
 * Renders one or more dictionary entries. Multiple offline pack matches are
 * shown as collapsible sections (each with its own note/vocabulary actions),
 * plus a combined action bar at the bottom to create from selected packs.
 */
export function renderLookupEntries(container: HTMLElement, entries: DictionaryEntry[], plugin: MynaryPlugin) {
	if (!entries.length) return;
	if (entries.length === 1) {
		renderEntry(container, entries[0]!, plugin);
		return;
	}

	const results = container.createDiv('mynary-pack-results');
	const selectedEntries = new Set<DictionaryEntry>(entries);

	entries.forEach((entry, index) => {
		const details = results.createEl('details', { cls: 'mynary-pack-result' });
		if (index === 0) details.open = true;
		const summary = details.createEl('summary', { cls: 'mynary-pack-result-summary' });
		summary.createSpan({ text: entry.source.name || entry.source.id, cls: 'mynary-pack-result-name' });
		const targetLang = entry.translations[0]?.languageCode;
		const langTag = targetLang && targetLang !== entry.language
			? `${entry.language.toUpperCase()} → ${targetLang.toUpperCase()}`
			: entry.language.toUpperCase();
		summary.createSpan({ text: langTag, cls: 'mynary-pack-result-lang' });
		const previewText = entry.translations[0]?.word || entry.meanings[0]?.definitions[0]?.text || '';
		if (previewText) summary.createSpan({ text: previewText, cls: 'mynary-pack-result-preview' });

		const body = details.createDiv('mynary-pack-result-body');
		renderEntry(body, entry, plugin);
	});

	const combinedBox = container.createDiv('mynary-combined-pack-actions');
	combinedBox.createEl('h4', { text: 'Combine selected packs' });
	const checkList = combinedBox.createDiv('mynary-combined-pack-checks');
	const buttons = combinedBox.createDiv('mynary-combined-pack-buttons');
	const createNoteBtn = buttons.createEl('button', { text: 'Create note from selected' });
	const insertBtn = buttons.createEl('button', { text: 'Insert from selected' });
	const addVocabBtn = buttons.createEl('button', { text: 'Add to vocabulary' });

	const syncButtons = () => {
		const empty = selectedEntries.size === 0;
		createNoteBtn.disabled = empty;
		insertBtn.disabled = empty;
		addVocabBtn.disabled = empty;
	};

	for (const entry of entries) {
		const label = checkList.createEl('label', { cls: 'mynary-combined-pack-check' });
		const checkbox = label.createEl('input', { type: 'checkbox' });
		checkbox.checked = true;
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) selectedEntries.add(entry);
			else selectedEntries.delete(entry);
			syncButtons();
		});
		label.createSpan({ text: entry.source.name || entry.source.id });
	}

	const getMerged = () => mergeDictionaryEntries(entries.filter((entry) => selectedEntries.has(entry)));
	createNoteBtn.addEventListener('click', () => {
		const merged = getMerged();
		if (merged) plugin.openTemplatePickerForEntry(merged, 'note');
	});
	insertBtn.addEventListener('click', () => {
		const merged = getMerged();
		if (merged) plugin.openTemplatePickerForEntry(merged, 'insert');
	});
	addVocabBtn.addEventListener('click', () => {
		const merged = getMerged();
		if (merged) void plugin.addVocabulary(merged);
	});
}
