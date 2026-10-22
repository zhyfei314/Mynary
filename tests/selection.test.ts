import { describe, expect, it } from 'vitest';
import { analyzeSelection, normalizeSelection } from '../src/utils/selection';

describe('selection normalization', () => {
	it('collapses whitespace and removes surrounding punctuation', () => {
		expect(normalizeSelection('  “Hello,   world!”  ')).toBe('Hello, world');
	});

	it('keeps short multi-word phrases valid', () => {
		expect(analyzeSelection('take care of')).toMatchObject({ text: 'take care of', wordCount: 3, tooLong: false });
	});

	it('flags selections longer than the lookup policy', () => {
		expect(analyzeSelection('one two three four five six seven eight nine').tooLong).toBe(true);
		expect(analyzeSelection('a'.repeat(81)).tooLong).toBe(true);
	});
});
