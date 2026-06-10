require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const StockfishEngine = require('./stockfish');
const { analysePGN } = require('./analysis');
const { Chess } = require('chess.js');
const { generateCoaching, generateMoveByMove } = require('./coach');
const {
  signUp, signIn, authMiddleware, optionalAuth,
  getCredits, deductCredit,
  saveAnalysis, getAnalyses, getAnalysis,
  createCheckoutSession, handleStripeWebhook,
  getProfile, updateProfile, changePassword, getTransactions, deleteAccount,
  PACKAGES,
} = require('./auth');

// Analysis tiers
const TIERS = {
  quick: { depth: 12, credits: 1, label: 'Quick' },
  deep:  { depth: 18, credits: 2, label: 'Deep' },
};

const app = express();

// Stripe webhook needs raw body
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    await handleStripeWebhook(req.body, req.headers['stripe-signature']);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Engine singleton ──
let engine = null;
async function getEngine() {
  if (engine && engine.ready) return engine;
  engine = new StockfishEngine(process.env.STOCKFISH_PATH || '/usr/games/stockfish', {
    depth: parseInt(process.env.STOCKFISH_DEPTH || '20'),
    multiPv: parseInt(process.env.STOCKFISH_MULTIPV || '3'),
    threads: parseInt(process.env.STOCKFISH_THREADS || '2'),
    hash: parseInt(process.env.STOCKFISH_HASH || '256'),
  });
  await engine.init();
  return engine;
}

// ── Job queue ──
const jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 30 * 60 * 1000);

// ═══ AUTH ROUTES ═══

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { email, password, firstName, lastName, rating, chessUsername } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if (!firstName) return res.status(400).json({ error: 'First name is required' });
    await signUp(email, password, { firstName, lastName, rating, chessUsername });
    // No confirmation gate — sign the user in immediately
    const session = await signIn(email, password);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const session = await signIn(email, password);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  const credits = await getCredits(req.user.id);
  res.json({ user: { id: req.user.id, email: req.user.email }, credits });
});

// ═══ CREDITS / PACKAGES ═══

app.get('/api/packages', (req, res) => {
  res.json(PACKAGES);
});

app.post('/api/checkout', authMiddleware, async (req, res) => {
  try {
    const { packageId } = req.body;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const session = await createCheckoutSession(req.user.id, req.user.email, packageId, baseUrl);
    res.json(session);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══ ANALYSIS (protected) ═══

app.post('/api/analyse', authMiddleware, async (req, res) => {
  const { pgn, playerColor, tier = 'quick' } = req.body;
  if (!pgn) return res.status(400).json({ error: 'PGN is required' });
  if (!['w', 'b'].includes(playerColor)) return res.status(400).json({ error: 'playerColor must be "w" or "b"' });

  const tierConfig = TIERS[tier] || TIERS.quick;
  const cost = tierConfig.credits;

  // Check credits
  const credits = await getCredits(req.user.id);
  if (credits < cost) {
    return res.status(403).json({ error: `This analysis needs ${cost} credit${cost > 1 ? 's' : ''}. You have ${credits}.` });
  }

  // Deduct the tier's credit cost
  for (let i = 0; i < cost; i++) {
    const ok = await deductCredit(req.user.id);
    if (!ok) return res.status(403).json({ error: 'Could not deduct credits.' });
  }

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId, status: 'running', progress: 0,
    message: 'Starting analysis...', result: null, error: null,
    createdAt: Date.now(), userId: req.user.id,
  };
  jobs.set(jobId, job);
  res.json({ jobId });

  // Background analysis
  (async () => {
    try {
      console.log(`\n── Job ${jobId.slice(0, 8)} (${playerColor === 'w' ? 'White' : 'Black'}) user: ${req.user.email} ──`);
      const t0 = Date.now();
      const sf = await getEngine();
      const analysis = await analysePGN(pgn, playerColor, sf, (pct, msg) => {
        job.progress = pct; job.message = msg;
      });

      job.progress = 92; job.message = 'Generating coaching...';
      const coaching = await generateCoaching(analysis);

      // Deep tier: also generate move-by-move commentary
      let moveComments = {};
      if (tier === 'deep') {
        job.progress = 96; job.message = 'Writing move-by-move notes...';
        moveComments = await generateMoveByMove(analysis);
      }
      console.log(`  Complete in ${((Date.now()-t0)/1000).toFixed(1)}s`);

      // Save to database
      const analysisId = await saveAnalysis(
        req.user.id, pgn, playerColor,
        analysis.headers, analysis.openingName,
        coaching,
        { totalMoves: analysis.totalMoves, bookDepth: analysis.bookDepth }
      );

      job.status = 'complete'; job.progress = 100; job.message = 'Done';
      job.result = {
        analysisId,
        analysis: {
          headers: analysis.headers,
          openingName: analysis.openingName,
          playerColor: analysis.playerColor,
          moves: analysis.moves,
          bookDepth: analysis.bookDepth,
        },
        coaching,
        moveComments,
      };
    } catch (err) {
      console.error('Job error:', err);
      job.status = 'error'; job.error = err.message;
      // Refund credits on failure
      const { addCredits } = require('./auth');
      await addCredits(req.user.id, cost);
    }
  })();
});

app.get('/api/job/:id', optionalAuth, (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'running') return res.json({ status: 'running', progress: job.progress, message: job.message });
  if (job.status === 'error') return res.json({ status: 'error', error: job.error });
  res.json({ status: 'complete', progress: 100, ...job.result });
});

// ═══ ACCOUNT MANAGEMENT ═══

app.get('/api/account', authMiddleware, async (req, res) => {
  const profile = await getProfile(req.user.id);
  if (!profile) return res.status(404).json({ error: 'Profile not found' });
  res.json(profile);
});

app.patch('/api/account', authMiddleware, async (req, res) => {
  try {
    const { firstName, lastName, chessRating, chessUsername } = req.body;
    const ok = await updateProfile(req.user.id, { firstName, lastName, chessRating, chessUsername });
    if (!ok) return res.status(400).json({ error: 'Update failed' });
    const profile = await getProfile(req.user.id);
    res.json(profile);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/account/password', authMiddleware, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    await changePassword(req.user.id, newPassword);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/account/transactions', authMiddleware, async (req, res) => {
  const txns = await getTransactions(req.user.id);
  res.json(txns);
});

app.delete('/api/account', authMiddleware, async (req, res) => {
  try {
    await deleteAccount(req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══ HISTORY ═══

app.get('/api/history', authMiddleware, async (req, res) => {
  const analyses = await getAnalyses(req.user.id);
  res.json(analyses);
});

app.get('/api/history/:id', authMiddleware, async (req, res) => {
  const analysis = await getAnalysis(req.user.id, req.params.id);
  if (!analysis) return res.status(404).json({ error: 'Not found' });
  res.json(analysis);
});


// ═══ LICHESS IMPORT ═══

// Fetch a user's recent games from Lichess (public, no auth needed)
app.get('/api/lichess/:username', authMiddleware, async (req, res) => {
  const username = req.params.username.trim();
  if (!username || !/^[a-zA-Z0-9_-]{2,30}$/.test(username)) {
    return res.status(400).json({ error: 'Invalid Lichess username' });
  }
  try {
    const url = `https://lichess.org/api/games/user/${encodeURIComponent(username)}`
      + '?max=15&pgnInJson=true&clocks=false&evals=false&opening=true&moves=true';
    const r = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });

    if (r.status === 404) return res.status(404).json({ error: 'Lichess user not found' });
    if (!r.ok) return res.status(502).json({ error: 'Could not reach Lichess' });

    const text = await r.text();
    const games = text.trim().split('\n').filter(Boolean).map((line) => {
      try {
        const g = JSON.parse(line);
        const white = (g.players && g.players.white && g.players.white.user && g.players.white.user.name) || 'Anonymous';
        const black = (g.players && g.players.black && g.players.black.user && g.players.black.user.name) || 'Anonymous';
        const whiteRating = (g.players && g.players.white && g.players.white.rating) || null;
        const blackRating = (g.players && g.players.black && g.players.black.rating) || null;
        // Determine which colour the requested user played
        const userIsWhite = white.toLowerCase() === username.toLowerCase();
        const playerColor = userIsWhite ? 'w' : 'b';
        let result = 'draw';
        if (g.winner === 'white') result = userIsWhite ? 'win' : 'loss';
        else if (g.winner === 'black') result = userIsWhite ? 'loss' : 'win';
        return {
          id: g.id,
          pgn: g.pgn,
          white, black, whiteRating, blackRating,
          playerColor,
          result,
          opening: g.opening ? g.opening.name : null,
          speed: g.speed,
          createdAt: g.createdAt,
        };
      } catch { return null; }
    }).filter(Boolean);

    res.json({ games });
  } catch (err) {
    console.error('Lichess fetch error:', err.message);
    res.status(502).json({ error: 'Could not fetch games from Lichess' });
  }
});

// ═══ PGN PARSE (for history replay) ═══
app.post('/api/parse-pgn', (req, res) => {
  try {
    const { pgn, playerColor } = req.body;
    const chess = new Chess();
    if (!chess.load_pgn(pgn)) return res.status(400).json({ error: 'Invalid PGN' });
    const history = chess.history({ verbose: true });
    chess.reset();
    const movesOut = [];
    for (let i = 0; i < history.length; i++) {
      const mv = history[i];
      chess.move(mv.san);
      movesOut.push({
        ply: i + 1,
        moveNumber: Math.floor(i / 2) + 1,
        san: mv.san,
        moveLabel: mv.color === 'w' ? `${Math.floor(i/2)+1}. ${mv.san}` : `${Math.floor(i/2)+1}...${mv.san}`,
        color: mv.color,
        from: mv.from,
        to: mv.to,
        fen: chess.fen(),
        isBook: false,
        isEngineTop: false,
        bestMove: '',
        evalAfterWhitePersp: '',
        cpAfter: 0,
      });
    }
    res.json({ moves: movesOut });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ═══ UTILITY ═══

app.get('/api/health', async (req, res) => {
  try {
    const sf = await getEngine();
    res.json({ status: 'ok', engine: sf.ready ? 'ready' : 'loading' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n  postgame running on http://localhost:${PORT}\n`);
  try { await getEngine(); } catch (err) {
    console.error('  ⚠ Engine failed:', err.message);
  }
});

process.on('SIGINT', () => { if (engine) engine.destroy(); process.exit(); });
process.on('SIGTERM', () => { if (engine) engine.destroy(); process.exit(); });








