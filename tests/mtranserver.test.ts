import { describe, expect, it, vi } from 'vitest';
import { MTranServerProvider } from '../src/providers/mtranserver';

describe('MTranServer provider', () => {
	it('posts a local translation request and returns the translated text', async () => {
		const request = vi.fn(async () => ({ status: 200, json: { text: 'Xin chào' } }));
		const provider = new MTranServerProvider(request, 'http://127.0.0.1:8989', 'secret', 15000);

		await expect(provider.translate('Hello', 'en', 'vi')).resolves.toBe('Xin chào');
		expect(request).toHaveBeenCalledWith(
			'http://127.0.0.1:8989/translate',
			JSON.stringify({ from: 'en', to: 'vi', text: 'Hello', html: false }),
			'secret',
		);
	});

	it('reports server errors', async () => {
		const provider = new MTranServerProvider(async () => ({ status: 503, json: {} }), 'http://127.0.0.1:8989');
		await expect(provider.translate('Hello', 'en', 'vi')).rejects.toThrow('MTranServer request failed (503)');
	});

	it('accepts the result field returned by MTranServer', async () => {
		const provider = new MTranServerProvider(async () => ({ status: 200, json: { result: 'Xin chào thế giới' } }), 'http://127.0.0.1:8989');

		await expect(provider.translate('Hello world', 'en', 'vi')).resolves.toBe('Xin chào thế giới');
	});
});
