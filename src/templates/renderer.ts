import { DictionaryEntry } from '../types';

export function renderTemplate(entry: DictionaryEntry, template: string): string {
	const definitions = entry.meanings.flatMap((meaning) => meaning.definitions.map((definition) => definition.text));
	const examples = entry.meanings.flatMap((meaning) => meaning.definitions.flatMap((definition) => definition.examples));
	const meaningsMarkdown = entry.meanings.map((meaning) => {
		const label = [meaning.partOfSpeech, meaning.etymology].filter(Boolean).join(' — ');
		const heading = label ? `### ${label}\n` : '';
		return `${heading}${meaning.definitions.map((definition) => `- ${definition.text}`).join('\n')}`;
	}).join('\n\n');
	const values: Record<string, string> = {
		word: entry.word,
		language: entry.language,
		IPA: entry.phonetics.map((phonetic) => phonetic.text).join(', '),
		partOfSpeech: entry.meanings.map((meaning) => meaning.partOfSpeech).filter(Boolean).join(', '),
		definition: definitions[0] ?? '',
		definitions: definitions.join('\n'),
		example: examples[0] ?? '',
		examples: examples.join('\n'),
		translation: entry.translations.map((translation) => translation.word).join(', '),
		translations: entry.translations.map((translation) => `${translation.languageName ?? translation.languageCode ?? translation.language ?? ''}: ${translation.word}`).join('\n'),
		synonyms: entry.synonyms.join(', '),
		antonyms: entry.antonyms.join(', '),
		etymology: entry.etymology ?? '',
		source: entry.source.name,
		sourceUrl: entry.source.url,
		lookupDate: new Date(entry.fetchedAt).toISOString().slice(0, 10),
		definitionsMarkdown: definitions.map((definition) => `- ${definition}`).join('\n'),
		meaningsMarkdown,
		examplesMarkdown: examples.map((example) => `- ${example}`).join('\n'),
		translationsMarkdown: entry.translations.map((translation) => `- ${translation.sense ? `${translation.sense}: ` : ''}${translation.languageName ?? translation.languageCode ?? translation.language ?? ''}: ${translation.word}`).join('\n'),
	};
	const aliases: Record<string, string> = {
		title: 'word',
		ipa: 'IPA',
		part_of_speech: 'partOfSpeech',
		source_url: 'sourceUrl',
		lookup_date: 'lookupDate',
		definitions_markdown: 'definitionsMarkdown',
		examples_markdown: 'examplesMarkdown',
		translations_markdown: 'translationsMarkdown',
		meanings_markdown: 'meaningsMarkdown',
	};
	const lookup = new Map(Object.entries(values).map(([key, value]) => [key.toLocaleLowerCase(), value]));
	const resolve = (key: string) => lookup.get((aliases[key.toLocaleLowerCase()] ?? key).toLocaleLowerCase()) ?? '';
	const withConditionals = renderConditionalBlocks(template, (key) => Boolean(resolve(key).trim()));
	return withConditionals.replace(/\{\{\s*([\w]+)\s*\}\}/g, (_match, key: string) => resolve(key));
}

function renderConditionalBlocks(template: string, isTruthy: (key: string) => boolean): string {
	return parseConditionalBlock(template, 0, false, isTruthy).text;
}

function parseConditionalBlock(template: string, position: number, stopAtClose: boolean, isTruthy: (key: string) => boolean): { text: string; index: number } {
	const tokens = /\{\{\s*(#if|\/if)\s*([\w]+)?\s*\}\}/gi;
	tokens.lastIndex = position;
	let output = '';
	let cursor = position;
	let match: RegExpExecArray | null;
	while ((match = tokens.exec(template))) {
		output += template.slice(cursor, match.index);
		const type = (match[1] ?? '').toLocaleLowerCase();
		if (type === '/if') {
			if (!stopAtClose) {
				output += match[0];
				cursor = tokens.lastIndex;
				continue;
			}
			return { text: output, index: tokens.lastIndex };
		}
		const nested = parseConditionalBlock(template, tokens.lastIndex, true, isTruthy);
		if (nested.index === template.length && !template.slice(tokens.lastIndex).match(/\{\{\s*\/if\s*\}\}/i)) {
			output += match[0] + template.slice(tokens.lastIndex);
			return { text: output, index: template.length };
		}
		if (isTruthy(match[2] ?? '')) output += nested.text;
		cursor = nested.index;
		tokens.lastIndex = nested.index;
	}
	output += template.slice(cursor);
	return { text: output, index: template.length };
}
