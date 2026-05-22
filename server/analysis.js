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

// Convert UCI move to SAN in a given position
function uciToSan(fen, uci) {
  if (!uci || uci.length < 4) return uci;
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    const move = chess.move({ from, to, promotion });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

// Convert a PV line (array of UCI moves) to SAN from a starting FEN
function pvToSan(fen, uciMoves, maxMoves = 5) {
  const sans = [];
  const chess = new Chess(fen);
  for (let i = 0; i < Math.min(uciMoves.length, maxMoves); i++) {
    const uci = uciMoves[i];
    if (!uci || uci.length < 4) break;
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci.length > 4 ? uci[4] : undefined,
      });
      if (!move) break;
      sans.push(move.san);
    } catch {
      break;
    }
  }
  return sans;
}

// Check Lichess opening explorer
async function checkOpeningBook(fen) {
  try {
    const url = `https://explorer.lichess.ovh/lichess?fen=${encodeURIComponent(fen)}&speeds=bullet,blitz,rapid,classical&ratings=1600,1800,2000,2200,2500&topGames=0&recentGames=0`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    const total = (d.white || 0) + (d.draws || 0) + (d.black || 0);
    if (total < 10) return null;
    return {
      inBook: true,
      opening: d.opening,
      totalGames: total,
    };
  } catch {
    return null;
  }
}

/**
 * Run full analysis pipeline.
 *
 * @param {string} pgn — the PGN text
 * @param {string} playerColor — 'w' or 'b'
 * @param {StockfishEngine} engine — initialised engine instance
 * @param {function} onProgress — callback(pct, message)
 * @returns {object} — full analysis result
 */
async function analysePGN(pgn, playerColor, engine, onProgress = () => {}) {
  const chess = new Chess();
  if (!chess.load_pgn(pgn)) {
    throw new Error('Invalid PGN');
  }

  const moves = chess.history({ verbose: true });
  if (!moves.length) throw new Error('No moves found in PGN');

  // Parse headers
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

  // Phase 1: Opening book
  onProgress(0, 'Checking opening book...');
  const bookPositions = new Set();
  let openingName = null;

  for (let i = 0; i < positions.length; i++) {
    const bookData = await checkOpeningBook(positions[i].fen);
    if (bookData && bookData.inBook) {
      bookPositions.add(positions[i].fen);
      if (bookData.opening && bookData.opening.name) openingName = bookData.opening.name;
    } else {
      break;
    }
  }

  // Phase 2: Engine evaluation
  onProgress(10, 'Running engine analysis...');
  await engine.newGame();

  const evals = [];
  for (let i = 0; i < positions.length; i++) {
    const pct = 10 + Math.round((i / positions.length) * 80);
    onProgress(pct, `Evaluating position ${i + 1}/${positions.length}`);

    const c = new Chess(positions[i].fen);
    if (c.game_over()) {
      if (c.in_checkmate()) {
        evals.push({ bestMove: '', evaluation: { cp: -30000, mate: 0 }, pvs: [], depth: 0 });
      } else {
        evals.push({ bestMove: '', evaluation: { cp: 0, mate: null }, pvs: [], depth: 0 });
      }
    } else {
      evals.push(await engine.evaluate(positions[i].fen, engine.depth));
    }
  }

  // Phase 3: Build annotated moves
  onProgress(90, 'Building analysis...');
  const annotatedMoves = [];

  for (let i = 1; i < positions.length; i++) {
    const move = positions[i].move;
    const evBefore = evals[i - 1];
    const evAfter = evals[i];
    const fenBefore = positions[i - 1].fen;

    // Win% from mover's perspective
    const wpBefore = evalToWinPct(evBefore.evaluation);
    const wpAfterOpp = evalToWinPct(evAfter.evaluation);
    const wpAfterMover = 100 - wpAfterOpp;
    const wpLoss = Math.max(0, wpBefore - wpAfterMover);

    // Move matching
    const playedUCI = move.from + move.to + (move.promotion || '');
    const isEngineTop = evBefore.bestMove === playedUCI;
    const isBook = bookPositions.has(fenBefore);

    // Best move in SAN
    const bestMoveSan = uciToSan(fenBefore, evBefore.bestMove);

    // Top PV lines in SAN
    const pvLines = (evBefore.pvs || []).slice(0, 3).map((pv) => ({
      rank: pv.rank,
      cp: pv.cp,
      mate: pv.mate,
      san: pvToSan(fenBefore, pv.line, 5),
      eval: formatEval({ cp: pv.cp, mate: pv.mate }),
    }));

    // Move number
    const moveNumber = Math.floor((i - 1) / 2) + 1;
    const isWhite = move.color === 'w';
    const moveLabel = isWhite ? `${moveNumber}. ${move.san}` : `${moveNumber}...${move.san}`;

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

      // Engine data
      evalBefore: formatEval(evBefore.evaluation),
      evalAfter: formatEval(evAfter.evaluation),
      evalAfterWhitePersp: formatEval(
        i % 2 === 1
          ? { cp: -(evAfter.evaluation.cp || 0), mate: evAfter.evaluation.mate != null ? -evAfter.evaluation.mate : null }
          : evAfter.evaluation
      ),
      cpBefore: evBefore.evaluation.cp,
      cpAfter: evAfter.evaluation.cp,

      // Win%
      wpBefore: Math.round(wpBefore * 10) / 10,
      wpAfterMover: Math.round(wpAfterMover * 10) / 10,
      wpLoss: Math.round(wpLoss * 10) / 10,

      // Best move
      bestMove: evBefore.bestMove,
      bestMoveSan,
      isEngineTop,
      pvLines,

      // Classification
      isBook,
      isSacrifice: !!move.captured && move.piece !== 'p',
    });
  }

  // Identify critical moments (for the player)
  const criticalMoments = annotatedMoves
    .filter((m) => m.color === playerColor && !m.isBook && m.wpLoss > 5)
    .sort((a, b) => b.wpLoss - a.wpLoss)
    .slice(0, 8);

  // Also identify good moments for the player
  const goodMoments = annotatedMoves
    .filter((m) => m.color === playerColor && m.isEngineTop && !m.isBook && m.wpBefore > 30 && m.wpBefore < 80)
    .slice(0, 5);

  onProgress(100, 'Done');

  return {
    headers,
    openingName,
    playerColor,
    totalMoves: annotatedMoves.length,
    moves: annotatedMoves,
    criticalMoments,
    goodMoments,
    bookDepth: Array.from(bookPositions).length,
  };
}

module.exports = { analysePGN, formatEval, cpToWinPct, evalToWinPct };
