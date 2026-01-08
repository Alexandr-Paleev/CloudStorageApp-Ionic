/**
 * Script to generate PWA icons from SVG
 * Requires: npm install sharp
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sizes = [192, 512];
const inputSvg = join(__dirname, '../public/icon.svg');
const outputDir = join(__dirname, '../public');

async function generateIcons() {
  console.log('🎨 Generating PWA icons...\n');

  const svgBuffer = readFileSync(inputSvg);

  for (const size of sizes) {
    const outputPath = join(outputDir, `icon-${size}x${size}.png`);
    
    await sharp(svgBuffer)
      .resize(size, size)
      .png({
        quality: 100,
        compressionLevel: 9,
      })
      .toFile(outputPath);
    
    console.log(`✅ Generated: icon-${size}x${size}.png`);
  }

  console.log('\n🎉 All icons generated successfully!');
}

generateIcons().catch((error) => {
  console.error('❌ Error generating icons:', error);
  process.exit(1);
});
