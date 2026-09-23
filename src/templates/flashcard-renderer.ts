import type { DictionaryEntry } from '../types';
import { extractFlashcardSide, hasFlashcardSide } from '../services/flashcard-markers';
import { renderTemplate } from './renderer';

export function prepareFlashcardNote(entry: DictionaryEntry, template: string, targetLanguage = '') {
	const templateEntry = {
		...entry,
		translations: targetLanguage ? entry.translations.filter((item) => item.languageCode === targetLanguage || item.language === targetLanguage) : [],
	};
	let content = renderTemplate(templateEntry, template, { targetLanguage });
	if (!hasFlashcardSide(content, 'front')) content = insertAfterFrontmatter(content, `<!-- mynary:front:start -->\n${entry.word}\n<!-- mynary:front:end -->\n\n`);
	if (!hasFlashcardSide(content, 'back')) {
		const definitions = renderTemplate(templateEntry, '{{meaningsMarkdown}}');
		const translations = targetLanguage ? renderTemplate(templateEntry, '{{translationsMarkdown}}') : '';
		const answer = [definitions, translations ? `### Translation\n${translations}` : ''].filter(Boolean).join('\n\n') || '*No definition available; add your own answer.*';
		content += `\n\n## Answer\n\n<!-- mynary:back:start -->\n${answer}\n<!-- mynary:back:end -->\n`;
	}
	return { content, front: extractFlashcardSide(content, 'front') ?? entry.word, back: extractFlashcardSide(content, 'back') ?? renderTemplate(templateEntry, '{{meaningsMarkdown}}') };
}

function insertAfterFrontmatter(markdown: string, block: string) {
	const frontmatter = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/u);
	if (!frontmatter || frontmatter.index === undefined) return `${block}${markdown}`;
	const insertionPoint = frontmatter.index + frontmatter[0].length;
	return `${markdown.slice(0, insertionPoint)}\n${block}${markdown.slice(insertionPoint)}`;
}
