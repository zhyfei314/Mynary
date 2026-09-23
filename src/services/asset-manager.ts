import type { DataAdapter } from 'obsidian';

export interface DownloadAsset { id: string; url: string; destination: string; sha256?: string; }

export class AssetManager {
	constructor(private readonly adapter: DataAdapter) {}

	async install(asset: DownloadAsset, request: (url: string) => Promise<ArrayBuffer>) {
		const temporary = `${asset.destination}.download`;
		await ensureParent(this.adapter, temporary);
		const data = await request(asset.url);
		if (asset.sha256 && (await sha256(data)).toLowerCase() !== asset.sha256.toLowerCase()) {
			await removeIfExists(this.adapter, temporary);
			throw new Error('Downloaded file failed checksum verification.');
		}
		await this.adapter.writeBinary(temporary, data);
		if (await this.adapter.exists(asset.destination)) await this.adapter.remove(asset.destination);
		await this.adapter.rename(temporary, asset.destination);
	}
}

async function ensureParent(adapter: DataAdapter, path: string) {
	const parts = path.split('/');
	parts.pop();
	let current = '';
	for (const part of parts) {
		if (!part) continue;
		current = current ? `${current}/${part}` : part;
		if (!(await adapter.exists(current))) await adapter.mkdir(current);
	}
}

async function removeIfExists(adapter: DataAdapter, path: string) {
	if (await adapter.exists(path)) await adapter.remove(path);
}

async function sha256(data: ArrayBuffer) {
	const digest = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
