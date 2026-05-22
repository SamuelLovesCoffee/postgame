require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
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
    depth: parseInt(process.env.STOCKFISH_DEPTH || '22'),
    multiPv: parseInt(process.env.STOCKFISH_MULTIPV || '3'),
    threads: parseInt(process.env.STOCKFISH_THREADS || '2'),
    hash: parseInt(process.env.STOCKFISH_HASH || '256'),
  });
  await engine.init();
  return engine;
}

// ── API: Full analysis + coaching ──
app.post('/api/analyse', async (req, res) => {
  const { pgn, playerColor } = req.body;

  if (!pgn) return res.status(400).json({ error: 'PGN is required' });
  if (!['w', 'b'].includes(playerColor)) return res.status(400).json({ error: 'playerColor must be "w" or "b"' });

  // Stream progress as newline-delimited JSON
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendProgress = (pct, msg) => {
    res.write(JSON.stringify({ type: 'progress', pct, message: msg }) + '\n');
  };

  try {
    console.log(`\n── New analysis request (${playerColor === 'w' ? 'White' : 'Black'}) ──`);
    const t0 = Date.now();

    const sf = await getEngine();
    const analysis = await analysePGN(pgn, playerColor, sf, (pct, msg) => {
      sendProgress(pct, msg);
      console.log(`  [${pct}%] ${msg}`);
    });

    const engineTime = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Engine analysis done in ${engineTime}s (${analysis.totalMoves} moves)`);

    sendProgress(95, 'Generating coaching...');
    console.log('  Generating coaching...');
    const coaching = await generateCoaching(analysis);
    const totalTime = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`  Complete in ${totalTime}s`);

    // Send final result
    res.write(JSON.stringify({
      type: 'result',
      analysis: {
        headers: analysis.headers,
        openingName: analysis.openingName,
        playerColor: analysis.playerColor,
        moves: analysis.moves,
        bookDepth: analysis.bookDepth,
      },
      coaching,
    }) + '\n');
    res.end();
  } catch (err) {
    console.error('Analysis error:', err);
    res.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
    res.end();
  }
});

// ── Health check ──
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

// Cleanup
process.on('SIGINT', () => { if (engine) engine.destroy(); process.exit(); });
process.on('SIGTERM', () => { if (engine) engine.destroy(); process.exit(); });
