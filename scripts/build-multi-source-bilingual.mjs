import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, stat, rm, readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createGunzip, createGzip } from 'node:zlib';
import { Transform } from 'node:stream';
import { resolve, join } from 'node:path';

const NUM_BUCKETS = 256;

const flags = process.argv.slice(2);
const args = flags.filter(f => !f.startsWith('--'));
const [outputArg] = args;

const shouldCompress = !flags.includes('--no-compress');
const compactMode = flags.includes('--compact');

if (!outputArg) {
    console.error('Usage: node build-multi-source-bilingual.mjs <output-dir> [--no-compress] [--compact]');
    process.exit(1);
}

const output = resolve(outputArg);

// ==========================================
// CẤU HÌNH: CÁC NGUỒN DỮ LIỆU
// ==========================================
const dataSources = [
    {
        name: 'English Wiktionary',
        url: 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz',
        file: 'en-wiktionary.jsonl.gz',
        language: 'en',  // Ngôn ngữ định nghĩa
        containsLangs: ['en', 'ja', 'zh', 'ko', 'vi', 'fr', 'de'],  // Các ngôn ngữ có trong file
    },
    {
        name: 'Vietnamese Wiktionary',
        url: 'https://kaikki.org/viwiktionary/vi-extract.jsonl.gz',
        file: 'vi-wiktionary.jsonl.gz',
        language: 'vi',
        containsLangs: ['vi', 'en', 'ja', 'zh', 'ko', 'fr', 'de'],
    },
    {
        name: 'Japanese Wiktionary',
        url: 'https://kaikki.org/jawiktionary/ja-extract.jsonl.gz',
        file: 'ja-wiktionary.jsonl.gz',
        language: 'ja',
        containsLangs: ['ja', 'en', 'zh', 'ko', 'vi', 'fr', 'de'],
    },
    {
        name: 'Korean Wiktionary',
        url: 'https://kaikki.org/kowiktionary/ko-extract.jsonl.gz',
        file: 'ko-wiktionary.jsonl.gz',
        language: 'ko',
        containsLangs: ['ko', 'en', 'ja', 'zh', 'vi', 'fr', 'de'],
    },
    {
        name: 'French Wiktionary',
        url: 'https://kaikki.org/frwiktionary/fr-extract.jsonl.gz',
        file: 'fr-wiktionary.jsonl.gz',
        language: 'fr',
        containsLangs: ['fr', 'en', 'ja', 'zh', 'ko', 'vi', 'de'],
    },
    {
        name: 'German Wiktionary',
        url: 'https://kaikki.org/dewiktionary/de-extract.jsonl.gz',
        file: 'de-wiktionary.jsonl.gz',
        language: 'de',
        containsLangs: ['de', 'en', 'ja', 'zh', 'ko', 'vi', 'fr'],
    },
];

// Các cặp từ điển cần tạo
const bilingualPairs = [
    { source: 'en', target: 'vi', name: 'English-Vietnamese Dictionary' },
    { source: 'vi', target: 'en', name: 'Vietnamese-English Dictionary' },
    { source: 'ja', target: 'en', name: 'Japanese-English Dictionary' },
    { source: 'en', target: 'ja', name: 'English-Japanese Dictionary' },
    { source: 'zh', target: 'en', name: 'Chinese-English Dictionary' },
    { source: 'en', target: 'zh', name: 'English-Chinese Dictionary' },
    { source: 'ko', target: 'en', name: 'Korean-English Dictionary' },
    { source: 'en', target: 'ko', name: 'English-Korean Dictionary' },
    { source: 'fr', target: 'en', name: 'French-English Dictionary' },
    { source: 'en', target: 'fr', name: 'English-French Dictionary' },
    { source: 'de', target: 'en', name: 'German-English Dictionary' },
    { source: 'en', target: 'de', name: 'English-German Dictionary' },
];

console.log(`\n🌍 Multi-Source Bilingual Dictionary Builder`);
console.log(`   📤 Output: ${output}`);
console.log(`   🗜️  Nén gzip: ${shouldCompress ? 'CÓ' : 'KHÔNG'}`);
console.log(`   🪶 Compact mode: ${compactMode ? 'CÓ' : 'KHÔNG'}`);
console.log(`   📚 Số nguồn dữ liệu: ${dataSources.length}`);
console.log(`   📚 Số cặp từ điển: ${bilingualPairs.length}\n`);

// ==========================================
// PHASE 1: TẢI TẤT CẢ CÁC NGUỒN DỮ LIỆU
// ==========================================
console.log(`📊 PHASE 1: Tải dữ liệu từ ${dataSources.length} nguồn...`);

const { spawn } = await import('node:child_process');

for (const source of dataSources) {
    const filePath = join(output, '.source', source.file);
    
    // Kiểm tra file đã tồn tại chưa
    try {
        await stat(filePath);
        console.log(`   ⏭️  ${source.name}: Đã tồn tại, bỏ qua.`);
        source.filePath = filePath;
        continue;
    } catch {}
    
    console.log(`   ⬇️  ${source.name}: Đang tải...`);
    
    await mkdir(join(output, '.source'), { recursive: true });
    
    await new Promise((resolve, reject) => {
        const isWindows = process.platform === 'win32';
        const curlCmd = isWindows ? 'curl.exe' : 'curl';
        const args = ['-L', '-f', '-#', '-o', filePath, source.url];
        const child = spawn(curlCmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
        
        child.on('close', (code) => {
            if (code === 0) {
                console.log(`   ✅ ${source.name}: Tải xong.`);
                source.filePath = filePath;
                resolve();
            } else {
                reject(new Error(`curl thoát với mã lỗi ${code}`));
            }
        });
        
        child.on('error', reject);
    });
}

console.log(`\n   ✅ Đã tải xong tất cả nguồn dữ liệu.\n`);

// ==========================================
// PHASE 2: XỬ LÝ TỪNG CẶP TỪ ĐIỂN
// ==========================================
console.log(`📊 PHASE 2: Xử lý ${bilingualPairs.length} cặp từ điển...\n`);

for (const pair of bilingualPairs) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📚 Đang xử lý: ${pair.name} (${pair.source}→${pair.target})`);
    console.log(`${'='.repeat(60)}`);
    
    const packName = `${pair.source}-${pair.target}`;
    const packDir = join(output, packName);
    const tempDir = join(packDir, '.temp');
    
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(tempDir, { recursive: true });
    
    // Tìm nguồn dữ liệu phù hợp
    // Để tạo từ điển X→Y, ta cần Wiktionary edition của Y (có từ X với định nghĩa Y)
    const sourceData = dataSources.find(s => s.language === pair.target && s.containsLangs.includes(pair.source));
    
    if (!sourceData) {
        console.log(`   ⚠️  Không tìm thấy nguồn dữ liệu phù hợp cho ${pair.source}→${pair.target}.`);
        console.log(`   💡 Cần Wiktionary edition của ${pair.target} có chứa từ ${pair.source}.`);
        continue;
    }
    
    console.log(`   📖 Nguồn: ${sourceData.name}`);
    console.log(`   📁 File: ${sourceData.filePath}`);
    
    // Tạo buckets
    const bucketStreams = Array.from({ length: NUM_BUCKETS }, (_, i) => {
        const path = join(tempDir, `bucket-${i.toString(16).padStart(2, '0')}.jsonl`);
        return createWriteStream(path, { flags: 'w' });
    });
    const bucketCounts = new Array(NUM_BUCKETS).fill(0);
    
    // Đọc file và phân phối vào buckets
    const isGzInput = sourceData.filePath.endsWith('.gz');
    let inputStream;
    if (isGzInput) {
        inputStream = createReadStream(sourceData.filePath).pipe(createGunzip());
    } else {
        inputStream = createReadStream(sourceData.filePath, { encoding: 'utf8' });
    }
    
    const rl = createInterface({
        input: inputStream,
        crlfDelay: Infinity
    });
    
    let lineCount = 0;
    let validCount = 0;
    let translationCount = 0;
    
    for await (const line of rl) {
        if (!line.trim()) continue;
        lineCount++;
        if (lineCount % 500000 === 0) {
            process.stdout.write(`\r   📖 Đã quét ${lineCount.toLocaleString()} dòng | ${validCount.toLocaleString()} từ hợp lệ`);
        }
        
        let item;
        try { item = JSON.parse(line); } catch { continue; }
        
        if (typeof item.word !== 'string') continue;
        
        const sourceLangCode = item.lang_code;
        if (sourceLangCode !== pair.source) continue;
        
        // Đọc translations từ cấp cao
        const topLevelTranslations = item.translations;
        if (!topLevelTranslations || !Array.isArray(topLevelTranslations)) continue;
        
        const translations = [];
        for (const tr of topLevelTranslations) {
            if (!tr || typeof tr !== 'object') continue;
            const trLang = tr.lang_code || tr.code || tr.lang;
            const trWord = tr.word;
            
            if (trLang === pair.target && typeof trWord === 'string') {
                translations.push({
                    word: trWord,
                    sense: tr.sense || undefined,
                    roman: tr.roman || undefined,
                });
            }
        }
        
        if (translations.length === 0) continue;
        
        const normalizedWord = normalizeWord(item.word);
        const payload = toBilingualPayload(item, translations, compactMode);
        
        const hash = createHash('sha1').update(normalizedWord).digest();
        const bucketId = hash[0];
        
        const record = { word: normalizedWord, payload };
        bucketStreams[bucketId].write(JSON.stringify(record) + '\n');
        bucketCounts[bucketId]++;
        validCount++;
        translationCount += translations.length;
    }
    
    console.log(`\n   ✅ Đã quét ${lineCount.toLocaleString()} dòng.`);
    console.log(`   📊 Tìm thấy ${validCount.toLocaleString()} từ ${pair.source} với ${translationCount.toLocaleString()} bản dịch ${pair.target}.`);
    
    // Đóng streams
    await Promise.all(bucketStreams.map(s => new Promise(r => s.end(r))));
    
    // Xử lý buckets và ghi file
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
    const totalBuckets = bucketCounts.filter(c => c > 0).length;
    
    for (let i = 0; i < NUM_BUCKETS; i++) {
        if (bucketCounts[i] === 0) continue;
        
        const bucketPath = join(tempDir, `bucket-${i.toString(16).padStart(2, '0')}.jsonl`);
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
    
    await rm(tempDir, { recursive: true, force: true });
    
    const fileStats = await stat(entriesPath);
    console.log(`   📦 Kích thước ${entriesFileName}: ${(fileStats.size / 1024 / 1024).toFixed(2)} MB`);
    
    // Ghi index.json
    const indexPath = resolve(packDir, 'index.json');
    const indexContent = JSON.stringify(index);
    await writeFile(indexPath, indexContent);
    const indexHash = createHash('sha256').update(indexContent, 'utf8').digest('hex');
    const entriesHashHex = entriesHash.digest('hex');
    
    // Ghi manifest.json
    const manifest = {
        format: 'mynary-pack-v1',
        id: `${packName}-bilingual`,
        kind: 'bilingual',
        language: pair.source,
        targetLanguage: pair.target,
        sourceLanguage: pair.source,
        targetLanguage: pair.target,
        name: pair.name,
        version: new Date().toISOString().slice(0, 10),
        entryCount: index.length,
        indexFile: 'index.json',
        entriesFile: entriesFileName,
        compressed: shouldCompress,
        compactMode,
        type: 'bilingual',
        direction: `${pair.source}→${pair.target}`,
        source: `https://kaikki.org/${sourceData.file}`,
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
let successCount = 0;

for (const pair of bilingualPairs) {
    const packName = `${pair.source}-${pair.target}`;
    const packDir = join(output, packName);
    const manifestPath = join(packDir, 'manifest.json');
    try {
        const manifestContent = await (await import('node:fs/promises')).readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestContent);
        const entriesPath = join(packDir, manifest.entriesFile);
        const entriesStats = await stat(entriesPath);
        const sizeMB = entriesStats.size / 1024 / 1024;
        totalEntries += manifest.entryCount;
        totalSize += sizeMB;
        successCount++;
        console.log(`   📚 ${pair.name.padEnd(35)} ${manifest.entryCount.toLocaleString().padStart(10)} entries | ${sizeMB.toFixed(2).padStart(8)} MB`);
    } catch {
        console.log(`   ❌ ${pair.name.padEnd(35)} Không tạo được`);
    }
}

console.log(`${'='.repeat(60)}`);
console.log(`   📊 TỔNG: ${successCount}/${bilingualPairs.length} từ điển | ${totalEntries.toLocaleString()} entries | ${totalSize.toFixed(2)} MB`);
console.log(`${'='.repeat(60)}\n`);

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function toBilingualPayload(item, translations, compact = false) {
    const keys = compact 
        ? { phonetics: 'ph', translations: 'tr', word: 'wd', sense: 'sn', pos: 'ps', etymology: 'ety', roman: 'rm' }
        : { phonetics: 'phonetics', translations: 'translations', word: 'word', sense: 'sense', pos: 'partOfSpeech', etymology: 'etymology', roman: 'roman' };

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

function normalizeWord(value) { return value.normalize('NFKC').trim().toLowerCase(); }
