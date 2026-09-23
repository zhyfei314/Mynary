import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

const file = process.argv[2]; // Ví dụ: node scripts/probe-language.mjs ./release/.source/hr.jsonl

if (!file) {
    console.log('❌ Vui lòng chỉ định file. Ví dụ: node scripts/probe-language.mjs hr.jsonl');
    process.exit(1);
}

const rl = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity
});

const langs = new Set();
let count = 0;

console.log(`🔍 Đang quét 1000 dòng đầu tiên của file ${file}...`);

rl.on('line', (line) => {
    if (count >= 1000) {
        rl.close();
        return;
    }
    try {
        const obj = JSON.parse(line);
        // Tìm mã ngôn ngữ (thường nằm ở trường 'lang' hoặc 'lang_code')
        if (obj.lang) langs.add(obj.lang);
        if (obj.lang_code) langs.add(obj.lang_code);
        
        // Đôi khi nó nằm trong mảng senses hoặc forms
        if (obj.senses && obj.senses[0] && obj.senses[0].lang) langs.add(obj.senses[0].lang);
        if (obj.forms && obj.forms[0] && obj.forms[0].lang) langs.add(obj.forms[0].lang);
        
    } catch (e) {}
    count++;
});

rl.on('close', () => {
    console.log(`\n✅ Đã quét xong ${count} dòng.`);
    console.log(`📋 Các mã ngôn ngữ thực tế tìm thấy trong file:`);
    console.log(Array.from(langs).join(', '));
});