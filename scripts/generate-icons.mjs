#!/usr/bin/env zx

import 'zx/globals';
import sharp from 'sharp';
import png2icons from 'png2icons';
import { fileURLToPath } from 'url';

// Calculate paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons');
const SVG_SOURCE = path.join(ICONS_DIR, 'icon.svg');

echo`🎨 Generating ClawX icons using Node.js...`;

// Check if SVG source exists
if (!fs.existsSync(SVG_SOURCE)) {
  echo`❌ SVG source not found: ${SVG_SOURCE}`;
  process.exit(1);
}

// Ensure icons directory exists
await fs.ensureDir(ICONS_DIR);

try {
  // 1. Generate Master PNG Buffer (1024x1024)
  echo`  Processing SVG source...`;
  const masterPngBuffer = await sharp(SVG_SOURCE)
    .resize(1024, 1024)
    .png() // Ensure it's PNG
    .toBuffer();

  // Save the main icon.png (typically 512x512 for Electron root icon)
  await sharp(masterPngBuffer)
    .resize(512, 512)
    .toFile(path.join(ICONS_DIR, 'icon.png'));
  echo`  ✅ Created icon.png (512x512)`;

  // 2. Generate Windows .ico
  // png2icons expects a buffer. It returns a buffer (or null).
  // createICO(buffer, scalingAlgorithm, withSize, useMath)
  // scalingAlgorithm: 1 = Bilinear (better), 2 = Hermite (good), 3 = Bezier (best/slowest)
  // Defaulting to Bezier (3) for quality or Hermite (2) for speed. Let's use 2 (Hermite) as it's balanced.
  echo`🪟 Generating Windows .ico...`;
  const icoBuffer = png2icons.createICO(masterPngBuffer, png2icons.HERMITE, 0, false);
  
  if (icoBuffer) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoBuffer);
    echo`  ✅ Created icon.ico`;
  } else {
    echo(chalk.red`  ❌ Failed to create icon.ico`);
    // detailed error might not be available from png2icons simple API, often returns null on failure
  }

  // 3. Generate macOS .icns
  echo`🍎 Generating macOS .icns...`;
  const icnsBuffer = png2icons.createICNS(masterPngBuffer, png2icons.HERMITE, 0);
  
  if (icnsBuffer) {
    fs.writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icnsBuffer);
    echo`  ✅ Created icon.icns`;
  } else {
    echo(chalk.red`  ❌ Failed to create icon.icns`);
  }

  // 4. Generate Linux PNGs (various sizes)
  echo`🐧 Generating Linux PNG icons...`;
  const linuxSizes = [16, 32, 48, 64, 128, 256, 512];
  let generatedCount = 0;
  
  for (const size of linuxSizes) {
    await sharp(masterPngBuffer)
      .resize(size, size)
      .toFile(path.join(ICONS_DIR, `${size}x${size}.png`));
    generatedCount++;
  }
  echo`  ✅ Created ${generatedCount} Linux PNG icons`;

  // 5. Generate macOS Tray Icon Template (monochrome silhouette from icon.svg)
  // macOS status bar icons are template images: only the alpha channel matters,
  // macOS tints them (black in light menu bar, white in dark). We build a pure-black
  // silhouette preserving icon.svg's alpha so it stays a clean monochrome template.
  echo`📍 Generating macOS tray icon template from icon.svg...`;
  for (const { size, name } of [
    { size: 22, name: 'tray-icon-Template.png' },
    { size: 44, name: 'tray-icon-Template@2x.png' },
  ]) {
    const alpha = await sharp(SVG_SOURCE)
      .resize(size, size)
      .ensureAlpha()
      .extractChannel('alpha')
      .toBuffer();
    await sharp({
      create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .joinChannel(alpha)
      .png()
      .toFile(path.join(ICONS_DIR, name));
    echo`  ✅ Created ${name} (${size}x${size})`;
  }

  echo`\n✨ Icon generation complete! Files located in: ${ICONS_DIR}`;

} catch (error) {
  echo(chalk.red`\n❌ Fatal Error: ${error.message}`);
  process.exit(1);
}
