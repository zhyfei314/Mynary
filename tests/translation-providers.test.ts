import { describe, expect, it, vi } from 'vitest';
import { LibreTranslateProvider, OpenAiCompatibleTranslationProvider, createPlamoPrompt } from '../src/providers/translation-providers';

describe('LibreTranslate provider', () => {
	it('posts the documented request shape and returns translatedText', async () => {
		const request = vi.fn(async () => ({ status: 200, json: { translatedText: 'Xin chào' } }));
		const provider = new LibreTranslateProvider(request, 'http://localhost:5000/', ' key ');
		await expect(provider.translate('Hello', 'en', 'vi')).resolves.toBe('Xin chào');
		expect(request).toHaveBeenCalledWith('http://localhost:5000/translate', JSON.stringify({ q: 'Hello', source: 'en', target: 'vi', format: 'text', api_key: 'key' }), { 'content-type': 'application/json' });
	});

	it('reports HTTP errors and malformed success responses', async () => {
		await expect(new LibreTranslateProvider(async () => ({ status: 429, json: { error: 'Rate limited' } }), 'http://localhost:5000').translate('Hi', 'en', 'vi')).rejects.toThrow('Rate limited');
		await expect(new LibreTranslateProvider(async () => ({ status: 200, json: {} }), 'http://localhost:5000').translate('Hi', 'en', 'vi')).rejects.toThrow('returned no translation');
	});
});

describe('OpenAI-compatible translation provider', () => {
	it('sends Chat Completions requests with bearer auth and reads message content', async () => {
		const request = vi.fn(async (_url: string, _body: string, _headers: Record<string, string>) => ({ status: 200, json: { choices: [{ message: { content: 'Xin chào' } }] } }));
		const provider = new OpenAiCompatibleTranslationProvider(request, 'http://localhost:8000/v1/', 'test-model', 'secret');
		await expect(provider.translate('Hello', 'en', 'vi')).resolves.toBe('Xin chào');
		const [url, rawBody, headers] = request.mock.calls[0]!;
		const body = JSON.parse(rawBody) as { model: string; messages: Array<{ role: string; content: string }> };
		expect(url).toBe('http://localhost:8000/v1/chat/completions');
		expect(headers.authorization).toBe('Bearer secret');
		expect(body.model).toBe('test-model');
		expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
		expect(body.messages[0]?.content).toContain('from en to vi');
	});

	it('sends PLaMo 3 PFML3 prompts to the Completions endpoint and reads text', async () => {
		const request = vi.fn(async (_url: string, _body: string, _headers: Record<string, string>) => ({ status: 200, json: { choices: [{ text: 'こんにちは' }] } }));
		const provider = new OpenAiCompatibleTranslationProvider(request, 'http://localhost:8000/v1', 'pfnet/plamo-3-translate-2b', '', 'plamo-3-completions');
		await expect(provider.translate('Hello', 'en', 'ja')).resolves.toBe('こんにちは');
		const [url, rawBody, headers] = request.mock.calls[0]!;
		const body = JSON.parse(rawBody) as { model: string; prompt: string; add_special_tokens: boolean; stop: string[] };
		expect(url).toBe('http://localhost:8000/v1/completions');
		expect(headers.authorization).toBeUndefined();
		expect(body.model).toBe('pfnet/plamo-3-translate-2b');
		expect(body.prompt).toBe(createPlamoPrompt('Hello', 'en', 'ja'));
		expect(body.prompt).toContain('<|plamo:tag|>dataset<|plamo:msg|>translation');
		expect(body.add_special_tokens).toBe(true);
		expect(body.stop).toContain('<|plamo:tag|>');
	});

	it('validates server errors, empty choices, and missing model configuration', async () => {
		const provider = new OpenAiCompatibleTranslationProvider(async () => ({ status: 500, json: { error: { message: 'Model unavailable' } } }), 'http://localhost:8000/v1', 'model');
		await expect(provider.translate('Hi', 'en', 'vi')).rejects.toThrow('Model unavailable');
		await expect(new OpenAiCompatibleTranslationProvider(async () => ({ status: 200, json: { choices: [] } }), 'http://localhost:8000/v1', 'model').translate('Hi', 'en', 'vi')).rejects.toThrow('returned no translation');
		await expect(new OpenAiCompatibleTranslationProvider(async () => ({ status: 200, json: {} }), 'http://localhost:8000/v1', '').translate('Hi', 'en', 'vi')).rejects.toThrow('Enter a model name');
	});
});
