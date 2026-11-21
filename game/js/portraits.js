// portraits.js — the crew's faces, drawn as small inline SVG busts (no image files): Elena
// Vega with her comms headset and coral streak, Mateo Cruz in his watch cap and plate
// carrier, Nico Vega the Safehouse mechanic in a backwards cap with goggles, and an SBPD
// dispatcher for police radio traffic. The dialogue box, the Z / X / C ability cards, the
// city menu's crew tiles and the title screen's save cards all use them. Each call gets its
// own gradient ids, so a portrait still paints when another copy of it is hidden.

let serial = 0;

const FACES = {
  elena: {
    bg: ['#ff8a7a', '#5a1d4a'], skin: '#c98b66', shade: '#a86d4e', top: '#ff6f91',
    hair: (u) => `<path d="M14 34c-2-15 7-24 18-24s20 9 18 24c0 9 2 15 5 20H10c3-5 4-11 4-20z" fill="#2a1416"/>
      <path d="M20 22c4-6 16-8 24-1-6-2-14-2-24 1z" fill="#4a2228"/>
      <path d="M44 16c4 5 6 14 4 26-1-8-3-16-7-22z" fill="#ff4f8a" opacity=".85"/>`,
    front: (u) => `<path d="M19 27c3-8 22-9 26 0-7-4-18-4-26 0z" fill="#2a1416"/>`,
    extra: (u) => `<path d="M13 32a19 19 0 0 1 38 0" fill="none" stroke="#1b1f27" stroke-width="2.4"/>
      <rect x="10" y="29" width="5" height="9" rx="2" fill="#1b1f27"/><path d="M13 37c1 6 6 8 11 8" fill="none" stroke="#1b1f27" stroke-width="1.6"/>
      <circle cx="24.5" cy="45" r="1.6" fill="#55ebff"/><circle cx="46" cy="40" r="1.3" fill="#ffc24b"/>`,
  },
  mateo: {
    bg: ['#ffc24b', '#3a2a12'], skin: '#a8714b', shade: '#8a5a39', top: '#4d5a3c',
    hair: () => '',
    front: () => `<path d="M17 26c1-11 9-15 15-15s14 4 15 15c-9-3-21-3-30 0z" fill="#22252b"/>
      <rect x="16" y="23" width="32" height="5" rx="2" fill="#30343c"/>`,
    extra: () => `<path d="M22 40c2 6 6 8 10 8s8-2 10-8c-2 2-6 3-10 3s-8-1-10-3z" fill="#2a1e17" opacity=".75"/>
      <path d="M12 64v-6c0-4 4-6 9-7l3 13zM52 64v-6c0-4-4-6-9-7l-3 13z" fill="#2b2f36"/>
      <rect x="40" y="56" width="6" height="3" fill="#ffc24b"/>`,
  },
  nico: {
    bg: ['#55ebff', '#123a4a'], skin: '#b98260', shade: '#9a6646', top: '#1f6f86',
    hair: () => '<path d="M17 30c-1-6 1-11 4-13l1 13z" fill="#1d1612"/><path d="M47 30c1-6-1-11-4-13l-1 13z" fill="#1d1612"/>',
    front: () => `<path d="M16 25c2-10 9-13 16-13s14 3 16 13z" fill="#18a9c4"/>
      <path d="M14 25h36v3H14z" fill="#0f6e82"/><path d="M41 18c5 0 9 2 10 6l-8 1z" fill="#0f6e82"/>
      <rect x="19" y="21" width="26" height="5" rx="2.5" fill="#1b1f27"/>
      <circle cx="26" cy="23.5" r="2.4" fill="#ffc24b" opacity=".9"/><circle cx="38" cy="23.5" r="2.4" fill="#ffc24b" opacity=".9"/>`,
    extra: () => `<path d="M37 41c2 1 4 1 5 0" stroke="#3a2a22" stroke-width="1.2" fill="none"/>
      <path d="M20 37c2 0 3 1 3 2" stroke="#2c2c2c" stroke-width="1.4" opacity=".55" fill="none"/>
      <path d="M22 64l2-12h16l2 12z" fill="#ffb257" opacity=".9"/>`,
  },
  dispatch: {
    bg: ['#ff4c5f', '#1b2a52'], skin: '#d09a74', shade: '#ad7a57', top: '#1c2c55',
    hair: () => '<path d="M17 32c-1-13 6-21 15-21s16 8 15 21c-2-7-7-11-15-11s-13 4-15 11z" fill="#3b2a1e"/>',
    front: () => '',
    extra: () => `<path d="M14 32a18 18 0 0 1 36 0" fill="none" stroke="#11151d" stroke-width="2.4"/>
      <rect x="11" y="29" width="5" height="8" rx="2" fill="#11151d"/><rect x="48" y="29" width="5" height="8" rx="2" fill="#11151d"/>
      <path d="M27 57h10l-5 5z" fill="#ffc24b"/>`,
  },
};

/** An inline SVG bust for `who` (elena, mateo, nico, dispatch; any other name falls back by its first letter). */
export function portraitSvg(who = 'elena') {
  const key = String(who).toLowerCase().split(/[\s·]/)[0];
  const f = FACES[key] ?? (key.startsWith('m') ? FACES.mateo : key.startsWith('n') ? FACES.nico : key.startsWith('s') ? FACES.dispatch : FACES.elena);
  const u = `pt${(serial += 1)}`;
  return `<svg class="portrait" viewBox="0 0 64 64" aria-hidden="true">
<defs><radialGradient id="${u}b" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="${f.bg[0]}"/><stop offset="1" stop-color="${f.bg[1]}"/></radialGradient>
<linearGradient id="${u}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${f.skin}"/><stop offset="1" stop-color="${f.shade}"/></linearGradient></defs>
<rect width="64" height="64" fill="url(#${u}b)"/>
<path d="M0 64c4-24 60-24 64 0" fill="${f.bg[1]}" opacity=".5"/>
${f.hair(u)}
<path d="M10 64c1-9 9-13 22-13s21 4 22 13z" fill="${f.top}"/>
<path d="M27 44h10v9c-3 2-7 2-10 0z" fill="${f.shade}"/>
<ellipse cx="32" cy="33" rx="12" ry="14" fill="url(#${u}s)"/>
<ellipse cx="20.5" cy="34" rx="2" ry="3" fill="${f.shade}"/><ellipse cx="43.5" cy="34" rx="2" ry="3" fill="${f.shade}"/>
<path d="M25 31.5h5M34 31.5h5" stroke="#1a1210" stroke-width="1.6" stroke-linecap="round"/>
<circle cx="27.5" cy="34" r="1.3" fill="#1a1210"/><circle cx="36.5" cy="34" r="1.3" fill="#1a1210"/>
<path d="M32 35v5l-2 1" fill="none" stroke="${f.shade}" stroke-width="1.2"/>
<path d="M28.5 43c2 1 5 1 7 0" fill="none" stroke="#6e3a2e" stroke-width="1.4" stroke-linecap="round"/>
${f.front(u)}
${f.extra(u)}
</svg>`;
}
