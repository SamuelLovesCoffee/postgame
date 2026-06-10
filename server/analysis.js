const { Chess } = require('chess.js');

// Lichess Win% model
function cpToWinPct(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

function evalToWinPct(ev) {
  if (!ev) return 50;
  if (ev.mate != null) return ev.mate > 0 ? 99.99 : 0.01;
  return cpToWinPct(ev.cp || 0);
}

function formatEval(ev) {
  if (!ev) return '0.00';
  if (ev.mate != null) return (ev.mate > 0 ? '+' : '') + 'M' + Math.abs(ev.mate);
  const v = (ev.cp || 0) / 100;
  return (v >= 0 ? '+' : '') + v.toFixed(2);
}

function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return uci;
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
    return move ? move.san : uci;
  } catch { return uci; }
}

function pvToSan(fen, uciMoves, maxMoves = 5) {
  const sans = [];
  const chess = new Chess(fen);
  for (let i = 0; i < Math.min(uciMoves.length, maxMoves); i++) {
    const uci = uciMoves[i];
    if (!uci || uci.length < 4) break;
    try {
      const move = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });
      if (!move) break;
      sans.push(move.san);
    } catch { break; }
  }
  return sans;
}

// ── Lichess Cloud Eval (cache layer) ──
async function lichessCloudEval(fen) {
  try {
    const url = 'https://lichess.org/api/cloud-eval?fen=' + encodeURIComponent(fen) + '&multiPv=3';
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.pvs || !d.pvs.length) return null;

    const pvs = d.pvs.map((pv, idx) => ({
      rank: idx + 1,
      cp: pv.cp || 0,
      mate: pv.mate != null ? pv.mate : null,
      line: pv.moves ? pv.moves.split(' ') : [],
      depth: d.depth || 30,
    }));

    const top = pvs[0];
    return {
      bestMove: top.line[0] || '',
      evaluation: { cp: top.cp, mate: top.mate },
      pvs,
      depth: d.depth || 30,
      source: 'cloud',
    };
  } catch { return null; }
}

// ── Lichess Opening Explorer ──
async function checkOpeningBook(fen) {
  try {
    const url = `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(fen)}&speeds=bullet,blitz,rapid,classical&ratings=1600,1800,2000,2200,2500&topGames=0&recentGames=0`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
    if (total < 10) return null;
    return { inBook: true, opening: d.opening, totalGames: total };
  } catch { return null; }
}

/**
 * Full analysis pipeline with speed optimisations:
 * 1. Book positions: no engine eval needed
 * 2. Lichess cloud eval: instant, depth 30+
 * 3. Local Stockfish: only for positions not in cloud
 */
async function analysePGN(pgn, playerColor, engine, onProgress = () => {}, depth = 16) {
  const chess = new Chess();
  if (!chess.load_pgn(pgn)) throw new Error('Invalid PGN');

  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('No moves found in PGN');

  const headers = {};
  (pgn.match(/\[(\w+)\s+"([^"]*)"\]/g) || []).forEach((h) => {
    const m = h.match(/\[(\w+)\s+"([^"]*)"\]/);
    if (m) headers[m[1]] = m[2];
  });

  // Build position list
  chess.reset();
  const positions = [{ fen: chess.fen(), move: null }];
  for (const mv of moves) {
    chess.move(mv.san);
    positions.push({ fen: chess.fen(), move: mv });
  }

  // Phase 1: Opening book (fast, sequential until out of book)
  onProgress(0, 'Checking opening book...');
  const bookPositions = new Set();
  let openingName = null;

  for (let i = 0; i < positions.length; i++) {
    const bookData = await checkOpeningBook(positions[i].fen);
    if (bookData && bookData.inBook) {
      bookPositions.add(positions[i].fen);
      if (bookData.opening && bookData.opening.name) openingName = bookData.opening.name;
    } else break;
  }
  const bookDepth = bookPositions.size;

  // Phase 2: Evaluate positions
  onProgress(5, 'Evaluating positions...');
  await engine.newGame();

  const evals = [];
  let cloudActive = true; // try cloud only until first miss (opening phase)

  for (let i = 0; i < positions.length; i++) {
    const pct = 5 + Math.round((i / positions.length) * 85);
    onProgress(pct, `Analysing move ${Math.ceil((i + 1) / 2)} of ${Math.ceil(positions.length / 2)}`);

    const fen = positions[i].fen;
    const c = new Chess(fen);

    // Terminal positions
    if (c.game_over()) {
      evals.push(c.in_checkmate()
        ? { bestMove: '', evaluation: { cp: -30000, mate: 0 }, pvs: [], depth: 0, source: 'terminal' }
        : { bestMove: '', evaluation: { cp: 0, mate: null }, pvs: [], depth: 0, source: 'terminal' });
      continue;
    }

    // Cloud eval ONLY during the opening (while still getting hits).
    // Lichess has deep (depth 40+) evals for common opening positions.
    // Once we get our first miss, we're out of book — stop trying cloud.
    if (cloudActive && i < 20) {
      const cloud = await lichessCloudEval(fen);
      if (cloud) {
        evals.push(cloud);
        continue;
      } else {
        cloudActive = false; // first miss: stop wasting API calls
      }
    }

    // Local Stockfish at the selected depth
    evals.push(await engine.evaluate(fen, depth));
  }

  // Phase 3: Build annotated moves
  onProgress(90, 'Building analysis...');
  const annotatedMoves = [];

  for (let i = 1; i < positions.length; i++) {
    const move = positions[i].move;
    const evBefore = evals[i - 1];
    const evAfter = evals[i];
    const fenBefore = positions[i - 1].fen;

    const wpBefore = evalToWinPct(evBefore.evaluation);
    const wpAfterOpp = evalToWinPct(evAfter.evaluation);
    const wpAfterMover = 100 - wpAfterOpp;
    const wpLoss = Math.max(0, wpBefore - wpAfterMover);

    const playedUCI = move.from + move.to + (move.promotion || '');
    const isEngineTop = evBefore.bestMove === playedUCI;
    const isBook = bookPositions.has(fenBefore);

    const bestMoveSan = uciToSan(fenBefore, evBefore.bestMove);

    const pvLines = (evBefore.pvs || []).slice(0, 3).map((pv) => ({
      rank: pv.rank,
      cp: pv.cp,
      mate: pv.mate,
      san: pvToSan(fenBefore, pv.line, 5),
      eval: formatEval({ cp: pv.cp, mate: pv.mate }),
    }));

    const moveNumber = Math.floor((i - 1) / 2) + 1;
    const moveLabel = move.color === 'w' ? `${moveNumber}. ${move.san}` : `${moveNumber}...${move.san}`;

    // Detect missed opportunities: player played okay (wpLoss < 3) but there was something much better
    const isMissedOpportunity = !isBook && move.color === playerColor && !isEngineTop
      && wpLoss >= 2 && wpLoss < 8
      && pvLines.length > 0
      && wpBefore < 70; // not already winning easily

    annotatedMoves.push({
      ply: i,
      moveNumber,
      san: move.san,
      moveLabel,
      color: move.color,
      from: move.from,
      to: move.to,
      fen: positions[i].fen,
      fenBefore,
      evalBefore: formatEval(evBefore.evaluation),
      evalAfter: formatEval(evAfter.evaluation),
      evalAfterWhitePersp: formatEval(
        i % 2 === 1
          ? { cp: -(evAfter.evaluation.cp || 0), mate: evAfter.evaluation.mate != null ? -evAfter.evaluation.mate : null }
          : evAfter.evaluation
      ),
      cpBefore: evBefore.evaluation.cp,
      cpAfter: evAfter.evaluation.cp,
      wpBefore: Math.round(wpBefore * 10) / 10,
      wpAfterMover: Math.round(wpAfterMover * 10) / 10,
      wpLoss: Math.round(wpLoss * 10) / 10,
      bestMove: evBefore.bestMove,
      bestMoveSan,
      isEngineTop,
      pvLines,
      isBook,
      isSacrifice: !!move.captured && move.piece !== 'p',
      isMissedOpportunity,
    });
  }

  // Critical moments (mistakes/blunders)
  const criticalMoments = annotatedMoves
    .filter((m) => m.color === playerColor && !m.isBook && m.wpLoss > 5)
    .sort((a, b) => b.wpLoss - a.wpLoss)
    .slice(0, 6);

  // Missed opportunities
  const missedOpportunities = annotatedMoves
    .filter((m) => m.isMissedOpportunity)
    .sort((a, b) => b.wpLoss - a.wpLoss)
    .slice(0, 4);

  // Good moves
  const goodMoments = annotatedMoves
    .filter((m) => m.color === playerColor && m.isEngineTop && !m.isBook && m.wpBefore > 30 && m.wpBefore < 80)
    .slice(0, 5);

  onProgress(92, 'Analysis complete');

  return {
    headers,
    openingName,
    playerColor,
    totalMoves: annotatedMoves.length,
    moves: annotatedMoves,
    criticalMoments,
    missedOpportunities,
    goodMoments,
    bookDepth,
  };
}

module.exports = { analysePGN, formatEval, cpToWinPct, evalToWinPct };

