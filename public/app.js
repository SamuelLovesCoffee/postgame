// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let moves = [];
let coaching = {};
let currentPly = 0;
let flipped = false;
let showBest = false;
let playerColor = 'w';

// Piece images
const PIECE_CDN = 'https://lichess1.org/assets/piece/cburnett/';
const pieceCache = {};
let usePieceImg = true;

// Preload pieces
(async () => {
  const keys = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];
  const results = await Promise.allSettled(keys.map(k => new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => { pieceCache[k] = img.src; ok(); };
    img.onerror = no;
    img.src = PIECE_CDN + k + '.svg';
  })));
  if (results.filter(r => r.status === 'rejected').length > 3) usePieceImg = false;
})();

// ═══════════════════════════════════════
// API
// ═══════════════════════════════════════
async function startAnalysis() {
  const pgn = document.getElementById('pgnInput').value.trim();
  if (!pgn) { showError('Please paste a PGN.'); return; }

  playerColor = document.getElementById('playerColor').value;
  flipped = playerColor === 'b';

  const btn = document.getElementById('analyseBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  // Show loading
  document.getElementById('inputView').style.display = 'none';
  document.getElementById('loadingView').style.display = 'flex';

  try {
    const response = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn, playerColor }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Analysis failed');
    }

    const data = await response.json();
    moves = data.analysis.moves;
    coaching = data.coaching;

    renderCoaching(data.analysis, data.coaching);
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('analysisView').style.display = 'block';
    goToMove(0);
  } catch (err) {
    console.error('Analysis error:', err);
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('inputView').style.display = 'block';
    showError(err.message);
  }

  btn.classList.remove('loading');
  btn.disabled = false;
}

// ═══════════════════════════════════════
// BOARD RENDERING
// ═══════════════════════════════════════
function parseFEN(fen) {
  const board = [];
  for (const rank of fen.split(' ')[0].split('/')) {
    const row = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) row.push(null);
      else row.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
    }
    board.push(row);
  }
  return board;
}

function renderBoard(fen, fromSq, toSq) {
  const board = parseFEN(fen);
  const el = document.getElementById('board');
  el.innerHTML = '';

  for (let vr = 0; vr < 8; vr++) {
    for (let vf = 0; vf < 8; vf++) {
      const r = flipped ? 7 - vr : vr;
      const f = flipped ? 7 - vf : vf;
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r + f) % 2 === 0 ? 'l' : 'd');
      const name = String.fromCharCode(97 + f) + (8 - r);
      if (name === fromSq || name === toSq) sq.classList.add('hl');
      if (board[r][f]) {
        const piece = board[r][f];
        if (usePieceImg && pieceCache[piece]) {
          const img = document.createElement('img');
          img.src = pieceCache[piece];
          img.draggable = false;
          sq.appendChild(img);
        }
      }
      el.appendChild(sq);
    }
  }
}

// ═══════════════════════════════════════
// EVAL BAR
// ═══════════════════════════════════════
function cpToWinPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function updateEval(m) {
  // Get eval from White's perspective
  let cp, mate;
  if (!m) { cp = 0; mate = null; }
  else {
    cp = m.cpAfter || 0;
    mate = m.eval_mate;
    // cpAfter is from side-to-move perspective. Convert.
    // If ply is odd (white just moved, black to move), negate
    if (m.ply % 2 === 1) cp = -cp;
  }

  const wpct = mate != null ? (mate > 0 ? 97 : 3) : Math.max(3, Math.min(97, cpToWinPct(cp)));
  document.getElementById('evalBarWhite').style.height = wpct + '%';
  document.getElementById('evalBarBlack').style.height = (100 - wpct) + '%';

  const str = m ? m.evalAfterWhitePersp : '+0.00';
  document.getElementById('evalDisplay').textContent = str;

  const top = document.getElementById('evalLabelTop');
  const bot = document.getElementById('evalLabelBot');
  if (str.startsWith('+') || str.startsWith('0')) {
    bot.textContent = str.replace('+', '');
    top.textContent = '';
  } else {
    top.textContent = str.replace('-', '');
    bot.textContent = '';
  }
}

// ═══════════════════════════════════════
// ARROWS
// ═══════════════════════════════════════
function drawArrow(uci) {
  const svg = document.getElementById('arrowSvg');
  while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);
  if (!uci || uci.length < 4 || !showBest) return;

  const sqPct = 100 / 8;
  const ff = uci.charCodeAt(0) - 97, fr = 8 - parseInt(uci[1]);
  const tf = uci.charCodeAt(2) - 97, tr = 8 - parseInt(uci[3]);

  const fv = flipped ? { f: 7 - ff, r: 7 - fr } : { f: ff, r: fr };
  const tv = flipped ? { f: 7 - tf, r: 7 - tr } : { f: tf, r: tr };

  const x1 = fv.f * sqPct + sqPct / 2, y1 = fv.r * sqPct + sqPct / 2;
  const x2 = tv.f * sqPct + sqPct / 2, y2 = tv.r * sqPct + sqPct / 2;

  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1 + (dx / len) * 2); line.setAttribute('y1', y1 + (dy / len) * 2);
  line.setAttribute('x2', x2 - (dx / len) * 3); line.setAttribute('y2', y2 - (dy / len) * 3);
  line.setAttribute('stroke', 'rgba(22,163,74,0.7)');
  line.setAttribute('stroke-width', '2.8');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('marker-end', 'url(#ah)');
  svg.appendChild(line);
}

function toggleBest() {
  showBest = !showBest;
  document.getElementById('bestToggle').classList.toggle('active', showBest);
  goToMove(currentPly);
}

// ═══════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════
function goToMove(ply) {
  ply = Math.max(0, Math.min(ply, moves.length));
  currentPly = ply;

  if (ply === 0) {
    renderBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', null, null);
    updateEval(null);
    drawArrow(moves.length > 0 ? moves[0].bestMove : null);
  } else {
    const m = moves[ply - 1];
    renderBoard(m.fen, m.from, m.to);
    updateEval(m);
    // Best move is from position before this move
    drawArrow(m.bestMove);
  }

  // Highlight active chip
  document.querySelectorAll('.move-chip').forEach(el => el.classList.remove('active'));
  const activeChip = document.querySelector(`.move-chip[data-ply="${ply}"]`);
  if (activeChip) {
    activeChip.classList.add('active');
    activeChip.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // Highlight active critical card
  document.querySelectorAll('.critical-card').forEach(el => el.classList.remove('active'));
  const activeCard = document.querySelector(`.critical-card[data-ply="${ply}"]`);
  if (activeCard) activeCard.classList.add('active');
}

// ═══════════════════════════════════════
// COACHING NARRATIVE RENDERER
// ═══════════════════════════════════════
function renderCoaching(analysis, coach) {
  const col = document.getElementById('coachCol');
  col.innerHTML = '';

  // 1. Summary card
  const summaryCard = document.createElement('div');
  summaryCard.className = 'coach-summary';
  summaryCard.innerHTML = `
    <h2>${analysis.headers.White || '?'} vs ${analysis.headers.Black || '?'}</h2>
    <div class="summary-text">${coach.summary || ''}</div>
    ${analysis.openingName ? `<span class="opening-tag">${analysis.openingName}</span>` : ''}
    ${coach.opening ? `<div class="summary-text" style="margin-top:8px">${coach.opening}</div>` : ''}
  `;
  col.appendChild(summaryCard);

  // 2. Build the coaching timeline
  // Map critical moments by ply for quick lookup
  const critByPly = {};
  (coach.criticalMoments || []).forEach(cm => { critByPly[cm.ply] = cm; });

  // Group moves into segments
  const segments = coach.segments || [];
  if (segments.length === 0) {
    // Fallback: one segment for the whole game
    segments.push({ startPly: 1, endPly: analysis.moves.length, title: 'Game', narrative: '' });
  }

  for (const seg of segments) {
    const segEl = document.createElement('div');
    segEl.className = 'segment';

    // Segment header
    const header = document.createElement('div');
    header.className = 'segment-header';
    header.textContent = seg.title || 'Continuation';
    segEl.appendChild(header);

    // Segment narrative
    if (seg.narrative) {
      const narr = document.createElement('div');
      narr.className = 'segment-narrative';
      narr.textContent = seg.narrative;
      segEl.appendChild(narr);
    }

    // Move chips for this segment
    const moveGroup = document.createElement('div');
    moveGroup.className = 'move-group';

    const startPly = seg.startPly || 1;
    const endPly = Math.min(seg.endPly || analysis.moves.length, analysis.moves.length);

    for (let i = startPly - 1; i < endPly; i++) {
      const m = analysis.moves[i];
      if (!m) continue;

      const chip = document.createElement('span');
      chip.className = 'move-chip';
      chip.dataset.ply = m.ply;
      if (m.isBook) chip.classList.add('book');

      const numStr = m.color === 'w' ? `<span class="num">${m.moveNumber}.</span>` : '';
      chip.innerHTML = numStr + m.san;
      chip.onclick = () => goToMove(m.ply);
      moveGroup.appendChild(chip);

      // Insert critical moment card after the move it references
      if (critByPly[m.ply]) {
        // Close current move group, insert card, start new group
        segEl.appendChild(moveGroup.cloneNode(true));
        moveGroup.innerHTML = '';

        const cm = critByPly[m.ply];
        segEl.appendChild(makeCriticalCard(cm, m));

        // Re-attach onclick handlers (cloneNode doesn't copy them)
        const lastGroup = segEl.querySelector('.move-group:last-of-type');
        if (lastGroup) {
          lastGroup.querySelectorAll('.move-chip').forEach(chip => {
            chip.onclick = () => goToMove(parseInt(chip.dataset.ply));
          });
        }
      }
    }

    // Append remaining move chips
    if (moveGroup.children.length > 0) {
      segEl.appendChild(moveGroup);
      moveGroup.querySelectorAll('.move-chip').forEach(chip => {
        chip.onclick = () => goToMove(parseInt(chip.dataset.ply));
      });
    }

    col.appendChild(segEl);
  }

  // 3. Takeaways card
  const takeaways = document.createElement('div');
  takeaways.className = 'takeaways';

  let takeawayHTML = '<h3>Takeaways</h3>';

  if (coach.strengths && coach.strengths.length) {
    takeawayHTML += `<div class="takeaway-section"><h4>Strengths</h4><ul class="takeaway-list strengths">${coach.strengths.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
  }
  if (coach.improvementAreas && coach.improvementAreas.length) {
    takeawayHTML += `<div class="takeaway-section"><h4>Areas to improve</h4><ul class="takeaway-list areas">${coach.improvementAreas.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
  }
  if (coach.studyRecommendation) {
    takeawayHTML += `<div class="takeaway-section"><h4>What to study</h4><div class="study-rec">${coach.studyRecommendation}</div></div>`;
  }

  takeaways.innerHTML = takeawayHTML;
  col.appendChild(takeaways);
}

function makeCriticalCard(cm, moveData) {
  const card = document.createElement('div');
  const type = cm.type || 'mistake';
  card.className = `critical-card type-${type}`;
  card.dataset.ply = cm.ply;
  card.onclick = () => goToMove(cm.ply);

  const badgeClass = ['blunder', 'mistake', 'inaccuracy'].includes(type) ? type : 'mistake';

  card.innerHTML = `
    <div class="cc-header">
      <span class="cc-badge ${badgeClass}">${type}</span>
      <span class="cc-move">${cm.moveLabel || ''}</span>
    </div>
    <div class="cc-title">${cm.title || ''}</div>
    <div class="cc-explanation">${cm.explanation || ''}</div>
    ${cm.concept ? `<span class="cc-concept">${cm.concept}</span>` : ''}
    ${cm.studyTip ? `<div class="cc-tip">💡 ${cm.studyTip}</div>` : ''}
  `;
  return card;
}

// ═══════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg;
  el.style.display = 'inline';
  setTimeout(() => { el.style.display = 'none'; }, 6000);
}

function showInput() {
  document.getElementById('inputView').style.display = 'flex';
  document.getElementById('analysisView').style.display = 'none';
  showBest = false;
  document.getElementById('bestToggle').classList.remove('active');
}

function loadSample() {
  document.getElementById('pgnInput').value = `[Event "Casual Game"]
[Site "Internet"]
[Date "2025.01.15"]
[White "Alice"]
[Black "Bob"]
[Result "0-1"]
[ECO "B01"]

1. e4 d5 2. exd5 Nf6 3. c4 c6 4. dxc6 Nxc6 5. Nf3 e5 6. Nc3 Bc5 7. Be2 O-O
8. O-O e4 9. Ne1 Bf5 10. Nd5 Qa5 11. a3 Rad8 12. b4 Nxb4 13. axb4 Bxb4
14. Bb2 Bc3 15. Bxc3 Qxc3 16. Nf4 Rd2 17. Nfg6 hxg6 18. Nxg6 fxg6
19. Qb3 e3 20. fxe3 Qxe3+ 21. Kh1 Ng4 22. Bxg4 Bxg4 23. Rxf8+ Kxf8
24. Qb4+ Kf7 25. Qb3 Be2 26. Rg1 Qf2 0-1`;
  document.getElementById('playerColor').value = 'b';
}

// Keyboard navigation
document.addEventListener('keydown', e => {
  if (document.getElementById('analysisView').style.display === 'none') return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); goToMove(currentPly - 1); }
  if (e.key === 'ArrowRight') { e.preventDefault(); goToMove(currentPly + 1); }
  if (e.key === 'Home') { e.preventDefault(); goToMove(0); }
  if (e.key === 'End') { e.preventDefault(); goToMove(moves.length); }
});
