import fs from 'fs';
import path from 'path';

const fileContent = fs.readFileSync('etiqueta terminada/extension/public/vendor/wppconnect-wa.min.js', 'utf8');

console.log("Length of vendor js:", fileContent.length);

const keywords = [
  'isReady',
  'onReady',
  'contacts',
  'contact',
  'whatsapp',
];

for (const keyword of keywords) {
  const count = (fileContent.match(new RegExp(keyword, 'g')) || []).length;
  console.log(`Keyword: ${keyword} - Count: ${count}`);
}
