import * as ort from 'onnxruntime-web';
import { requestUrl } from 'obsidian';
import type { AudioSource } from '../types';
import { SUPERTONIC_LANGUAGES } from './supertonic';
import type { TtsProvider } from './supertonic';

const MODEL_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/onnx';
const VOICE_BASE = 'https://huggingface.co/Supertone/supertonic-3/resolve/main/voice_styles';

interface WebConfig { ae: { sample_rate: number; base_chunk_size: number }; ttl: { chunk_compress_factor: number; latent_dim: number }; }
interface Style { ttl: ort.Tensor; dp: ort.Tensor; }

export class SupertonicWebProvider implements TtsProvider {
	private engine?: Promise<WebEngine>;
	constructor(private readonly voice = 'M1', private readonly steps = 8, private readonly speed = 1.05, private readonly wasmPath?: string) {}
	supportsLanguage(language: string) { return SUPERTONIC_LANGUAGES.has(language); }

	async synthesize(text: string, language: string): Promise<AudioSource> {
		if (!this.supportsLanguage(language)) throw new Error(`Supertonic does not support “${language}”. IPA is still available.`);
		const engine = await this.load();
		const style = await engine.loadStyle(this.voice);
		const result = await engine.synthesize(text, language, style, this.steps, this.speed);
		const sampleCount = Math.min(result.wav.length, Math.max(1, Math.floor(engine.sampleRate * result.duration)));
		const samples = normalizeSamples(result.wav.slice(0, sampleCount), engine.sampleRate);
		if (!samples.length) throw new Error('Supertonic returned an empty audio buffer.');
		const buffer = writeWav(samples, engine.sampleRate);
		const mimeType = 'audio/wav';
		const url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
		return { url, mimeType, title: `Supertonic web ${this.voice}`, provider: 'tts', sourceUrl: MODEL_BASE, languageCode: language, confidence: 1 };
	}

	private load() {
		this.engine ??= loadWebEngine(this.wasmPath);
		return this.engine;
	}
}

class WebEngine {
	readonly sampleRate: number;
	private readonly loadedStyles = new Map<string, Promise<Style>>();
	constructor(private readonly cfg: WebConfig, private readonly processor: UnicodeProcessor, private readonly dp: ort.InferenceSession, private readonly textEncoder: ort.InferenceSession, private readonly vectorEstimator: ort.InferenceSession, private readonly vocoder: ort.InferenceSession) { this.sampleRate = cfg.ae.sample_rate; }

	loadStyle(voice: string) {
		const cached = this.loadedStyles.get(voice);
		if (cached) return cached;
		const promise = requestJson<{ style_ttl: JsonTensor; style_dp: JsonTensor }>(`${VOICE_BASE}/${encodeURIComponent(voice)}.json`).then((value) => toStyle(value));
		this.loadedStyles.set(voice, promise);
		return promise;
	}

	async synthesize(text: string, language: string, style: Style, steps: number, speed: number) {
		const processed = this.processor.call(text, language);
		const textIds = new ort.Tensor('int64', BigInt64Array.from(processed.textIds.flat().map((value) => BigInt(value))), [1, processed.textIds[0]!.length]);
		const textMask = new ort.Tensor('float32', Float32Array.from(processed.textMask.flat()), [1, 1, processed.textMask[0]!.length]);
		const durationOutput = await this.dp.run({ text_ids: textIds, style_dp: style.dp, text_mask: textMask });
		const durationTensor = durationOutput.duration;
		if (!durationTensor) throw new Error('Supertonic duration model returned no output.');
		const duration = Number(durationTensor.data[0]) / speed;
		const encoded = await this.textEncoder.run({ text_ids: textIds, style_ttl: style.ttl, text_mask: textMask });
		const textEmb = encoded.text_emb;
		if (!textEmb) throw new Error('Supertonic text encoder returned no output.');
		const latent = createNoise(duration, this.sampleRate, this.cfg.ae.base_chunk_size, this.cfg.ttl.chunk_compress_factor, this.cfg.ttl.latent_dim);
		const latentMask = new ort.Tensor('float32', Float32Array.from(latent.mask), [1, 1, latent.length]);
		const stepCount = Math.max(1, Math.floor(steps));
		const totalStep = new ort.Tensor('float32', new Float32Array([stepCount]), [1]);
		let current = latent.values;
		for (let step = 0; step < stepCount; step++) {
			const output = await this.vectorEstimator.run({
				noisy_latent: new ort.Tensor('float32', Float32Array.from(current), [1, latent.channels, latent.length]),
				text_emb: textEmb,
				style_ttl: style.ttl,
				latent_mask: latentMask,
				text_mask: textMask,
				current_step: new ort.Tensor('float32', new Float32Array([step]), [1]),
				total_step: totalStep,
			});
			const denoised = output.denoised_latent;
			if (!denoised) throw new Error('Supertonic vector estimator returned no output.');
			current = Array.from(denoised.data as Iterable<number>);
		}
		const waveform = await this.vocoder.run({ latent: new ort.Tensor('float32', Float32Array.from(current), [1, latent.channels, latent.length]) });
		const wav = waveform.wav_tts;
		if (!wav) throw new Error('Supertonic vocoder returned no audio.');
		return { wav: Array.from(wav.data as Iterable<number>), duration };
	}
}

class UnicodeProcessor {
	constructor(private readonly indexer: number[]) {}
	call(text: string, language: string) {
		const normalized = normalizeText(text);
		const tagged = `<${language}>${normalized}`;
		const values = [...tagged].map((character) => this.indexer[character.codePointAt(0) ?? 0] ?? -1);
		return { textIds: [values], textMask: [values.map(() => 1)] };
	}
}

interface JsonTensor { dims: number[]; data: number[] | number[][] | number[][][]; }
function toStyle(value: { style_ttl: JsonTensor; style_dp: JsonTensor }): Style {
	const ttl = flatten(value.style_ttl.data);
	const dp = flatten(value.style_dp.data);
	return {
		ttl: new ort.Tensor('float32', Float32Array.from(ttl), value.style_ttl.dims),
		dp: new ort.Tensor('float32', Float32Array.from(dp), value.style_dp.dims),
	};
}

async function loadWebEngine(wasmPath?: string) {
	// Obsidian can run without the cross-origin isolation required by threaded
	// WASM, especially on mobile. The WASM entry point also bundles the runtime,
	// so it does not depend on a matching CDN version being reachable.
	ort.env.wasm.numThreads = 1;
	ort.env.wasm.proxy = false;
	if (wasmPath) ort.env.wasm.wasmPaths = { wasm: wasmPath };
	const files = ['duration_predictor.onnx', 'text_encoder.onnx', 'vector_estimator.onnx', 'vocoder.onnx'];
	const create = async () => {
		const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' as const };
		const sessions = await Promise.all(files.map((file) => ort.InferenceSession.create(`${MODEL_BASE}/${file}`, options)));
		const [dp, textEncoder, vectorEstimator, vocoder] = sessions;
		if (!dp || !textEncoder || !vectorEstimator || !vocoder) throw new Error('Supertonic web models are incomplete.');
		const [cfg, indexer] = await Promise.all([
			requestJson<WebConfig>(`${MODEL_BASE}/tts.json`),
			requestJson<number[]>(`${MODEL_BASE}/unicode_indexer.json`),
		]);
		return new WebEngine(cfg, new UnicodeProcessor(indexer), dp, textEncoder, vectorEstimator, vocoder);
	};
	return create();
}

function normalizeText(value: string) {
	return value.normalize('NFKD').replace(/[\u{1F000}-\u{1FAFF}]/gu, '').replaceAll('/', ' ').replaceAll('[', ' ').replaceAll(']', ' ').replace(/[_|#<>]/g, ' ').replace(/\s+/g, ' ').trim() || 'silence';
}

async function requestJson<T>(url: string): Promise<T> {
	const response = await requestUrl(url);
	if (response.status < 200 || response.status >= 300) throw new Error(`Supertonic web asset request failed (${response.status}).`);
	return response.json as T;
}

function flatten(value: number | number[] | number[][] | number[][][]) {
	return Array.isArray(value) ? value.flat(Infinity) as number[] : [value];
}

function createNoise(duration: number, sampleRate: number, baseChunkSize: number, compressFactor: number, latentDim: number) {
	const wavLength = Math.max(1, Math.floor(duration * sampleRate));
	const chunkSize = baseChunkSize * compressFactor;
	const length = Math.max(1, Math.ceil(wavLength / chunkSize));
	const channels = latentDim * compressFactor;
	const values = Array.from({ length: channels * length }, () => gaussian());
	const valid = Math.ceil(wavLength / chunkSize);
	const mask = Array.from({ length }, (_, index) => index < valid ? 1 : 0);
	for (let channel = 0; channel < channels; channel++) for (let index = 0; index < length; index++) if (!mask[index]) values[channel * length + index] = 0;
	return { values, mask, channels, length };
}

function gaussian() { const u = Math.max(0.0001, Math.random()); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()); }

function normalizeSamples(samples: number[], sampleRate: number) {
		const finite = samples.map((sample) => Number.isFinite(sample) ? sample : 0);
		const peak = finite.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);
		if (peak < 0.00001) throw new Error('Supertonic returned silent audio.');
		const gain = Math.min(8, 0.92 / peak);
		const fadeLength = Math.min(Math.floor(sampleRate * 0.008), Math.floor(finite.length / 2));
		return finite.map((sample, index) => {
			const fadeIn = fadeLength ? Math.min(1, index / fadeLength) : 1;
			const fadeOut = fadeLength ? Math.min(1, (finite.length - 1 - index) / fadeLength) : 1;
			return Math.max(-1, Math.min(1, sample * gain * Math.min(fadeIn, fadeOut)));
		});
}

function writeWav(samples: number[], sampleRate: number) {
	const buffer = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(buffer);
	const write = (offset: number, value: string) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
	write(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, samples.length * 2, true);
	const output = new Int16Array(buffer, 44);
	samples.forEach((sample, index) => { output[index] = Math.floor(Math.max(-1, Math.min(1, sample)) * 32767); });
	return buffer;
}
