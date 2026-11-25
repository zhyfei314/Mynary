import { describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleTtsProvider, resolveSpeechEndpoint } from '../src/providers/openai-tts';

describe('OpenAiCompatibleTtsProvider', () => {
	it('resolves both base v1 URLs and full speech endpoints', () => {
		expect(resolveSpeechEndpoint('http://127.0.0.1:8000/v1')).toBe('http://127.0.0.1:8000/v1/audio/speech');
		expect(resolveSpeechEndpoint('http://127.0.0.1:8000/v1/')).toBe('http://127.0.0.1:8000/v1/audio/speech');
		expect(resolveSpeechEndpoint('http://127.0.0.1:8000/v1/audio/speech')).toBe('http://127.0.0.1:8000/v1/audio/speech');
	});

	it('sends OpenAI-compatible speech payload with optional bearer token and returns audio source', async () => {
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-tts');
		try {
			const calls: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
			const provider = new OpenAiCompatibleTtsProvider(
				async (url, body, headers) => {
					calls.push({ url, body, headers });
					return { status: 200, arrayBuffer: new Uint8Array([1, 2, 3]).buffer, mimeType: 'audio/mpeg' };
				},
				'http://127.0.0.1:8000/v1',
				'kokoro',
				'af_heart',
				'secret-key',
				1.1,
			);

			const audio = await provider.synthesize('hello', 'en');
			expect(calls).toHaveLength(1);
			expect(calls[0]!.url).toBe('http://127.0.0.1:8000/v1/audio/speech');
			expect(calls[0]!.headers.authorization).toBe('Bearer secret-key');
			expect(JSON.parse(calls[0]!.body)).toEqual({
				model: 'kokoro',
				input: 'hello',
				voice: 'af_heart',
				speed: 1.1,
				response_format: 'mp3',
			});
			expect(audio.url).toBe('blob:mock-tts');
			expect(audio.mimeType).toBe('audio/mpeg');
			expect(audio.provider).toBe('tts');
		} finally {
			createObjectURL.mockRestore();
		}
	});
});
