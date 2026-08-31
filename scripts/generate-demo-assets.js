/**
 * Generates the files the demo account is seeded with, plus the OG image the
 * link preview uses.
 *
 * These are committed rather than generated at build time: /api/demo/session
 * fetches them over HTTP from the deployment's own origin, so they have to
 * exist as static assets, and a fork should get a working demo from a clone
 * without running anything.
 *
 * Run with: npm run generate:demo-assets
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '../public');
const demoDir = join(publicDir, 'demo');

/* The palette is theme/variables.css — indigo, violet, sky. */
const INDIGO = '#4f46e5';
const VIOLET = '#8b5cf6';
const SKY = '#0ea5e9';
const INK = '#0f172a';

/**
 * A soft mesh gradient: three offset radial blobs over a base colour. Rendered
 * as one SVG rather than composited layers so the blur stays cheap.
 */
function meshSvg(width, height, base, blobs) {
  const stops = blobs
    .map(
      (b, i) => `
      <radialGradient id="g${i}" cx="${b.cx}" cy="${b.cy}" r="${b.r}">
        <stop offset="0%" stop-color="${b.color}" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="${b.color}" stop-opacity="0"/>
      </radialGradient>`
    )
    .join('');

  const rects = blobs
    .map((_, i) => `<rect width="${width}" height="${height}" fill="url(#g${i})"/>`)
    .join('');

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>${stops}</defs>
      <rect width="${width}" height="${height}" fill="${base}"/>
      ${rects}
    </svg>`
  );
}

/**
 * Kept deliberately small.
 *
 * The dashboard renders these as 100x100 thumbnails, and getThumbnailUrl only
 * resizes for Cloudinary — Supabase Storage image transformation is a paid
 * feature, so on this path the browser downloads the original. At 1600x900 the
 * first two were 280 KB and 148 KB to paint two 100px squares.
 */
async function demoImages() {
  mkdirSync(demoDir, { recursive: true });

  await sharp(
    meshSvg(900, 506, INK, [
      { cx: '20%', cy: '25%', r: '65%', color: INDIGO },
      { cx: '80%', cy: '20%', r: '55%', color: SKY },
      { cx: '55%', cy: '95%', r: '70%', color: VIOLET },
    ])
  )
    .png({ compressionLevel: 9, palette: true, colors: 64 })
    .toFile(join(demoDir, 'gradient-hero.png'));

  await sharp(
    meshSvg(700, 875, '#111827', [
      { cx: '15%', cy: '85%', r: '70%', color: VIOLET },
      { cx: '85%', cy: '30%', r: '60%', color: INDIGO },
    ])
  )
    .png({ compressionLevel: 9, palette: true, colors: 64 })
    .toFile(join(demoDir, 'mesh-poster.png'));

  await sharp(join(publicDir, 'icon.svg'))
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(join(demoDir, 'logo-mark.png'));

  console.log('✅ demo images');
}

/**
 * A minimal, hand-assembled PDF — one page, one base-14 font, no compression.
 *
 * pdf-lib would be a dependency the app never otherwise needs, and the file is
 * simple enough that the only fiddly part is the cross-reference table, whose
 * byte offsets are computed below rather than written by hand.
 */
function buildPdf(lines) {
  const content =
    'BT\n/F1 22 Tf\n60 760 Td\n20 TL\n' +
    lines
      .map((line) => {
        const escaped = line.text.replace(/([\\()])/g, '\\$1');
        return `/F1 ${line.size} Tf\n${line.leading} TL\n(${escaped}) Tj\nT*`;
      })
      .join('\n') +
    '\nET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n` +
    `startxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

function demoPdf() {
  const pdf = buildPdf([
    { text: 'Cloud Storage App', size: 26, leading: 40 },
    { text: 'This file lives in the demo account you just opened.', size: 13, leading: 30 },
    { text: '', size: 13, leading: 14 },
    { text: 'What you can try here:', size: 15, leading: 26 },
    { text: '  - Upload a file. Images are routed to Cloudinary,', size: 12, leading: 18 },
    { text: '    everything else to Cloudflare R2 or Supabase Storage.', size: 12, leading: 22 },
    { text: '  - Open a file and create a share link. It expires in', size: 12, leading: 18 },
    { text: '    7 days and can be revoked from the same screen.', size: 12, leading: 22 },
    { text: '  - Watch the storage meter. The quota is enforced', size: 12, leading: 18 },
    { text: '    server-side when an R2 upload URL is signed.', size: 12, leading: 22 },
    { text: '  - Visit Plans. Stripe runs in test mode, so card', size: 12, leading: 18 },
    { text: '    4242 4242 4242 4242 upgrades without charging you.', size: 12, leading: 30 },
    { text: 'This account is yours alone and is deleted after 24 hours.', size: 12, leading: 26 },
    { text: 'Source: github.com/Alexandr-Paleev/CloudStorageApp-Ionic', size: 12, leading: 18 },
  ]);

  writeFileSync(join(demoDir, 'welcome.pdf'), pdf);
  console.log('✅ demo pdf');
}

/**
 * 1200x630 link preview: the product name on the left, a real screenshot of
 * the dashboard on the right. A rendered screenshot rather than a logo because
 * the preview is the only picture most people will ever see of this app.
 */
async function ogImage() {
  const background = await sharp(
    meshSvg(1200, 630, INK, [
      { cx: '10%', cy: '20%', r: '70%', color: INDIGO },
      { cx: '95%', cy: '90%', r: '60%', color: VIOLET },
    ])
  )
    .png()
    .toBuffer();

  /* Scaled, not cropped: a cropped screenshot loses the storage meter, which is
     the one element that says what the app does. 1280x900 -> 470x330. */
  const shotWidth = 470;
  const shotHeight = Math.round((900 / 1280) * shotWidth);
  const shot = await sharp(join(__dirname, '../docs/screenshots/dashboard.png'))
    .resize({ width: shotWidth })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${shotWidth}" height="${shotHeight}" xmlns="http://www.w3.org/2000/svg">
             <rect width="${shotWidth}" height="${shotHeight}" rx="14" ry="14" fill="#fff"/>
           </svg>`
        ),
        blend: 'dest-in',
      },
    ])
    .png()
    .toBuffer();

  /* Helvetica runs about 0.58em per character bold and 0.5em regular, so the
     text column is kept under 560px — the screenshot starts at x=660. */
  const text = Buffer.from(
    `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
       <style>
         .t { font-family: Helvetica, Arial, sans-serif; fill: #ffffff; }
         .s { font-family: Helvetica, Arial, sans-serif; fill: #ddd6fe; }
         .m { font-family: Helvetica, Arial, sans-serif; fill: #a5b4fc; }
       </style>
       <text class="t" x="72" y="248" font-size="52" font-weight="bold">Cloud Storage App</text>
       <text class="s" x="72" y="300" font-size="24">Multi-provider file storage and billing</text>
       <text class="s" x="72" y="334" font-size="24">Share links, quotas, five backends</text>
       <rect x="72" y="378" width="120" height="4" rx="2" fill="#8b5cf6"/>
       <text class="m" x="72" y="432" font-size="19">Ionic React  .  TypeScript  .  Supabase  .  Stripe</text>
       <text class="m" x="72" y="464" font-size="19">Cloudinary  .  Cloudflare R2  .  Google Drive</text>
     </svg>`
  );

  await sharp(background)
    .composite([
      { input: shot, top: Math.round((630 - shotHeight) / 2), left: 660 },
      { input: text, top: 0, left: 0 },
    ])
    .png({ compressionLevel: 9 })
    .toFile(join(publicDir, 'og-image.png'));

  console.log('✅ og-image.png');
}

await demoImages();
demoPdf();
await ogImage();
console.log('\n🎉 done');
