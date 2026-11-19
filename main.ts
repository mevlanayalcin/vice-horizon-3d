// SOLARIS BAY — a gta6-01 entry (Node 22, standard library only).
//
// The game itself is this directory's game/ folder: plain static files a desktop browser
// serves offline — game/index.html, one stylesheet and twelve authored ES modules under
// game/js/ (config, world, renderer3d, vehicles, traffic, police, combat, missions, audio,
// hud, save, main). No library, no build step and no network request: the city, every car,
// character, shader and sound is generated in the browser from the game's own code.
//
// This program is the plumbing the bounty asks for. It copies game/ and screenshots/ from
// beside this file into the output directory and writes dossier.json — the Game block and
// the source text the judge reads — with the kit's buildDossier. The same inputs must
// produce the same bytes on every run, so nothing here reads the clock or the environment
// beyond MAKEFUN_OUTPUT_DIR.
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

const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

function countFiles(dir) {
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files += countFiles(path);
    else files += 1;
  }
  return files;
}

if (!existsSync(join(gameDir, 'index.html'))) {
  throw new Error('game/index.html is missing — the entry has nothing to hand in');
}
if (countFiles(gameDir) > GAME_FILE_MAX) {
  throw new Error(`game/ holds more than ${GAME_FILE_MAX} files`);
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

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: SCREENSHOT_MAX, max_bytes: SCREENSHOT_BUDGET },
    game_max_files: GAME_FILE_MAX,
    game_max_bytes: GAME_BYTE_MAX,
    game_path_max_bytes: 1000,
  }),
);
