const { spawn } = require('child_process');

class StockfishEngine {
  constructor(path, options = {}) {
    this.path = path || '/usr/games/stockfish';
    this.depth = options.depth || 22;
    this.multiPv = options.multiPv || 3;
    this.threads = options.threads || 2;
    this.hash = options.hash || 256;
    this.process = null;
    this.ready = false;
    this.queue = [];
    this.buffer = '';
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.path, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.on('error', (err) => {
        reject(new Error(`Stockfish binary not found at ${this.path}: ${err.message}`));
      });

      this.process.stderr.on('data', (data) => {
        console.error('[stockfish stderr]', data.toString());
      });

      this.process.stdout.on('data', (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          this._handleLine(line.trim());
        }
      });

      // Wait for UCI init
      const timeout = setTimeout(() => reject(new Error('Stockfish UCI timeout')), 10000);

      this._waitFor('uciok').then(() => {
        clearTimeout(timeout);
        // Configure engine
        this._send(`setoption name Threads value ${this.threads}`);
        this._send(`setoption name Hash value ${this.hash}`);
        this._send(`setoption name MultiPV value ${this.multiPv}`);
        return this._waitForReady();
      }).then(() => {
        this.ready = true;
        console.log(`Stockfish ready (threads: ${this.threads}, hash: ${this.hash}MB, multiPV: ${this.multiPv})`);
        resolve();
      }).catch(reject);

      this._send('uci');
    });
  }

  _send(cmd) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(cmd + '\n');
    }
  }

  _handleLine(line) {
    if (!line) return;
    // Notify all waiting listeners
    for (const listener of this.queue) {
      listener(line);
    }
  }

  _waitFor(keyword) {
    return new Promise((resolve) => {
      const handler = (line) => {
        if (line.includes(keyword)) {
          this.queue = this.queue.filter((h) => h !== handler);
          resolve(line);
        }
      };
      this.queue.push(handler);
    });
  }

  _waitForReady() {
    this._send('isready');
    return this._waitFor('readyok');
  }

  /**
   * Evaluate a position. Returns:
   * {
   *   bestMove: 'e2e4',
   *   evaluation: { cp: 35, mate: null },
   *   pvs: [
   *     { rank: 1, cp: 35, mate: null, line: ['e2e4', 'd7d5', ...], san: ['e4', 'd5', ...] },
   *     { rank: 2, cp: 20, mate: null, line: ['d2d4', ...], san: ['d4', ...] },
   *   ],
   *   depth: 22,
   * }
   */
  async evaluate(fen, depth) {
    if (!this.ready) throw new Error('Engine not initialised');

    const d = depth || this.depth;
    const pvs = new Map(); // pvIndex -> latest info

    return new Promise((resolve) => {
      const handler = (line) => {
        // Parse info lines
        if (line.startsWith('info') && line.includes(' pv ')) {
          const depthMatch = line.match(/depth (\d+)/);
          const pvMatch = line.match(/multipv (\d+)/);
          const cpMatch = line.match(/score cp (-?\d+)/);
          const mateMatch = line.match(/score mate (-?\d+)/);
          const movesMatch = line.match(/ pv (.+)/);

          if (depthMatch && movesMatch) {
            const pvIndex = pvMatch ? parseInt(pvMatch[1]) : 1;
            const info = {
              rank: pvIndex,
              depth: parseInt(depthMatch[1]),
              cp: cpMatch ? parseInt(cpMatch[1]) : 0,
              mate: mateMatch ? parseInt(mateMatch[1]) : null,
              line: movesMatch[1].trim().split(/\s+/),
            };
            pvs.set(pvIndex, info);
          }
        }

        // bestmove signals completion
        if (line.startsWith('bestmove')) {
          this.queue = this.queue.filter((h) => h !== handler);

          const bestMoveMatch = line.match(/bestmove (\S+)/);
          const bestMove = bestMoveMatch ? bestMoveMatch[1] : '';

          // Collect PVs sorted by rank
          const sortedPvs = Array.from(pvs.values())
            .sort((a, b) => a.rank - b.rank)
            .map((pv) => ({
              rank: pv.rank,
              cp: pv.cp,
              mate: pv.mate,
              line: pv.line,
              depth: pv.depth,
            }));

          const topPv = sortedPvs[0] || { cp: 0, mate: null };

          resolve({
            bestMove,
            evaluation: { cp: topPv.cp, mate: topPv.mate },
            pvs: sortedPvs,
            depth: topPv.depth || d,
          });
        }
      };

      this.queue.push(handler);
      this._send('position fen ' + fen);
      this._send('go depth ' + d);
    });
  }

  async newGame() {
    this._send('ucinewgame');
    return this._waitForReady();
  }

  destroy() {
    if (this.process) {
      this._send('quit');
      this.process.kill();
      this.process = null;
      this.ready = false;
    }
  }
}

module.exports = StockfishEngine;
