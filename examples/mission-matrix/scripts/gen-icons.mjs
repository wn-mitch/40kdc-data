// Generate the PWA / favicon icon set from the Alpaca Software logo.
//
// The source (brand/alpaca-software-logo.png) is a wide lockup: the hexagonal
// alpaca *mark* on the left, then the "ALPACA SOFTWARE" wordmark. App icons are
// square, so we crop the mark out, flatten it onto the logo's own background
// colour (no transparency — maskable icons must be full-bleed opaque), pad it
// into a square tile, and emit the sizes a PWA + browser need.
//
// Run with `npm run gen:icons`; outputs land in public/ and are committed.
// There is no system rasteriser installed (no ImageMagick/rsvg), so this is the
// minimal Node glue — the crop/flatten/multi-size emit isn't covered by an
// existing CLI.

import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../brand/alpaca-software-logo.png");
const OUT = resolve(here, "../public");

/** Pixel reader over a raw RGBA buffer. */
function reader(data, info) {
  const ch = info.channels;
  return (x, y) => {
    const i = (y * info.width + x) * ch;
    return [data[i], data[i + 1], data[i + 2], ch > 3 ? data[i + 3] : 255];
  };
}

/**
 * Locate the alpaca mark: the leftmost inked cluster, bounded on the right by
 * the first wide column-gap (the space before the wordmark). Returns the tight
 * bounding box plus the detected background colour. Data-driven so a tweaked
 * source still crops correctly.
 */
async function findMark() {
  const { data, info } = await sharp(SRC)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const px = reader(data, info);
  const bg = px(0, 0); // opaque corner = tile colour
  const isInk = (x, y) => {
    const [r, g, b, a] = px(x, y);
    if (a < 32) return false;
    return Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 60;
  };

  const colInk = new Array(info.width).fill(0);
  for (let x = 0; x < info.width; x++) {
    for (let y = 0; y < info.height; y++) if (isInk(x, y)) colInk[x]++;
  }

  const firstInk = colInk.findIndex((c) => c > 0);
  // First run of >=8 empty columns after the mark = gap before the wordmark.
  let gapStart = info.width;
  let run = 0;
  for (let x = firstInk; x < info.width; x++) {
    if (colInk[x] === 0) {
      if (++run >= 8) {
        gapStart = x - run + 1;
        break;
      }
    } else run = 0;
  }

  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let x = 0; x < gapStart; x++) {
    for (let y = 0; y < info.height; y++) {
      if (!isInk(x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error("no mark detected in source logo");
  return {
    bg: { r: bg[0], g: bg[1], b: bg[2], alpha: 1 },
    left: minX,
    top: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

/**
 * Render one square icon: the cropped mark resized so its larger dimension is
 * `coverage` of the tile, centred on a `bg`-filled square.
 */
async function makeIcon({ size, coverage, out, mark, bg }) {
  const inner = Math.round(size * coverage);
  // Mark is taller than wide; fit inside an `inner` box preserving aspect.
  const fit =
    mark.width >= mark.height
      ? { width: inner }
      : { height: inner };
  const cropped = await sharp(SRC)
    .extract({ left: mark.left, top: mark.top, width: mark.width, height: mark.height })
    .resize({ ...fit, fit: "inside" })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: bg },
  })
    .composite([{ input: cropped, gravity: "center" }])
    .png()
    .toFile(resolve(OUT, out));
  console.log(`  ${out}  (${size}px, mark ${Math.round(coverage * 100)}%)`);
}

const mark = await findMark();
console.log(
  `mark @ ${mark.left},${mark.top} ${mark.width}x${mark.height}  tile rgb(${mark.bg.r},${mark.bg.g},${mark.bg.b})`,
);
const bg = mark.bg;

// Standard ("any") icons + apple-touch: comfortable padding.
// Maskable: smaller coverage so the mark stays inside the circular safe zone.
// Favicon: near edge-to-edge so it reads at 32px.
await makeIcon({ size: 192, coverage: 0.72, out: "pwa-192x192.png", mark, bg });
await makeIcon({ size: 512, coverage: 0.72, out: "pwa-512x512.png", mark, bg });
await makeIcon({ size: 512, coverage: 0.6, out: "pwa-maskable-512x512.png", mark, bg });
await makeIcon({ size: 180, coverage: 0.74, out: "apple-touch-icon.png", mark, bg });
await makeIcon({ size: 32, coverage: 0.86, out: "favicon-32x32.png", mark, bg });
console.log("done.");
