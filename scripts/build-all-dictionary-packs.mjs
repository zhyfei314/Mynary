import { createGunzip } from 'node:zlib';
import { createWriteStream, createReadStream } from 'node:fs';
import { copyFile, mkdir, rm, stat, access } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';

// ==========================================
// CẤU HÌNH
// ==========================================
const MAX_CONCURRENT = 1; // Giữ ở 1 để bảo vệ RAM và tránh bị server từ chối

const root = resolve(process.argv[2] || 'dictionary-packs/release');
const selected = process.argv.slice(3).filter((value) => value && !value.startsWith('--'));
const keepSources = process.argv.includes('--keep-sources');

// [Mã, Tên hiển thị, Tên gốc trên Server Kaikki]
const languages = [
	['ar', 'Arabic', 'Arabic'], 
    ['bg', 'Bulgarian', 'Bulgarian'], 
    ['cs', 'Czech', 'Czech'], 
    ['da', 'Danish', 'Danish'], 
    ['de', 'German', 'German'], 
    ['el', 'Greek', 'Greek'],
	['en', 'English', 'English'], 
    ['es', 'Spanish', 'Spanish'], 
    ['et', 'Estonian', 'Estonian'], 
    ['fi', 'Finnish', 'Finnish'], 
    ['fr', 'French', 'French'], 
    ['he', 'Hebrew', 'Hebrew'],
	['hi', 'Hindi', 'Hindi'], 
    ['hr', 'Croatian', 'Serbo-Croatian'], // 🎯 Đã sửa
    ['hu', 'Hungarian', 'Hungarian'], 
    ['id', 'Indonesian', 'Indonesian'], 
    ['it', 'Italian', 'Italian'], 
    ['ja', 'Japanese', 'Japanese'],
	['ko', 'Korean', 'Korean'], 
    ['lt', 'Lithuanian', 'Lithuanian'], 
    ['lv', 'Latvian', 'Latvian'], 
    ['nl', 'Dutch', 'Dutch'], 
    ['no', 'Norwegian', 'Norwegian Bokmål'], // 🎯 Đã sửa
    ['pl', 'Polish', 'Polish'],
	['pt', 'Portuguese', 'Portuguese'], 
    ['ro', 'Romanian', 'Romanian'], 
    ['ru', 'Russian', 'Russian'], 
    ['sk', 'Slovak', 'Slovak'], 
    ['sl', 'Slovenian', 'Slovene'], // 🎯 Đã sửa
    ['sv', 'Swedish', 'Swedish'],
	['th', 'Thai', 'Thai'], 
    ['tr', 'Turkish', 'Turkish'], 
    ['uk', 'Ukrainian', 'Ukrainian'], 
    ['vi', 'Vietnamese', 'Vietnamese'], 
    ['zh', 'Chinese', 'Chinese'],
].filter(([code]) => !selected.length || selected.includes(code));

// ==========================================
// HÀM HỖ TRỢ
// ==========================================
function formatBytes(bytes) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function getMemoryUsage() {
	const used = process.memoryUsage();
	return `${(used.heapUsed / 1024 / 1024).toFixed(1)} MB`;
}

function defaultSourceUrl(code, kaikkiName) {
	if (code === 'en') return 'https://kaikki.org/dictionary/raw-wiktextract-data.jsonl.gz';
	
	const cleanName = kaikkiName.replace(/[\s-]/g, '');
	const encodedFolder = encodeURIComponent(kaikkiName);
	const encodedFile = encodeURIComponent(`kaikki.org-dictionary-${cleanName}.jsonl.gz`);
	
	return `https://kaikki.org/dictionary/${encodedFolder}/${encodedFile}`;
}

async function checkFileExists(url) {
	try {
		const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
		if (!response.ok) return { exists: false, status: response.status };
		const contentLength = response.headers.get('content-length');
		return { exists: true, size: contentLength ? parseInt(contentLength, 10) : 0 };
	} catch (error) {
		return { exists: false, error: error.message };
	}
}

// 🛡️ HÀM TẢI XUỐNG "WINDOWS-PROOF" (Sử dụng curl.exe để tránh bị terminated)
async function downloadWithRetry(url, destination, retries = 3) {
	for (let attempt = 1; attempt <= retries; attempt++) {
		try {
			console.log(`   ⬇️  Đang tải... (Lần ${attempt}/${retries})`);
			
			// Sử dụng curl.exe có sẵn trong Windows 10/11 để tải, tránh lỗi stream của Node.js fetch
			const isWindows = process.platform === 'win32';
			const curlCmd = isWindows ? 'curl.exe' : 'curl';
			
			await new Promise((resolve, reject) => {
				// -L: theo dõi redirect, -f: fail nếu lỗi HTTP, -#: hiển thị progress bar, -o: file đầu ra
				const args = ['-L', '-f', '-#', '-o', destination, url];
				const child = spawn(curlCmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
				
				child.on('close', (code) => {
					if (code === 0) resolve();
					else reject(new Error(`curl thoát với mã lỗi ${code}`));
				});
				
				child.on('error', (err) => {
					reject(err);
				});
			});
			
			console.log(`\n   ✅ Tải xuống thành công.`);
			return;
		} catch (error) {
			const waitTime = 5000 * attempt;
			console.log(`\n   ⚠️ Lỗi tải xuống: ${error.message}. Sẽ thử lại sau ${waitTime/1000} giây...`);
			await new Promise(resolve => setTimeout(resolve, waitTime));
		}
	}
	throw new Error(`Không thể tải xuống sau ${retries} lần thử.`);
}

// ==========================================
// XỬ LÝ TỪNG NGÔN NGỮ
// ==========================================
async function processLanguage(code, displayName, kaikkiName) {
	const sourceUrl = process.env[`MYNARY_${code.toUpperCase()}_URL`] || defaultSourceUrl(code, kaikkiName);
	const sourceDir = join(root, '.source');
	const archive = join(sourceDir, `${code}.jsonl.gz`);
	const jsonl = join(sourceDir, `${code}.jsonl`);
	const destination = join(root, code);

	console.log(`\n${'='.repeat(65)}`);
	console.log(`🌍 [${code.toUpperCase()}] ${displayName} (Gốc: ${kaikkiName})`);
	console.log(`🔗 Nguồn: ${sourceUrl}`);
	console.log(`💾 RAM hiện tại: ${getMemoryUsage()}`);

	try {
		await mkdir(sourceDir, { recursive: true });
		
		console.log(`\n🔍 [1/5] Đang kiểm tra file trên server...`);
		const check = await checkFileExists(sourceUrl);
		if (!check.exists) {
			throw new Error(`File không tồn tại (HTTP ${check.status || 'N/A'}).`);
		}
		console.log(`   ✅ File tồn tại. Dung lượng: ${formatBytes(check.size)}`);

		console.log(`\n📥 [2/5] Đang tải dữ liệu...`);
		await downloadWithRetry(sourceUrl, archive);
		const archiveStats = await stat(archive);
		console.log(`   ✅ Đã tải xong: ${formatBytes(archiveStats.size)}`);

		console.log(`\n📦 [3/5] Đang giải nén dữ liệu...`);
		const startTime = Date.now();
		await pipeline(createReadStream(archive), createGunzip(), createWriteStream(jsonl));
		
		const jsonlStats = await stat(jsonl);
		const duration = ((Date.now() - startTime) / 1000).toFixed(1);
		console.log(`   ✅ Đã giải nén: ${formatBytes(jsonlStats.size)} (mất ${duration}s)`);

		console.log(`\n🛠️  [4/5] Đang xây dựng gói (Building pack)...`);
		await new Promise((resolveProcess, reject) => {
			const child = spawn(process.execPath, ['--max-old-space-size=3072', 'scripts/build-dictionary-pack.mjs', jsonl, destination, filterCode, `${displayName} Core Dictionary`, '--minimal'], { 
                              stdio: 'inherit' 
                        });
			child.once('error', reject);
			child.once('exit', (status) => {
				if (status === 0) resolveProcess();
				else reject(new Error(`Build thất bại với mã lỗi ${status}`));
			});
		});
		console.log(`   ✅ Build hoàn tất.`);

		if (!keepSources) {
			console.log(`\n🧹 [5/5] Đang dọn dẹp file tạm...`);
			await rm(archive, { force: true });
			await rm(jsonl, { force: true });
			console.log(`   ✅ Đã giải phóng dung lượng ổ cứng.`);
		}
		
		console.log(`\n🎉 [${code.toUpperCase()}] HOÀN THÀNH: ${destination}`);
		console.log(`${'='.repeat(65)}\n`);
		return { code, success: true };

	} catch (error) {
		console.error(`\n❌ [${code.toUpperCase()}] THẤT BẠI: ${error instanceof Error ? error.message : error}`);
		console.error(`💡 File nguồn được giữ lại tại: ${sourceDir} để kiểm tra.`);
		console.error(`${'='.repeat(65)}\n`);
		return { code, success: false, error: error.message };
	}
}

// ==========================================
// HÀM CHÍNH
// ==========================================
async function main() {
	console.log(`\n🚀 Bắt đầu xây dựng ${languages.length} gói từ điển.`);
	console.log(`📂 Thư mục đích: ${root}`);
	console.log(`⚙️ Chế độ xử lý song song: Tối đa ${MAX_CONCURRENT} (Bảo vệ RAM)`);
	console.log(`🛡️ Chế độ giữ file nguồn: ${keepSources ? 'CÓ' : 'KHÔNG'}\n`);
	
	await mkdir(root, { recursive: true });

	const buildScriptPath = resolve('scripts/build-dictionary-pack.mjs');
	try {
		await access(buildScriptPath);
	} catch {
		console.error(`\n❌ LỖI: Không tìm thấy file '${buildScriptPath}'.`);
		process.exit(1);
	}

	const results = [];
	const executing = new Set();

	for (const [code, displayName, kaikkiName] of languages) {
		const promise = processLanguage(code, displayName, kaikkiName).then(res => {
			executing.delete(promise);
			return res;
		});
		
		results.push(promise);
		executing.add(promise);

		if (executing.size >= MAX_CONCURRENT) {
			await Promise.race(executing);
		}
	}

	await Promise.allSettled(results);
	
	const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
	const successes = languages.length - failures;
	
	console.log('\n' + '🏆'.repeat(25));
	console.log(`📊 TỔNG KẾT:`);
	console.log(`   ✅ Thành công: ${successes} ngôn ngữ`);
	console.log(`   ❌ Thất bại: ${failures} ngôn ngữ`);
	
	if (failures === 0) {
		console.log(`\n🎉 TUYỆT VỜI! Tất cả các gói đã được xây dựng thành công.`);
		if (!keepSources) {
			await rm(join(root, '.source'), { recursive: true, force: true }).catch(() => {});
			console.log(`🧹 Đã dọn dẹp hoàn toàn thư mục .source.`);
		}
	} else {
		console.log(`\n⚠️ MỘT SỐ NGÔN NGỮ BỊ LỖI.`);
		const failedCodes = results
			.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success))
			.map(r => r.value?.code || 'unknown')
			.join(' ');
		console.log(`💡 Mẹo: Chạy lại lệnh: npm run build:packs -- ./release ${failedCodes}`);
	}
	console.log('🏆'.repeat(25) + '\n');
}

main().catch(err => {
	console.error('\n💥 LỖI KHÔNG MONG MUỐN:', err);
	process.exit(1);
});