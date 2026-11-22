// screens.js — every screen that is not the live HUD, inserted on import (before main.js
// builds the HUD, so hud.js finds every id it reads):
//   · the Golden-Hour title / start screen: the SOLARIS BAY lockup over the live city camera,
//     CONTINUE / NEW GAME / LOAD GAME / CONTROLS & SETTINGS, the right-hand panel of three
//     live save-slot cards (filled by hud.setTitleSlots from save.js) and a key footer;
//   · the city menu shell (M / Tab) that citymenu.js renders into: map canvas, completion
//     ring, tabs with the SAVES tab marked, the save pill and the side panel;
//   · Controls & Settings (field manual plus sound, screen effects and mouse speed),
//     Pause (save / load columns), Load Game, Story Complete and the mission popup.
// Buttons carry data-action; hud.js routes every click to stage_glue.js.

const btn = (action, label, cls = 'modal-btn', extra = '') => `<button class="${cls}" data-action="${action}"${extra}>${label}</button>`;
const head = (kicker, close, action) => `<div class="modal-head"><span class="modal-kicker">${kicker}</span><button class="modal-close" data-action="${action}">${close}</button></div>`;
const keyChip = ([k, what]) => `<span class="kc"><b>${k}</b>${what}</span>`;

// ------------------------------------------------------------------ title / start screen
const FOOTER_KEYS = [['WASD', 'MOVE / DRIVE'], ['MOUSE', 'AIM · LMB FIRE'], ['SHIFT', 'SPRINT / NITRO'], ['SPACE', 'HANDBRAKE'],
  ['E / F', 'STEAL CAR'], ['Q / C', 'COVER'], ['Z X C', 'CREW'], ['M', 'CITY MAP'], ['ESC', 'PAUSE · SAVE']];

const menuItem = (action, index, label, meta, id = '') => `<button class="menu-btn" data-action="${action}"${id ? ` id="${id}"` : ''}>
<span class="btn-index">${index}</span><span class="btn-label">${label}</span><span class="btn-meta"${id ? ` id="${id}Meta"` : ''}>${meta}</span><span class="btn-arrow">›</span></button>`;

const title = `<div id="titleScreen" class="screen title-screen">
<div class="title-grade"></div>
<div class="title-inner">
<div class="title-left">
<div class="eyebrow"><span class="live-dot"></span>LIVE CITY · OCEAN BOULEVARD · GOLDEN HOUR</div>
<div class="logo-block">
<div class="logo-sun"></div>
<h1 class="logo"><span class="logo-solaris">SOLARIS</span><span class="logo-bay"><i></i>BAY<i></i></span></h1>
</div>
<p class="tagline">Sun, salt and <em>unfinished business.</em></p>
<nav class="menu" aria-label="Main menu">
${menuItem('continue', '01', 'CONTINUE', 'NO SAVE FOUND', 'continueBtn')}
${menuItem('new', '02', 'NEW GAME', 'ACT I · BOARDWALK BOOST')}
${menuItem('loadMenu', '03', 'LOAD GAME', '3 SLOTS + AUTOSAVE', 'loadMenuBtn')}
${menuItem('controls', '04', 'CONTROLS &amp; SETTINGS', 'KEYS · SOUND')}
</nav>
<div class="title-stats">
<div class="stat"><span class="stat-label">STORY</span><span class="stat-value" id="titleProgress">0 / 8</span></div>
<div class="stat"><span class="stat-label">CASH</span><span class="stat-value gold" id="titleCash">$640</span></div>
<div class="stat"><span class="stat-label">SUN TOKENS</span><span class="stat-value" id="titleTokens">0 / 12</span></div>
<div class="stat"><span class="stat-label">PEAK HEAT</span><span class="stat-value" id="titlePeak">★ 0</span></div>
</div>
</div>
<aside class="title-right" aria-label="Save slots">
<div class="right-head"><span>SAVE SLOTS</span><span class="right-line"></span><span id="titleSlotsMeta">0 / 3 USED</span></div>
<div class="title-cards" id="titleSaveCards"></div>
<div class="title-auto" id="titleAuto"><span class="ta-dot"></span><span id="titleAutoText">AUTOSAVE · WRITTEN AFTER EVERY JOB</span></div>
</aside>
</div>
<footer class="title-bottom">
<div class="title-keys">${FOOTER_KEYS.map(keyChip).join('')}</div>
<span class="title-build">SOLARIS BAY <b>v11</b> · WEBGL2 · 100% OFFLINE</span>
</footer>
</div>`;

// ------------------------------------------------------------------ city menu shell
const TABS = [['map', 'MAP'], ['story', 'STORY'], ['crew', 'CREW &amp; TURF'], ['activities', 'ACTIVITIES'], ['garage', 'GARAGE'], ['stats', 'STATS'], ['saves', 'SAVES']];
const LEGEND = [['player', 'YOU'], ['mission', 'MISSION'], ['act', 'ACTIVITY'], ['garage', 'GARAGE'], ['police', 'POLICE'], ['ramp', 'RAMP']];

const cityMenu = `<div id="cityMenu" class="screen overlay city-menu hidden" aria-label="City map, progression and saves">
<div class="cm-shell">
<div class="cm-head">
<div class="cm-ring" id="cmRing"></div>
<div class="cm-brand"><span class="cm-logo">SOLARIS<b>BAY</b></span><span class="cm-sub" id="cmSub">Palm Strip · 19:12 · Golden Hour</span></div>
<nav class="cm-tabs" id="cmTabs">${TABS.map(([tab, label], i) => `<button data-action="menuTab" data-tab="${tab}" class="${i ? '' : 'on'}${tab === 'saves' ? ' cm-tab-saves' : ''}">${tab === 'saves' ? '<i class="save-glyph"></i>' : ''}${label}</button>`).join('')}</nav>
<button class="cm-save" id="cmSave" data-action="menuTab" data-tab="saves" aria-label="Save slots"><span>3 SAVE SLOTS</span><b>SLOT 1 · NOT SAVED YET</b></button>
<div class="cm-wallet"><span>CASH</span><b id="cmCash">$0</b></div>
</div>
<div class="cm-body">
<div class="cm-map-wrap">
<canvas id="cityMapCanvas" width="1240" height="900" aria-label="Full city map"></canvas>
<div class="cm-turf" id="cmTurf" aria-label="District standing"></div>
<div class="cm-legend">${LEGEND.map(([k, label]) => `<span><i class="lg-${k}"></i>${label}</span>`).join('')}</div>
</div>
<div class="cm-side" id="cmSide"></div>
</div>
<div class="cm-foot"><span>M / TAB CLOSE · CLICK A TAB · SAVE / LOAD ANY SLOT HERE · UPGRADES APPLY TO EVERY CAR</span>${btn('closeMenu', 'BACK TO THE CITY')}</div>
</div>
</div>`;

// ------------------------------------------------------------------ controls & settings
const MANUAL = [
  ['ON FOOT', [
    '<b>WASD</b> walk · <b>Shift</b> sprint · <b>Space</b> jump',
    '<b>Mouse / Arrows</b> camera and aim · <b>LMB</b> shoot · <b>RMB</b> aim',
    '<b>1</b> fists · <b>2</b> pistol · <b>3</b> SMG · <b>4</b> shotgun · <b>5</b> carbine',
    '<b>R</b> reload · <b>E / F</b> steal the nearest car',
    '<b>Q / C</b> drop into low cover · <b>RMB</b> peek and fire',
    '<b>T</b> call Mateo to your side or stand him down',
  ]],
  ['BEHIND THE WHEEL', [
    '<b>W / S</b> throttle &amp; brake · <b>A / D</b> steer',
    '<b>Shift</b> nitro · <b>Space</b> handbrake drift',
    '<b>Mouse</b> orbit the chase camera · <b>H</b> horn',
    '<b>R</b> radio station · <b>E / F</b> exit',
  ]],
  ['CREW &amp; CITY', [
    '<b>Z</b> Elena · JAM DISPATCH, SBPD blind for 8 s',
    '<b>X</b> Mateo · FIELD PATCH, +35 health, +25 armour',
    '<b>C</b> Nico · NITRO SURGE while driving (on foot C is cover)',
    '<b>M / Tab</b> city map, story, crew, garage, saves · <b>Esc</b> pause',
  ]],
];

const setting = (action, label, id, value) => `<button class="set-row" data-action="${action}"><span>${label}</span><b id="${id}">${value}</b></button>`;
const controls = `<div id="controlsScreen" class="screen overlay hidden">
<div class="modal wide">
${head('CONTROLS &amp; SETTINGS', 'CLOSE ✕', 'closeControls')}
<h2>Everything you can do in Solaris Bay</h2>
<div class="manual-grid">
${MANUAL.map(([name, lines]) => `<div class="manual-col"><h3>${name}</h3>${lines.map((line) => `<p>${line}</p>`).join('')}</div>`).join('\n')}
</div>
<div class="settings-grid">
${setting('toggleSound', 'SOUND', 'soundLabel', 'ON')}
${setting('toggleFx', 'SCREEN EFFECTS', 'fxLabel', 'ON')}
${setting('mouseSpeed', 'MOUSE SPEED', 'mouseLabel', 'NORMAL')}
</div>
<div class="modal-foot"><span>SETTINGS APPLY AT ONCE · SAVES STAY IN THIS BROWSER</span>${btn('closeControls', 'BACK')}</div>
</div>
</div>`;

// ------------------------------------------------------------------ pause, load, story
const pauseBtn = (action, label, cls = '', id = '') => `<button class="menu-btn${cls}" data-action="${action}"${id ? ` id="${id}"` : ''}><span class="btn-label">${label}</span><span class="btn-arrow">›</span></button>`;
const pause = `<div id="pauseScreen" class="screen overlay hidden">
<div class="modal pause-modal">
${head('SOLARIS BAY · PAUSED', 'RESUME ✕', 'resume')}
<div class="pause-title-row">
<div><h2>PAUSED</h2><p class="pause-sub" id="pauseSub">Palm Strip · Golden Hour</p></div>
<div class="pause-cash"><span>CASH</span><b id="pauseCash">$640</b></div>
</div>
<div class="pause-grid">
<div class="pause-actions">
${pauseBtn('resume', 'RESUME', ' primary')}
${pauseBtn('controls', 'CONTROLS &amp; SETTINGS')}
${pauseBtn('restart', 'RESTART STORY', '', 'restartBtn')}
${pauseBtn('quit', 'QUIT TO TITLE')}
<div class="pause-note">The autosave is written after every job. Click a slot to save or overwrite it, ✕ to delete.</div>
</div>
<div class="save-columns">
<div class="save-col"><div class="save-head">SAVE TO</div><div id="saveSlots" class="slot-list"></div></div>
<div class="save-col"><div class="save-head">LOAD FROM</div><div id="loadSlots" class="slot-list"></div></div>
</div>
</div>
</div>
</div>`;

const slots = `<div id="slotsScreen" class="screen overlay hidden">
<div class="modal slots-modal">
${head('LOAD GAME', 'CLOSE ✕', 'closeSlots')}
<h2>Save slots</h2>
<p class="pause-sub">Three manual slots and the autosave, kept in this browser only.</p>
<div id="titleSlots" class="slot-list slot-grid"></div>
<div class="modal-foot"><span>LOAD A SLOT TO PICK UP WHERE IT LEFT OFF · ✕ DELETES IT</span>${btn('closeSlots', 'BACK')}</div>
</div>
</div>`;

const story = `<div id="storyScreen" class="screen overlay hidden">
<div class="modal story-modal">
<span class="story-kicker">STORY COMPLETE · 08 / 08</span>
<h2>THE CITY<br><span>IS YOURS.</span></h2>
<p class="story-copy">Elena has the ledger, Mateo has the case, and Solaris Bay has a new set of legends. The sun keeps coming up on the Strip.</p>
<div class="story-stats" id="storyStats"></div>
<div class="story-actions">${btn('freeRoam', 'KEEP DRIVING')}${btn('quit', 'RETURN TO TITLE', 'modal-btn ghost')}</div>
</div>
</div>`;

const popup = `<div id="missionPopup" class="mission-popup hidden">
<div class="popup-kicker">MISSION COMPLETE</div>
<div class="popup-name" id="popupName">BOARDWALK BOOST</div>
<div class="popup-reward" id="popupReward">+$1,400</div>
<div class="popup-next" id="popupNext">NEXT · HARBOR CONTRABAND</div>
</div>`;

const loading = document.getElementById('loading');
loading.insertAdjacentHTML('beforebegin', [cityMenu, title, controls, pause, slots, story, popup].join('\n'));
