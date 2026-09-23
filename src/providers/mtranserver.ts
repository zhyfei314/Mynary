export interface MTranServerResponse {
	status: number;
	json: unknown;
}

export type MTranServerRequester = (url: string, body: string, token: string) => Promise<MTranServerResponse>;

export class MTranServerProvider {
	constructor(
		private readonly request: MTranServerRequester,
		private readonly endpoint: string,
		private readonly token = '',
		private readonly timeoutMs = 15_000,
	) {}

	async translate(text: string, from: string, to: string): Promise<string> {
		const request = this.request(`${this.endpoint}/translate`, JSON.stringify({ from, to, text, html: false }), this.token);
		let timeoutId: number | undefined;
		const timeout = new Promise<never>((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error(`MTranServer timed out after ${this.timeoutMs / 1000} seconds.`)), this.timeoutMs); });
		let response: MTranServerResponse;
		try {
			response = await Promise.race([request, timeout]);
		} catch (error) {
			if (error instanceof Error && error.message.includes('timed out')) throw error;
			throw new Error(`Could not connect to MTranServer at ${this.endpoint}. Start the server and check its address and port.`);
		} finally { if (timeoutId !== undefined) window.clearTimeout(timeoutId); }
		if (response.status < 200 || response.status >= 300) throw new Error(`MTranServer request failed (${response.status}).`);
		const data = response.json as { result?: unknown; text?: unknown; translatedText?: unknown; translation?: unknown; error?: unknown };
		const translated = data.result ?? data.translatedText ?? data.text ?? data.translation;
		if (typeof translated !== 'string' || !translated.trim()) throw new Error(typeof data.error === 'string' ? data.error : 'MTranServer returned no translation.');
		return translated;
	}
}
