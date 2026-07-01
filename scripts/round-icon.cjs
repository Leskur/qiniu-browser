const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SIZE = 1024;
const RADIUS = Math.round(SIZE * 0.22); // ~22% 圆角，接近 macOS 风格
const INPUT = path.join(__dirname, '../src-tauri/icons/icon.png');
const OUTPUT = path.join(__dirname, '../src-tauri/icons/icon.png');

// 生成圆角矩形 SVG 蒙版
const mask = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}">
    <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RADIUS}" ry="${RADIUS}" fill="white"/>
  </svg>`
);

async function run() {
  // 先把原图 resize 到 1024
  const original = await sharp(INPUT).resize(SIZE, SIZE).png().toBuffer();

  // 加圆角蒙版（composite 蒙版后四角变透明）
  const rounded = await sharp(original)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  fs.writeFileSync(OUTPUT, rounded);
  console.log(`✓ icon.png saved (${SIZE}x${SIZE}, radius=${RADIUS}px)`);
}

run().catch(e => { console.error(e); process.exit(1); });
