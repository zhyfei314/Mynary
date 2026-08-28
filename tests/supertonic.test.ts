/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import { SupertonicProvider } from '../src/providers/supertonic';

describe('Supertonic provider', () => {
	it('posts the configured synthesis options and returns an audio source', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:supertonic');
		let requestUrl = '';
		let requestBody = '';
		const provider = new SupertonicProvider(async (url, body) => {
			requestUrl = url;
			requestBody = body;
			return { status: 200, arrayBuffer: new ArrayBuffer(4), mimeType: 'audio/wav' };
		}, 'http://127.0.0.1:7788/v1/tts', 'F1', 10, 1.2);

		const source = await provider.synthesize('hello', 'en');

		expect(requestUrl).toBe('http://127.0.0.1:7788/v1/tts');
		expect(JSON.parse(requestBody)).toEqual({ text: 'hello', voice: 'F1', lang: 'en', steps: 10, speed: 1.2, response_format: 'wav' });
		expect(source).toMatchObject({ url: 'blob:supertonic', mimeType: 'audio/wav', provider: 'tts', languageCode: 'en' });
		expect(createObjectURL).toHaveBeenCalledOnce();
		createObjectURL.mockRestore();
	});

	it('rejects a failed local server response', async () => {
		const provider = new SupertonicProvider(async () => ({ status: 503, arrayBuffer: new ArrayBuffer(0) }));
		await expect(provider.synthesize('hello', 'en')).rejects.toThrow('Supertonic request failed (503)');
	});

	it('does not leave a lookup hanging when the local server never responds', async () => {
		vi.useFakeTimers();
		try {
			const provider = new SupertonicProvider(() => new Promise<never>(() => undefined));
			const result = expect(provider.synthesize('hello', 'en')).rejects.toThrow('timed out after 15 seconds');
			await vi.advanceTimersByTimeAsync(15_000);
			await result;
		} finally {
			vi.useRealTimers();
		}
	});
});
