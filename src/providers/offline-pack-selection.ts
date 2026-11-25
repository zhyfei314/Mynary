import type { DictionaryEntry, DictionaryPackManifest, Meaning, Pronunciation, Translation } from '../types';

export type InstalledDictionaryPack = DictionaryPackManifest & { storagePath: string; filesReady: boolean };

export type OfflinePackMode = 'auto' | 'custom';
export type OfflinePackPriority = 'bilingual-first' | 'input-language' | 'alphabetical';

export interface OfflinePackSelectionOptions {
	activeLanguage: string;
	mode: OfflinePackMode;
	selectedPackIds: string[];
	sourceLanguage?: string;
	priority: OfflinePackPriority;
}

/**
 * In auto mode, bilingual packs match the active lookup/target language
 * (e.g. en-vi matches vi), while core packs are unrestricted so users can
 * still look up words in any installed core dictionary.
 */
export function isPackMatchingAutoLanguage(pack: Pick<DictionaryPackManifest, 'kind' | 'language' | 'targetLanguage'>, activeLanguage: string): boolean {
	if (pack.kind === 'core') return true;
	return pack.targetLanguage === activeLanguage;
}

/**
 * Filters and orders installed offline dictionary packs according to user
 * selection, optional source-language filter, and priority mode.
 */
export function selectOfflinePacks(packs: InstalledDictionaryPack[], options: OfflinePackSelectionOptions): InstalledDictionaryPack[] {
	const activeLanguage = options.activeLanguage.trim().toLowerCase();
	const sourceFilter = (options.sourceLanguage ?? '').trim().toLowerCase();
	const selectedSet = new Set(options.selectedPackIds);

	const filtered = packs.filter((pack) => {
		if (!pack.filesReady) return false;
		if (sourceFilter && pack.language.toLowerCase() !== sourceFilter) return false;
		if (options.mode === 'custom') return selectedSet.has(pack.id);
		return isPackMatchingAutoLanguage(pack, activeLanguage);
	});

	return filtered.sort((left, right) => comparePacks(left, right, options.priority, activeLanguage, sourceFilter));
}

function comparePacks(
	left: InstalledDictionaryPack,
	right: InstalledDictionaryPack,
	priority: OfflinePackPriority,
	activeLanguage: string,
	sourceFilter: string,
): number {
	if (priority === 'input-language') {
		const targetSource = sourceFilter || activeLanguage;
		const leftScore = left.language.toLowerCase() === targetSource ? 0 : left.kind === 'bilingual' && left.targetLanguage === activeLanguage ? 1 : 2;
		const rightScore = right.language.toLowerCase() === targetSource ? 0 : right.kind === 'bilingual' && right.targetLanguage === activeLanguage ? 1 : 2;
		if (leftScore !== rightScore) return leftScore - rightScore;
	} else if (priority === 'bilingual-first') {
		const leftScore = left.kind === 'bilingual' && left.targetLanguage === activeLanguage ? 0 : left.kind === 'bilingual' ? 1 : 2;
		const rightScore = right.kind === 'bilingual' && right.targetLanguage === activeLanguage ? 0 : right.kind === 'bilingual' ? 1 : 2;
		if (leftScore !== rightScore) return leftScore - rightScore;
	}
	return (left.name || left.id).localeCompare(right.name || right.id) || left.id.localeCompare(right.id);
}

/**
 * Merges multiple pack entries into a single DictionaryEntry for combined
 * note creation or vocabulary export.
 */
export function mergeDictionaryEntries(entries: DictionaryEntry[]): DictionaryEntry | undefined {
	if (!entries.length) return undefined;
	if (entries.length === 1) return entries[0];
	const primary = entries[0]!;
	const phonetics: Pronunciation[] = [];
	const seenPhonetics = new Set<string>();
	const meanings: Meaning[] = [];
	const translations: Translation[] = [];
	const seenTranslations = new Set<string>();
	const synonyms = new Set<string>();
	const antonyms = new Set<string>();
	const etymologies: string[] = [];

	for (const entry of entries) {
		for (const phonetic of entry.phonetics) {
			const key = `${phonetic.text}:${phonetic.type ?? ''}`;
			if (!seenPhonetics.has(key)) {
				seenPhonetics.add(key);
				phonetics.push(phonetic);
			}
		}
		for (const meaning of entry.meanings) meanings.push(meaning);
		for (const translation of entry.translations) {
			const key = `${translation.languageCode ?? translation.language ?? ''}:${translation.word}:${translation.sense ?? ''}`;
			if (!seenTranslations.has(key)) {
				seenTranslations.add(key);
				translations.push(translation);
			}
		}
		for (const item of entry.synonyms) synonyms.add(item);
		for (const item of entry.antonyms) antonyms.add(item);
		if (entry.etymology && !etymologies.includes(entry.etymology)) etymologies.push(entry.etymology);
	}

	return {
		word: primary.word,
		language: primary.language,
		phonetics,
		meanings,
		translations,
		synonyms: [...synonyms],
		antonyms: [...antonyms],
		etymology: etymologies.length ? etymologies.join('\n\n') : undefined,
		source: {
			id: entries.map((entry) => entry.source.id).join('+'),
			name: entries.map((entry) => entry.source.name).join(' + '),
			url: primary.source.url,
		},
		fetchedAt: Math.max(...entries.map((entry) => entry.fetchedAt)),
	};
}
