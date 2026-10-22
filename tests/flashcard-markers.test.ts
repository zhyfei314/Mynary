import { describe, expect, it } from 'vitest';
import { extractFlashcardSide, hasFlashcardSide } from '../src/services/flashcard-markers';

describe('flashcard template markers', () => {
	it('extracts front and back contents without including surrounding note text', () => {
		const note = '# Note\n<!-- mynary:front:start -->\nQuestion\n<!-- mynary:front:end -->\n## Answer\n<!-- mynary:back:start -->\nDefinition\n<!-- mynary:back:end -->\n## Notes';
		expect(extractFlashcardSide(note, 'front')).toBe('Question');
		expect(extractFlashcardSide(note, 'back')).toBe('Definition');
	});

	it('accepts alias names, case differences, and start/end variants', () => {
		const note = '<!-- MYNARY_question_begin -->\nPrompt\n<!-- mynary:prompt:close -->\n<!-- mynary_answer_open -->\nAnswer\n<!-- mynary:reverse:stop -->';
		expect(extractFlashcardSide(note, 'front')).toBe('Prompt');
		expect(extractFlashcardSide(note, 'back')).toBe('Answer');
		expect(hasFlashcardSide(note, 'front')).toBe(true);
		expect(hasFlashcardSide(note, 'back')).toBe(true);
	});

	it('ignores incomplete marker pairs', () => {
		expect(extractFlashcardSide('<!-- mynary:back:start -->\nAnswer', 'back')).toBeUndefined();
	});
});
