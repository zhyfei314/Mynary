/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { dedupeAudioSources } from '../src/utils/format';

describe('audio display helpers', () => {
	it('deduplicates identical audio URLs and prefers local copies', () => {
		const sources = dedupeAudioSources([
			{ url: 'https://example.test/hello.ogg', provider: 'wiktionary', confidence: 0.9 },
			{ url: 'https://example.test/hello.ogg', provider: 'other', confidence: 0.8 },
			{ url: 'blob:hello', provider: 'tts', confidence: 1 },
			{ url: 'blob:hello', provider: 'tts', confidence: 1 },
		]);

		expect(sources).toHaveLength(2);
		expect(sources[0]).toMatchObject({ provider: 'wiktionary', confidence: 0.9 });
		expect(sources[1]).toMatchObject({ provider: 'tts' });
	});
});
