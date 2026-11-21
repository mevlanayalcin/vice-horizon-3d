// SOLARIS BAY — a gta6-01 entry (Node 22, standard library only). Build v9.
//
// The game itself is this directory's game/ folder: plain static files a desktop browser
// serves offline — game/index.html, one stylesheet and twenty-eight authored ES modules
// under game/js/. main.js imports the gameplay systems first (missions, police, crew, turf,
// save, progression, activities, citymenu, combat), then vehicles, config, camera, traffic,
// audio, hud (with minimap), daycycle, scene, renderer3d (with postfx), world, and last
// streetprops and stage_glue (title and pause menus, screens, photo mode via shotstage).
// No library, no build step and no network request: the city, every car, character, sign,
// shader and sound is generated in code.
//
// This program is the plumbing the bounty asks for. It copies game/ and screenshots/ from
// beside this file into the output directory and writes dossier.json — the Game block and
// the source text the judge reads — with the kit's buildDossier, which walks index.html and
// then main.js's imports depth first, so that import order is the order the judge reads.
// The same inputs must produce the same bytes on every run, so nothing here reads the clock
// or the environment beyond MAKEFUN_OUTPUT_DIR.
//
// Play it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's own caps, kept beside the copy so a broken build fails loudly here rather
// than silently in the scorer: 4 screenshots at 256 KiB each, 993 files and 48 MiB of game/
// files, and a source budget of 160 KiB inside the dossier.
const SCREENSHOT_BUDGET = 262144;
const SCREENSHOT_MAX = 4;
const GAME_FILE_MAX = 993;
const GAME_BYTE_MAX = 50331648;
const TEXT_MAX = 163840;
// Our own ceiling for the finished dossier, well inside the kit's 4 MiB limit: the four
// screenshots plus the source text land near 1 MiB, so 1.5 MiB catches an oversized image
// or a runaway module before submission.
const DOSSIER_BUDGET = 1572864;

const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

/** File count and total bytes under a directory, walked in name order. */
function measure(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const inner = measure(path);
      files += inner.files;
      bytes += inner.bytes;
    } else {
      files += 1;
      bytes += statSync(path).size;
    }
  }
  return { files, bytes };
}

if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error('game/index.html is missing — the entry has nothing to hand in');
}
const game = measure(gameDir);
if (game.files > GAME_FILE_MAX) {
  throw new Error(`game/ holds ${game.files} files, over ${GAME_FILE_MAX}`);
}
if (game.bytes > GAME_BYTE_MAX) {
  throw new Error(`game/ holds ${game.bytes} bytes, over ${GAME_BYTE_MAX}`);
}

mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });

// Every screenshot is a real frame of this game, captured by its maker; the first by name
// is the cover. Refuse to hand in an image the gate would reject.
const shots = existsSync(shotsDir)
  ? readdirSync(shotsDir).filter((name) => !name.startsWith('.')).sort()
  : [];
if (shots.length < 3 || shots.length > SCREENSHOT_MAX) {
  throw new Error(`expected 3 or 4 screenshots, found ${shots.length}`);
}
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > SCREENSHOT_BUDGET) throw new Error(`${name} is ${size} bytes, over 256 KiB`);
  cpSync(join(shotsDir, name), join(out, 'screenshots', name));
}

const dossier = buildDossier(out, {
  text_max_bytes: TEXT_MAX,
  screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_BUDGET },
  game_max_files: GAME_FILE_MAX,
  game_max_bytes: GAME_BYTE_MAX,
  game_path_max_bytes: 1000,
});
const dossierBytes = Buffer.byteLength(dossier);
if (dossierBytes > DOSSIER_BUDGET) {
  throw new Error(`dossier.json is ${dossierBytes} bytes, over the ${DOSSIER_BUDGET}-byte budget`);
}
writeFileSync(join(out, 'dossier.json'), dossier);
