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

// ── Knowledge helpers ──

// Count total pieces on the board (for tablebase eligibility)
function pieceCount(fen) {
  return (fen.split(' ')[0].match(/[a-zA-Z]/g) || []).length;
}

// Non-pawn material value (both sides), used for phase detection
function nonPawnMaterial(fen) {
  const board = fen.split(' ')[0];
  const vals = { q: 9, r: 5, b: 3, n: 3 };
  let total = 0;
  for (const ch of board) {
    const v = vals[ch.toLowerCase()];
    if (v) total += v;
  }
  return total;
}

// Game phase: opening / middlegame / endgame
function detectPhase(fen, ply, bookDepth) {
  if (ply <= Math.max(bookDepth + 2, 14)) return 'opening';
  if (nonPawnMaterial(fen) <= 13) return 'endgame';
  return 'middlegame';
}

// Pawn structure notes from a FEN: isolated, doubled, passed pawns
function pawnStructureNotes(fen) {
  const rows = fen.split(' ')[0].split('/');
  const wp = [], bp = []; // arrays of {file, rank}
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '8') { f += +ch; continue; }
      if (ch === 'P') wp.push({ f, r: 8 - r });
      if (ch === 'p') bp.push({ f, r: 8 - r });
      f++;
    }
  }
  const notes = [];
  const files = (arr) => arr.map(p => p.f);
  const wf = files(wp), bf = files(bp);

  const fileLetter = (f) => String.fromCharCode(97 + f);

  // Doubled
  for (const [name, fl] of [['White', wf], ['Black', bf]]) {
    const seen = {};
    fl.forEach(f => { seen[f] = (seen[f] || 0) + 1; });
    const doubled = Object.keys(seen).filter(f => seen[f] >= 2).map(f => fileLetter(+f));
    if (doubled.length) notes.push(`${name} has doubled pawns on the ${doubled.join(', ')}-file${doubled.length > 1 ? 's' : ''}`);
  }
  // Isolated
  for (const [name, fl] of [['White', wf], ['Black', bf]]) {
    const set = new Set(fl);
    const iso = [...new Set(fl.filter(f => !set.has(f - 1) && !set.has(f + 1)))].map(fileLetter);
    if (iso.length) notes.push(`${name} has isolated pawn(s) on the ${iso.join(', ')}-file${iso.length > 1 ? 's' : ''}`);
  }
  // Passed pawns
  for (const p of wp) {
    const blockers = bp.filter(q => Math.abs(q.f - p.f) <= 1 && q.r > p.r);
    if (!blockers.length) notes.push(`White has a passed pawn on ${fileLetter(p.f)}${p.r}`);
  }
  for (const p of bp) {
    const blockers = wp.filter(q => Math.abs(q.f - p.f) <= 1 && q.r < p.r);
    if (!blockers.length) notes.push(`Black has a passed pawn on ${fileLetter(p.f)}${p.r}`);
  }
  return notes.slice(0, 4);
}

// Lichess Syzygy tablebase (perfect play for <=7 pieces)
const tbCache = new Map();
async function tablebaseLookup(fen) {
  if (pieceCount(fen) > 7) return null;
  if (tbCache.has(fen)) return tbCache.get(fen);
  try {
    const r = await fetch('https://tablebase.lichess.ovh/standard?fen=' + encodeURIComponent(fen.replace(/ /g, '_')));
    if (!r.ok) { tbCache.set(fen, null); return null; }
    const d = await r.json();
    const result = { category: d.category, dtz: d.dtz }; // category from side-to-move perspective
    tbCache.set(fen, result);
    return result;
  } catch { tbCache.set(fen, null); return null; }
}

// Lichess Masters database: top continuations + notable master games
async function masterGamesLookup(fen) {
  try {
    const r = await fetch('https://explorer.lichess.ovh/masters?fen=' + encodeURIComponent(fen) + '&topGames=3&moves=4');
    if (!r.ok) return null;
    const d = await r.json();
    const topMoves = (d.moves || []).slice(0, 4).map(m => ({
      san: m.san,
      games: (m.white || 0) + (m.draws || 0) + (m.black || 0),
    }));
    const games = (d.topGames || []).slice(0, 3).map(g => ({
      white: g.white && g.white.name, whiteRating: g.white && g.white.rating,
      black: g.black && g.black.name, blackRating: g.black && g.black.rating,
      year: g.year, winner: g.winner || 'draw',
    }));
    if (!topMoves.length && !games.length) return null;
    return { opening: d.opening ? d.opening.name : null, topMoves, games };
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
    const phase = detectPhase(fenBefore, i, bookDepth);

    // Detect missed opportunities: player played okay (wpLoss < 3) but there was something much better
    const isMissedOpportunity = !isBook && move.color === playerColor && !isEngineTop
      && wpLoss >= 2 && wpLoss < 8
      && pvLines.length > 0
      && wpBefore < 70; // not already winning easily

    // Brilliant move detection (Chess.com-style "!!"):
    // A real sacrifice (gives up material) that is ALSO the best move and keeps
    // the position good. We approximate "sacrifice" as: the move is a capture of
    // a lower-value piece by a higher-value one, OR it allows immediate recapture
    // of the moved piece, while remaining the engine's top choice and not losing.
    const PIECE_VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let isBrilliant = false;
    if (move.color === playerColor && !isBook && isEngineTop && wpLoss < 2 && wpAfterMover > 45) {
      const movedVal = PIECE_VAL[move.piece] || 0;
      const capturedVal = move.captured ? (PIECE_VAL[move.captured] || 0) : 0;
      // Sacrifice signals: moving a valuable piece to a square where it can be
      // captured by a less valuable enemy piece, or capturing less than you give.
      // We check if after the move, the moved piece sits on a square attacked by
      // a cheaper enemy pawn/piece (approximated via the next position's best reply
      // being a capture on the destination square).
      const nextBest = evAfter.bestMove || '';
      const recapturesDest = nextBest.slice(2, 4) === move.to;
      const givesMaterial = (movedVal >= 3 && recapturesDest && capturedVal < movedVal);
      // Also flag a queen/rook sac that stays winning
      const heavySac = (movedVal >= 5 && recapturesDest);
      if ((givesMaterial || heavySac) && move.san.length > 1) {
        isBrilliant = true;
      }
    }

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
      isBrilliant,
      phase,
    });
  }

  // Critical moments (mistakes/blunders)
  const criticalMoments = annotatedMoves
    .filter((m) => m.color === playerColor && !m.isBook && m.wpLoss > 5)
    .sort((a, b) => b.wpLoss - a.wpLoss)
    .slice(0, 6);

  // Enrich critical moments with pawn structure + endgame tablebase verdicts
  onProgress(90, 'Adding position context...');
  for (const m of criticalMoments) {
    m.pawnNotes = pawnStructureNotes(m.fenBefore);
    if (m.phase === 'endgame') {
      const tbBefore = await tablebaseLookup(m.fenBefore);
      const tbAfter = await tablebaseLookup(m.fen);
      if (tbBefore) m.tbBefore = tbBefore.category; // win/draw/loss for side to move
      if (tbAfter) m.tbAfter = tbAfter.category;
    }
  }

  // Opening theory + master games for the position at the end of book
  let masterInfo = null;
  const theoryIdx = Math.min(Math.max(bookDepth, 6), 16, positions.length - 1);
  if (theoryIdx > 2) {
    masterInfo = await masterGamesLookup(positions[theoryIdx].fen);
  }

  // Brilliant moves (rare, only the clearest sacrifices)
  const brilliantMoves = annotatedMoves.filter((m) => m.isBrilliant).slice(0, 3);

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
    brilliantMoves,
    masterInfo,
    criticalMoments,
    missedOpportunities,
    goodMoments,
    bookDepth,
  };
}

module.exports = { analysePGN, formatEval, cpToWinPct, evalToWinPct };



