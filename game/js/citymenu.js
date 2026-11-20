// citymenu.js — the in-game city menu (M / Tab): a full vector map of Solaris Bay with
// every blip and the live District Standing bars, beside tabs for the eight-job story arc,
// the crew roster (deploy / stand down, perks, live status) with turf detail, side
// activities (medals, personal bests and the live streak multiplier), the Safehouse Garage
// (upgrades bought with cash and discounted by turf, the Paint Shop and neon underglow
// selectors, the stolen-car collection), the save slots (three manual slots plus the
// autosave, save / load from the menu) and lifetime stats with the rank ladder's milestone
// rewards. A save pill beside the cash shows the active slot and the last autosave and jumps
// to the SAVES tab. Opening it pauses the city; buttons route through the HUD's data-action
// handler to main.js.

import { MISSIONS } from './missions.js';
import { ACTIVITIES, STUNT_GOAL, medalFor } from './activities.js';
import { COLLECTION, NEONS, PAINTS, RANKS, UPGRADES, rankFor } from './progression.js';
import { TURF, TURF_TIERS, tierFor } from './turf.js';
import { DISTRICTS, VEHICLES } from './config.js';

const money = (n) => `$${Number(Math.round(n)).toLocaleString('en-US')}`;
const hexCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const districtLabel = (id) => (TURF.find((d) => d.id === id) ?? DISTRICTS.find((d) => d.id === id))?.name ?? '';

export function createCityMenu({ painter, missions, activities, progression, combat, police, crew, turf, saves }) {
  const root = document.getElementById('cityMenu');
  const canvas = document.getElementById('cityMapCanvas');
  const side = document.getElementById('cmSide');
  const tabs = document.getElementById('cmTabs');
  const turfBox = document.getElementById('cmTurf');
  let tab = 'map';
  let open = false;

  function rankCard(compact = false) {
    const p = combat.player;
    const rank = rankFor(p.respect);
    const next = rank.next ? `${rank.next.respect - p.respect} RP to ${rank.next.name}` : 'Top of the city';
    return `<div class="cm-card${compact ? ' cm-tight' : ''}"><div class="cm-rank"><div class="cm-rank-badge">${rank.index + 1}</div>
      <div style="flex:1"><div class="cm-rank-name">${rank.name.toUpperCase()}</div><div class="cm-rank-next">${p.respect} RESPECT · ${next}</div>
      <div class="cm-meter"><span style="width:${Math.round(rank.progress * 100)}%"></span></div></div></div></div>`;
  }

  function storyRows(detail) {
    const s = missions.state;
    return MISSIONS.map((m, i) => {
      const done = s.done[i];
      const active = s.active && s.index === i;
      const cls = done ? 'done' : active ? 'active' : 'locked';
      const mark = done ? '✓' : active ? '▶' : String(i + 1);
      const where = `<i class="cm-dist" style="--c:${TURF.find((d) => d.id === m.district)?.color ?? '#fff'}">${districtLabel(m.district).toUpperCase()}</i>`;
      if (!detail) {
        return `<li class="${active ? 'on' : ''}"><span class="st ${cls}">${mark}</span><span class="nm">${m.code} · ${m.name.toUpperCase()}${where}</span><span class="rw">${money(m.reward)}</span></li>`;
      }
      const status = active ? missions.objectiveText() : done ? 'Complete' : 'Locked';
      return `<li><span class="st ${cls}">${mark}</span><span class="nm">${m.code} · ${m.name.toUpperCase()}${where}<small>${m.giver} · ${m.steps.length} steps · +${m.turf}% turf · ${status}</small><small>${m.brief}</small></span><span class="rw">${money(m.reward)}</span></li>`;
    }).join('');
  }

  /** Crew tiles: portrait, role, live status and the deploy / stand-down toggle. */
  function crewCard(detail) {
    const tiles = crew.roster().map((c) => {
      const state = !c.recruited ? 'locked' : c.deployed ? 'on' : 'off';
      const badge = !c.recruited ? `JOINS AFTER JOB ${String(c.joins + 1).padStart(2, '0')}` : c.status;
      const perks = detail ? `<ul class="cm-perks">${c.perks.map((p) => `<li>${p}</li>`).join('')}</ul>` : `<small>${c.perks[0]}</small>`;
      const button = c.recruited ? `<button class="cm-crew-btn" data-action="crewToggle" data-crew="${c.id}">${c.deployed ? 'STAND DOWN' : 'DEPLOY'}</button>` : '';
      return `<div class="cm-crew ${state}"><div class="cm-crew-top"><span class="cm-crew-pic" style="--c:${c.color}">${c.initial}</span>
        <div class="cm-crew-id"><b>${c.name.toUpperCase()}</b><em>${c.role.toUpperCase()}</em></div></div>
        <div class="cm-crew-status"><i></i>${badge}</div>${perks}${button}</div>`;
    }).join('');
    const live = crew.roster().filter((c) => c.active).length;
    return `<div class="cm-card"><h4>CREW<em>${live} / 2 DEPLOYED</em></h4><div class="cm-crew-row">${tiles}</div></div>`;
  }

  /** District Standing bars: overlaid on the map, and larger on the crew tab. */
  function turfBars(detail) {
    const rows = TURF.map((d) => {
      const v = Math.round(turf.standing(d.id));
      const tier = tierFor(v);
      return `<div class="tf-row"><div class="tf-top"><b style="color:${d.color}">${(detail ? d.name : d.name).toUpperCase()}</b><em>${tier.name}</em><span>${v}%</span></div>
        <div class="tf-bar"><i style="width:${v}%;background:linear-gradient(90deg, rgba(${d.rgb},0.55), ${d.color});box-shadow:0 0 8px rgba(${d.rgb},0.6)"></i>${[25, 50, 75].map((m) => `<u style="left:${m}%"></u>`).join('')}</div></div>`;
    }).join('');
    const pay = turf.payPerMinute();
    const off = Math.round(turf.discount() * 100);
    return `<div class="tf-head"><span>DISTRICT STANDING</span><em>${Math.round(turf.overall())}%</em></div>${rows}
      <div class="tf-foot"><span>+${money(pay)}/MIN</span><span>GARAGE −${off}%</span></div>`;
  }

  function turfDetail() {
    const tiers = TURF_TIERS.map((t) => `<li><span class="st ${turf.controlledCount(t.min) ? 'done' : 'locked'}">${t.min}</span><span class="nm">${t.name}<small>${t.pay ? `+${money(t.pay)} per minute per district` : 'No payout yet'}${t.min >= 50 ? ' · 5% garage discount' : ''}</small></span><span class="rw">${turf.controlledCount(t.min)} / 5</span></li>`).join('');
    return `<div class="cm-card cm-turf-card">${turfBars(true)}</div>
      <div class="cm-card"><h4>STANDING TIERS<em>JOBS · RACES · RUNS · SHAKEN CHASES</em></h4><ul class="cm-list">${tiers}</ul></div>`;
  }

  function activityRows(detail) {
    const st = activities.state;
    const rows = ACTIVITIES.map((a) => {
      const best = st.best[a.id];
      const runs = st.completed[a.id] ?? 0;
      const medal = medalFor(a, best);
      const badge = medal ? `<i class="cm-medal ${medal.id}">${medal.name}</i>` : '';
      const pb = best ? `<i class="cm-pb">PB ${best}s</i>` : '';
      const sub = detail ? `<small>${a.blurb}<br>Par ${a.time}s · gold ≤ ${Math.floor(a.time * 0.72)}s · +${a.turf}% ${districtLabel(a.district)}</small>` : '';
      return `<li><span class="st ${runs ? 'done' : 'act'}">${a.kind === 'race' ? 'R' : a.kind === 'fare' ? 'T' : 'C'}</span><span class="nm">${a.name.toUpperCase()}${badge}${pb}${sub}</span><span class="rw">${money(a.reward)}</span></li>`;
    });
    const stunts = progression.state.stats.stunts ?? 0;
    rows.push(`<li><span class="st ${stunts >= STUNT_GOAL ? 'done' : 'act'}">S</span><span class="nm">STUNT RAMPS<i class="cm-pb">${Math.min(stunts, STUNT_GOAL)} / ${STUNT_GOAL}</i>${detail ? '<small>Land the gold ramps · +$150 each</small>' : ''}</span><span class="rw">${money(STUNT_GOAL * 150)}</span></li>`);
    return rows.join('');
  }

  /** The live streak multiplier badge for the activities header. */
  function streakBadge() {
    const st = activities.state;
    const mult = activities.multiplier ?? 1;
    return `<em class="${st.streak ? 'cm-hot' : ''}">STREAK ${st.streak} · x${mult.toFixed(2)}</em>`;
  }

  /** Paint Shop and underglow selectors: swatches for every colour, locked ones by rank. */
  function paintShop() {
    const s = progression.state;
    const swatch = (kind, item, current) => {
      const open = progression.unlocked(item);
      const fill = item.hex == null ? (kind === 'neon' ? 'transparent' : 'linear-gradient(135deg,#888,#eee)') : hexCss(item.hex);
      const glow = kind === 'neon' && item.hex != null ? `box-shadow:0 0 9px ${hexCss(item.hex)};` : '';
      return `<button class="cm-swatch${current === item.id ? ' on' : ''}${open ? '' : ' locked'}" data-action="${kind === 'neon' ? 'setNeon' : 'setPaint'}" data-style="${item.id}" title="${item.name}${open ? '' : ` · ${RANKS[item.rank].name}`}"><i style="background:${fill};${glow}"></i><b>${item.name.toUpperCase()}</b>${open ? '' : `<u>RANK ${item.rank + 1}</u>`}</button>`;
    };
    return `<div class="cm-card"><h4>PAINT SHOP<em>${(PAINTS.find((p) => p.id === s.paint)?.name ?? 'Factory').toUpperCase()}</em></h4>
      <div class="cm-swatches">${PAINTS.map((p) => swatch('paint', p, s.paint)).join('')}</div>
      <h4 style="margin-top:7px">NEON UNDERGLOW<em>${(NEONS.find((n) => n.id === s.neon)?.name ?? 'Off').toUpperCase()}</em></h4>
      <div class="cm-swatches">${NEONS.map((n) => swatch('neon', n, s.neon)).join('')}</div></div>`;
  }

  function garageSummary(compact = false) {
    const u = progression.state.upgrades;
    const pips = (n) => `<span class="cm-pips">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
    const ups = `<div class="cm-upgrades">${UPGRADES.map((up) => `<span>${up.name.split(' ').pop().toUpperCase()}${pips(u[up.id])}</span>`).join('')}</div>`;
    if (compact) return ups;
    const cars = COLLECTION.map((id) => `<span class="${progression.state.stored.includes(id) ? 'on' : ''}">${VEHICLES[id].name.toUpperCase()}</span>`).join('');
    return `${ups}<div class="cm-cars" style="margin-top:6px">${cars}</div>`;
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
    return `<div class="cm-card"><h4>SAFEHOUSE GARAGE · UPGRADES<em>${turf.discount() > 0 ? `TURF DISCOUNT −${Math.round(turf.discount() * 100)}%` : 'APPLY TO EVERY CAR'}</em></h4><ul class="cm-list">${rows}</ul></div>
      ${paintShop()}
      <div class="cm-card"><h4>COLLECTION<em>${progression.state.stored.length} / ${COLLECTION.length}</em></h4><div class="cm-cars">${cars}</div>
      <div class="cm-rank-next" style="margin-top:8px">Drive a stolen car into the Safehouse Garage (G on the map) to store it · +$1,200 per new model.</div></div>`;
  }

  function statsDetail() {
    const p = combat.player;
    const st = progression.state.stats;
    const rows = [
      ['Cash', money(p.cash)], ['Respect', `${p.respect} RP`], ['Story', `${missions.progress} / ${MISSIONS.length}`],
      ['Peak heat', `★ ${Math.max(police.peak, police.wanted)}`], ['Cars stolen', st.stolen], ['Stunt jumps', st.stunts],
      ['Side activities', st.activities], ['Best streak', `x${(1 + Math.min(4, activities.state.bestStreak ?? 0) * 0.25).toFixed(2)}`], ['Heat evaded', st.evaded], ['Takedowns', st.takedowns],
      ['Lamps flattened', st.lamps ?? 0], ['Cars stored', progression.state.stored.length],
      ['Turf payouts', money(turf.state.earned)], ['Crew rounds', `${crew.state.hits} / ${crew.state.shots} hit`],
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const ladder = RANKS.map((r, i) => `<li><span class="st ${p.respect >= r.respect ? 'done' : 'locked'}">${i + 1}</span><span class="nm">${r.name.toUpperCase()}<small>${i ? `+${money(r.cash)} · ${r.perk}` : r.perk}</small></span><span class="rw">${r.respect} RP</span></li>`).join('');
    return `${rankCard()}<div class="cm-card"><h4>CAREER</h4><div class="cm-stats">${rows}</div></div><div class="cm-card"><h4>STREET RANKS<em>MILESTONE REWARDS</em></h4><ul class="cm-list">${ladder}</ul></div>`;
  }

  /** The header pill: active manual slot, last autosave time and the slot count. */
  function savePill() {
    const pill = document.getElementById('cmSave');
    if (!pill || !saves) return;
    const { list, active, time } = saves();
    const auto = list.find((s) => s.slot === 'auto');
    const used = list.filter((s) => s.slot !== 'auto' && s.exists).length;
    const status = auto?.exists ? `AUTO-SAVED ${time(auto.savedAt).split(' ').pop()}` : 'NOT SAVED YET';
    pill.querySelector('b').textContent = `SLOT ${active} · ${status}`;
    pill.querySelector('span').textContent = `3 SAVE SLOTS · ${used} USED`;
    pill.classList.toggle('on', tab === 'saves');
  }

  /** SAVES tab: the autosave and the three named slots, each saveable and loadable here. */
  function savesDetail() {
    const { list, active, time } = saves();
    const rows = list.map((s) => {
      const manual = s.slot !== 'auto';
      const meta = s.exists
        ? `<small>${s.district} · ${s.progress}/${s.total} jobs${s.storyComplete ? ' · complete' : ''} · ${money(s.cash)}${s.crew.length ? ` · crew ${s.crew.map((id) => id[0].toUpperCase() + id.slice(1)).join(' & ')}` : ''}</small><small>${time(s.savedAt)}</small>`
        : `<small>${manual ? 'Empty · save here to keep this run' : 'Written on every new game, finished job and garage restyle'}</small>`;
      const mark = manual ? s.slot : 'A';
      const tag = manual && s.slot === active ? '<i class="cm-pb">ACTIVE</i>' : '';
      const buttons = `${manual ? `<button data-action="saveSlot" data-slot="${s.slot}">${s.exists ? 'OVERWRITE' : 'SAVE'}</button>` : ''}<button data-action="loadSlot" data-slot="${s.slot}" ${s.exists ? '' : 'disabled'}>LOAD</button>`;
      return `<li><span class="st ${s.exists ? 'done' : 'locked'}">${mark}</span><span class="nm">${s.label}${tag}${s.exists ? `<small class="cm-slot-name">${s.name}</small>` : ''}${meta}</span><span class="cm-slot-btns">${buttons}</span></li>`;
    }).join('');
    return `<div class="cm-card"><h4>SAVE SLOTS<em>3 SLOTS + AUTOSAVE · LOCALSTORAGE</em></h4><ul class="cm-list cm-saves">${rows}</ul></div>
      <div class="cm-card"><div class="cm-rank-next">Saves stay in this browser. Esc also pauses to save, load or delete, and the title screen's LOAD GAME lists every slot.</div></div>`;
  }

  function renderSide() {
    if (tab === 'saves' && saves) {
      side.innerHTML = savesDetail();
    } else if (tab === 'story') {
      side.innerHTML = `<div class="cm-card"><h4>THE SOLARIS BAY JOB<em>${missions.progress} / ${MISSIONS.length} JOBS</em></h4><ul class="cm-list cm-scroll">${storyRows(true)}</ul></div>`;
    } else if (tab === 'crew') {
      side.innerHTML = `${crewCard(true)}${turfDetail()}`;
    } else if (tab === 'activities') {
      side.innerHTML = `<div class="cm-card"><h4>SIDE ACTIVITIES${streakBadge()}</h4><ul class="cm-list">${activityRows(true)}</ul></div>`;
    } else if (tab === 'garage') {
      side.innerHTML = garageDetail();
    } else if (tab === 'stats') {
      side.innerHTML = statsDetail();
    } else {
      side.innerHTML = `${rankCard(true)}
        <div class="cm-card"><h4>STORY<em>${missions.progress} / ${MISSIONS.length} JOBS · 5 DISTRICTS</em></h4><ul class="cm-list cm-compact">${storyRows(false)}</ul></div>
        ${crewCard(false)}
        <div class="cm-card"><h4>ACTIVITIES${streakBadge()}</h4><ul class="cm-list cm-compact">${activityRows(false)}</ul></div>
        <div class="cm-card cm-tight"><h4>GARAGE<em>${progression.state.stored.length} / ${COLLECTION.length} CARS · ${(PAINTS.find((p) => p.id === progression.state.paint)?.name ?? 'Factory').toUpperCase()} · ${(NEONS.find((n) => n.id === progression.state.neon)?.name ?? 'Off').toUpperCase()} NEON</em></h4>${garageSummary(true)}</div>`;
    }
    [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (turfBox) {
      turfBox.classList.toggle('hidden', tab === 'crew');
      turfBox.innerHTML = turfBars(false);
    }
    savePill();
  }

  /** Redraw the map and the side panel from the live state. */
  function render(state) {
    if (!open) return;
    painter.drawCityMap(canvas, { ...state, turf: turf.state.standing });
    renderSide();
    const cash = document.getElementById('cmCash');
    if (cash) cash.textContent = money(combat.player.cash);
    const sub = document.getElementById('cmSub');
    if (sub && state.subtitle) sub.textContent = state.subtitle;
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
