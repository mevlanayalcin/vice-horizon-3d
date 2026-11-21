// screens.js — markup index.html does not need for first paint: the title screen's
// district list and key card, the city menu, the field manual, pause, load game, story
// complete and the mission popup.
// It is inserted on import, before main.js builds the HUD, at the same place in the
// document the page itself would hold it (the city menu before the title screen, the
// other overlays before the loading veil), so ids, classes and stacking match a static page.

const DISTRICTS = [
  ['#ffb257', 'PALM STRIP', 'Oceanfront boulevard · pastel hotels · endless palms'],
  ['#ff6f91', 'CORAL PIER', 'A neon wheel over the water · salt on everything'],
  ['#c56cff', 'NEON MIDTOWN', 'Glass towers · magenta light · the Solaris Vault'],
  ['#57d8d0', 'HARBOR DOCKS', 'Containers, cranes and quiet money'],
  ['#5cc8ff', 'MARINA CAUSEWAY', 'Bridges to the yachts · glass on the water'],
  ['#9ee06a', 'CASA HILLS', 'Pastel houses stacked against the hillside'],
  ['#ffe08a', 'STARLIGHT KEY', 'An island marina · yachts and private slips'],
];
const KEYS = [['WASD', 'Move / Drive'], ['SHIFT', 'Sprint / Nitro'], ['MOUSE', 'Look · LMB fire'], ['E / F', 'Steal &amp; exit car'],
  ['Q / C', 'Take cover'], ['T', 'Call Mateo'], ['1-4', 'Weapons'], ['R', 'Radio station'], ['SPACE', 'Handbrake / Jump'],
  ['M', 'Map &amp; garage'], ['ESC', 'Pause &amp; save']];
const [cityHead, manualHead] = document.querySelectorAll('#titleScreen .right-head');
cityHead.insertAdjacentHTML('afterend', `\n<ul class="district-list">\n${DISTRICTS.map(([c, name, blurb]) => `<li><span class="d-swatch" style="--c:${c}"></span><div><span class="d-name">${name}</span><span class="d-blurb">${blurb}</span></div></li>`).join('\n')}\n</ul>`);
manualHead.insertAdjacentHTML('afterend', `\n<div class="mini-controls">\n${KEYS.map(([k, what]) => `<div><span class="key-group">${k}</span><span>${what}</span></div>`).join('\n')}\n</div>`);

const btn = (action, label, cls = 'modal-btn') => `<button class="${cls}" data-action="${action}">${label}</button>`;
const head = (kicker, close, action) => `<div class="modal-head"><span class="modal-kicker">${kicker}</span><span class="modal-close" data-action="${action}">${close}</span></div>`;

const TABS = [['map', 'MAP'], ['story', 'STORY'], ['crew', 'CREW &amp; TURF'], ['activities', 'ACTIVITIES'], ['garage', 'GARAGE'], ['stats', 'STATS'], ['saves', 'SAVES']];
const LEGEND = [['player', 'YOU'], ['mission', 'MISSION'], ['act', 'ACTIVITY'], ['garage', 'GARAGE'], ['police', 'POLICE'], ['ramp', 'STUNT RAMP']];

const cityMenu = `<div id="cityMenu" class="screen overlay city-menu hidden" aria-label="City map and progression">
<div class="cm-shell">
<div class="cm-head">
<div class="cm-brand"><span class="cm-logo">SOLARIS<b>BAY</b></span><span class="cm-sub" id="cmSub">Palm Strip · 19:12 · Golden Hour</span></div>
<nav class="cm-tabs" id="cmTabs">${TABS.map(([tab, label], i) => `<button data-action="menuTab" data-tab="${tab}"${i ? '' : ' class="on"'}>${label}</button>`).join('')}</nav>
<button class="cm-save" id="cmSave" data-action="menuTab" data-tab="saves" aria-label="Save slots"><span>SAVE · 3 SLOTS</span><b>SLOT 1 · NOT SAVED YET</b></button>
<div class="cm-wallet"><span>CASH</span><b id="cmCash">$0</b></div>
</div>
<div class="cm-body">
<div class="cm-map-wrap">
<canvas id="cityMapCanvas" width="1240" height="860" aria-label="Full city map"></canvas>
<div class="cm-turf" id="cmTurf" aria-label="District standing"></div>
<div class="cm-legend">
${[LEGEND.slice(0, 3), LEGEND.slice(3)].map((row) => row.map(([k, label]) => `<span><i class="lg-${k}"></i>${label}</span>`).join('')).join('\n')}
</div>
</div>
<div class="cm-side" id="cmSide"></div>
</div>
<div class="cm-foot"><span>M / TAB CLOSE · CLICK A TAB · SAVES TAB WRITES 3 SLOTS · GARAGE UPGRADES APPLY TO EVERY CAR YOU DRIVE</span>${btn('closeMenu', 'BACK TO THE CITY')}</div>
</div>
</div>`;

const MANUAL = [
  ['ON FOOT', [
    '<b>WASD</b> walk · <b>Shift</b> sprint · <b>Space</b> jump',
    '<b>Mouse / Arrows</b> camera and aim · <b>LMB</b> shoot / punch',
    '<b>1</b> fists · <b>2</b> pistol · <b>3</b> SMG · <b>4</b> shotgun',
    '<b>X</b> reload · <b>E / F</b> enter the nearest car',
    '<b>Q / C</b> drop into low cover beside a car, bollard or barricade · <b>RMB</b> peek and fire',
    '<b>T</b> call Mateo to your side or stand him down',
  ], 'Weapons unlock through the story. Cover soaks most incoming fire and steadies your aim.'],
  ['BEHIND THE WHEEL', [
    '<b>W / S</b> throttle &amp; brake · <b>A / D</b> steer',
    '<b>Shift</b> nitro boost · <b>Space</b> handbrake drift',
    '<b>Mouse</b> orbit the chase camera · <b>H</b> horn',
    '<b>E / F</b> exit · <b>1-4</b> still switches weapons',
  ], 'Hit the gold ramps at speed for airtime and cash. Water stalls the engine.'],
  ['THE CITY', [
    '<b>Gold diamond</b> mission waypoint',
    '<b>Red / blue blips</b> police · <b>white dots</b> traffic',
    '<b>Stars</b> wanted level · from three stars SBPD sets roadblocks and Air One flies',
    '<b>R</b> radio · <b>M / Tab</b> city map, story, crew, turf, garage · <b>Esc</b> pause, save, load',
  ], 'Jobs, races, runs and shaken chases raise district standing: passive cash and garage discounts.'],
];

const controls = `<div id="controlsScreen" class="screen overlay hidden">
<div class="modal wide">
${head('FIELD MANUAL', 'CLOSE ✕', 'closeControls')}
<h2>Everything you can do in Solaris Bay</h2>
<div class="manual-grid">
${MANUAL.map(([title, lines, note]) => `<div class="manual-col">
<h3>${title}</h3>
${lines.map((line) => `<p>${line}</p>`).join('\n')}
<p class="muted-note">${note}</p>
</div>`).join('\n')}
</div>
<div class="modal-foot"><span>SOLARIS BAY · PALM STRIP TO MARINA CAUSEWAY</span>${btn('closeControls', 'BACK TO THE CITY')}</div>
</div>
</div>`;

const menuBtn = (action, label, extra = '') => `<button class="menu-btn${extra}" data-action="${action}">${label}</button>`;
const pause = `<div id="pauseScreen" class="screen overlay hidden">
<div class="modal pause-modal">
${head('SOLARIS BAY', 'RESUME ✕', 'resume')}
<div class="pause-title-row">
<div>
<h2>PAUSED</h2>
<p class="pause-sub" id="pauseSub">Palm Strip · Golden Hour</p>
</div>
<div class="pause-cash"><span>CASH</span><b id="pauseCash">$640</b></div>
</div>
<div class="pause-grid">
<div class="pause-actions">
${menuBtn('resume', '<span class="btn-label">RESUME</span><span class="btn-arrow">→</span>', ' primary')}
${menuBtn('toggleSound', '<span class="btn-label" id="soundLabel">SOUND · ON</span>')}
${menuBtn('restart', '<span class="btn-label">RESTART STORY</span>')}
${menuBtn('quit', '<span class="btn-label">QUIT TO TITLE</span>')}
<div class="pause-note">Autosave runs after every mission. Three named manual slots below: click to save or overwrite, ✕ to delete.</div>
</div>
<div class="save-columns">
${[['SAVE TO', 'saveSlots'], ['LOAD FROM', 'loadSlots']].map(([label, id]) => `<div class="save-col">
<div class="save-head">${label}</div>
<div id="${id}" class="slot-list"></div>
</div>`).join('\n')}
</div>
</div>
</div>
</div>`;

const slots = `<div id="slotsScreen" class="screen overlay hidden">
<div class="modal slots-modal">
${head('LOAD GAME', 'CLOSE ✕', 'closeSlots')}
<h2>Save slots</h2>
<p class="pause-sub">Three named manual slots and the autosave, stored in this browser only.</p>
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
<div class="story-actions">
${btn('freeRoam', 'KEEP DRIVING')}
${btn('quit', 'RETURN TO TITLE', 'modal-btn ghost')}
</div>
</div>
</div>`;

const popup = `<div id="missionPopup" class="mission-popup hidden">
<div class="popup-kicker">MISSION COMPLETE</div>
<div class="popup-name" id="popupName">BOARDWALK BOOST</div>
<div class="popup-reward" id="popupReward">+$1,400</div>
<div class="popup-next" id="popupNext">NEXT · HARBOR CONTRABAND</div>
</div>`;

document.getElementById('titleScreen').insertAdjacentHTML('beforebegin', `${cityMenu}\n`);
document.getElementById('loading').insertAdjacentHTML('beforebegin', [controls, pause, slots, story, popup].join('\n'));
