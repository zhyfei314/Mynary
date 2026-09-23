import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { resolve, join } from 'node:path';

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const positional = args.filter(a => !a.startsWith('--'));

const releaseDir = resolve(positional[0] || 'release');
const selectedPacks = positional.slice(1); // Nếu có, chỉ nén các pack được chỉ định

const keepOriginal = flags.includes('--keep');
const onlyEntries = flags.includes('--only-entries');

// Index phải giữ nguyên để plugin có thể đọc nhanh; chỉ nén entries.jsonl.
const filesToCompress = ['entries.jsonl'];

let grandOriginal = 0;
let grandCompressed = 0;

async function compressFile(inputPath, outputPath) {
    await pipeline(
        createReadStream(inputPath),
        createGzip({ level: 6 }),
        createWriteStream(outputPath)
    );
}

async function compressPack(packDir, packName) {
    console.log(`\n📦 Đang xử lý: ${packName}`);
    
    for (const file of filesToCompress) {
        const inputPath = join(packDir, file);
        const outputPath = join(packDir, `${file}.gz`);
        
        try {
            const stats = await stat(inputPath);
            
            // Bỏ qua nếu file .gz đã tồn tại (tránh nén lại)
            try {
                await stat(outputPath);
                console.log(`   ⏭️  ${file}.gz đã tồn tại, bỏ qua.`);
                grandOriginal += stats.size;
                const gzStats = await stat(outputPath);
                grandCompressed += gzStats.size;
                continue;
            } catch {}
            
            const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
            process.stdout.write(`   ⏳ Nén ${file} (${sizeMB} MB)...`);
            
            await compressFile(inputPath, outputPath);
            
            const newStats = await stat(outputPath);
            const saved = ((1 - newStats.size / stats.size) * 100).toFixed(1);
            const newSizeMB = (newStats.size / 1024 / 1024).toFixed(2);
            
            console.log(` ✅ ${newSizeMB} MB (-${saved}%)`);
            
            grandOriginal += stats.size;
            grandCompressed += newStats.size;
            
            // Xóa file gốc nếu không có flag --keep
            if (!keepOriginal) {
                await rm(inputPath);
            }

            const manifestPath = join(packDir, 'manifest.json');
            try {
                const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
                manifest.entriesFile = `${file}.gz`;
                manifest.compressed = true;
                manifest.entriesSha256 = createHash('sha256').update(await readFile(outputPath)).digest('hex');
                await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
            } catch (error) {
                console.log(`\n   ⚠️  Không cập nhật được manifest: ${error.message}`);
            }
        } catch (err) {
            console.log(`\n   ⚠️  Bỏ qua ${file}: ${err.message}`);
        }
    }
}

async function main() {
    console.log(`\n🗜️  Đang nén các pack trong: ${releaseDir}`);
    console.log(`   File cần nén: ${filesToCompress.join(', ')}`);
    console.log(`   Giữ file gốc: ${keepOriginal ? 'CÓ (--keep)' : 'KHÔNG (xóa sau khi nén)'}`);
    if (selectedPacks.length > 0) {
        console.log(`   Chỉ nén: ${selectedPacks.join(', ')}`);
    }
    
    let entries;
    try {
        entries = await readdir(releaseDir, { withFileTypes: true });
    } catch {
        console.error(`❌ Không tìm thấy thư mục: ${releaseDir}`);
        process.exit(1);
    }
    
    // Lấy tất cả thư mục con (bỏ qua .source, .temp, và các file ẩn)
    let packDirs = entries.filter(e => 
        e.isDirectory() && 
        e.name !== '.source' && 
        e.name !== '.temp' &&
        !e.name.startsWith('.')
    );
    
    // Lọc theo danh sách được chỉ định (nếu có)
    if (selectedPacks.length > 0) {
        packDirs = packDirs.filter(e => selectedPacks.includes(e.name));
    }
    
    if (packDirs.length === 0) {
        console.log('\n❌ Không tìm thấy thư mục pack nào.');
        return;
    }
    
    console.log(`   📋 Tìm thấy ${packDirs.length} thư mục pack.\n`);
    
    for (const dir of packDirs) {
        const packDir = join(releaseDir, dir.name);
        await compressPack(packDir, dir.name);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log(`📊 TỔNG KẾT:`);
    if (grandOriginal > 0) {
        console.log(`   📦 Tổng dung lượng gốc: ${(grandOriginal / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   🗜️  Tổng dung lượng nén: ${(grandCompressed / 1024 / 1024 / 1024).toFixed(2)} GB`);
        console.log(`   💾 Tiết kiệm: ${((1 - grandCompressed / grandOriginal) * 100).toFixed(1)}%`);
    } else {
        console.log('   ℹ️  Không có file nào được nén.');
    }
    console.log('='.repeat(60));
    
    if (!keepOriginal && grandOriginal > 0) {
        console.log('\n⚠️  LƯU Ý QUAN TRỌNG:');
        console.log('   Các file gốc đã bị XÓA sau khi nén.');
        console.log('   Plugin Mynary cần hỗ trợ đọc file .gz để hoạt động.');
        console.log('   Nếu plugin chưa hỗ trợ, hãy chạy lại với flag --keep.');
    }
}

main().catch(err => {
    console.error('\n💥 Lỗi:', err);
    process.exit(1);
});
