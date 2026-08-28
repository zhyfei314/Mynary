import { describe, expect, it } from 'vitest';
import { getEnglishDeinflections } from '../src/providers/english-deinflector';

describe('English deinflection', () => {
	it('covers common Yomitan-style suffix rules', () => {
		expect(getEnglishDeinflections('walked').map((item) => item.word)).toContain('walk');
		expect(getEnglishDeinflections('tries').map((item) => item.word)).toContain('try');
		expect(getEnglishDeinflections('running').map((item) => item.word)).toContain('run');
	});

	it('handles irregular past forms', () => {
		expect(getEnglishDeinflections('said')).toContainEqual({ word: 'say', reason: 'irregular past tense' });
	});
});
