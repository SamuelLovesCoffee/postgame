require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const StockfishEngine = require('./stockfish');
const { analysePGN } = require('./analysis');
const { generateCoaching } = require('./coach');
const {
  signUp, signIn, authMiddleware, optionalAuth,
  getCredits, deductCredit,
  saveAnalysis, getAnalyses, getAnalysis,
  createCheckoutSession, handleStripeWebhook,
  PACKAGES,
} = require('./auth');

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
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const result = await signUp(email, password);
    // Auto sign-in after signup
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
  const { pgn, playerColor } = req.body;
  if (!pgn) return res.status(400).json({ error: 'PGN is required' });
  if (!['w', 'b'].includes(playerColor)) return res.status(400).json({ error: 'playerColor must be "w" or "b"' });

  // Check credits
  const credits = await getCredits(req.user.id);
  if (credits <= 0) {
    return res.status(403).json({ error: 'No credits remaining. Purchase more to continue.' });
  }

  // Deduct credit
  const deducted = await deductCredit(req.user.id);
  if (!deducted) {
    return res.status(403).json({ error: 'Could not deduct credit.' });
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
      };
    } catch (err) {
      console.error('Job error:', err);
      job.status = 'error'; job.error = err.message;
      // Refund credit on failure
      const { addCredits } = require('./auth');
      await addCredits(req.user.id, 1);
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
