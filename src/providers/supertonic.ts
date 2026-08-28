import type { AudioSource } from '../types';

export interface SupertonicResponse { status: number; arrayBuffer: ArrayBuffer; mimeType?: string; }
export type SupertonicRequester = (url: string, body: string) => Promise<SupertonicResponse>;
export const SUPERTONIC_LANGUAGES = new Set(['en', 'ko', 'ja', 'ar', 'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hi', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nl', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sv', 'tr', 'uk', 'vi']);
export interface TtsProvider { synthesize(text: string, language: string): Promise<AudioSource>; supportsLanguage?(language: string): boolean; }
const REQUEST_TIMEOUT_MS = 15_000;

export class SupertonicProvider implements TtsProvider {
	constructor(private readonly request: SupertonicRequester, private readonly endpoint = 'http://127.0.0.1:7788/v1/tts', private readonly voice = 'M1', private readonly steps = 8, private readonly speed = 1.05) {}
	supportsLanguage(language: string) { return SUPERTONIC_LANGUAGES.has(language); }

	async synthesize(text: string, language: string): Promise<AudioSource> {
		if (!this.supportsLanguage(language)) throw new Error(`Supertonic does not support “${language}”. IPA is still available.`);
		const response = await requestWithTimeout(this.request, this.endpoint, JSON.stringify({ text, voice: this.voice, lang: language, steps: this.steps, speed: this.speed, response_format: 'wav' }));
		if (response.status < 200 || response.status >= 300) throw new Error(`Supertonic request failed (${response.status}).`);
		const mimeType = response.mimeType || 'audio/wav';
		const url = URL.createObjectURL(new Blob([response.arrayBuffer], { type: mimeType }));
		return { url, mimeType, title: `Supertonic ${this.voice}`, provider: 'tts', sourceUrl: this.endpoint, languageCode: language, confidence: 1 };
	}
}

async function requestWithTimeout(request: SupertonicRequester, url: string, body: string) {
	let timeoutId: number | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = window.setTimeout(() => reject(new Error(`Supertonic request timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds.`)), REQUEST_TIMEOUT_MS);
	});
	try {
		return await Promise.race([request(url, body), timeout]);
	} finally {
		if (timeoutId !== undefined) window.clearTimeout(timeoutId);
	}
}
