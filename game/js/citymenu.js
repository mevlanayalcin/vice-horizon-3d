// citymenu.js — the city menu (M / Tab). The left half is the full vector map of Solaris
// Bay (coastline, districts tinted by standing, GPS route, every blip) with the District
// Standing panel and its passive income laid over it. The header carries a radial
// "% COMPLETE" ring (the same figure every save card shows, from save.js), the tabs, the
// save pill and the wallet. The MAP tab's side panel summarises the whole career at once:
// the eight story jobs with their G / S / B medals, the deployed crew as portrait cards, side
// activities with medals and personal bests, garage upgrade stages and three inline save
// cards whose SAVE and LOAD buttons write and read the real localStorage slots. The other
// tabs open each section in full: STORY, CREW & TURF, ACTIVITIES, GARAGE (upgrades, Paint
// Shop, underglow, collection), STATS (career and the rank ladder) and SAVES. Opening the
// menu pauses the city; buttons route through the HUD's data-action handler to main.js.
// Crew portraits come from the HUD (portraits.js) through the `portrait` option.

import { MISSIONS } from './missions.js';
import { ACTIVITIES, STUNT_GOAL, medalFor } from './activities.js';
import { COLLECTION, NEONS, PAINTS, RANKS, UPGRADES, rankFor } from './progression.js';
import { TURF, TURF_TIERS, tierFor } from './turf.js';
import { DISTRICTS, VEHICLES } from './config.js';

const money = (n) => `$${Number(Math.round(n)).toLocaleString('en-US')}`;
const hexCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const districtOf = (id) => TURF.find((d) => d.id === id) ?? DISTRICTS.find((d) => d.id === id);
const MEDAL_NAMES = { G: 'gold', S: 'silver', B: 'bronze' };
const card = (title, note, body, cls = '') => `<div class="cm-card ${cls}"><h4>${title}${note ? `<em>${note}</em>` : ''}</h4>${body}</div>`;

export function createCityMenu({ painter, missions, activities, progression, combat, police, crew, turf, saves, completion, portrait = () => '' }) {
  const root = document.getElementById('cityMenu');
  const canvas = document.getElementById('cityMapCanvas');
  const side = document.getElementById('cmSide');
  const tabs = document.getElementById('cmTabs');
  const turfBox = document.getElementById('cmTurf');
  const ring = document.getElementById('cmRing');
  let tab = 'map';
  let open = false;
  let lastSideHtml = '';
  let lastTurfHtml = '';
  let lastRingHtml = '';
  const portraitCache = new Map();
  const portraitFor = (id) => {
    if (!portraitCache.has(id)) portraitCache.set(id, portrait(id));
    return portraitCache.get(id);
  };

  /** Overall completion in percent, the figure from save.js that every save card shows. */
  const percent = () => completion?.() ?? 0;

  function ringSvg(pct) {
    const r = 25, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="cmRingG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd88b"/><stop offset=".55" stop-color="#ff6a4d"/><stop offset="1" stop-color="#ff3f95"/></linearGradient></defs>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="6"/>
      <circle cx="32" cy="32" r="${r}" fill="none" stroke="url(#cmRingG)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 32 32)"/>
      ${[0, 1, 2, 3].map((i) => `<circle cx="${32 + Math.sin(i * Math.PI / 2) * r}" cy="${32 - Math.cos(i * Math.PI / 2) * r}" r="1.4" fill="#0b111b"/>`).join('')}</svg>
      <div class="cm-ring-text"><b>${pct.toFixed(1)}%</b><span>COMPLETE</span></div>`;
  }

  // ------------------------------------------------------------------ story
  function medal(rating) {
    return rating ? `<i class="cm-medal ${MEDAL_NAMES[rating]}">${rating}</i>` : '';
  }

  function storyGrid() {
    const s = missions.state;
    return `<div class="cm-jobs">${MISSIONS.map((m, i) => {
      const done = s.done[i];
      const active = s.active && s.index === i;
      const cls = done ? 'done' : active ? 'active' : 'locked';
      const d = districtOf(m.district);
      const tail = done ? medal(s.ratings?.[i]) : active ? '<i class="cm-live">LIVE</i>' : `<i class="cm-rw">${money(m.reward)}</i>`;
      return `<div class="cm-job ${cls}"><span class="st">${done ? '✓' : active ? '▶' : m.code}</span><span class="nm">${m.name.toUpperCase()}<small style="--c:${d?.color ?? '#fff'}">${(d?.name ?? '').toUpperCase()}</small></span>${tail}</div>`;
    }).join('')}</div>`;
  }

  function storyDetail() {
    const s = missions.state;
    return `<ul class="cm-list">${MISSIONS.map((m, i) => {
      const done = s.done[i];
      const active = s.active && s.index === i;
      const status = active ? missions.objectiveText() : done ? 'Complete' : 'Locked';
      return `<li><span class="st ${done ? 'done' : active ? 'active' : 'locked'}">${done ? '✓' : active ? '▶' : i + 1}</span>
        <span class="nm">${m.code} · ${m.name.toUpperCase()}${done ? medal(s.ratings?.[i]) : ''}<small>${m.giver} · ${districtOf(m.district)?.name ?? ''} · ${m.steps.length} stages · +${m.turf}% turf · ${status}</small><small>${m.brief}</small></span>
        <span class="rw">${money(m.reward)}</span></li>`;
    }).join('')}</ul>`;
  }

  // ------------------------------------------------------------------ crew
  function crewTiles(detail) {
    return `<div class="cm-crew-row">${crew.roster().map((c) => {
      const state = !c.recruited ? 'locked' : c.deployed ? 'on' : 'off';
      const badge = !c.recruited ? `JOINS AFTER JOB ${String(c.joins + 1).padStart(2, '0')}` : c.deployed ? c.status : 'STOOD DOWN';
      const perks = detail ? `<ul class="cm-perks">${c.perks.map((p) => `<li>${p}</li>`).join('')}</ul>` : '';
      const button = detail && c.recruited ? `<button class="cm-crew-btn" data-action="crewToggle" data-crew="${c.id}">${c.deployed ? 'STAND DOWN' : 'DEPLOY'}</button>` : '';
      return `<div class="cm-crew ${state}" style="--c:${c.color}"><span class="cm-crew-pic">${portraitFor(c.id)}</span>
        <div class="cm-crew-id"><b>${c.name.toUpperCase()}</b><em>${c.role.toUpperCase()}</em><span class="cm-crew-status"><i></i>${badge}</span></div>${button}${perks}</div>`;
    }).join('')}</div>`;
  }

  // ------------------------------------------------------------------ turf
  function turfBars() {
    const rows = TURF.map((d) => {
      const v = Math.round(turf.standing(d.id));
      return `<div class="tf-row"><div class="tf-top"><b style="color:${d.color}">${d.name.toUpperCase()}</b><em>${tierFor(v).name}</em><span>${v}</span></div>
        <div class="tf-bar"><i style="width:${v}%;background:linear-gradient(90deg, rgba(${d.rgb},0.5), ${d.color})"></i>${[25, 50, 75].map((m) => `<u style="left:${m}%"></u>`).join('')}</div></div>`;
    }).join('');
    return `<div class="tf-head"><span>DISTRICT STANDING</span><em>${Math.round(turf.overall())}%</em></div>${rows}
      <div class="tf-foot"><span>PASSIVE +${money(turf.payPerMinute())}/MIN</span><span>GARAGE −${Math.round(turf.discount() * 100)}%</span></div>`;
  }

  function turfDetail() {
    const tiers = TURF_TIERS.map((t) => `<li><span class="st ${turf.controlledCount(t.min) ? 'done' : 'locked'}">${t.min}</span><span class="nm">${t.name}<small>${t.pay ? `+${money(t.pay)} per minute per district` : 'No payout yet'}${t.min >= 50 ? ' · 5% garage discount' : ''}</small></span><span class="rw">${turf.controlledCount(t.min)} / 5</span></li>`).join('');
    return card('STANDING TIERS', 'JOBS · RACES · RUNS · SHAKEN CHASES', `<ul class="cm-list">${tiers}</ul>`)
      + `<div class="cm-card cm-turf-card">${turfBars()}</div>`;
  }

  // ------------------------------------------------------------------ activities
  function activityItems() {
    const st = activities.state;
    const items = ACTIVITIES.map((a) => {
      const best = st.best[a.id];
      const m = medalFor(a, best);
      return { a, best, medal: m, runs: st.completed[a.id] ?? 0 };
    });
    return items;
  }

  function activityGrid() {
    const cells = activityItems().map(({ a, best, medal: m }) => `<div class="cm-act"><span class="st ${m ? 'done' : 'act'}">${a.kind === 'race' ? 'R' : a.kind === 'fare' ? 'T' : 'C'}</span>
      <span class="nm">${a.name.toUpperCase()}<small>${best ? `PB ${best}s` : `PAR ${a.time}s`}</small></span>${m ? `<i class="cm-medal ${m.id}">${m.name[0]}</i>` : '<i class="cm-medal none">—</i>'}</div>`);
    const stunts = Math.min(progression.state.stats.stunts ?? 0, STUNT_GOAL);
    cells.push(`<div class="cm-act"><span class="st ${stunts >= STUNT_GOAL ? 'done' : 'act'}">S</span><span class="nm">STUNT RAMPS<small>${stunts} / ${STUNT_GOAL} LANDED</small></span><i class="cm-medal none">${Math.round((stunts / STUNT_GOAL) * 100)}%</i></div>`);
    return `<div class="cm-acts">${cells.join('')}</div>`;
  }

  function activityDetail() {
    const rows = activityItems().map(({ a, best, medal: m, runs }) => `<li><span class="st ${runs ? 'done' : 'act'}">${a.kind === 'race' ? 'R' : a.kind === 'fare' ? 'T' : 'C'}</span>
      <span class="nm">${a.name.toUpperCase()}${m ? `<i class="cm-medal ${m.id}">${m.name}</i>` : ''}${best ? `<i class="cm-pb">PB ${best}s</i>` : ''}<small>${a.blurb}<br>Par ${a.time}s · gold ≤ ${Math.floor(a.time * 0.72)}s · +${a.turf}% ${districtOf(a.district)?.name ?? ''}</small></span>
      <span class="rw">${money(a.reward)}</span></li>`).join('');
    return card('SIDE ACTIVITIES', streakText(), `<ul class="cm-list">${rows}</ul>`);
  }

  const streakText = () => `STREAK ${activities.state.streak} · x${(activities.multiplier ?? 1).toFixed(2)}`;

  // ------------------------------------------------------------------ garage
  function upgradePips() {
    const u = progression.state.upgrades;
    return `<div class="cm-upgrades">${UPGRADES.map((up) => `<span><b>${up.name.split(' ').pop().toUpperCase()}</b><span class="cm-pips">${[0, 1, 2].map((i) => `<i class="${i < u[up.id] ? 'on' : ''}"></i>`).join('')}</span></span>`).join('')}</div>`;
  }

  function paintShop() {
    const s = progression.state;
    const swatch = (kind, item, current) => {
      const unlocked = progression.unlocked(item);
      const fill = item.hex == null ? (kind === 'neon' ? 'transparent' : 'linear-gradient(135deg,#888,#eee)') : hexCss(item.hex);
      const glow = kind === 'neon' && item.hex != null ? `box-shadow:0 0 9px ${hexCss(item.hex)};` : '';
      return `<button class="cm-swatch${current === item.id ? ' on' : ''}${unlocked ? '' : ' locked'}" data-action="${kind === 'neon' ? 'setNeon' : 'setPaint'}" data-style="${item.id}" title="${item.name}${unlocked ? '' : ` · ${RANKS[item.rank].name}`}"><i style="background:${fill};${glow}"></i><b>${item.name.toUpperCase()}</b>${unlocked ? '' : `<u>RANK ${item.rank + 1}</u>`}</button>`;
    };
    return card('PAINT SHOP', (PAINTS.find((p) => p.id === s.paint)?.name ?? 'Factory').toUpperCase(), `<div class="cm-swatches">${PAINTS.map((p) => swatch('paint', p, s.paint)).join('')}</div>
      <h4 class="cm-sub-h">NEON UNDERGLOW<em>${(NEONS.find((n) => n.id === s.neon)?.name ?? 'Off').toUpperCase()}</em></h4><div class="cm-swatches">${NEONS.map((n) => swatch('neon', n, s.neon)).join('')}</div>`);
  }

  function garageDetail() {
    const u = progression.state.upgrades;
    const cash = combat.player.cash;
    const rows = UPGRADES.map((up) => {
      const price = progression.upgradePrice(up.id);
      const button = price === null ? '<button disabled>MAXED</button>'
        : `<button data-action="buyUpgrade" data-upgrade="${up.id}" ${cash < price ? 'disabled' : ''}>BUY ${money(price)}</button>`;
      return `<li><span class="st ${u[up.id] ? 'done' : 'locked'}">${u[up.id]}</span><span class="nm">${up.name.toUpperCase()}<small>${up.blurb}</small></span>${button}</li>`;
    }).join('');
    const cars = COLLECTION.map((id) => `<span class="${progression.state.stored.includes(id) ? 'on' : ''}">${VEHICLES[id].name.toUpperCase()}</span>`).join('');
    return card('SAFEHOUSE GARAGE · UPGRADES', turf.discount() > 0 ? `TURF DISCOUNT −${Math.round(turf.discount() * 100)}%` : 'APPLY TO EVERY CAR', `<ul class="cm-list">${rows}</ul>`)
      + paintShop()
      + card('COLLECTION', `${progression.state.stored.length} / ${COLLECTION.length}`, `<div class="cm-cars">${cars}</div><div class="cm-note">Drive a stolen car into the Safehouse Garage (G on the map) to store it · +$1,200 per new model.</div>`);
  }

  // ------------------------------------------------------------------ stats
  function statsDetail() {
    const p = combat.player;
    const st = progression.state.stats;
    const rank = rankFor(p.respect);
    const rows = [
      ['Completion', `${percent().toFixed(1)}%`], ['Cash', money(p.cash)], ['Respect', `${p.respect} RP`], ['Story', `${missions.progress} / ${MISSIONS.length}`],
      ['Peak heat', `★ ${Math.max(police.peak, police.wanted)}`], ['Cars stolen', st.stolen], ['Stunt jumps', st.stunts],
      ['Side activities', st.activities], ['Heat evaded', st.evaded], ['Takedowns', st.takedowns], ['Lamps flattened', st.lamps ?? 0],
      ['Cars stored', progression.state.stored.length], ['Turf payouts', money(turf.state.earned)], ['Crew abilities', crew.state.used ?? 0],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const ladder = RANKS.map((r, i) => `<li><span class="st ${p.respect >= r.respect ? 'done' : 'locked'}">${i + 1}</span><span class="nm">${r.name.toUpperCase()}<small>${i ? `+${money(r.cash)} · ${r.perk}` : r.perk}</small></span><span class="rw">${r.respect} RP</span></li>`).join('');
    return card('STREET RANK', rank.next ? `${rank.next.respect - p.respect} RP TO ${rank.next.name.toUpperCase()}` : 'TOP OF THE CITY',
      `<div class="cm-rank"><b class="cm-rank-badge">${rank.index + 1}</b><span class="cm-rank-name">${rank.name.toUpperCase()}</span><span class="cm-meter"><i style="width:${Math.round(rank.progress * 100)}%"></i></span></div>`)
      + card('CAREER', '', `<div class="cm-stats">${rows}</div>`) + card('STREET RANKS', 'MILESTONE REWARDS', `<ul class="cm-list">${ladder}</ul>`);
  }

  // ------------------------------------------------------------------ saves
  function saveCards(full) {
    const { list, active, time } = saves();
    const shown = full ? list : list.filter((s) => s.slot !== 'auto');
    return `<div class="cm-slots${full ? ' full' : ''}">${shown.map((s) => {
      const manual = s.slot !== 'auto';
      const on = manual && s.slot === active;
      const body = s.exists
        ? `<b class="sc-act">${s.act}</b><span class="sc-meta"><em>${Math.round(s.completion ?? 0)}%</em> · ${money(s.cash)}</span><span class="sc-meta">${String(s.district).toUpperCase()}</span><span class="sc-meta sc-time">${time(s.savedAt).toUpperCase()}</span>`
        : `<b class="sc-act empty">EMPTY</b><span class="sc-meta">${manual ? 'Save here to keep this run' : 'Written after every job'}</span>`;
      const buttons = `${manual ? `<button class="sc-save" data-action="saveSlot" data-slot="${s.slot}">SAVE</button>` : ''}<button class="sc-load" data-action="loadSlot" data-slot="${s.slot}" ${s.exists ? '' : 'disabled'}>LOAD</button>`;
      return `<div class="cm-slot${s.exists ? '' : ' empty'}${on ? ' on' : ''}"><div class="sc-head"><span>${s.label}</span>${on ? '<i>ACTIVE</i>' : ''}</div>${body}<div class="sc-btns">${buttons}</div></div>`;
    }).join('')}</div>`;
  }

  function savePill() {
    const pill = document.getElementById('cmSave');
    if (!pill || !saves) return;
    const { list, active, time } = saves();
    const auto = list.find((s) => s.slot === 'auto');
    const used = list.filter((s) => s.slot !== 'auto' && s.exists).length;
    pill.querySelector('b').textContent = `SLOT ${active} · ${auto?.exists ? `AUTO-SAVED ${time(auto.savedAt).split(' ').pop()}` : 'NOT SAVED YET'}`;
    pill.querySelector('span').textContent = `3 SAVE SLOTS · ${used} USED`;
    pill.classList.toggle('on', tab === 'saves');
  }

  // ------------------------------------------------------------------ layout
  function renderSide() {
    const done = missions.progress;
    const live = crew.roster().filter((c) => c.active).length;
    const u = progression.state.upgrades;
    const stages = Object.values(u).reduce((n, v) => n + v, 0);
    let html = '';
    if (tab === 'saves') {
      html = card('SAVE SLOTS', '3 SLOTS + AUTOSAVE · LOCALSTORAGE', saveCards(true))
        + '<div class="cm-card"><div class="cm-note">Saves stay in this browser. Esc pauses to save, load or delete, and the title screen\'s LOAD GAME lists every slot.</div></div>';
    } else if (tab === 'story') {
      html = card('THE SOLARIS BAY JOB', `${done} / ${MISSIONS.length} JOBS`, storyDetail(), 'cm-scroll');
    } else if (tab === 'crew') {
      html = card('CREW', `${live} / 2 DEPLOYED`, crewTiles(true)) + turfDetail();
    } else if (tab === 'activities') {
      html = activityDetail();
    } else if (tab === 'garage') {
      html = garageDetail();
    } else if (tab === 'stats') {
      html = statsDetail();
    } else {
      html = card('STORY JOBS', `${done} / ${MISSIONS.length} · MEDALS G / S / B`, storyGrid())
        + card('DEPLOYED CREW', `${live} / 2 ON THE JOB`, crewTiles(false))
        + card('ACTIVITIES', streakText(), activityGrid())
        + card('GARAGE UPGRADES', `${stages} / 12 STAGES · ${(PAINTS.find((p) => p.id === progression.state.paint)?.name ?? 'Factory').toUpperCase()}`, upgradePips(), 'cm-tight')
        + card('SAVES', 'SLOT 1-3 · SAVE / LOAD', saveCards(false), 'cm-saves-card');
    }
    if (html !== lastSideHtml) {
      lastSideHtml = html;
      side.innerHTML = html;
    }
    [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    turfBox.classList.toggle('hidden', tab === 'crew');
    const turfHtml = turfBars();
    if (turfHtml !== lastTurfHtml) {
      lastTurfHtml = turfHtml;
      turfBox.innerHTML = turfHtml;
    }
    const ringHtml = ringSvg(percent());
    if (ringHtml !== lastRingHtml) {
      lastRingHtml = ringHtml;
      ring.innerHTML = ringHtml;
    }
    savePill();
  }

  /** Redraw the map and the side panel from the live state. */
  function render(state) {
    if (!open) return;
    painter.drawCityMap(canvas, { ...state, turf: turf.state.standing });
    renderSide();
    document.getElementById('cmCash').textContent = money(combat.player.cash);
    if (state.subtitle) document.getElementById('cmSub').textContent = state.subtitle;
  }

  function show(nextTab = tab) {
    tab = nextTab;
    open = true;
    root.classList.remove('hidden');
  }

  function hide() {
    open = false;
    root.classList.add('hidden');
  }

  function setTab(next) {
    tab = next;
    renderSide();
  }

  return { show, hide, setTab, render, get open() { return open; }, get tab() { return tab; } };
}
