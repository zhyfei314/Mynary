import type { AudioSource } from '../types';
import type { TtsProvider } from './supertonic';

export interface TtsBinaryResponse {
	status: number;
	arrayBuffer: ArrayBuffer;
	mimeType?: string;
}

export type TtsBinaryRequester = (url: string, body: string, headers: Record<string, string>) => Promise<TtsBinaryResponse>;

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * TTS provider for OpenAI-compatible `/v1/audio/speech` servers
 * (e.g. OpenAI, Kokoro-FastAPI, OpenedAI-Speech, Edge-TTS proxies).
 */
export class OpenAiCompatibleTtsProvider implements TtsProvider {
	constructor(
		private readonly request: TtsBinaryRequester,
		private readonly endpoint = 'http://127.0.0.1:8000/v1',
		private readonly model = 'tts-1',
		private readonly voice = 'alloy',
		private readonly apiKey = '',
		private readonly speed = 1,
	) {}

	supportsLanguage() {
		return true;
	}

	async synthesize(text: string, language: string): Promise<AudioSource> {
		const url = resolveSpeechEndpoint(this.endpoint);
		const headers: Record<string, string> = { 'content-type': 'application/json' };
		if (this.apiKey.trim()) headers.authorization = `Bearer ${this.apiKey.trim()}`;
		const body = JSON.stringify({
			model: this.model.trim() || 'tts-1',
			input: text,
			voice: this.voice.trim() || 'alloy',
			speed: this.speed,
			response_format: 'mp3',
		});
		const response = await requestWithTimeout(this.request, url, body, headers);
		if (response.status < 200 || response.status >= 300) {
			throw new Error(`TTS server request failed (${response.status}).`);
		}
		const mimeType = response.mimeType && /^audio\//iu.test(response.mimeType) ? response.mimeType : 'audio/mpeg';
		const objectUrl = URL.createObjectURL(new Blob([response.arrayBuffer], { type: mimeType }));
		return {
			url: objectUrl,
			mimeType,
			title: `${this.model || 'TTS'} (${this.voice || 'default'})`,
			provider: 'tts',
			sourceUrl: url,
			languageCode: language,
			confidence: 1,
		};
	}
}

export function resolveSpeechEndpoint(endpoint: string): string {
	const clean = endpoint.trim().replace(/\/+$/u, '') || 'http://127.0.0.1:8000/v1';
	return /\/audio\/speech$/iu.test(clean) ? clean : `${clean}/audio/speech`;
}

async function requestWithTimeout(
	request: TtsBinaryRequester,
	url: string,
	body: string,
	headers: Record<string, string>,
): Promise<TtsBinaryResponse> {
	let timeoutId: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = window.setTimeout(() => reject(new Error(`TTS server request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`)), REQUEST_TIMEOUT_MS);
	});
	try {
		return await Promise.race([request(url, body, headers), timeout]);
	} finally {
		if (timeoutId !== undefined) window.clearTimeout(timeoutId);
	}
}
