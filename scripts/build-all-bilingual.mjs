import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat, rm, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';

const NUM_BUCKETS = 256;

const flags = process.argv.slice(2);
const args = flags.filter(f => !f.startsWith('--'));
const [inputArg, outputArg] = args;

const shouldCompress = !flags.includes('--no-compress');
const compactMode = flags.includes('--compact');

if (!inputArg || !outputArg) {
    console.error('Usage: node build-all-bilingual.mjs <kaikki.jsonl.gz> <output-dir> [--no-compress] [--compact]');
    console.error('Note: Input can be .jsonl or .jsonl.gz (auto-detected)');
    process.exit(1);
}

const input = resolve(inputArg);
const output = resolve(outputArg);
const isGzInput = input.endsWith('.gz');

// ==========================================
// CẤU HÌNH: CẢ HAI CHIỀU CHO MỖI NGÔN NGỮ
// ==========================================
const bilingualPairs = [
    { source: 'en', target: 'vi', name: 'English-Vietnamese Dictionary', description: 'Tra từ Anh → Việt' },
    { source: 'vi', target: 'en', name: 'Vietnamese-English Dictionary', description: 'Tra từ Việt → Anh' },
    { source: 'ja', target: 'en', name: 'Japanese-English Dictionary', description: 'Tra từ Nhật → Anh' },
    { source: 'en', target: 'ja', name: 'English-Japanese Dictionary', description: 'Tra từ Anh → Nhật' },
    { source: 'zh', target: 'en', name: 'Chinese-English Dictionary', description: 'Tra từ Trung → Anh' },
    { source: 'en', target: 'zh', name: 'English-Chinese Dictionary', description: 'Tra từ Anh → Trung' },
    { source: 'ko', target: 'en', name: 'Korean-English Dictionary', description: 'Tra từ Hàn → Anh' },
    { source: 'en', target: 'ko', name: 'English-Korean Dictionary', description: 'Tra từ Anh → Hàn' },
    { source: 'fr', target: 'en', name: 'French-English Dictionary', description: 'Tra từ Pháp → Anh' },
    { source: 'en', target: 'fr', name: 'English-French Dictionary', description: 'Tra từ Anh → Pháp' },
    { source: 'de', target: 'en', name: 'German-English Dictionary', description: 'Tra từ Đức → Anh' },
    { source: 'en', target: 'de', name: 'English-German Dictionary', description: 'Tra từ Anh → Đức' },
];

console.log(`\n🌍 Bilingual Dictionary Builder (Stream from .gz)`);
console.log(`   📥 Nguồn: ${input} ${isGzInput ? '(NÉN - sẽ đọc trực tiếp)' : '(KHÔNG NÉN)'}`);
console.log(`   📤 Output: ${output}`);
console.log(`   🗜️  Nén gzip output: ${shouldCompress ? 'CÓ' : 'KHÔNG'}`);
console.log(`   🪶 Compact mode: ${compactMode ? 'CÓ' : 'KHÔNG'}`);
console.log(`   📚 Số từ điển: ${bilingualPairs.length}\n`);

// ==========================================
// PHASE 1: ĐỌC FILE (TRỰC TIẾP TỪ .GZ HOẶC THƯỜNG)
// ==========================================
console.log(`📊 PHASE 1: Đọc file và phân phối vào ${bilingualPairs.length} từ điển...`);

// Tạo cấu trúc thư mục tạm cho từng cặp
for (const pair of bilingualPairs) {
    const packName = `${pair.source}-${pair.target}`;
    const tempDir = join(output, packName, '.temp');
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(tempDir, { recursive: true });
    
    pair.packName = packName;
    pair.tempDir = tempDir;
    pair.bucketStreams = Array.from({ length: NUM_BUCKETS }, (_, i) => {
        const path = join(tempDir, `bucket-${i.toString(16).padStart(2, '0')}.jsonl`);
        return createWriteStream(path, { flags: 'w' });
    });
    pair.bucketCounts = new Array(NUM_BUCKETS).fill(0);
    pair.validCount = 0;
    pair.translationCount = 0;
}

// Tạo read stream (tự động giải nén nếu là .gz)
let inputStream;
if (isGzInput) {
    console.log(`   🔧 Đang tạo stream đọc trực tiếp từ file .gz (không giải nén ra đĩa)...`);
    inputStream = createReadStream(input).pipe(createGunzip());
} else {
    inputStream = createReadStream(input, { encoding: 'utf8' });
}

const rl = createInterface({
    input: inputStream,
    crlfDelay: Infinity
});

let lineCount = 0;

for await (const line of rl) {
    if (!line.trim()) continue;
    lineCount++;
    if (lineCount % 500000 === 0) {
        const summary = bilingualPairs
            .map(p => `${p.source}→${p.target}: ${p.validCount.toLocaleString()}`)
            .join(' | ');
        process.stdout.write(`\r   📖 Đã quét ${lineCount.toLocaleString()} dòng | ${summary}`);
    }
    
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    
    if (typeof item.word !== 'string' || !Array.isArray(item.senses)) continue;
    
    const sourceLangCode = item.lang_code;
    if (!sourceLangCode) continue;
    
    const matchingPairs = bilingualPairs.filter(p => p.source === sourceLangCode);
    if (matchingPairs.length === 0) continue;
    
    for (const pair of matchingPairs) {
        const translations = [];
        
        for (const sense of item.senses) {
            if (!Array.isArray(sense.translations)) continue;
            for (const tr of sense.translations) {
                if (tr.lang_code === pair.target && typeof tr.word === 'string') {
                    translations.push({
                        word: tr.word,
                        sense: tr.sense || undefined
                    });
                }
            }
        }
        
        if (translations.length === 0) continue;
        
        const normalizedWord = normalizeWord(item.word);
        const payload = toBilingualPayload(item, translations, compactMode);
        
        const hash = createHash('sha1').update(normalizedWord).digest();
        const bucketId = hash[0];
        
        const record = { word: normalizedWord, payload };
        pair.bucketStreams[bucketId].write(JSON.stringify(record) + '\n');
        pair.bucketCounts[bucketId]++;
        pair.validCount++;
        pair.translationCount += translations.length;
    }
}

console.log(`\n\n   ✅ Đã quét xong ${lineCount.toLocaleString()} dòng.\n`);

// Đóng tất cả streams
for (const pair of bilingualPairs) {
    await Promise.all(pair.bucketStreams.map(s => new Promise(r => s.end(r))));
    console.log(`   📚 ${pair.name} (${pair.source}→${pair.target}): ${pair.validCount.toLocaleString()} từ, ${pair.translationCount.toLocaleString()} bản dịch`);
}

// ==========================================
// PHASE 2: XỬ LÝ TỪNG TỪ ĐIỂN
// ==========================================
for (const pair of bilingualPairs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📚 Đang xử lý: ${pair.name} (${pair.source}→${pair.target})`);
    console.log(`${'='.repeat(60)}`);
    
    const packDir = join(output, pair.packName);
    const entriesFileName = shouldCompress ? 'entries.jsonl.gz' : 'entries.jsonl';
    const entriesPath = resolve(packDir, entriesFileName);
    
    const index = [];
    let offset = 0;
    const entriesHash = createHash('sha256');
    
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
    
    let processedBuckets = 0;
    const totalBuckets = pair.bucketCounts.filter(c => c > 0).length;
    
    for (let i = 0; i < NUM_BUCKETS; i++) {
        if (pair.bucketCounts[i] === 0) continue;
        
        const bucketPath = join(pair.tempDir, `bucket-${i.toString(16).padStart(2, '0')}.jsonl`);
        const bucketMap = new Map();
        const bucketRl = createInterface({
            input: createReadStream(bucketPath, { encoding: 'utf8' }),
            crlfDelay: Infinity
        });
        
        for await (const line of bucketRl) {
            const record = JSON.parse(line);
            const existing = bucketMap.get(record.word);
            if (existing) {
                existing.payload = mergeBilingualPayload(existing.payload, record.payload);
            } else {
                bucketMap.set(record.word, record);
            }
        }
        
        const sorted = [...bucketMap.values()].sort((a, b) => a.word.localeCompare(b.word));
        
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
    
    console.log(`\n   ✅ Đã xử lý xong.`);
    
    await rm(pair.tempDir, { recursive: true, force: true });
    
    const fileStats = await stat(entriesPath);
    console.log(`   📦 Kích thước ${entriesFileName}: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
    
    const indexPath = resolve(packDir, 'index.json');
    const indexContent = JSON.stringify(index);
    await writeFile(indexPath, indexContent);
    const indexHash = createHash('sha256').update(indexContent, 'utf8').digest('hex');
    const entriesHashHex = entriesHash.digest('hex');
    
    const manifest = {
        format: 'mynary-pack-v1',
        id: `${pair.packName}-bilingual`,
        kind: 'bilingual',
        language: pair.source,
        targetLanguage: pair.target,
        sourceLanguage: pair.source,
        targetLanguage: pair.target,
        name: pair.name,
        description: pair.description,
        version: new Date().toISOString().slice(0, 10),
        entryCount: index.length,
        indexFile: 'index.json',
        entriesFile: entriesFileName,
        compressed: shouldCompress,
        compactMode,
        type: 'bilingual',
        direction: `${pair.source}→${pair.target}`,
        source: 'https://kaikki.org/',
        license: 'CC BY-SA 4.0 / GFDL',
        indexSha256: indexHash,
        entriesSha256: createHash('sha256').update(await readFile(entriesPath)).digest('hex'),
    };
    await writeFile(resolve(packDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    
    console.log(`   🎉 Hoàn thành: ${index.length.toLocaleString()} entries vào ${packDir}`);
}

// ==========================================
// TỔNG KẾT
// ==========================================
console.log(`\n${'='.repeat(60)}`);
console.log(`🏆 TỔNG KẾT:`);
console.log(`${'='.repeat(60)}`);

let totalEntries = 0;
let totalSize = 0;

for (const pair of bilingualPairs) {
    const packDir = join(output, pair.packName);
    const manifestPath = join(packDir, 'manifest.json');
    try {
        const manifestContent = await (await import('node:fs/promises')).readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        const entriesPath = join(packDir, manifest.entriesFile);
        const entriesStats = await stat(entriesPath);
        const sizeMB = entriesStats.size / 1024 / 1024;
        totalEntries += manifest.entryCount;
        totalSize += sizeMB;
        console.log(`   📚 ${pair.name.padEnd(35)} ${manifest.entryCount.toLocaleString().padStart(10)} entries | ${sizeMB.toFixed(2).padStart(8)} MB`);
    } catch {
        console.log(`   ❌ ${pair.name}: Lỗi`);
    }
}

console.log(`${'='.repeat(60)}`);
console.log(`   📊 TỔNG: ${totalEntries.toLocaleString()} entries | ${totalSize.toFixed(2)} MB`);
console.log(`${'='.repeat(60)}\n`);

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function toBilingualPayload(item, translations, compact = false) {
    const keys = compact 
        ? { phonetics: 'ph', translations: 'tr', word: 'wd', sense: 'sn', pos: 'ps', etymology: 'ety' }
        : { phonetics: 'phonetics', translations: 'translations', word: 'word', sense: 'sense', pos: 'partOfSpeech', etymology: 'etymology' };

    const payload = {
        [keys.phonetics]: (item.sounds ?? [])
            .filter((s) => typeof s.ipa === 'string')
            .map((s) => ({ [keys.word]: s.ipa })),
        [keys.translations]: translations,
    };

    if (item.pos) payload[keys.pos] = item.pos;
    if (typeof item.etymology_text === 'string' && item.etymology_text.trim()) {
        payload[keys.etymology] = item.etymology_text;
    }

    return payload;
}

function mergeBilingualPayload(left, right) {
    const result = { ...left };
    if (right.phonetics?.length) result.phonetics = uniqueByText([...(left.phonetics ?? []), ...right.phonetics]);
    if (right.translations?.length) result.translations = uniqueByText([...(left.translations ?? []), ...right.translations]);
    if (!result.partOfSpeech && right.partOfSpeech) result.partOfSpeech = right.partOfSpeech;
    if (!result.etymology && right.etymology) result.etymology = right.etymology;
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
