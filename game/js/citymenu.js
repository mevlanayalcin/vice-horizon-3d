// citymenu.js — the in-game city menu (M / Tab): a full vector map of Solaris Bay with
// every blip, beside tabs for the story arc, side activities (medals, personal bests and
// the live streak multiplier), the Safehouse Garage (upgrades bought with cash, the Paint
// Shop and neon underglow selectors, the stolen-car collection) and lifetime stats with
// the rank ladder's milestone rewards. Opening it pauses the city; buttons route through
// the HUD's data-action handler to main.js.

import { MISSIONS } from './missions.js';
import { ACTIVITIES, STUNT_GOAL, medalFor } from './activities.js';
import { COLLECTION, NEONS, PAINTS, RANKS, UPGRADES, rankFor } from './progression.js';
import { VEHICLES } from './config.js';

const money = (n) => `$${Number(Math.round(n)).toLocaleString('en-US')}`;
const hexCss = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

export function createCityMenu({ painter, missions, activities, progression, combat, police }) {
  const root = document.getElementById('cityMenu');
  const canvas = document.getElementById('cityMapCanvas');
  const side = document.getElementById('cmSide');
  const tabs = document.getElementById('cmTabs');
  let tab = 'map';
  let open = false;

  function rankCard() {
    const p = combat.player;
    const rank = rankFor(p.respect);
    const next = rank.next ? `${rank.next.respect - p.respect} RP to ${rank.next.name}` : 'Top of the city';
    return `<div class="cm-card"><div class="cm-rank"><div class="cm-rank-badge">${rank.index + 1}</div>
      <div style="flex:1"><div class="cm-rank-name">${rank.name.toUpperCase()}</div><div class="cm-rank-next">${p.respect} RESPECT · ${next}</div>
      <div class="cm-meter"><span style="width:${Math.round(rank.progress * 100)}%"></span></div></div></div></div>`;
  }

  function storyRows(detail) {
    const s = missions.state;
    return MISSIONS.map((m, i) => {
      const done = s.done[i];
      const active = s.active && s.index === i;
      const cls = done ? 'done' : active ? 'active' : 'locked';
      const mark = done ? '✓' : active ? '▶' : m.code.slice(-1);
      const sub = detail ? m.brief : `${m.giver} · ${active ? missions.objectiveText() : done ? 'Complete' : 'Locked'}`;
      return `<li><span class="st ${cls}">${mark}</span><span class="nm">${m.code} · ${m.name.toUpperCase()}<small>${sub}</small></span><span class="rw">${money(m.reward)}</span></li>`;
    }).join('');
  }

  function activityRows(detail) {
    const st = activities.state;
    const rows = ACTIVITIES.map((a) => {
      const best = st.best[a.id];
      const runs = st.completed[a.id] ?? 0;
      const medal = medalFor(a, best);
      const badge = medal ? `<i class="cm-medal ${medal.id}">${medal.name}</i>` : '';
      const pb = best ? `<i class="cm-pb">PB ${best}s</i>` : '';
      const sub = detail ? `${a.blurb}<br>Par ${a.time}s · gold ≤ ${Math.floor(a.time * 0.72)}s` : best ? `${runs} clear${runs === 1 ? '' : 's'}` : `Beat ${a.time}s`;
      return `<li><span class="st ${runs ? 'done' : 'act'}">${a.kind === 'race' ? 'R' : a.kind === 'fare' ? 'T' : 'C'}</span><span class="nm">${a.name.toUpperCase()}${badge}${pb}<small>${sub}</small></span><span class="rw">${money(a.reward)}</span></li>`;
    });
    const stunts = progression.state.stats.stunts ?? 0;
    rows.push(`<li><span class="st ${stunts >= STUNT_GOAL ? 'done' : 'act'}">S</span><span class="nm">STUNT RAMPS<small>${Math.min(stunts, STUNT_GOAL)} / ${STUNT_GOAL} jumps landed · +$150 each</small></span><span class="rw">${money(STUNT_GOAL * 150)}</span></li>`);
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

  function garageSummary() {
    const u = progression.state.upgrades;
    const pips = (n) => `<span class="cm-pips">${[0, 1, 2].map((i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
    const cars = COLLECTION.map((id) => `<span class="${progression.state.stored.includes(id) ? 'on' : ''}">${VEHICLES[id].name.toUpperCase()}</span>`).join('');
    return `<div class="cm-upgrades">${UPGRADES.map((up) => `<span>${up.name.split(' ').pop().toUpperCase()}${pips(u[up.id])}</span>`).join('')}</div>
      <div class="cm-cars" style="margin-top:6px">${cars}</div>`;
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
    return `<div class="cm-card"><h4>SAFEHOUSE GARAGE · UPGRADES<em>APPLY TO EVERY CAR</em></h4><ul class="cm-list">${rows}</ul></div>
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
    ].map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const ladder = RANKS.map((r, i) => `<li><span class="st ${p.respect >= r.respect ? 'done' : 'locked'}">${i + 1}</span><span class="nm">${r.name.toUpperCase()}<small>${i ? `+${money(r.cash)} · ${r.perk}` : r.perk}</small></span><span class="rw">${r.respect} RP</span></li>`).join('');
    return `${rankCard()}<div class="cm-card"><h4>CAREER</h4><div class="cm-stats">${rows}</div></div><div class="cm-card"><h4>STREET RANKS<em>MILESTONE REWARDS</em></h4><ul class="cm-list">${ladder}</ul></div>`;
  }

  function renderSide() {
    if (tab === 'story') {
      side.innerHTML = `<div class="cm-card"><h4>THE SOLARIS BAY JOB<em>${missions.progress} / ${MISSIONS.length}</em></h4><ul class="cm-list">${storyRows(true)}</ul></div>`;
    } else if (tab === 'activities') {
      side.innerHTML = `<div class="cm-card"><h4>SIDE ACTIVITIES${streakBadge()}</h4><ul class="cm-list">${activityRows(true)}</ul></div>`;
    } else if (tab === 'garage') {
      side.innerHTML = garageDetail();
    } else if (tab === 'stats') {
      side.innerHTML = statsDetail();
    } else {
      side.innerHTML = `${rankCard()}
        <div class="cm-card"><h4>STORY<em>${missions.progress} / ${MISSIONS.length} JOBS</em></h4><ul class="cm-list">${storyRows(false)}</ul></div>
        <div class="cm-card"><h4>ACTIVITIES${streakBadge()}</h4><ul class="cm-list">${activityRows(false)}</ul></div>
        <div class="cm-card"><h4>GARAGE<em>${progression.state.stored.length} / ${COLLECTION.length} CARS · ${(PAINTS.find((p) => p.id === progression.state.paint)?.name ?? 'Factory').toUpperCase()} · ${(NEONS.find((n) => n.id === progression.state.neon)?.name ?? 'Off').toUpperCase()} GLOW</em></h4>${garageSummary()}</div>`;
    }
    [...tabs.children].forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  }

  /** Redraw the map and the side panel from the live state. */
  function render(state) {
    if (!open) return;
    painter.drawCityMap(canvas, state);
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
