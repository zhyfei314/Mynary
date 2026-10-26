export const MAX_LEGACY_FLASHCARD_REFRESHES = 10;

const LEGACY_WORD_LINE = /^\s*([^\r\n()]{1,100}?)\s*\(\)::/imu;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

export function isLegacyFlashcardNote(markdown: string): boolean {
	return /^\s*#\s*flashcards\/[^\r\n]+/imu.test(markdown) || LEGACY_WORD_LINE.test(markdown);
}

export function isMynaryFlashcardNote(markdown: string): boolean {
	return isLegacyFlashcardNote(markdown)
		|| (/<!--\s*mynary\s*[:_-]\s*(?:front|question|prompt)\s*[:_-]\s*(?:start|begin|open)\s*-->/iu.test(markdown)
			&& /<!--\s*mynary\s*[:_-]\s*(?:back|answer|reverse)\s*[:_-]\s*(?:start|begin|open)\s*-->/iu.test(markdown));
}

export function hasLanguageLabelInFilename(path: string): boolean {
	const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/iu, '');
	return /\[[a-z]{2,3}\](?:-\d+)?$/iu.test(filename);
}

export function getLegacyFlashcardLanguage(markdown: string, path: string, knownLanguages: string[], fallback: string): string {
	const fromProperty = readFrontmatterValue(markdown, 'mynary-language');
	const fromId = readFrontmatterValue(markdown, 'mynary-vocabulary-id')?.match(/^([a-z]{2,3}):/iu)?.[1];
	const fromLegacyTitle = markdown.match(/^#\s*flashcards\/([a-z]{2,3})_/imu)?.[1];
	const filename = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/iu, '');
	const fromFilename = filename.match(/\[([a-z]{2,3})\](?:-\d+)?$/iu)?.[1];
	const fromFolder = knownLanguages.find((code) => path.toLocaleLowerCase().includes(`/${code.toLocaleLowerCase()}/`));
	return fromProperty ?? fromId ?? fromLegacyTitle ?? fromFilename ?? fromFolder ?? fallback;
}

export function getLegacyFlashcardWord(markdown: string): string | undefined {
	const storedWord = readFrontmatterValue(markdown, 'mynary-word');
	const legacyWord = markdown.match(LEGACY_WORD_LINE)?.[1];
	const front = markdown.match(/<!--\s*mynary\s*[:_-]\s*(?:front|question|prompt)\s*[:_-]\s*(?:start|begin|open)\s*-->([\s\S]*?)<!--\s*mynary\s*[:_-]\s*(?:front|question|prompt)\s*[:_-]\s*(?:end|close|stop)\s*-->/iu)?.[1];
	const value = storedWord ?? legacyWord ?? front;
	const word = value?.trim().replace(/\s+\[[a-z]{2,3}\]$/iu, '').replace(/^\[\[|\]\]$/gu, '').trim();
	return word || undefined;
}

export function languageLabeledNotePath(path: string, word: string, language: string, senseIndex?: number, senseCount?: number): string {
	const slash = path.lastIndexOf('/');
	const directory = slash >= 0 ? path.slice(0, slash + 1) : '';
	const filename = slash >= 0 ? path.slice(slash + 1) : path;
	const extensionIndex = filename.lastIndexOf('.');
	const extension = extensionIndex >= 0 ? filename.slice(extensionIndex) : '.md';
	const currentBase = extensionIndex >= 0 ? filename.slice(0, extensionIndex) : filename;
	const existingSuffix = currentBase.match(/(?:\s+\[[a-z]{2,3}\])?(-\d+)$/iu)?.[1] ?? '';
	const suffix = senseCount && senseCount > 1 ? `-${senseIndex ?? 1}` : senseCount === 1 ? '' : existingSuffix;
	const safeWord = word.replace(/[\\/:*?"<>|]/gu, '-').trim() || 'Vocabulary';
	return `${directory}${safeWord} [${language.toUpperCase()}]${suffix}${extension}`;
}

function readFrontmatterValue(markdown: string, key: string): string | undefined {
	const frontmatter = markdown.match(FRONTMATTER)?.[1];
	const line = frontmatter?.split(/\r?\n/u).find((item) => item.startsWith(`${key}:`));
	const value = line?.slice(key.length + 1).trim();
	if (!value) return undefined;
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value;
}
