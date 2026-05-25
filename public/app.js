// ═══════════════════════════════════════
// STATE
// ═══════════════════════════════════════
let moves = [];
let coaching = {};
let analysisResult = null;
let currentPly = 0;
let flipped = false;
let showBest = false;
let playerColor = 'w';
let animating = false;

// Piece images
const PIECE_CDN = 'https://lichess1.org/assets/piece/cburnett/';
const pieceCache = {};
let usePieceImg = true;

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
// API — Job-based with polling
// ═══════════════════════════════════════
async function startAnalysis() {
  const pgn = document.getElementById('pgnInput').value.trim();
  if (!pgn) { showError('Please paste a PGN.'); return; }

  playerColor = document.getElementById('playerColor').value;
  flipped = playerColor === 'b';

  const btn = document.getElementById('analyseBtn');
  btn.classList.add('loading');
  btn.disabled = true;

  document.getElementById('inputView').style.display = 'none';
  const loadingView = document.getElementById('loadingView');
  loadingView.style.display = 'flex';
  document.getElementById('loadingFill').style.width = '0%';
  document.getElementById('loadingMsg').textContent = 'Submitting game...';
  document.getElementById('loadingTitle').textContent = 'Analysing your game...';

  try {
    // Submit job
    const submitRes = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pgn, playerColor }),
    });

    if (!submitRes.ok) {
      const err = await submitRes.json().catch(() => ({}));
      throw new Error(err.error || 'Submission failed');
    }

    const { jobId } = await submitRes.json();

    // Poll for progress
    let finalData = null;
    while (!finalData) {
      await new Promise(r => setTimeout(r, 1500));

      const pollRes = await fetch(`/api/job/${jobId}`);
      if (!pollRes.ok) throw new Error('Lost connection to analysis job');

      const job = await pollRes.json();

      if (job.status === 'running') {
        document.getElementById('loadingFill').style.width = job.progress + '%';
        document.getElementById('loadingMsg').textContent = job.message;
      } else if (job.status === 'error') {
        throw new Error(job.error);
      } else if (job.status === 'complete') {
        finalData = job;
      }
    }

    moves = finalData.analysis.moves;
    coaching = finalData.coaching;
    analysisResult = finalData;

    renderCoaching(finalData.analysis, finalData.coaching);
    loadingView.style.display = 'none';
    document.getElementById('analysisView').style.display = 'block';
    goToMove(0);
  } catch (err) {
    console.error('Analysis error:', err);
    loadingView.style.display = 'none';
    document.getElementById('inputView').style.display = 'block';
    showError(err.message);
  }

  btn.classList.remove('loading');
  btn.disabled = false;
}

// ═══════════════════════════════════════
// BOARD — with piece animation
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

function sqToVisual(file, rank) {
  return flipped ? { vr: 7 - rank, vf: 7 - file } : { vr: rank, vf: file };
}

function sqNameToCoords(sq) {
  return { f: sq.charCodeAt(0) - 97, r: 8 - parseInt(sq[1]) };
}

function mkPiece(code) {
  if (usePieceImg && pieceCache[code]) {
    const i = document.createElement('img');
    i.src = pieceCache[code]; i.draggable = false;
    return i;
  }
  return null;
}

function renderBoardStatic(fen, fromSq, toSq) {
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
        const piece = mkPiece(board[r][f]);
        if (piece) sq.appendChild(piece);
      }
      el.appendChild(sq);
    }
  }
}

function renderBoardAnimated(newFen, fromSq, toSq, direction) {
  if (animating || !fromSq || !toSq) {
    renderBoardStatic(newFen, fromSq, toSq);
    return;
  }

  const boardEl = document.getElementById('board');
  const boardRect = boardEl.getBoundingClientRect();
  const sqSize = boardRect.width / 8;
  const newBoard = parseFEN(newFen);

  const src = sqNameToCoords(direction === 'forward' ? fromSq : toSq);
  const dst = sqNameToCoords(direction === 'forward' ? toSq : fromSq);
  const movingPiece = newBoard[dst.r][dst.f];

  if (!movingPiece || !pieceCache[movingPiece]) {
    renderBoardStatic(newFen, fromSq, toSq);
    return;
  }

  // Render board without the moving piece at destination
  const temp = newBoard.map(r => [...r]);
  temp[dst.r][dst.f] = null;

  // Quick static render of the temp board
  boardEl.innerHTML = '';
  for (let vr = 0; vr < 8; vr++) {
    for (let vf = 0; vf < 8; vf++) {
      const r = flipped ? 7 - vr : vr;
      const f = flipped ? 7 - vf : vf;
      const sq = document.createElement('div');
      sq.className = 'sq ' + ((r + f) % 2 === 0 ? 'l' : 'd');
      const name = String.fromCharCode(97 + f) + (8 - r);
      if (name === fromSq || name === toSq) sq.classList.add('hl');
      if (temp[r][f]) {
        const piece = mkPiece(temp[r][f]);
        if (piece) sq.appendChild(piece);
      }
      boardEl.appendChild(sq);
    }
  }

  // Create animated piece
  animating = true;
  const srcV = sqToVisual(src.f, src.r);
  const dstV = sqToVisual(dst.f, dst.r);

  const anim = document.createElement('div');
  anim.style.cssText = `position:absolute;width:${sqSize}px;height:${sqSize}px;z-index:10;pointer-events:none;transition:left 0.18s ease-out,top 0.18s ease-out;left:${srcV.vf*sqSize}px;top:${srcV.vr*sqSize}px;`;
  const img = document.createElement('img');
  img.src = pieceCache[movingPiece];
  img.style.cssText = `width:85%;height:85%;object-fit:contain;margin:7.5%;filter:drop-shadow(1px 2px 2px rgba(0,0,0,0.3))`;
  anim.appendChild(img);

  boardEl.style.position = 'relative';
  boardEl.appendChild(anim);

  // Trigger animation
  requestAnimationFrame(() => {
    anim.style.left = (dstV.vf * sqSize) + 'px';
    anim.style.top = (dstV.vr * sqSize) + 'px';
  });

  const done = () => {
    anim.remove();
    renderBoardStatic(newFen, fromSq, toSq);
    animating = false;
  };
  anim.addEventListener('transitionend', done, { once: true });
  setTimeout(() => { if (animating) done(); }, 280);
}

// ═══════════════════════════════════════
// EVAL BAR
// ═══════════════════════════════════════
function cpToWinPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function updateEval(m) {
  let cp, mate;
  if (!m) { cp = 0; mate = null; }
  else {
    cp = m.cpAfter || 0;
    mate = m.eval_mate;
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
    bot.textContent = str.replace('+', ''); top.textContent = '';
  } else {
    top.textContent = str.replace('-', ''); bot.textContent = '';
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
  const dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy);

  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', x1 + (dx/len)*2); line.setAttribute('y1', y1 + (dy/len)*2);
  line.setAttribute('x2', x2 - (dx/len)*3); line.setAttribute('y2', y2 - (dy/len)*3);
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
// NAVIGATION — with animation
// ═══════════════════════════════════════
function goToMove(ply) {
  ply = Math.max(0, Math.min(ply, moves.length));
  const prev = currentPly;
  currentPly = ply;
  const isSingle = Math.abs(ply - prev) === 1;
  const dir = ply > prev ? 'forward' : 'backward';

  if (ply === 0) {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    if (isSingle && prev === 1) {
      renderBoardAnimated(startFen, moves[0].from, moves[0].to, 'backward');
    } else {
      renderBoardStatic(startFen, null, null);
    }
    updateEval(null);
    drawArrow(moves.length > 0 ? moves[0].bestMove : null);
  } else {
    const m = moves[ply - 1];
    if (isSingle) {
      renderBoardAnimated(m.fen, m.from, m.to, dir);
    } else {
      renderBoardStatic(m.fen, m.from, m.to);
    }
    updateEval(m);
    drawArrow(m.bestMove);
  }

  document.querySelectorAll('.move-chip').forEach(el => el.classList.remove('active'));
  const ac = document.querySelector(`.move-chip[data-ply="${ply}"]`);
  if (ac) { ac.classList.add('active'); ac.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }

  document.querySelectorAll('.critical-card').forEach(el => el.classList.remove('active'));
  const card = document.querySelector(`.critical-card[data-ply="${ply}"]`);
  if (card) card.classList.add('active');
}

// ═══════════════════════════════════════
// COACHING RENDERER
// ═══════════════════════════════════════
function renderCoaching(analysis, coach) {
  const col = document.getElementById('coachCol');
  col.innerHTML = '';

  // Summary
  const summary = document.createElement('div');
  summary.className = 'coach-summary';
  summary.innerHTML = `
    <h2>${analysis.headers.White || '?'} vs ${analysis.headers.Black || '?'}</h2>
    <div class="summary-text">${coach.summary || ''}</div>
    ${analysis.openingName ? `<span class="opening-tag">${analysis.openingName}</span>` : ''}
    ${coach.opening ? `<div class="summary-text" style="margin-top:8px">${coach.opening}</div>` : ''}
  `;
  col.appendChild(summary);

  // Map critical moments + missed ideas by ply
  const critByPly = {};
  (coach.criticalMoments || []).forEach(cm => { critByPly[cm.ply] = cm; });
  const missedByPly = {};
  (coach.missedIdeas || []).forEach(mi => { missedByPly[mi.ply] = mi; });

  // Segments
  const segments = coach.segments || [{ startPly: 1, endPly: analysis.moves.length, title: 'Game', narrative: '' }];

  for (const seg of segments) {
    const segEl = document.createElement('div');
    segEl.className = 'segment';

    const header = document.createElement('div');
    header.className = 'segment-header';
    header.textContent = seg.title || 'Continuation';
    segEl.appendChild(header);

    if (seg.narrative) {
      const narr = document.createElement('div');
      narr.className = 'segment-narrative';
      narr.textContent = seg.narrative;
      segEl.appendChild(narr);
    }

    const startPly = seg.startPly || 1;
    const endPly = Math.min(seg.endPly || analysis.moves.length, analysis.moves.length);

    let currentGroup = document.createElement('div');
    currentGroup.className = 'move-group';

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
      currentGroup.appendChild(chip);

      // Insert cards after the relevant move
      if (critByPly[m.ply] || missedByPly[m.ply]) {
        segEl.appendChild(currentGroup);
        currentGroup = document.createElement('div');
        currentGroup.className = 'move-group';

        if (critByPly[m.ply]) {
          segEl.appendChild(makeCriticalCard(critByPly[m.ply]));
        }
        if (missedByPly[m.ply]) {
          segEl.appendChild(makeMissedCard(missedByPly[m.ply]));
        }
      }
    }

    if (currentGroup.children.length > 0) segEl.appendChild(currentGroup);
    col.appendChild(segEl);
  }

  // Takeaways
  const takeaways = document.createElement('div');
  takeaways.className = 'takeaways';
  let html = '<h3>Takeaways</h3>';
  if (coach.strengths && coach.strengths.length) {
    html += `<div class="takeaway-section"><h4>Strengths</h4><ul class="takeaway-list strengths">${coach.strengths.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
  }
  if (coach.improvementAreas && coach.improvementAreas.length) {
    html += `<div class="takeaway-section"><h4>Areas to improve</h4><ul class="takeaway-list areas">${coach.improvementAreas.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
  }
  if (coach.studyRecommendation) {
    html += `<div class="takeaway-section"><h4>What to study</h4><div class="study-rec">${coach.studyRecommendation}</div></div>`;
  }
  takeaways.innerHTML = html;
  col.appendChild(takeaways);

  // Export button
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-btn';
  exportBtn.textContent = '📥 Export coaching report';
  exportBtn.onclick = exportReport;
  col.appendChild(exportBtn);
}

function makeCriticalCard(cm) {
  const card = document.createElement('div');
  const type = cm.type || 'mistake';
  card.className = `critical-card type-${type}`;
  card.dataset.ply = cm.ply;
  card.onclick = () => goToMove(cm.ply);
  const badgeClass = ['blunder','mistake','inaccuracy'].includes(type) ? type : 'mistake';
  card.innerHTML = `
    <div class="cc-header"><span class="cc-badge ${badgeClass}">${type}</span><span class="cc-move">${cm.moveLabel || ''}</span></div>
    <div class="cc-title">${cm.title || ''}</div>
    <div class="cc-explanation">${cm.explanation || ''}</div>
    ${cm.concept ? `<span class="cc-concept">${cm.concept}</span>` : ''}
    ${cm.studyTip ? `<div class="cc-tip">💡 ${cm.studyTip}</div>` : ''}
  `;
  return card;
}

function makeMissedCard(mi) {
  const card = document.createElement('div');
  card.className = 'critical-card type-idea';
  card.dataset.ply = mi.ply;
  card.onclick = () => goToMove(mi.ply);
  card.innerHTML = `
    <div class="cc-header"><span class="cc-badge idea">💡 idea</span><span class="cc-move">${mi.moveLabel || ''}</span></div>
    <div class="cc-title">${mi.title || ''}</div>
    <div class="cc-explanation">${mi.explanation || ''}</div>
    ${mi.engineLine ? `<div class="cc-tip">Engine line: ${mi.engineLine}</div>` : ''}
  `;
  return card;
}

// ═══════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════
function exportReport() {
  if (!coaching || !analysisResult) return;
  const a = analysisResult.analysis;
  const c = coaching;

  let md = `# postgame Coaching Report\n\n`;
  md += `**${a.headers.White || '?'} vs ${a.headers.Black || '?'}** — ${a.headers.Result || '?'}\n`;
  md += `**Opening:** ${a.openingName || a.headers.ECO || 'Unknown'}\n`;
  md += `**Reviewed as:** ${a.playerColor === 'w' ? 'White' : 'Black'}\n\n`;
  md += `---\n\n## Summary\n\n${c.summary || ''}\n\n`;

  if (c.opening) md += `**Opening:** ${c.opening}\n\n`;

  if (c.segments && c.segments.length) {
    md += `---\n\n## Game Phases\n\n`;
    for (const seg of c.segments) {
      md += `### ${seg.title}\n\n${seg.narrative || ''}\n\n`;
    }
  }

  if (c.criticalMoments && c.criticalMoments.length) {
    md += `---\n\n## Critical Moments\n\n`;
    for (const cm of c.criticalMoments) {
      md += `### ${cm.moveLabel} — ${cm.title}\n\n`;
      md += `**${(cm.type || 'mistake').toUpperCase()}**\n\n`;
      md += `${cm.explanation || ''}\n\n`;
      if (cm.concept) md += `**Concept:** ${cm.concept}\n\n`;
      if (cm.studyTip) md += `> 💡 ${cm.studyTip}\n\n`;
    }
  }

  if (c.missedIdeas && c.missedIdeas.length) {
    md += `---\n\n## Missed Ideas\n\n`;
    for (const mi of c.missedIdeas) {
      md += `### ${mi.moveLabel} — ${mi.title}\n\n`;
      md += `${mi.explanation || ''}\n\n`;
      if (mi.engineLine) md += `**Engine line:** ${mi.engineLine}\n\n`;
    }
  }

  if (c.strengths && c.strengths.length) {
    md += `---\n\n## Strengths\n\n`;
    c.strengths.forEach(s => { md += `- ${s}\n`; });
    md += '\n';
  }

  if (c.improvementAreas && c.improvementAreas.length) {
    md += `## Areas to Improve\n\n`;
    c.improvementAreas.forEach(s => { md += `- ${s}\n`; });
    md += '\n';
  }

  if (c.studyRecommendation) {
    md += `---\n\n## Study Recommendation\n\n${c.studyRecommendation}\n`;
  }

  // Download as .md file
  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const white = (a.headers.White || 'white').replace(/\s+/g, '-');
  const black = (a.headers.Black || 'black').replace(/\s+/g, '-');
  link.download = `postgame-${white}-vs-${black}.md`;
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════
function showError(msg) {
  const el = document.getElementById('errorMsg');
  el.textContent = msg; el.style.display = 'inline';
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
