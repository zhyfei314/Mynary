import { DictionaryEntry } from '../types';
import { renderTemplate } from '../templates/renderer';
import type MynaryPlugin from '../main';

export function entryToMarkdown(entry: DictionaryEntry) { return renderTemplate(entry, '{{definitionsMarkdown}}\n\n{{examplesMarkdown}}'); }
export function renderEntry(container: HTMLElement, entry: DictionaryEntry, plugin: MynaryPlugin) {
	const title = container.createDiv('mynary-entry-title'); title.createEl('h2', { text: entry.word });
	const metadata = container.createDiv('mynary-entry-metadata');
	metadata.createSpan({ text: plugin.lastLookupWasCached ? 'Cached result' : 'Fresh result' });
	metadata.createSpan({ text: ` · ${entry.language.toUpperCase()}` });
	if (entry.phonetics.length) container.createDiv({ text: entry.phonetics.map((p) => p.text).join(' · '), cls: 'mynary-phonetics' });
	const definitions = container.createDiv('mynary-definitions');
	const totalDefinitions = entry.meanings.reduce((total, meaning) => total + meaning.definitions.length, 0);
	const renderDefinitions = (limit: number) => {
		definitions.empty();
		let remaining = limit;
		entry.meanings.forEach((meaning) => {
			if (remaining <= 0) return;
			const visible = meaning.definitions.slice(0, remaining);
			if (!visible.length) return;
			const section = definitions.createDiv('mynary-meaning');
			if (meaning.partOfSpeech) section.createEl('h3', { text: meaning.partOfSpeech });
			if (meaning.etymology) section.createDiv({ text: meaning.etymology, cls: 'mynary-meaning-context' });
			const list = section.createEl('ol');
			visible.forEach((definition) => {
				const li = list.createEl('li', { text: definition.text });
				definition.examples.forEach((example) => li.createEl('blockquote', { text: example }));
			});
			remaining -= visible.length;
		});
	};
	const initialLimit = 5;
	renderDefinitions(Math.min(initialLimit, totalDefinitions));
	if (totalDefinitions > initialLimit) {
		const expand = container.createDiv('mynary-expand-actions');
		const showMore = expand.createEl('button', { text: `Show all definitions (${totalDefinitions})` });
		showMore.addEventListener('click', () => { renderDefinitions(totalDefinitions); expand.empty(); });
	}
	if (entry.translations.length) renderTranslations(container, entry.translations);
	if (entry.synonyms.length) renderCollapsible(container, 'Synonyms', entry.synonyms);
	if (entry.antonyms.length) renderCollapsible(container, 'Antonyms', entry.antonyms);
	if (entry.etymology) renderCollapsible(container, 'Etymology', [entry.etymology]);
	const actions = container.createDiv('mynary-actions');
	const copy = actions.createEl('button', { text: 'Copy' });
	copy.addEventListener('click', () => plugin.openTemplatePickerForEntry(entry, 'copy'));
	const insert = actions.createEl('button', { text: 'Insert' });
	insert.addEventListener('click', () => plugin.openTemplatePickerForEntry(entry, 'insert'));
	const note = actions.createEl('button', { text: 'Create note' });
	note.addEventListener('click', () => plugin.openTemplatePickerForEntry(entry, 'note'));
	const refresh = actions.createEl('button', { text: 'Refresh' });
	refresh.addEventListener('click', () => void plugin.refreshLookup());
	const source = container.createEl('a', { text: `Source: ${entry.source.name}`, href: entry.source.url, cls: 'mynary-source' }); source.target = '_blank';
}

function renderCollapsible(container: HTMLElement, title: string, items: string[]) {
	const details = container.createEl('details', { cls: 'mynary-collapsible' });
	details.createEl('summary', { text: title });
	const list = details.createEl('ul');
	items.forEach((item) => list.createEl('li', { text: item }));
}

function renderTranslations(container: HTMLElement, translations: DictionaryEntry['translations']) {
	const details = container.createEl('details', { cls: 'mynary-collapsible' });
	details.createEl('summary', { text: `Translations (${translations.length})` });
	const filters = details.createDiv('mynary-translation-filters');
	const query = filters.createEl('input', { type: 'search', placeholder: 'Filter translations…' });
	query.setAttribute('aria-label', 'Filter translations');
	const languageSelect = filters.createEl('select', { attr: { 'aria-label': 'Filter translation language' } });
	languageSelect.createEl('option', { value: '', text: 'All languages' });
	const languageOptions = new Map<string, string>();
	translations.forEach((translation) => {
		const key = translation.languageCode ?? translation.languageName ?? translation.language ?? 'unknown';
		const label = translation.languageName ?? translation.languageCode ?? translation.language ?? 'Unknown';
		languageOptions.set(key, label);
	});
	[...languageOptions.entries()].sort((a, b) => a[1].localeCompare(b[1])).forEach(([value, label]) => languageSelect.createEl('option', { value, text: label }));
	const results = details.createDiv('mynary-translation-results');
	const render = () => {
		results.empty();
		const needle = query.value.trim().toLocaleLowerCase();
		const language = languageSelect.value;
		const filtered = translations.filter((translation) => {
			const languageKey = translation.languageCode ?? translation.languageName ?? translation.language ?? 'unknown';
			const haystack = `${translation.word} ${translation.languageName ?? ''} ${translation.languageCode ?? ''} ${translation.sense ?? ''}`.toLocaleLowerCase();
			return (!language || languageKey === language) && (!needle || haystack.includes(needle));
		});
		if (!filtered.length) { results.createDiv({ text: 'No translations match this filter.', cls: 'mynary-empty' }); return; }
		const groups = new Map<string, Map<string, DictionaryEntry['translations']>>();
		filtered.forEach((translation) => {
			const key = translation.sense ?? 'General';
			const languageKey = translation.languageCode ?? translation.languageName ?? translation.language ?? 'Unknown';
			const group = groups.get(key) ?? new Map<string, DictionaryEntry['translations']>();
			const languageGroup = group.get(languageKey) ?? [];
			languageGroup.push(translation);
			group.set(languageKey, languageGroup);
			groups.set(key, group);
		});
		groups.forEach((languages, sense) => {
			if (groups.size > 1) results.createEl('h4', { text: sense });
			const list = results.createEl('ul');
			languages.forEach((items) => {
				const item = items[0];
				if (!item) return;
				const label = item.languageName ?? item.languageCode ?? item.language ?? 'Unknown';
				const words = [...new Set(items.map((translation) => translation.word))].join(', ');
				list.createEl('li', { text: `${label}: ${words}` });
			});
		});
	};
	query.addEventListener('input', render);
	languageSelect.addEventListener('change', render);
	render();
}
