import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { OfflineDictionaryProvider } from '../src/providers/offline-dictionary';

interface IndexItem { word: string; offset: number; length: number; }
const hasReleasePacks = existsSync(join(process.cwd(), 'release', 'vi', 'manifest.json'));
const releaseFolders = hasReleasePacks
	? readdirSync(join(process.cwd(), 'release')).filter((folder) => existsSync(join(process.cwd(), 'release', folder, 'manifest.json')))
	: [];

async function openPack(folder: string) {
	const root = join(process.cwd(), 'release', folder);
	const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as { indexFile: string; entriesFile: string };
	const index = JSON.parse(await readFile(join(root, manifest.indexFile), 'utf8')) as IndexItem[];
	const adapter = {
		exists: async (path: string) => path.endsWith('/manifest.json') || path.endsWith(`/${manifest.indexFile}`) || path.endsWith(`/${manifest.entriesFile}`),
		read: async (path: string) => readFile(join(root, path.split('/').at(-1)!), 'utf8'),
		readBinary: async (path: string) => {
			const bytes = await readFile(join(root, path.split('/').at(-1)!));
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
		},
	} as never;
	return { provider: new OfflineDictionaryProvider(adapter, `release/${folder}`), index };
}

describe.skipIf(!hasReleasePacks)('real offline dictionary packs', () => {
	it('looks up a real entry from every available release pack', async () => {
		for (const folder of releaseFolders) {
			const { provider, index } = await openPack(folder);
			const sample = index[Math.floor(index.length / 2)]!;
			const result = await provider.lookup(sample.word);
			expect(result?.word.toLocaleLowerCase(), folder).toBe(sample.word.toLocaleLowerCase());
			expect(result?.source.id, folder).toBeTruthy();
		}
	}, 120_000);

	it('converts real sense-only bilingual entries into displayable definitions', async () => {
		const { provider } = await openPack('en-vi');
		const entry = await provider.lookup('advocated');
		expect(entry?.meanings[0]?.definitions[0]?.text).toBe('Quá khứ và phân từ quá khứ của advocate');
	});
});
