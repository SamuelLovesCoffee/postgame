// server/shareCard.js
// Renders a 1200x630 PNG share card from an analysis summary.
// HTML -> Satori (SVG, text baked to vector paths) -> resvg (PNG). No headless browser:
// low memory, ~tens of ms, which matters on Railway. CommonJS module that lazy-imports
// the ESM-only deps so it drops into our CJS app with no module-system conversion.
const fs = require('fs');
const path = require('path');

const WIDTH = 1200, HEIGHT = 630;
// Brand tokens, mirrored from public/styles.css :root
const C = { bg:'#09080d', accent:'#e94560', text:'#e8e8ed', text2:'#a0a0ae', border:'#2e2e38' };

let _fonts = null;
function loadFonts() {
  if (_fonts) return _fonts;
  // Geist (the site typeface) is read from the installed @fontsource package — nothing
  // binary committed. Satori reads .woff fine (not .woff2).
  const dir = path.join(require.resolve('@fontsource/geist-sans/package.json'), '..', 'files');
  const read = f => fs.readFileSync(path.join(dir, f));
  _fonts = [
    { name:'Geist', weight:400, style:'normal', data: read('geist-sans-latin-400-normal.woff') },
    { name:'Geist', weight:600, style:'normal', data: read('geist-sans-latin-600-normal.woff') },
    { name:'Geist', weight:700, style:'normal', data: read('geist-sans-latin-700-normal.woff') },
  ];
  return _fonts;
}

// satori-html does NOT decode HTML entities, so DO NOT escape. Strip only angle brackets
// so stray <> can't be misparsed as tags; leave ' & — accents as literal characters.
function sanitize(s){ return String(s || '').replace(/[<>]/g, '').trim(); }

// Size the hero by length so even a ~260-char summary wraps without clipping.
function heroSize(len){ return len <= 90 ? 52 : len <= 150 ? 46 : len <= 210 ? 40 : 35; }

function template({ summary, eyebrow }){
  const s = sanitize(summary) || 'Your game, reviewed move by move.';
  const eye = (sanitize(eyebrow) || 'Game analysis').toUpperCase();
  const fz = heroSize(s.length);
  return `<div style="display:flex;flex-direction:column;justify-content:space-between;width:${WIDTH}px;height:${HEIGHT}px;background:${C.bg};padding:72px 80px;font-family:Geist">
    <div style="display:flex;font-size:22px;font-weight:600;letter-spacing:3px;color:${C.accent}">${eye}</div>
    <div style="display:flex;font-size:${fz}px;font-weight:600;line-height:1.28;letter-spacing:-0.5px;color:${C.text}">${s}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;border-top:1px solid ${C.border};padding-top:30px">
      <div style="display:flex;font-size:30px;font-weight:700;color:${C.text}">post<span style="color:${C.accent}">game</span></div>
      <div style="display:flex;font-size:22px;color:${C.text2}">www.post-game.net</div>
    </div>
  </div>`;
}

async function renderShareCard({ summary, eyebrow } = {}){
  const { default: satori } = await import('satori');
  const { html } = await import('satori-html');
  const { Resvg } = await import('@resvg/resvg-js');
  const markup = html(template({ summary, eyebrow }));
  const svg = await satori(markup, { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode:'width', value: WIDTH } }).render().asPng();
}

module.exports = { renderShareCard, sanitize };
