import { DictionaryEntry, Definition, Meaning, Phonetic, Translation } from '../types';

const LANGUAGE_NAMES: Record<string, string[]> = {
	en: ['English'],
	vi: ['Vietnamese', 'Tiếng Việt'],
	ja: ['Japanese', '日本語'],
	ko: ['Korean', '한국어'],
	zh: ['Chinese', '汉语', '中文'],
	fr: ['French', 'Français'],
	de: ['German', 'Deutsch'],
	es: ['Spanish', 'Español'],
	it: ['Italian', 'Italiano'],
	ru: ['Russian', 'Русский'],
};

const NON_MEANING_HEADINGS = new Set([
	'alternative forms', 'alternative spellings', 'etymology', 'pronunciation', 'usage notes',
	'derived terms', 'descendants', 'translations', 'synonyms', 'antonyms', 'references',
	'further reading', 'see also', 'anagrams', 'related words', 'coordinate terms',
	'từ nguyên', 'cách phát âm', 'bản dịch', 'từ đồng nghĩa', 'từ trái nghĩa', 'tham khảo',
	'語源', '発音', '翻訳', '類義語', '対義語', '参考',
	'어원', '발음', '번역', '유의어', '반의어', '참고',
	'词源', '发音', '翻译', '同义词', '反义词', '参考',
	'étymologie', 'prononciation', 'traductions', 'synonymes', 'antonymes', 'références',
	'ausprache', 'übersetzungen', 'synonyme', 'antonyme', 'referenzen',
	'etimología', 'pronunciación', 'traducciones', 'sinónimos', 'antónimos', 'referencias',
	'etimologia', 'pronuncia', 'traduzioni', 'sinonimi', 'antonimi', 'riferimenti',
	'этимология', 'произношение', 'переводы', 'синонимы', 'антонимы', 'ссылки',
]);

const HEADING_ALIASES: Record<string, string[]> = {
	translations: ['translations', 'bản dịch', '翻訳', '번역', '翻译', 'traductions', 'übersetzungen', 'traducciones', 'traduzioni', 'переводы'],
	etymology: ['etymology', 'từ nguyên', '語源', '어원', '词源', 'étymologie', 'etimologie', 'etimología', 'etimologia', 'этимология'],
	pronunciation: ['pronunciation', 'cách phát âm', '発音', '발음', '发音', 'prononciation', 'aussprache', 'pronunciación', 'pronuncia', 'произношение'],
	synonyms: ['synonyms', 'từ đồng nghĩa', '類義語', '유의어', '同义词', 'synonymes', 'synonyme', 'sinónimos', 'sinonimi', 'синонимы'],
	antonyms: ['antonyms', 'từ trái nghĩa', '対義語', '반의어', '反义词', 'antonymes', 'antonyme', 'antónimos', 'antonimi', 'антонимы'],
};

export type DocumentFactory = (html: string) => Document;

export function parseWiktionaryHtml(
	html: string,
	word: string,
	language: string,
	title: string,
	fetchedAt = Date.now(),
	documentFactory: DocumentFactory = (value) => new DOMParser().parseFromString(value, 'text/html'),
): DictionaryEntry {
	const document = documentFactory(html);
	const languageHeadings = Array.from(document.querySelectorAll('h2'));
	const languageHeading = languageHeadings.find((heading) => matchesHeading(heading, LANGUAGE_NAMES[language] ?? [language]))
		?? (languageHeadings.length === 1 ? languageHeadings[0] : undefined);
	const sectionNodes = languageHeading ? collectLanguageNodes(document, languageHeading) : collectRenderedNodes(document);
	const meanings = parseMeanings(sectionNodes);
	const pronunciation = parsePhonetics(sectionNodes);
	const translations = parseTranslations(sectionNodes);
	const sourceUrl = `https://${language}.wiktionary.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
	return normalizeEntry({
		word,
		language,
		phonetics: pronunciation,
		meanings,
		translations,
		synonyms: parseRelation(sectionNodes, 'synonyms'),
		antonyms: parseRelation(sectionNodes, 'antonyms'),
		etymology: parseSectionText(sectionNodes, 'etymology'),
		source: { id: 'wiktionary', name: 'Wiktionary', url: sourceUrl },
		fetchedAt,
	});
}

export function normalizeEntry(entry: DictionaryEntry): DictionaryEntry {
	return {
		...entry,
		phonetics: uniqueBy(entry.phonetics, (item) => item.text.toLocaleLowerCase()),
		meanings: entry.meanings
			.map((meaning) => ({
				...meaning,
				partOfSpeech: meaning.partOfSpeech ? compactRepeatedTokens(cleanText(meaning.partOfSpeech)) : meaning.partOfSpeech,
				etymology: meaning.etymology ? cleanText(meaning.etymology) : meaning.etymology,
				definitions: uniqueBy(meaning.definitions.map((definition) => ({
					text: cleanText(definition.text),
					examples: uniqueBy(definition.examples.map(cleanText).filter((example) => !isQuoteText(example)), (example) => example.toLocaleLowerCase()),
				})), (definition) => definition.text.toLocaleLowerCase()),
			}))
			.filter((meaning) => meaning.definitions.length > 0),
		translations: uniqueBy(entry.translations.map((translation) => ({
			...translation,
			word: compactRepeatedTokens(cleanText(translation.word)),
			languageCode: translation.languageCode?.toLocaleLowerCase(),
			languageName: translation.languageName ? compactRepeatedTokens(cleanText(translation.languageName)) : undefined,
			sense: translation.sense ? compactRepeatedTokens(cleanText(translation.sense)) : undefined,
		})).filter((translation) => translation.word && !isLanguageLabel(translation.word, translation.languageCode, translation.languageName)), (translation) => `${translation.sense ?? ''}|${translation.languageCode ?? translation.languageName ?? ''}|${translation.word}`.toLocaleLowerCase()),
		synonyms: uniqueBy(entry.synonyms.map(cleanText).filter(Boolean), (item) => item.toLocaleLowerCase()),
		antonyms: uniqueBy(entry.antonyms.map(cleanText).filter(Boolean), (item) => item.toLocaleLowerCase()),
		etymology: entry.etymology ? cleanText(entry.etymology) : undefined,
	};
}

function parseMeanings(nodes: Element[]): Meaning[] {
	const headings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-5]$/.test(node.tagName));
	const meanings: Meaning[] = [];
	let currentEtymology: string | undefined;
	for (const heading of headings) {
		const partOfSpeech = headingText(heading);
		const normalized = partOfSpeech.toLocaleLowerCase();
		if (isEtymologyHeading(normalized)) {
			currentEtymology = /\d/.test(partOfSpeech) ? partOfSpeech : undefined;
			continue;
		}
		if (NON_MEANING_HEADINGS.has(normalized)) continue;
		const block = nodesBetween(nodes, heading, nextHeading(nodes, heading));
		const list = block.flatMap((node) => [
			...(node.tagName === 'OL' ? [node] : []),
			...Array.from(node.querySelectorAll('ol')),
		]).find((candidate) => candidate.querySelector(':scope > li'));
		if (!list) continue;
		const definitions = Array.from(list.querySelectorAll(':scope > li')).map((item) => parseDefinition(item)).filter((item): item is Definition => Boolean(item));
		if (definitions.length) meanings.push({ partOfSpeech, etymology: currentEtymology, definitions });
	}
	return meanings;
}

function isEtymologyHeading(value: string) {
	return (HEADING_ALIASES.etymology ?? []).some((alias) => {
		const normalizedAlias = alias.toLocaleLowerCase();
		return value === normalizedAlias || /^\d+$/.test(value.slice(normalizedAlias.length + 1)) && value.startsWith(`${normalizedAlias} `);
	}) || /^etymology\s+\d+$/i.test(value);
}

function parseDefinition(item: Element): Definition | undefined {
	const clone = item.cloneNode(true) as Element;
	Array.from(clone.querySelectorAll('ol, ul, dl, blockquote, style, script, template, .citation, .reference, .references, .quotation, .quote, [class*="quote"], sup')).forEach((node) => node.remove());
	const text = cleanText(clone.textContent ?? '');
	if (!text) return undefined;
	const examples = Array.from(item.querySelectorAll('dl dd, .example, .e-example, .usage-example')).filter((node) => !isQuoteElement(node)).map((node) => cleanText(node.textContent ?? '')).filter(Boolean);
	return { text, examples: [...new Set(examples)] };
}

function parsePhonetics(nodes: Element[]): Phonetic[] {
	const values = new Set<string>();
	for (const node of nodes) {
		for (const ipa of Array.from(node.querySelectorAll('.IPA, .ipa, [class*="IPA"]'))) {
			const text = cleanText(ipa.textContent ?? '');
			if (text) values.add(text);
		}
	}
	return [...values].map((text) => ({ text }));
}

function parseTranslations(nodes: Element[]): Translation[] {
	const translations: Translation[] = [];
	const translationHeadings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-5]$/.test(node.tagName) && matchesHeading(node, HEADING_ALIASES.translations ?? ['translations']));
	for (const heading of translationHeadings) {
		const block = nodesBetween(nodes, heading, nextHeading(nodes, heading));
		const sense = block.flatMap((node) => [
			...(/^H[45]$/.test(node.tagName) ? [node] : []),
			...Array.from(node.querySelectorAll('h4, h5, .NavHead, .translations-header')),
		]).map(headingText).find((value) => value && !(HEADING_ALIASES.translations ?? ['translations']).some((alias) => value.toLocaleLowerCase() === alias.toLocaleLowerCase()));
		for (const row of block.flatMap((node) => Array.from(node.querySelectorAll('tr')))) {
			const cells = Array.from(row.querySelectorAll('th, td'));
			if (cells.length < 2) continue;
			const languageName = cleanText(cells[0]?.textContent ?? '').replace(/:$/, '');
			const languageCode = findLanguageCode(cells[0] ?? row);
			const words = cells.slice(1).flatMap((cell) => translationWords(cell));
			words.forEach((word) => translations.push({ word, languageCode, languageName, sense }));
		}
		for (const item of block.flatMap((node) => Array.from(node.querySelectorAll('li')))) {
			const text = cleanText(item.textContent ?? '');
			const separator = text.indexOf(':');
			if (separator <= 0) continue;
			const languageName = text.slice(0, separator).trim();
			const words = translationWords(item).filter((word) => !isLanguageLabel(word, findLanguageCode(item), languageName));
			words.forEach((word) => translations.push({ word, languageName, languageCode: findLanguageCode(item), sense }));
		}
	}
	return dedupeTranslations(translations);
}

function parseSectionText(nodes: Element[], target: string): string | undefined {
	const headings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-5]$/.test(node.tagName) && isTargetHeading(node, target));
	const sections = headings.flatMap((heading) => nodesBetween(nodes, heading, nextAnyHeading(nodes, heading))
		.filter((node) => !/^H[3-5]$/.test(node.tagName))
		.map((node) => cleanText(node.textContent ?? '')).filter(Boolean));
	return [...new Set(sections)].join(' ') || undefined;
}

function translationWords(element: Element): string[] {
	return Array.from(element.querySelectorAll('a'))
		.filter((link) => !link.hasAttribute('lang') && !/^https?:\/\/[^/]+\.wiktionary\.org/i.test(link.getAttribute('href') ?? ''))
		.map((link) => cleanText(link.textContent ?? ''))
		.filter(Boolean);
}

function parseRelation(nodes: Element[], target: string): string[] {
	const heading = nodes.find((node): node is HTMLHeadingElement => /^H[3-5]$/.test(node.tagName) && matchesHeading(node, HEADING_ALIASES[target] ?? [target]));
	if (!heading) return [];
	return [...new Set(nodesBetween(nodes, heading, nextHeading(nodes, heading)).flatMap((node) => Array.from(node.querySelectorAll('a')).map((link) => cleanText(link.textContent ?? '')).filter(Boolean)))];
}

function collectLanguageNodes(document: Document, languageHeading: Element): Element[] {
	const nodes = collectRenderedNodes(document);
	const start = nodes.indexOf(languageHeading);
	if (start < 0) return nodes;
	const nextLanguageHeading = nodes.find((node, index) => index > start && node.tagName === 'H2');
	const end = nextLanguageHeading ? nodes.indexOf(nextLanguageHeading) : nodes.length;
	return nodes.slice(start + 1, end < 0 ? nodes.length : end);
}

function collectRenderedNodes(document: Document): Element[] {
	return Array.from(document.querySelectorAll('h2, h3, h4, h5, ol, ul, dl, table, p, div'));
}

function nodesBetween(nodes: Element[], start: Element, end?: Element): Element[] {
	const startIndex = nodes.indexOf(start);
	const endIndex = end ? nodes.indexOf(end) : nodes.length;
	return nodes.slice(startIndex + 1, endIndex < 0 ? nodes.length : endIndex);
}

function nextHeading(nodes: Element[], start: Element): Element | undefined {
	const level = Number(start.tagName.slice(1));
	return nodes.find((candidate) => {
		const candidateLevel = Number(candidate.tagName.slice(1));
		return /^H[3-5]$/.test(candidate.tagName) && candidate !== start && candidateLevel <= level && isAfter(start, candidate);
	});
}
function nextAnyHeading(nodes: Element[], start: Element): Element | undefined {
	return nodes.find((candidate) => /^H[3-5]$/.test(candidate.tagName) && candidate !== start && isAfter(start, candidate));
}

function headingText(element: Element) { return cleanText(element.querySelector('.mw-headline')?.textContent ?? element.textContent ?? ''); }
function matchesHeading(element: Element, aliases: string[]) {
	const value = headingText(element).toLocaleLowerCase();
	return aliases.some((alias) => value === alias.toLocaleLowerCase());
}
function isTargetHeading(element: Element, target: string) {
	const value = headingText(element).toLocaleLowerCase();
	const aliases = HEADING_ALIASES[target] ?? [target];
	return aliases.some((alias) => value === alias.toLocaleLowerCase() || value.startsWith(`${alias.toLocaleLowerCase()} `));
}
function cleanText(value: string) {
	return compactRepeatedTokens(value
		.replace(/\[[0-9]+\]/g, '')
		.replace(/\.mw-parser-output\s*\{[^}]*\}/gi, '')
		.replace(/(?:^|\s)[.#][\w-]+\s*\{[^}]*\}/g, ' ')
		.replace(/\s+/g, ' ').trim());
}
function isAfter(start: Element, candidate: Element) { return Boolean(start.compareDocumentPosition(candidate) & 4); }
function compactRepeatedTokens(value: string) {
	const tokens = value.split(' ').filter(Boolean);
	if (tokens.length > 1 && tokens.every((token) => token.toLocaleLowerCase() === tokens[0]?.toLocaleLowerCase())) return tokens[0] ?? value;
	return value;
}
function isQuoteElement(element: Element) { return Boolean(element.closest('blockquote, .citation, .reference, .references, .quotation, .quote, [class*="quote"]')); }
function isQuoteText(value: string) { return /^\(?\s*(?:quoted|quote|citation|source)\b/i.test(value); }
function isLanguageLabel(word: string, languageCode?: string, languageName?: string) { return word.toLocaleLowerCase() === languageCode?.toLocaleLowerCase() || word.toLocaleLowerCase() === languageName?.toLocaleLowerCase(); }
function uniqueBy<T>(items: T[], key: (item: T) => string) { const seen = new Set<string>(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function findLanguageCode(element: Element): string | undefined {
	const link = element.querySelector('a[lang], a[href*=".wiktionary.org"]');
	const lang = link?.getAttribute('lang');
	if (lang) return lang;
	const href = link?.getAttribute('href') ?? '';
	return href.match(/^https?:\/\/([a-z-]+)\.wiktionary\.org/i)?.[1];
}
function dedupeTranslations(items: Translation[]) {
	const seen = new Set<string>();
	return items.filter((item) => { const key = `${item.sense ?? ''}|${item.languageCode ?? item.languageName ?? ''}|${item.word}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
