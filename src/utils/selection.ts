export const MAX_LOOKUP_CHARS = 80;
export const MAX_LOOKUP_WORDS = 8;

export interface SelectionInfo {
	text: string;
	wordCount: number;
	tooLong: boolean;
}

export function normalizeSelection(value: string): string {
	return value
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[\s"'“”‘’.,!?;:()[\]{}]+|[\s"'“”‘’.,!?;:()[\]{}]+$/g, '')
		.trim();
}

export function analyzeSelection(value: string): SelectionInfo {
	const text = normalizeSelection(value);
	const wordCount = text ? text.split(' ').length : 0;
	return {
		text,
		wordCount,
		tooLong: text.length > MAX_LOOKUP_CHARS || wordCount > MAX_LOOKUP_WORDS,
	};
}
