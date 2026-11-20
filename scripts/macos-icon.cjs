const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Always build from the unpadded source so repeated runs never add more padding.
const input = path.join(__dirname, '../src-tauri/icons/icon.png');
const output = path.join(__dirname, '../src-tauri/icons/icon.icns');
const contentRatio = 0.82;
const representations = [
  ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic08', 256],
  ['ic13', 256], ['ic09', 512], ['ic14', 512], ['ic10', 1024],
];

async function run() {
  const chunks = [];
  for (const [type, size] of representations) {
    const contentSize = Math.round(size * contentRatio);
    const inset = Math.floor((size - contentSize) / 2);
    const content = await sharp(input).resize(contentSize, contentSize).png().toBuffer();
    const png = await sharp({ create: {
      width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
    } }).composite([{ input: content, left: inset, top: inset }]).png().toBuffer();
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    chunks.push(header, png);
  }
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  fs.writeFileSync(output, Buffer.concat([header, ...chunks]));
  console.log('Generated macOS icon with 82% content and transparent margins.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
