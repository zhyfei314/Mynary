import type { AudioSource } from '../types';
import type { TtsProvider } from './supertonic';

const VOICE_DISCOVERY_TIMEOUT_MS = 8000;
const MAX_UTTERANCE_LENGTH = 1800;

/** Uses the host OS speech engine exposed by Web Speech API; remote voices are never selected. */
export class SystemSpeechProvider implements TtsProvider {
	private voices: SpeechSynthesisVoice[] = [];

	constructor() {
		this.refreshVoices();
	}

	refreshVoices() {
		this.voices = getSpeechSynthesis()?.getVoices().filter((voice) => voice.localService) ?? [];
		return [...this.voices];
	}

	getLocalVoices() {
		return [...this.voices];
	}

	supportsLanguage(language: string) {
		if (!hasSpeechSynthesis()) return false;
		const voices = this.refreshVoices();
		// WebKit and Chromium may populate the voice list asynchronously on startup.
		return voices.length === 0 || voices.some((voice) => languageMatchRank(voice.lang, language) > 0);
	}

	async speak(text: string, language: string) {
		const synthesis = getSpeechSynthesis();
		if (!synthesis) throw new Error('System speech is unavailable in this Obsidian app. Update Obsidian and try again.');
		const voice = await this.findVoice(language, synthesis);
		if (!voice) throw new Error(noVoiceMessage(language));
		const chunks = splitForSpeech(text);
		if (!chunks.length) return;
		synthesis.cancel();
		for (const chunk of chunks) {
			await speakChunk(synthesis, chunk, voice);
		}
	}

	async synthesize(): Promise<AudioSource> {
		throw new Error('System voices speak directly and do not create audio files.');
	}

	private async findVoice(language: string, synthesis: SpeechSynthesis) {
		let voices = this.refreshVoices();
		if (!voices.length) {
			await waitForVoices(synthesis);
			voices = this.refreshVoices();
		}
		return selectLocalVoice(voices, language);
	}
}

function getSpeechSynthesis() {
	return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : undefined;
}

export function hasSpeechSynthesis() {
	return Boolean(getSpeechSynthesis() && typeof SpeechSynthesisUtterance !== 'undefined');
}

function languageMatchRank(voiceLanguage: string, requestedLanguage: string) {
	const voiceTag = normalizeLanguageTag(voiceLanguage);
	const requestedTag = normalizeLanguageTag(requestedLanguage);
	if (!voiceTag || !requestedTag) return 0;
	if (voiceTag === requestedTag) return 2;
	return voiceTag.split('-')[0] === requestedTag.split('-')[0] ? 1 : 0;
}

export function selectLocalVoice(voices: readonly SpeechSynthesisVoice[], language: string) {
	return voices
		.filter((voice) => voice.localService)
		.map((voice) => ({ voice, rank: languageMatchRank(voice.lang, language) }))
		.filter(({ rank }) => rank > 0)
		.sort((a, b) => b.rank - a.rank || Number(b.voice.default) - Number(a.voice.default))[0]?.voice;
}

function normalizeLanguageTag(language: string) {
	try {
		return Intl.getCanonicalLocales(language.trim().replace(/_/gu, '-'))[0]?.toLowerCase() ?? '';
	} catch {
		return '';
	}
}

function waitForVoices(synthesis: SpeechSynthesis) {
	return new Promise<void>((resolve) => {
		let done = false;
		let checkVoices: () => void;
		let pollId: number | undefined;
		const finish = () => {
			if (done) return;
			done = true;
			window.clearTimeout(timeoutId);
			if (pollId !== undefined) window.clearInterval(pollId);
			synthesis.removeEventListener('voiceschanged', checkVoices);
			resolve();
		};
		checkVoices = () => {
			if (synthesis.getVoices().some((voice) => voice.localService)) finish();
		};
		const timeoutId = window.setTimeout(finish, VOICE_DISCOVERY_TIMEOUT_MS);
		synthesis.addEventListener('voiceschanged', checkVoices);
		// Some Android WebViews populate voices after startup without dispatching voiceschanged.
		pollId = window.setInterval(checkVoices, 250);
		checkVoices();
	});
}

function splitForSpeech(text: string) {
	const normalized = text.replace(/\s+/gu, ' ').trim();
	if (normalized.length <= MAX_UTTERANCE_LENGTH) return normalized ? [normalized] : [];
	const chunks: string[] = [];
	let remaining = normalized;
	while (remaining.length > MAX_UTTERANCE_LENGTH) {
		let splitAt = remaining.lastIndexOf(' ', MAX_UTTERANCE_LENGTH);
		if (splitAt < MAX_UTTERANCE_LENGTH / 2) splitAt = MAX_UTTERANCE_LENGTH;
		chunks.push(remaining.slice(0, splitAt).trim());
		remaining = remaining.slice(splitAt).trim();
	}
	if (remaining) chunks.push(remaining);
	return chunks;
}

function speakChunk(synthesis: SpeechSynthesis, text: string, voice: SpeechSynthesisVoice) {
	return new Promise<void>((resolve, reject) => {
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.voice = voice;
		utterance.lang = voice.lang;
		utterance.onend = () => resolve();
		utterance.onerror = (event) => {
			if (event.error === 'canceled' || event.error === 'interrupted') reject(new Error('Speech was stopped.'));
			else reject(new Error(`The ${voice.name || voice.lang} system voice failed to speak. Check that the voice is installed and available offline.`));
		};
		synthesis.speak(utterance);
	});
}

export function noVoiceMessage(language: string) {
	return `Obsidian's WebView does not expose an offline ${language.toUpperCase()} voice. Confirm that the system text-to-speech engine has an offline voice, then refresh voices. Some Android WebViews do not expose Android's installed voices to Web Speech API; another reader app may use Android's native speech service directly.`;
}

export function systemSpeechSetupInstructions(platform: { isAndroidApp: boolean; isIosApp: boolean; isWin: boolean; isMacOS: boolean; isLinux: boolean }) {
	if (platform.isAndroidApp) return 'Android: Settings → Accessibility → Text-to-speech output. Select an engine, download its offline voice data, then reopen Obsidian.';
	if (platform.isIosApp) return 'iOS/iPadOS: Settings → Accessibility → Spoken Content → Voices. Download a voice for the language, then reopen Obsidian.';
	if (platform.isWin) return 'Windows: Settings → Time & language → Language & region → language options → install the Text-to-speech feature. Restart Obsidian after installation.';
	if (platform.isMacOS) return 'macOS: System Settings → Accessibility → Read & Speak → System voice → Manage voices. Download the voice, then restart Obsidian.';
	if (platform.isLinux) return 'Linux: install and enable a local speech engine supported by your desktop (for example Speech Dispatcher with eSpeak NG). Restart Obsidian and check that the engine is exposed to its webview.';
	return 'Install an offline speech voice for this language in your device settings, then restart Obsidian.';
}
