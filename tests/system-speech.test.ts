import { describe, expect, it } from 'vitest';
import { selectLocalVoice } from '../src/providers/system-speech';

function voice(name: string, lang: string, localService: boolean, isDefault = false) {
	return { name, lang, localService, default: isDefault } as SpeechSynthesisVoice;
}

describe('system speech voice selection', () => {
	it('uses an exact locale match before a same-language fallback', () => {
		const fallback = voice('English UK', 'en-GB', true, true);
		const exact = voice('English US', 'en-US', true);

		expect(selectLocalVoice([fallback, exact], 'en-US')).toBe(exact);
	});

	it('never selects remote voices, even when they exactly match', () => {
		const remote = voice('Remote English US', 'en-US', false, true);
		const localFallback = voice('Local English UK', 'en-GB', true);

		expect(selectLocalVoice([remote, localFallback], 'en-US')).toBe(localFallback);
		expect(selectLocalVoice([remote], 'en-US')).toBeUndefined();
	});

	it('returns no voice for an unrelated language', () => {
		expect(selectLocalVoice([voice('English', 'en-US', true)], 'vi')).toBeUndefined();
	});
});
