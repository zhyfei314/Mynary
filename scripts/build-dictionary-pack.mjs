import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat, rm, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { resolve, join } from 'node:path';

const NUM_BUCKETS = 256; // Chia dữ liệu thành 256 phần để xử lý

const flags = process.argv.slice(2);
const args = flags.filter(f => !f.startsWith('--'));
const [inputArg, outputArg, languageArg = 'en', nameArg] = args;

const shouldCompress = flags.includes('--compress'); // Mặc định KHÔNG nén (để plugin đọc được)
const compactMode = flags.includes('--compact');
const minimalMode = flags.includes('--minimal');

if (!inputArg || !outputArg) {
	console.error('Usage: node scripts/build-dictionary-pack.mjs <kaikki.jsonl> <output-dir> [language] [name] [--compress] [--compact] [--minimal]');
	process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const language = languageArg.toLowerCase();
const name = nameArg || `${language.toUpperCase()} Core Dictionary`;
const entriesFileName = shouldCompress ? 'entries.jsonl.gz' : 'entries.jsonl';
const tempDir = join(output, '.temp');

// ==========================================
// PHASE 1: PHÂN PHỐI VÀO BUCKETS
// ==========================================
console.log(`\n📊 PHASE 1: Phân phối dữ liệu vào ${NUM_BUCKETS} buckets...`);
if (compactMode) console.log('   🪶 Compact mode: Dùng key ngắn');
if (minimalMode) console.log('   🪶 Minimal mode: Chỉ giữ word + meanings');

await rm(tempDir, { recursive: true, force: true }).catch(() => {});
await mkdir(tempDir, { recursive: true });

const bucketStreams = Array.from({ length: NUM_BUCKETS }, (_, i) => {
	const path = join(tempDir, `bucket-${i.toString(16).padStart(2, '0')}.jsonl`);
	return createWriteStream(path, { flags: 'w' });
});

const rl = createInterface({
	input: createReadStream(input, { encoding: 'utf8' }),
	crlfDelay: Infinity
});

let lineCount = 0;
let validCount = 0;
const bucketCounts = new Array(NUM_BUCKETS).fill(0);

for await (const line of rl) {
	if (!line.trim()) continue;
	lineCount++;
	if (lineCount % 500000 === 0) {
		process.stdout.write(`\r   📖 Đã quét ${lineCount.toLocaleString()} dòng, ${validCount.toLocaleString()} hợp lệ...`);
	}
	
	let item;
	try { item = JSON.parse(line); } catch { continue; }
	
	if (item.lang_code && item.lang_code !== language) continue;
	if (typeof item.word !== 'string' || !Array.isArray(item.senses)) continue;
	
	const normalizedWord = normalizeWord(item.word);
	const payload = toPayload(item, compactMode, minimalMode);
	if (!payload.meanings?.length && !payload.phonetics?.length) continue;
	
	// Hash word để xác định bucket (đảm bảo cùng word về cùng bucket)
	const hash = createHash('sha1').update(normalizedWord).digest();
	const bucketId = hash[0]; // Byte đầu tiên (0-255)
	
	const record = { word: normalizedWord, payload };
	bucketStreams[bucketId].write(JSON.stringify(record) + '\n');
	bucketCounts[bucketId]++;
	validCount++;
}

console.log(`\n   ✅ Đã phân phối ${validCount.toLocaleString()} entries vào ${bucketCounts.filter(c => c > 0).length} buckets.`);

// Đóng tất cả streams
await Promise.all(bucketStreams.map(s => new Promise(r => s.end(r))));

// ==========================================
// PHASE 2: XỬ LÝ TỪNG BUCKET
// ==========================================
console.log(`\n📊 PHASE 2: Xử lý từng bucket và xây dựng index...`);

await mkdir(output, { recursive: true });

const index = [];
let offset = 0;
const entriesHash = createHash('sha256');

const entriesPath = resolve(output, entriesFileName);

// Tạo hash transform
const hashTransform = new Transform({
	transform(chunk, encoding, callback) {
		entriesHash.update(chunk);
		callback(null, chunk);
	}
});

let finalWriteStream;
if (shouldCompress) {
	const gzip = createGzip({ level: 6 });
	finalWriteStream = createWriteStream(entriesPath);
	hashTransform.pipe(gzip).pipe(finalWriteStream);
} else {
	finalWriteStream = createWriteStream(entriesPath);
	hashTransform.pipe(finalWriteStream);
}

// Xử lý từng bucket
let processedBuckets = 0;
const totalBuckets = bucketCounts.filter(c => c > 0).length;

for (let i = 0; i < NUM_BUCKETS; i++) {
	if (bucketCounts[i] === 0) continue;
	
	const bucketPath = join(tempDir, `bucket-${i.toString(16).padStart(2, '0')}.jsonl`);
	
	// Đọc bucket vào Map để dedup
	const bucketMap = new Map();
	const bucketRl = createInterface({
		input: createReadStream(bucketPath, { encoding: 'utf8' }),
		crlfDelay: Infinity
	});
	
	for await (const line of bucketRl) {
		const record = JSON.parse(line);
		const existing = bucketMap.get(record.word);
		if (existing) {
			existing.payload = mergePayload(existing.payload, record.payload, minimalMode);
		} else {
			bucketMap.set(record.word, record);
		}
	}
	
	// Sort bucket theo alphabet
	const sorted = [...bucketMap.values()].sort((a, b) => a.word.localeCompare(b.word));
	
	// Ghi vào file entries
	for (const record of sorted) {
		const payloadStr = JSON.stringify(record.payload);
		const bytes = Buffer.from(payloadStr, 'utf8');
		
		hashTransform.write(bytes);
		index.push({ word: record.word, offset, length: bytes.length });
		offset += bytes.length;
	}
	
	bucketMap.clear();
	await rm(bucketPath, { force: true });
	
	processedBuckets++;
	process.stdout.write(`\r   🔧 Đã xử lý ${processedBuckets}/${totalBuckets} buckets...`);
}

hashTransform.end();
await new Promise(r => finalWriteStream.on('finish', r));

console.log(`\n   ✅ Đã xử lý xong tất cả buckets.`);

// Xóa thư mục temp
await rm(tempDir, { recursive: true, force: true });

const fileStats = await stat(entriesPath);
console.log(`   📦 Kích thước file ${entriesFileName}: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);

// ==========================================
// PHASE 3: HOÀN TẤT (Index + Manifest)
// ==========================================
console.log(`\n📊 PHASE 3: Tạo index và manifest...`);

const indexPath = resolve(output, 'index.json');
const indexContent = JSON.stringify(index);
await writeFile(indexPath, indexContent);
const indexHash = createHash('sha256').update(indexContent, 'utf8').digest('hex');
const entriesHashHex = entriesHash.digest('hex');

const manifest = {
	format: 'mynary-pack-v1', 
	id: `${language}-core`, 
	kind: 'core',
	language, 
	name,
	version: new Date().toISOString().slice(0, 10), 
	entryCount: index.length,
	indexFile: 'index.json', 
	entriesFile: entriesFileName,
	compressed: shouldCompress,
	compactMode,
	minimalMode,
	source: 'https://kaikki.org/', 
	license: 'CC BY-SA 4.0 / GFDL',
	indexSha256: indexHash,
	entriesSha256: createHash('sha256').update(await readFile(entriesPath)).digest('hex'),
};
await writeFile(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// Cảnh báo kích thước
if (fileStats.size > 100 * 1024 * 1024) {
	console.log(`\n⚠️  CẢNH BÁO: File ${entriesFileName} vượt quá 100MB!`);
	console.log(`   GitHub sẽ TỪ CHỐI push file này.`);
	console.log(`   👉 Giải pháp: Dùng Git LFS`);
	console.log(`      git lfs install`);
	console.log(`      git lfs track "release/**/${entriesFileName}"`);
	console.log(`      git add .gitattributes`);
} else if (fileStats.size > 50 * 1024 * 1024) {
	console.log(`\n⚠️  CẢNH BÁO: File ${entriesFileName} vượt quá 50MB.`);
}

console.log(`\n🎉 HOÀN THÀNH: ${index.length.toLocaleString()} entries vào ${output}\n`);

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function toPayload(item, compact = false, minimal = false) {
	const keys = compact 
		? { phonetics: 'ph', meanings: 'mn', partOfSpeech: 'ps', definitions: 'df', examples: 'ex', translations: 'tr', synonyms: 'syn', antonyms: 'ant', etymology: 'ety', code: 'cd', sense: 'sn', word: 'wd', text: 'tx' }
		: { phonetics: 'phonetics', meanings: 'meanings', partOfSpeech: 'partOfSpeech', definitions: 'definitions', examples: 'examples', translations: 'translations', synonyms: 'synonyms', antonyms: 'antonyms', etymology: 'etymology', code: 'code', sense: 'sense', word: 'word', text: 'text' };

	const meanings = item.senses.flatMap((sense) => 
		(sense.glosses ?? []).map((text) => {
			const def = { [keys.text]: text };
			if (!minimal) {
				const examples = (sense.examples ?? []).map((ex) => ex.text).filter(Boolean);
				if (examples.length) def[keys.examples] = examples;
			}
			return def;
		})
	);

	if (!meanings.length) return {};

	const payload = {
		[keys.phonetics]: (item.sounds ?? []).filter((s) => typeof s.ipa === 'string').map((s) => ({ [keys.text]: s.ipa })),
		[keys.meanings]: [{ [keys.partOfSpeech]: item.pos, [keys.definitions]: meanings }],
	};

	if (!minimal) {
		const translations = (item.translations ?? [])
			.filter((t) => typeof t.word === 'string')
			.map((t) => {
				const tr = { [keys.word]: t.word, [keys.code]: t.code };
				if (t.sense) tr[keys.sense] = t.sense;
				return tr;
			});
		if (translations.length) payload[keys.translations] = translations;

		const synonyms = (item.synonyms ?? []).map((i) => i.word).filter(Boolean);
		if (synonyms.length) payload[keys.synonyms] = synonyms;

		const antonyms = (item.antonyms ?? []).map((i) => i.word).filter(Boolean);
		if (antonyms.length) payload[keys.antonyms] = antonyms;

		if (typeof item.etymology_text === 'string' && item.etymology_text.trim()) {
			payload[keys.etymology] = item.etymology_text;
		}
	}

	return payload;
}

function mergePayload(left, right, minimal = false) {
	const result = { ...left };
	if (right.phonetics?.length) result.phonetics = uniqueByText([...(left.phonetics ?? []), ...right.phonetics]);
	if (right.meanings?.length) result.meanings = [...(left.meanings ?? []), ...right.meanings];
	if (!minimal) {
		if (right.translations?.length) result.translations = uniqueByText([...(left.translations ?? []), ...right.translations]);
		if (right.synonyms?.length) result.synonyms = [...new Set([...(left.synonyms ?? []), ...right.synonyms])];
		if (right.antonyms?.length) result.antonyms = [...new Set([...(left.antonyms ?? []), ...right.antonyms])];
		if (!result.etymology && right.etymology) result.etymology = right.etymology;
	}
	return result;
}

function uniqueByText(items) {
	const seen = new Set();
	return items.filter((item) => { 
		const key = JSON.stringify(item); 
		if (seen.has(key)) return false; 
		seen.add(key); 
		return true; 
	});
}

function normalizeWord(value) { return value.normalize('NFKC').trim().toLocaleLowerCase(); }
