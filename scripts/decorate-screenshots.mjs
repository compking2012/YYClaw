#!/usr/bin/env node
/**
 * Decorate raw README screenshots to match the committed macOS-window look.
 *
 * `tests/e2e/capture-readme-screenshots.spec.ts` writes the flat renderer
 * viewport (2560x1600). Playwright can only capture web contents, so it cannot
 * reproduce the rounded corners, drop shadow and transparent margin that a
 * macOS window screenshot has. This step adds them, producing the same
 * 2784x1824 canvas geometry the previous images used:
 *
 *   canvas 2784x1824, transparent
 *   window 2560x1600 at (112, 76), corner radius 24
 *   shadow offset +36y, blurred, black at ~35% opacity
 *
 * Idempotent guard: a file already at canvas size is skipped, so re-running
 * without re-capturing does not double-decorate.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

const SCREENSHOT_ROOT = 'resources/screenshot';

const CANVAS_WIDTH = 2784;
const CANVAS_HEIGHT = 1824;
const WINDOW_WIDTH = 2560;
const WINDOW_HEIGHT = 1600;
const OFFSET_X = 112;
const OFFSET_Y = 76;
const CORNER_RADIUS = 24;
// Calibrated against the previously committed images. Measuring alpha falloff on
// the old en/chat.png put the shadow ~45px above, ~48/42px to the sides and
// ~50px below the canvas edge; sigma 45 at 0.65 opacity with a +33y offset
// reproduces that within ~3px on every edge.
const SHADOW_DY = 33;
const SHADOW_BLUR = 45;
const SHADOW_OPACITY = 0.65;

function roundedRectSvg(width, height, radius, fill) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${fill}"/>`
    + '</svg>',
  );
}

async function buildShadow() {
  // Blur needs room to spread, but the padded silhouette must still fit inside
  // the target canvas, so cap the padding at the available margin.
  const pad = Math.min(
    SHADOW_BLUR * 2,
    Math.floor((CANVAS_WIDTH - WINDOW_WIDTH) / 2),
    Math.floor((CANVAS_HEIGHT - WINDOW_HEIGHT) / 2),
  );
  // Two stages on purpose: sharp applies `composite` late in a pipeline, so
  // chaining `.blur()` onto the same call would blur the blank base and leave
  // the composited rect hard-edged.
  const silhouette = await sharp({
    create: {
      width: WINDOW_WIDTH + pad * 2,
      height: WINDOW_HEIGHT + pad * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{
      input: roundedRectSvg(WINDOW_WIDTH, WINDOW_HEIGHT, CORNER_RADIUS, `rgba(0,0,0,${SHADOW_OPACITY})`),
      left: pad,
      top: pad,
    }])
    .png()
    .toBuffer();

  const blurred = await sharp(silhouette).blur(SHADOW_BLUR).png().toBuffer();
  return { buffer: blurred, pad };
}

async function decorate(filePath, shadow) {
  const source = sharp(await readFile(filePath));
  const meta = await source.metadata();

  if (meta.width === CANVAS_WIDTH && meta.height === CANVAS_HEIGHT) {
    return { skipped: true, reason: 'already decorated' };
  }
  if (meta.width !== WINDOW_WIDTH || meta.height !== WINDOW_HEIGHT) {
    return {
      skipped: true,
      reason: `unexpected size ${meta.width}x${meta.height}, expected ${WINDOW_WIDTH}x${WINDOW_HEIGHT}`,
    };
  }

  // Round the window's corners: keep only what the rounded rect covers.
  const rounded = await source
    .ensureAlpha()
    .composite([{
      input: roundedRectSvg(WINDOW_WIDTH, WINDOW_HEIGHT, CORNER_RADIUS, '#fff'),
      blend: 'dest-in',
    }])
    .png()
    .toBuffer();

  const out = await sharp({
    create: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadow.buffer, left: OFFSET_X - shadow.pad, top: OFFSET_Y - shadow.pad + SHADOW_DY },
      { input: rounded, left: OFFSET_X, top: OFFSET_Y },
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(filePath, out);
  return { skipped: false };
}

async function main() {
  const shadow = await buildShadow();
  const locales = (await readdir(SCREENSHOT_ROOT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  let decorated = 0;
  let skipped = 0;

  for (const locale of locales) {
    const dir = join(SCREENSHOT_ROOT, locale);
    const files = (await readdir(dir)).filter((name) => name.endsWith('.png')).sort();
    for (const name of files) {
      const filePath = join(dir, name);
      const result = await decorate(filePath, shadow);
      if (result.skipped) {
        skipped += 1;
        console.log(`  skip  ${locale}/${name} — ${result.reason}`);
      } else {
        decorated += 1;
        console.log(`  ok    ${locale}/${name}`);
      }
    }
  }

  console.log(`\ndecorated ${decorated}, skipped ${skipped}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
