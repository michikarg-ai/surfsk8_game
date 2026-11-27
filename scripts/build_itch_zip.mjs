import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const RELEASE_DIR = path.join(ROOT_DIR, 'release');
const ZIP_NAME = 'srfsk8-itch-html5.zip';
const ZIP_PATH = path.join(RELEASE_DIR, ZIP_NAME);

const ITCH_MAX_BYTES = 500 * 1024 * 1024; // 500 MB itch.io HTML5 ZIP hard cap

/**
 * Explicit allowlist of production public/ assets referenced by the game.
 * Prevents gigabytes of local git-ignored photogrammetry scans (.usdz, raw .glb,
 * uncompressed 4K PNGs, .DS_Store) from leaking into the itch.io HTML5 ZIP.
 */
const PRODUCTION_PUBLIC_FILES = [
  // Audio
  'audio/garage_theme.mp3',
  'audio/surfskate_anthem_1.mp3',
  'audio/surfskate_anthem_2.mp3',
  'audio/surfskate_anthem_3.mp3',
  // Fonts
  'fonts/BarlowCondensed-600n.woff2',
  'fonts/BarlowCondensed-700n.woff2',
  'fonts/BarlowCondensed-800i.woff2',
  'fonts/BarlowCondensed-800n.woff2',
  'fonts/BarlowCondensed-900i.woff2',
  'fonts/BarlowCondensed-900n.woff2',
  'fonts/PermanentMarker.woff2',
  'fonts/RubikDirt.woff2',
  'fonts/SedgwickAveDisplay.woff2',
  // Models & LiDAR grids
  'models/airport_skatepark_game.glb',
  'models/airport_skatepark_lidar.json',
  'models/im_gefilde_lidar.json',
  'models/pumptrack_aschheim.glb',
  'models/skatepark_multi.glb',
  'models/skater.glb',
  'models/skater_female.glb',
  // Textures & skyboxes
  'textures/airport_golden_hour_bg.jpg',
  'textures/airport_skatepark_tex0.jpg',
  'textures/airport_thumb.png',
  'textures/im_gefilde_thumb.png',
  'textures/landing_page_background.jpeg',
  'textures/night_sky_alps.jpg',
  'textures/skatepark_multi_tex0.jpg',
];

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function walkFiles(dir, baseDir = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, baseDir));
    } else if (entry.isFile()) {
      results.push(path.relative(baseDir, full).split(path.sep).join('/'));
    }
  }
  return results;
}

function copyRelFile(relPath, stagingDir) {
  const src = path.join(DIST_DIR, relPath);
  const dst = path.join(stagingDir, relPath);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  return fs.statSync(dst).size;
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error('dist/ does not exist. Run `ITCH_BUILD=1 npm run build` first.');
  }

  const indexHtmlPath = path.join(DIST_DIR, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error('dist/index.html is missing.');
  }

  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
  if (!indexHtml.includes('./assets/')) {
    throw new Error(
      'dist/index.html does not contain relative `./assets/` paths. Ensure `ITCH_BUILD=1` was set during Vite build.'
    );
  }
  if (/src="\/assets\/|href="\/assets\//.test(indexHtml)) {
    throw new Error('dist/index.html still contains root-absolute `/assets/` references.');
  }

  const allDistFiles = walkFiles(DIST_DIR);
  const totalDistBytes = allDistFiles.reduce(
    (sum, rel) => sum + fs.statSync(path.join(DIST_DIR, rel)).size,
    0
  );

  // Build exact list of files to include in the itch.io package
  const filesToInclude = new Set(['index.html']);

  for (const rel of allDistFiles) {
    if (rel.startsWith('assets/')) {
      filesToInclude.add(rel);
    }
  }

  for (const rel of PRODUCTION_PUBLIC_FILES) {
    const full = path.join(DIST_DIR, rel);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing required production asset in dist/: ${rel}`);
    }
    filesToInclude.add(rel);
  }

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'srfsk8-itch-'));
  try {
    let stagedBytes = 0;
    const sortedFiles = Array.from(filesToInclude).sort();
    for (const rel of sortedFiles) {
      stagedBytes += copyRelFile(rel, stagingDir);
    }

    const excludedFiles = allDistFiles.filter((rel) => !filesToInclude.has(rel));
    const excludedBytes = totalDistBytes - stagedBytes;

    fs.mkdirSync(RELEASE_DIR, { recursive: true });
    if (fs.existsSync(ZIP_PATH)) {
      fs.unlinkSync(ZIP_PATH);
    }

    execFileSync('zip', ['-r', '-9', '-q', ZIP_PATH, '.'], {
      cwd: stagingDir,
      stdio: 'inherit',
    });

    const zipBytes = fs.statSync(ZIP_PATH).size;
    if (zipBytes > ITCH_MAX_BYTES) {
      throw new Error(
        `itch.io ZIP (${formatMB(zipBytes)}) exceeds itch.io's 500 MB HTML5 limit!`
      );
    }

    // Verify ZIP structure via unzip -l
    const unzipListing = execFileSync('unzip', ['-l', ZIP_PATH], { encoding: 'utf8' });
    if (!/\s+index\.html$/m.test(unzipListing)) {
      throw new Error('ZIP verification failed: index.html is not at ZIP root.');
    }

    console.log('');
    console.log('=== SRFSK8 itch.io HTML5 Package Ready ===');
    console.log(`ZIP path:           ${path.relative(ROOT_DIR, ZIP_PATH)}`);
    console.log(`Included files:     ${sortedFiles.length}`);
    console.log(`Uncompressed size:  ${formatMB(stagedBytes)}`);
    console.log(`ZIP archive size:   ${formatMB(zipBytes)} (limit: 500.00 MB)`);
    console.log(
      `Filtered out:       ${excludedFiles.length} non-production/raw files (${formatMB(excludedBytes)} saved)`
    );
    console.log('Verified:           index.html at ZIP root + relative ./assets/ paths');
    console.log('=========================================');
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

main();
