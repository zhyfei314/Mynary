import { DictionaryEntry, Meaning, Phonetic, Translation } from '../types';

const LANGUAGE_NAMES: Record<string, string> = {
	en: 'English', vi: 'Vietnamese', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
	fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', ru: 'Russian',
};

export function parseWikitext(word: string, language: string, title: string, raw: string, fetchedAt = Date.now()): DictionaryEntry {
	const section = findLanguageSection(raw, language);
	const phonetics = parsePhonetics(section);
	const meanings = parseMeanings(section);
	const sourceUrl = `https://${language}.wiktionary.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
	return {
		word,
		language,
		phonetics,
		meanings,
		translations: parseTranslations(section),
		synonyms: parseRelationLinks(section, 'synonyms?'),
		antonyms: parseRelationLinks(section, 'antonyms?'),
		etymology: parseEtymology(section),
		source: { id: 'wiktionary', name: 'Wiktionary', url: sourceUrl },
		fetchedAt,
	};
}

function findLanguageSection(raw: string, language: string): string {
	const languageName = LANGUAGE_NAMES[language] ?? language;
	const heading = new RegExp(`^==\\s*${escapeRegExp(languageName)}\\s*==\\s*$`, 'mi');
	const match = heading.exec(raw);
	if (!match || match.index === undefined) return raw;
	const bodyStart = match.index + match[0].length;
	const nextHeading = /^==\s*[^=].*?\s*==\s*$/gim;
	nextHeading.lastIndex = bodyStart;
	const next = nextHeading.exec(raw);
	return raw.slice(bodyStart, next?.index ?? raw.length);
}

function parsePhonetics(section: string): Phonetic[] {
	const values = new Set<string>();
	for (const match of section.matchAll(/\{\{(?:IPA|IPAchar|pron|音声)\s*\|([^}]+)\}\}/gi)) {
		const parts = (match[1] ?? '').split('|').map((part) => part.trim());
		const value = clean(/^[a-z-]{2,5}$/i.test(parts[0] ?? '') ? (parts[1] ?? '') : (parts[0] ?? ''));
		if (value) values.add(value);
	}
	return [...values].map((text) => ({ text }));
}

function parseMeanings(section: string): Meaning[] {
	const text = stripComments(section);
	const meanings: Meaning[] = [];
	let current: Meaning | undefined;
	let lastDefinition: { text: string; examples: string[] } | undefined;

	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		const heading = line.match(/^===+\s*([^=]+?)\s*===+$/);
		if (heading) {
			current = { partOfSpeech: clean(heading[1] ?? ''), definitions: [] };
			meanings.push(current);
			lastDefinition = undefined;
			continue;
		}
		const definitionMatch = line.match(/^#(?![#:*])\s*(.+)$/);
		if (definitionMatch) {
			if (!current) { current = { definitions: [] }; meanings.push(current); }
			const definition = { text: clean(definitionMatch[1] ?? ''), examples: [] };
			if (definition.text) { current.definitions.push(definition); lastDefinition = definition; }
			continue;
		}
		const exampleMatch = line.match(/^#[:*]\s*(.+)$/);
		if (exampleMatch && lastDefinition) {
			const rawExample = exampleMatch[1] ?? '';
			// #* is Wiktionary's citation/quotation convention. Keep #:
			// usage examples, but do not expose bibliographic material.
			if (line.startsWith('#*')) continue;
			if (isQuoteTemplate(rawExample)) continue;
			const example = clean(rawExample);
			if (example) lastDefinition.examples.push(example);
		}
	}
	return meanings.filter((meaning) => meaning.definitions.length > 0);
}

function parseTranslations(section: string): Translation[] {
	const translations: Translation[] = [];
	const seen = new Set<string>();
	for (const match of section.matchAll(/\{\{(?:t|t\+)\s*\|\s*([^|}]+)\s*\|\s*([^|}]+)[^}]*\}\}/gi)) {
		const language = clean(match[1] ?? '');
		const word = clean(match[2] ?? '');
		const key = `${language}:${word}`;
		if (language && word && !seen.has(key)) { seen.add(key); translations.push({ language, word }); }
	}
	return translations;
}

function parseRelationLinks(section: string, heading: string): string[] {
	const headingMatch = new RegExp(`^={3,}\\s*${heading}\\s*={3,}([\\s\\S]*?)(?=^={3,}|(?![\\s\\S]))`, 'im').exec(section);
	if (!headingMatch) return [];
	const body = headingMatch[1] ?? '';
	const links = [...body.matchAll(/\[\[([^]|]+)(?:\|([^]]+))?\]\]/g)].map((match) => clean(match[2] ?? match[1] ?? ''));
	const templates = [...body.matchAll(/\{\{(?:l|link)\|[^|}]+\|([^|}]+)[^}]*\}\}/gi)].map((match) => clean(match[1] ?? ''));
	return [...new Set([...links, ...templates])].filter(Boolean);
}

function parseEtymology(section: string): string | undefined {
	const match = /^={3,}[ \t]*Etymology[^=\r\n]*={3,}([\s\S]*?)(?=^={3,}|(?![\s\S]))/im.exec(section);
	if (!match) return undefined;
	return clean(match[1]?.split(/\r?\n/).find((line) => line.trim() && !line.trim().startsWith('{{')) ?? '') || undefined;
}

export function clean(value: string): string {
	let cleaned = stripQuoteTemplates(value)
		.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_all, target: string, label?: string) => label ?? target.split('#')[0] ?? target)
		.replace(/\[https?:\/\/\S+(?:\s+([^\]]+))?\]/gi, (_all, label?: string) => label ?? '')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/''+/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	for (let pass = 0; pass < 3 && /\{\{[^{}]*\}\}/.test(cleaned); pass++) {
		cleaned = cleaned.replace(/\{\{([^{}]*)\}\}/g, (_all, body: string) => renderTemplate(body));
	}
	return cleaned
		.replace(/\b(en|vi|ja|ko|zh|fr|de|es|it|ru)(?:\s+\1)+\b/gi, '$1')
		.replace(/\{\{|\}\}/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function renderTemplate(body: string): string {
	const parts = body.split('|').map((part: string) => part.trim());
	const name = (parts.shift() ?? '').toLocaleLowerCase();
	if (/^(quote|quote-|rq:|cite|citation)/i.test(name)) return '';
	if (/^(lb|label|q|qualifier|gloss|context|usage|sense|rfdef|rfv|non-gloss definition)$/.test(name)) return '';
	if (/^(ux|usex|example)$/.test(name)) return parts[1] ?? parts[0] ?? '';
	if (/^(l|link|t|t\+|m|mention|inh|der|bor|cog|cognate|root)$/.test(name)) return parts[1] ?? parts[0] ?? '';
	if (/^(ipa|ipa2|pron|audio|rhymes|en-noun|en-verb|en-adj)$/.test(name)) return '';
	return parts.find((part) => !/^[a-z-]{2,8}$/i.test(part) && !/^[a-z]+\s*=/.test(part))?.split('=')[0] ?? '';
}

function isQuoteTemplate(value: string) { return /\{\{\s*(?:quote|quote-[^|}\s]+|RQ:[^|}]+)\b/i.test(value); }
function stripQuoteTemplates(value: string) {
	let result = value;
	for (let pass = 0; pass < 4; pass++) {
		const next = result.replace(/\{\{\s*(?:quote|quote-[^|}\s]+|RQ:[^|}]+)[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}/gi, '');
		if (next === result) break;
		result = next;
	}
	return result;
}

function stripComments(value: string) { return value.replace(/<!--[\s\S]*?-->/g, ''); }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
