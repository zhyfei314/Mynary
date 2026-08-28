export interface EnglishDeinflection {
	word: string;
	reason: string;
}

/**
 * A deliberately small, conservative subset of Yomitan's English rules.
 * The provider still tries the exact Wiktionary page first; these candidates
 * are only used when that page has no dictionary meanings.
 */
export function getEnglishDeinflections(input: string): EnglishDeinflection[] {
	const word = input.trim().toLocaleLowerCase();
	if (!word || word.length < 3) return [];

	const candidates: EnglishDeinflection[] = [];
	const add = (value: string, reason: string) => {
		if (value === word || value.length < 2 || candidates.some((candidate) => candidate.word === value)) return;
		candidates.push({ word: value, reason });
	};

	// Yomitan's high-value irregular rules.
	for (const [form, lemma] of [['said', 'say'], ['paid', 'pay'], ['laid', 'lay']] as const) {
		if (word === form) add(lemma, 'irregular past tense');
	}

	if (word.endsWith('ies')) add(`${word.slice(0, -3)}y`, 'third-person singular or plural');
	if (word.endsWith('ves')) {
		add(`${word.slice(0, -3)}f`, 'plural');
		add(`${word.slice(0, -3)}fe`, 'plural');
	}
	if (word.endsWith('es')) add(word.slice(0, -2), 'third-person singular or plural');
	if (word.endsWith('s') && !word.endsWith('ss')) add(word.slice(0, -1), 'third-person singular or plural');

	if (word.endsWith('ied')) add(`${word.slice(0, -3)}y`, 'past tense');
	if (word.endsWith('cked')) add(`${word.slice(0, -4)}c`, 'past tense');
	if (word.endsWith('ed')) {
		add(word.slice(0, -2), 'past tense');
		add(`${word.slice(0, -2)}e`, 'past tense');
	}
	for (const consonant of 'bdgklmnprstz') {
		if (word.endsWith(`${consonant}${consonant}ed`)) add(`${word.slice(0, -4)}${consonant}`, 'past tense');
	}

	if (word.endsWith('ying')) add(`${word.slice(0, -4)}ie`, 'present participle');
	if (word.endsWith('cking')) add(`${word.slice(0, -5)}c`, 'present participle');
	if (word.endsWith('ing')) {
		add(word.slice(0, -3), 'present participle');
		add(`${word.slice(0, -3)}e`, 'present participle');
	}
	for (const consonant of 'bdgklmnprstz') {
		if (word.endsWith(`${consonant}${consonant}ing`)) add(`${word.slice(0, -5)}${consonant}`, 'present participle');
	}

	return candidates;
}
