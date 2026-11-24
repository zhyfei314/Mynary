export interface TranslationHttpResponse {
	status: number;
	json: unknown;
}

export type TranslationRequester = (url: string, body: string, headers: Record<string, string>) => Promise<TranslationHttpResponse>;
export type OpenAiCompatibleProtocol = 'chat-completions' | 'plamo-3-completions';

export class LibreTranslateProvider {
	constructor(
		private readonly request: TranslationRequester,
		private readonly endpoint: string,
		private readonly apiKey = '',
		private readonly timeoutMs = 15_000,
	) {}

	async translate(text: string, from: string, to: string) {
		const body: Record<string, unknown> = { q: text, source: from, target: to, format: 'text' };
		if (this.apiKey.trim()) body.api_key = this.apiKey.trim();
		const response = await requestWithTimeout(
			() => this.request(`${trimTrailingSlashes(this.endpoint)}/translate`, JSON.stringify(body), { 'content-type': 'application/json' }),
			this.timeoutMs,
			'LibreTranslate',
		);
		assertSuccess(response, 'LibreTranslate');
		const data = asRecord(response.json);
		const translated = data?.translatedText;
		if (typeof translated !== 'string' || !translated.trim()) throw new Error(getErrorMessage(response.json) ?? 'LibreTranslate returned no translation.');
		return translated.trim();
	}
}

export class OpenAiCompatibleTranslationProvider {
	constructor(
		private readonly request: TranslationRequester,
		private readonly endpoint: string,
		private readonly model: string,
		private readonly apiKey = '',
		private readonly protocol: OpenAiCompatibleProtocol = 'chat-completions',
		private readonly timeoutMs = 30_000,
	) {}

	async translate(text: string, from: string, to: string) {
		if (!this.model.trim()) throw new Error('Enter a model name for the OpenAI-compatible translation server.');
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (this.apiKey.trim()) headers.authorization = `Bearer ${this.apiKey.trim()}`;
		const isPlamo = this.protocol === 'plamo-3-completions';
		const url = `${trimTrailingSlashes(this.endpoint)}/${isPlamo ? 'completions' : 'chat/completions'}`;
		const body = isPlamo
			? { model: this.model.trim(), prompt: createPlamoPrompt(text, from, to), temperature: 0, max_tokens: 512, stop: ['<|plamo:tag|>', '<|plamo:bos|>'], add_special_tokens: true }
			: {
				model: this.model.trim(),
				messages: [
					{ role: 'system', content: `Translate the user's text from ${from === 'auto' ? 'the detected source language' : from} to ${to}. Return only the translation. Preserve the original meaning, formatting, and line breaks.` },
					{ role: 'user', content: text },
				],
				temperature: 0,
				max_tokens: 1024,
			};
		const response = await requestWithTimeout(
			() => this.request(url, JSON.stringify(body), headers),
			this.timeoutMs,
			'OpenAI-compatible translation server',
		);
		assertSuccess(response, 'OpenAI-compatible translation server');
		const data = asRecord(response.json);
		const choices = Array.isArray(data?.choices) ? data.choices : [];
		const firstChoice = asRecord(choices[0]);
		const message = asRecord(firstChoice?.message);
		const translated = isPlamo ? firstChoice?.text : message?.content;
		if (typeof translated !== 'string' || !translated.trim()) throw new Error(getErrorMessage(response.json) ?? 'The OpenAI-compatible server returned no translation.');
		return translated.trim();
	}
}

export function createPlamoPrompt(text: string, from: string, to: string) {
	const inputLanguage = from === 'auto' ? '' : `<|plamo:key|>lang<|plamo:val|>${from}`;
	return `<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input${inputLanguage}<|plamo:msg|>${text}<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${to}<|plamo:msg|>`;
}

async function requestWithTimeout<T>(request: () => Promise<T>, timeoutMs: number, providerName: string): Promise<T> {
	let timeoutId: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = window.setTimeout(() => reject(new Error(`${providerName} timed out after ${Math.round(timeoutMs / 1000)} seconds.`)), timeoutMs);
	});
	try {
		return await Promise.race([request(), timeout]);
	} catch (error) {
		if (error instanceof Error && error.message.includes('timed out')) throw error;
		throw new Error(`Could not connect to ${providerName}. Check the endpoint and server status.`);
	} finally {
		if (timeoutId !== undefined) window.clearTimeout(timeoutId);
	}
}

function assertSuccess(response: TranslationHttpResponse, providerName: string) {
	if (response.status < 200 || response.status >= 300) {
		throw new Error(getErrorMessage(response.json) ?? `${providerName} request failed (HTTP ${response.status}).`);
	}
}

function getErrorMessage(value: unknown) {
	const data = asRecord(value);
	const nested = asRecord(data?.error);
	const message = nested?.message ?? data?.error;
	return typeof message === 'string' && message.trim() ? message.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function trimTrailingSlashes(value: string) {
	return value.trim().replace(/\/+$/u, '');
}
