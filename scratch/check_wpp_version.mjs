import fs from 'fs';

const content = fs.readFileSync('etiqueta terminada/extension/public/vendor/wppconnect-wa.min.js', 'utf8');

// Look for a version string like "version":"X.Y.Z" or similar
const versionMatches = content.match(/"version"\s*:\s*"([^"]+)"|version\s*=\s*"([^"]+)"/);
if (versionMatches) {
  console.log("Version matches:", versionMatches[0], versionMatches[1] || versionMatches[2]);
} else {
  // Let's print first 2000 characters
  console.log("First 1000 characters:\n", content.slice(0, 1000));
}
