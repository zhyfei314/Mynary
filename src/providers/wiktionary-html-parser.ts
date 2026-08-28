import { DictionaryEntry, Definition, Meaning, Pronunciation, Translation } from '../types';
import { getLanguageHeadingAliases, getSectionAliases } from './language-registry';

const NON_MEANING_HEADINGS = new Set([
	'alternative forms', 'alternative spellings', 'etymology', 'pronunciation', 'usage notes',
	'derived terms', 'descendants', 'translations', 'synonyms', 'antonyms', 'references', 'conjugation', 'inflection',
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

const PARTS_OF_SPEECH = new Set([
	'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'interjection',
	'article', 'determiner', 'numeral', 'particle', 'auxiliary', 'modal verb', 'proper noun',
	'חלק דיבר', 'danh từ', 'động từ', 'tính từ', 'trạng từ', '副詞', '名詞', '動詞', '形容詞',
]);

export type DocumentFactory = (html: string) => Document;

/** Extracts lemma links from Wiktionary's rendered form-of explanations. */
export function parseFormOfLinks(html: string, language: string, documentFactory: DocumentFactory = (value) => new DOMParser().parseFromString(value, 'text/html')): string[] {
	const document = documentFactory(html);
	const values = Array.from(document.querySelectorAll('a')).filter((link) => {
		const className = link.className.toString().toLocaleLowerCase();
		const formOfAncestor = link.closest('[class*="form-of"], [class*="form_of"]');
		const text = link.closest('li, p')?.textContent?.toLocaleLowerCase() ?? link.parentElement?.textContent?.toLocaleLowerCase() ?? '';
		return className.includes('form-of') || Boolean(formOfAncestor) || looksLikeFormOfText(text);
	}).map((link) => formOfTarget(link, language)).filter((value): value is string => Boolean(value));
	return [...new Set(values)].filter((value) => value.toLocaleLowerCase() !== language.toLocaleLowerCase());
}

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
	const languageHeading = languageHeadings.find((heading) => matchesHeading(heading, getLanguageHeadingAliases(language)))
		?? (languageHeadings.length === 1 ? languageHeadings[0] : undefined);
	const sectionNodes = languageHeading ? collectLanguageNodes(document, languageHeading) : collectRenderedNodes(document);
	const meanings = parseMeanings(sectionNodes, language);
	const pronunciation = parsePhonetics(sectionNodes, language);
	const translations = parseTranslations(sectionNodes, language);
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
		phonetics: uniqueBy(entry.phonetics.map((item) => {
			const audio = item.audio?.map(normalizeAudio).filter((value): value is NonNullable<typeof value> => Boolean(value));
			return { ...item, ...(audio?.length ? { audio } : {}) };
		}), (item) => item.text.toLocaleLowerCase()),
		meanings: entry.meanings
			.map((meaning) => ({
				...meaning,
				partOfSpeech: meaning.partOfSpeech ? compactRepeatedTokens(cleanText(meaning.partOfSpeech)) : meaning.partOfSpeech,
				labels: meaning.labels?.map(cleanText).filter(Boolean),
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

function parseMeanings(nodes: Element[], language: string): Meaning[] {
	const headings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-6]$/.test(node.tagName));
	const meanings: Meaning[] = [];
	let currentEtymology: string | undefined;
	for (const heading of headings) {
		const partOfSpeech = headingText(heading);
		const normalized = partOfSpeech.toLocaleLowerCase();
		if (isEtymologyHeading(normalized)) {
			currentEtymology = /\d/.test(partOfSpeech) ? partOfSpeech : undefined;
			continue;
		}
		if (isNonMeaningHeading(normalized, language)) continue;
		const block = nodesBetween(nodes, heading, nextAnyHeading(nodes, heading));
		const list = block.find((node) => node.tagName === 'OL' && node.querySelector(':scope > li'));
		if (!list) continue;
		const parsedDefinitions = Array.from(list.querySelectorAll(':scope > li')).map((item) => parseDefinition(item)).filter((item): item is ParsedDefinition => Boolean(item));
		if (!parsedDefinitions.length) continue;
		const isPos = isPartOfSpeech(normalized);
		const parent = nearestParentHeading(headings, heading);
		const parentPartOfSpeech = parent && isPartOfSpeech(headingText(parent).toLocaleLowerCase()) ? headingText(parent) : undefined;
		const resolvedPartOfSpeech = isPos ? partOfSpeech : parentPartOfSpeech ?? partOfSpeech;
		const listIndex = block.indexOf(list);
		const contextLabels = extractContextLabels(listIndex < 0 ? block : block.slice(0, listIndex));
		const headingLabels = isPos ? [...new Set([...extractLabels(partOfSpeech), ...contextLabels])] : [partOfSpeech];
		const cleanPartOfSpeech = isPos ? stripLabelsFromPartOfSpeech(partOfSpeech) : resolvedPartOfSpeech;
		const groups: Array<{ labels: string[]; definitions: Definition[] }> = [];
		for (const parsed of parsedDefinitions) {
			const labels = parsed.labels.length ? parsed.labels : headingLabels;
			const previous = groups.at(-1);
			if (previous && sameLabels(previous.labels, labels)) previous.definitions.push(parsed.definition);
			else groups.push({ labels, definitions: [parsed.definition] });
		}
		groups.forEach((group) => meanings.push({
			partOfSpeech: cleanPartOfSpeech,
			...(group.labels.length ? { labels: group.labels } : {}),
			etymology: currentEtymology,
			definitions: group.definitions,
		}));
	}
	return meanings;
}

function isPartOfSpeech(value: string) {
	return PARTS_OF_SPEECH.has(value) || /^(?:verb|noun|adjective|adverb|pronoun|preposition|conjunction|interjection)\b/i.test(value);
}

function nearestParentHeading(headings: HTMLHeadingElement[], heading: HTMLHeadingElement) {
	const level = Number(heading.tagName.slice(1));
	const index = headings.indexOf(heading);
	return [...headings.slice(0, index)].reverse().find((candidate) => Number(candidate.tagName.slice(1)) < level);
}

function isEtymologyHeading(value: string) {
	return (HEADING_ALIASES.etymology ?? []).some((alias) => {
		const normalizedAlias = alias.toLocaleLowerCase();
		return value === normalizedAlias || /^\d+$/.test(value.slice(normalizedAlias.length + 1)) && value.startsWith(`${normalizedAlias} `);
	}) || /^etymology\s+\d+$/i.test(value);
}

function isNonMeaningHeading(value: string, language: string) {
	if (NON_MEANING_HEADINGS.has(value)) return true;
	return [...getSectionAliases(language, 'translations'), ...getSectionAliases(language, 'pronunciation')]
		.some((alias) => value === alias.toLocaleLowerCase());
}

interface ParsedDefinition { definition: Definition; labels: string[]; }

function parseDefinition(item: Element): ParsedDefinition | undefined {
	if (isFormOfDefinition(item)) return undefined;
	const labels = extractDefinitionLabels(item);
	const clone = item.cloneNode(true) as Element;
	Array.from(clone.querySelectorAll('ol, ul, dl, blockquote, style, script, template, .citation, .reference, .references, .quotation, .quote, [class*="quote"], [class*="usage-label"], [class*="qualifier-content"], [class*="ib-content"], [class*="gender"], sup')).forEach((node) => node.remove());
	const text = cleanText((clone.textContent ?? '').replace(/^\s*\((?:transitive|intransitive|untransitive|countable|uncountable|mass noun|usually transitive|usually intransitive)[^)]*\)\s*/i, ''));
	if (!text) return undefined;
	const examples = Array.from(item.querySelectorAll('dl dd, .example, .e-example, .usage-example')).filter((node) => !isQuoteElement(node)).map((node) => cleanText(node.textContent ?? '')).filter(Boolean);
	return { definition: { text, examples: [...new Set(examples)] }, labels };
}

const DEFINITION_LABELS = new Set([
	'transitive', 'intransitive', 'untransitive', 'ditransitive', 'ambitransitive', 'reflexive',
	'countable', 'uncountable', 'mass noun', 'usually transitive', 'usually intransitive',
	'plural', 'singular', 'archaic', 'obsolete', 'rare', 'formal', 'informal', 'literary',
]);
const LABEL_SELECTORS = '[class*="usage-label"], [class*="qualifier-content"], [class*="ib-content"], [class*="gender"]';

function extractDefinitionLabels(item: Element): string[] {
	const values = Array.from(item.querySelectorAll(LABEL_SELECTORS))
		.flatMap((node) => splitLabels(node.textContent ?? ''));
	const leading = cleanText(item.textContent ?? '').match(/^\(?\s*([^)]{2,50})\s*\)?\s*(?=\S)/)?.[1];
	if (leading && DEFINITION_LABELS.has(leading.trim().toLocaleLowerCase())) values.push(leading);
	return [...new Set(values.map(normalizeLabel).filter(Boolean))];
}

function extractContextLabels(nodes: Element[]) {
	return [...new Set(nodes.flatMap((node) => {
		const labelNodes = [
			...(node.matches(LABEL_SELECTORS) ? [node] : []),
			...Array.from(node.querySelectorAll(LABEL_SELECTORS)),
		];
		return labelNodes.flatMap((label) => splitLabels(label.textContent ?? '')).map(normalizeLabel);
	}))];
}

function splitLabels(value: string) {
	return value.split(/[,;·]|\s+or\s+/i).map((item) => cleanText(item)).filter((item) => DEFINITION_LABELS.has(item.toLocaleLowerCase()));
}

function normalizeLabel(value: string) { return value.trim().replace(/^./, (character) => character.toLocaleUpperCase()); }

function extractLabels(value: string) {
	const matches = value.match(/\(([^)]+)\)|\b(?:transitive|intransitive|untransitive|countable|uncountable|mass noun)\b/gi) ?? [];
	return [...new Set(matches.flatMap(splitLabels).map(normalizeLabel))];
}

function stripLabelsFromPartOfSpeech(value: string) {
	return value.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function sameLabels(left: string[], right: string[]) { return left.join('|').toLocaleLowerCase() === right.join('|').toLocaleLowerCase(); }

function isFormOfDefinition(item: Element) {
	if (item.querySelector('[class*="form-of"], [class*="form_of"]')) return true;
	const text = cleanText(item.textContent ?? '');
	return looksLikeFormOfText(text);
}

function looksLikeFormOfText(value: string) {
	return /^(?:the )?(?:simple|third-person|first-person|second-person|past|present|future|comparative|superlative|participle|infinitive|plural|singular)\b[^.]{0,100}\b(?:forms? of|of)\b/i.test(value);
}

function parsePhonetics(nodes: Element[], language: string): Pronunciation[] {
	const values = new Map<string, Pronunciation>();
	const aliases = getSectionAliases(language, 'pronunciation');
	const headings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-6]$/.test(node.tagName) && matchesHeading(node, aliases));
	const blocks = headings.length
		? headings.map((heading) => nodesBetween(nodes, heading, nextHeading(nodes, heading)))
		: [nodes];
	for (const block of blocks) {
		const ipaNodes = [...new Set(block.flatMap((node) => Array.from(node.querySelectorAll('.IPA, .ipa, [class*="IPA"]'))))];
		const audioElements = [...new Set(block.flatMap((node) => Array.from(node.querySelectorAll('audio'))))];
		for (const ipa of ipaNodes) {
			const text = cleanText(ipa.textContent ?? '');
			if (!text || text.startsWith('-')) continue;
			const key = text.toLocaleLowerCase();
			const current = values.get(key);
			const directAudio = isFirstIpaInListItem(ipa, ipaNodes) ? parseAudio(ipa) : [];
			const audio = mergeAudio(directAudio, parseNearbyAudio(ipa, ipaNodes, audioElements));
			if (current) current.audio = mergeAudio(current.audio, audio);
			else values.set(key, { text, ...(audio.length ? { audio } : {}) });
		}
	}
	return [...values.values()];
}

function isFirstIpaInListItem(ipa: Element, ipaNodes: Element[]) {
	const listItem = ipa.closest('li');
	return !listItem || ipaNodes.find((candidate) => candidate.closest('li') === listItem) === ipa;
}

function parseNearbyAudio(ipa: Element, ipaNodes: Element[], audioElements: Element[]): NonNullable<Pronunciation['audio']> {
	const text = cleanText(ipa.textContent ?? '');
	if (!text || text.startsWith('-')) return [];
	const nearestAudio = audioElements
		.filter((audio) => isAfter(ipa, audio))
		.sort((a, b) => documentOrderDistance(ipa, a) - documentOrderDistance(ipa, b))[0];
	if (!nearestAudio) return [];
	const previousIpas = ipaNodes
		.filter((candidate) => isAfter(candidate, nearestAudio) && !cleanText(candidate.textContent ?? '').startsWith('-'));
	const matchingIpas = previousIpas.filter((candidate) => pronunciationRegionsMatch(candidate, nearestAudio));
	const target = matchingIpas[0] ?? previousIpas.at(-1);
	return target === ipa ? parseAudioElement(nearestAudio) : [];
}

function pronunciationRegionsMatch(ipa: Element, audio: Element) {
	const ipaRegion = cleanText(ipa.closest('li')?.querySelector('.usage-label-accent')?.textContent ?? '').toLocaleLowerCase();
	const audioLabel = cleanText(audio.closest('.audiotable')?.textContent ?? audio.parentElement?.textContent ?? '').toLocaleLowerCase();
	if (!ipaRegion || !audioLabel) return false;
	const regionGroups = [
		['uk', 'british', 'received pronunciation'],
		['us', 'usa', 'american', 'general american'],
		['australia', 'australian'],
		['canada', 'canadian'],
		['new zealand', 'new zealand'],
	];
	return regionGroups.some((group) => group.some((value) => audioLabel.includes(value)) && group.some((value) => ipaRegion.includes(value)));
}

function parseAudio(ipa: Element): NonNullable<Pronunciation['audio']> {
	const scope = ipa.closest('li') ?? ipa.parentElement ?? ipa;
	return parseAudioInScope(scope);
}

function parseAudioInScope(scope: Element): NonNullable<Pronunciation['audio']> {
	const audioElements = Array.from(scope.querySelectorAll('audio'));
	return audioElements.flatMap((audio) => parseAudioElement(audio));
}

function parseAudioElement(audio: Element): NonNullable<Pronunciation['audio']> {
	const sources = Array.from(audio.querySelectorAll('source')).map((source) => ({ source, audio }));
	if (!sources.length) {
		return uniqueBy([{ source: audio, audio }], (item) => item.source.getAttribute('src') ?? '').map((item) => parseAudioSource(item.source, item.audio)).filter((audio): audio is NonNullable<typeof audio> => Boolean(audio));
	}
	return uniqueBy(sources.map(({ source, audio }) => parseAudioSource(source, audio)).filter((value): value is NonNullable<typeof value> => Boolean(value)), (audio) => audio.url);
}

function parseAudioSource(source: Element, audio: Element): NonNullable<Pronunciation['audio']>[number] | undefined {
		const rawUrl = source.getAttribute('src');
		if (!rawUrl) return undefined;
		const url = normalizeMediaUrl(rawUrl);
		if (!url) return undefined;
		const provider = audio.getAttribute('data-mwprovider')?.toLocaleLowerCase() === 'wikimediacommons' ? 'wikimedia-commons' as const : 'wiktionary' as const;
		return {
			url,
			mimeType: source.getAttribute('type') ?? undefined,
			...(audio.getAttribute('data-mwtitle') ? { title: audio.getAttribute('data-mwtitle') ?? undefined } : {}),
			provider,
		};
}

function mergeAudio(existing: Pronunciation['audio'], incoming: NonNullable<Pronunciation['audio']>) {
	return uniqueBy([...(existing ?? []), ...incoming], (audio) => audio.url);
}

function parseTranslations(nodes: Element[], language: string): Translation[] {
	const translations: Translation[] = [];
	const aliases = getSectionAliases(language, 'translations');
	const translationHeadings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-6]$/.test(node.tagName) && matchesHeading(node, aliases));
	for (const heading of translationHeadings) {
		const block = nodesBetween(nodes, heading, nextHeading(nodes, heading));
		const sense = block.flatMap((node) => [
			...(/^H[45]$/.test(node.tagName) ? [node] : []),
			...Array.from(node.querySelectorAll('h4, h5, .NavHead, .translations-header')),
		]).map(headingText).find((value) => value && !aliases.some((alias) => value.toLocaleLowerCase() === alias.toLocaleLowerCase()));
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
	const headings = nodes.filter((node): node is HTMLHeadingElement => /^H[3-6]$/.test(node.tagName) && isTargetHeading(node, target));
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
	const heading = nodes.find((node): node is HTMLHeadingElement => /^H[3-6]$/.test(node.tagName) && matchesHeading(node, HEADING_ALIASES[target] ?? [target]));
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
	return Array.from(document.querySelectorAll('h2, h3, h4, h5, h6, ol, ul, dl, table, p, div'));
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
		return /^H[3-6]$/.test(candidate.tagName) && candidate !== start && candidateLevel <= level && isAfter(start, candidate);
	});
}
function nextAnyHeading(nodes: Element[], start: Element): Element | undefined {
	return nodes.find((candidate) => /^H[3-6]$/.test(candidate.tagName) && candidate !== start && isAfter(start, candidate));
}

function headingText(element: Element) { return cleanText(element.querySelector('.mw-headline')?.textContent ?? element.textContent ?? ''); }

function formOfTarget(link: HTMLAnchorElement, language: string): string | undefined {
	const href = link.getAttribute('href') ?? '';
	try {
		const url = new URL(href, `https://${language}.wiktionary.org`);
		const hostLanguage = url.hostname.match(/^([a-z-]+)\.wiktionary\.org$/i)?.[1];
		if (hostLanguage && hostLanguage.toLocaleLowerCase() !== language.toLocaleLowerCase()) return undefined;
		const title = url.pathname.startsWith('/wiki/') ? url.pathname.slice('/wiki/'.length) : url.searchParams.get('title') ?? '';
		if (title) {
			const decoded = decodeURIComponent(title).replace(/_/g, ' ').trim();
			if (!/^(?:category|template|appendix|special):/i.test(decoded)) return cleanText(decoded.split('#')[0] ?? decoded);
		}
	} catch {
		// Fall back to the visible label for malformed or relative links.
	}
	const text = cleanText(link.textContent ?? '');
	return text || undefined;
}

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
function documentOrderDistance(start: Element, candidate: Element) {
	const position = start.compareDocumentPosition(candidate);
	return position & 4 ? 1 : position & 2 ? -1 : 0;
}
function compactRepeatedTokens(value: string) {
	const tokens = value.split(' ').filter(Boolean);
	if (tokens.length > 1 && tokens.every((token) => token.toLocaleLowerCase() === tokens[0]?.toLocaleLowerCase())) return tokens[0] ?? value;
	return value;
}
function isQuoteElement(element: Element) { return Boolean(element.closest('blockquote, .citation, .reference, .references, .quotation, .quote, [class*="quote"]')); }
function isQuoteText(value: string) { return /^\(?\s*(?:quoted|quote|citation|source)\b/i.test(value); }
function isLanguageLabel(word: string, languageCode?: string, languageName?: string) { return word.toLocaleLowerCase() === languageCode?.toLocaleLowerCase() || word.toLocaleLowerCase() === languageName?.toLocaleLowerCase(); }
function uniqueBy<T>(items: T[], key: (item: T) => string) { const seen = new Set<string>(); return items.filter((item) => { const value = key(item); if (seen.has(value)) return false; seen.add(value); return true; }); }
function normalizeAudio(audio: NonNullable<Pronunciation['audio']>[number]) {
	const url = normalizeMediaUrl(audio.url);
	return url ? { ...audio, url } : undefined;
}
function normalizeMediaUrl(value: string) {
	try { return new URL(value, 'https://en.wiktionary.org').toString(); } catch { return undefined; }
}
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
