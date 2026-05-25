require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const StockfishEngine = require('./stockfish');
const { analysePGN } = require('./analysis');
const { generateCoaching } = require('./coach');

const app = express();
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

// ── Job queue (in-memory) ──
const jobs = new Map();

// Clean up old jobs every 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000; // 1 hour
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}, 30 * 60 * 1000);

// ── API: Submit analysis job ──
app.post('/api/analyse', async (req, res) => {
  const { pgn, playerColor } = req.body;

  if (!pgn) return res.status(400).json({ error: 'PGN is required' });
  if (!['w', 'b'].includes(playerColor)) return res.status(400).json({ error: 'playerColor must be "w" or "b"' });

  const jobId = crypto.randomUUID();
  const job = {
    id: jobId,
    status: 'running',
    progress: 0,
    message: 'Starting analysis...',
    result: null,
    error: null,
    createdAt: Date.now(),
  };
  jobs.set(jobId, job);

  // Return job ID immediately
  res.json({ jobId });

  // Run analysis in background
  (async () => {
    try {
      console.log(`\n── Job ${jobId.slice(0, 8)} (${playerColor === 'w' ? 'White' : 'Black'}) ──`);
      const t0 = Date.now();

      const sf = await getEngine();
      const analysis = await analysePGN(pgn, playerColor, sf, (pct, msg) => {
        job.progress = pct;
        job.message = msg;
        console.log(`  [${pct}%] ${msg}`);
      });

      const engineTime = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  Engine done in ${engineTime}s (${analysis.totalMoves} moves)`);

      job.progress = 92;
      job.message = 'Generating coaching...';
      console.log('  Generating coaching...');
      const coaching = await generateCoaching(analysis);
      const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`  Complete in ${totalTime}s`);

      job.status = 'complete';
      job.progress = 100;
      job.message = 'Done';
      job.result = {
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
      job.status = 'error';
      job.error = err.message;
    }
  })();
});

// ── API: Poll job status ──
app.get('/api/job/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  if (job.status === 'running') {
    return res.json({
      status: 'running',
      progress: job.progress,
      message: job.message,
    });
  }

  if (job.status === 'error') {
    return res.json({ status: 'error', error: job.error });
  }

  // Complete — send result and clean up
  res.json({
    status: 'complete',
    progress: 100,
    ...job.result,
  });
});

// ── API: Test key ──
app.get('/api/test-key', async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.json({ error: 'ANTHROPIC_API_KEY not found in environment' });
  res.json({
    keyPrefix: key.slice(0, 12) + '...',
    keyLength: key.length,
    hasQuotes: key.startsWith('"') || key.startsWith("'"),
    hasSpaces: key !== key.trim(),
  });
});

// ── Health check ──
app.get('/api/health', async (req, res) => {
  try {
    const sf = await getEngine();
    res.json({ status: 'ok', engine: sf.ready ? 'ready' : 'loading' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── SPA fallback ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start ──
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`\n  postgame running on http://localhost:${PORT}\n`);
  try {
    await getEngine();
  } catch (err) {
    console.error('  ⚠ Engine failed to init:', err.message);
    console.error('  Install Stockfish: apt install stockfish');
    console.error('  Or set STOCKFISH_PATH in .env\n');
  }
});

process.on('SIGINT', () => { if (engine) engine.destroy(); process.exit(); });
process.on('SIGTERM', () => { if (engine) engine.destroy(); process.exit(); });
