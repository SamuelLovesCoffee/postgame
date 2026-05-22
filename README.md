# postgame

AI chess coach that explains your games. Not just move ratings — narrative coaching tied to specific positions, with concrete improvement recommendations.

## How it works

1. Paste a PGN and select which colour you played
2. Stockfish 16 evaluates every position (multi-PV, depth 22)
3. Lichess opening explorer identifies book moves
4. Claude analyses the annotated game and generates a coaching narrative
5. The UI presents coaching cards woven between move groups at critical moments

## Architecture

```
Frontend (static HTML/CSS/JS)
    ↓ POST /api/analyse
Backend (Express)
    ├── Stockfish 16 binary (UCI, child_process)
    ├── Lichess Opening Explorer API
    └── Claude API (coaching generation)
```

## Setup

### Prerequisites

- Node.js 20+
- Stockfish binary (`apt install stockfish` or [download](https://stockfishchess.org/download/))
- Anthropic API key

### Local development

```bash
# Clone and install
npm install

# Configure
cp .env.example .env
# Edit .env with your ANTHROPIC_API_KEY and STOCKFISH_PATH

# Run
npm run dev
# → http://localhost:3000
```

### Docker

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Build and run
docker compose up --build
# → http://localhost:3000
```

### Deploy to VPS

Any VPS with Docker works. Recommended: Hetzner CX22 (~€5/month).

```bash
# On the VPS
git clone <repo> && cd postgame
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
docker compose up -d
```

For production, add a reverse proxy (Caddy is simplest):

```bash
# Caddyfile
postgame.yourdomain.com {
    reverse_proxy localhost:3000
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | required | Claude API key |
| `STOCKFISH_PATH` | `/usr/games/stockfish` | Path to Stockfish binary |
| `STOCKFISH_DEPTH` | `22` | Search depth per position |
| `STOCKFISH_MULTIPV` | `3` | Number of lines to analyse |
| `STOCKFISH_THREADS` | `2` | Engine threads |
| `STOCKFISH_HASH` | `256` | Hash table size (MB) |
| `PORT` | `3000` | Server port |

## Project structure

```
postgame/
├── server/
│   ├── index.js        # Express server + routes
│   ├── stockfish.js    # Stockfish UCI wrapper
│   ├── analysis.js     # Analysis pipeline (eval + book + Win%)
│   └── coach.js        # Claude coaching prompt + response handling
├── public/
│   ├── index.html      # Frontend markup
│   ├── styles.css      # Styles
│   └── app.js          # Frontend logic
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Future ideas

- Book RAG: feed chess book chunks into the coaching prompt for specific concept references
- Pattern tracking across multiple games
- Opening repertoire recommendations
- Exportable coaching reports (PDF / shareable link)
- SSE for real-time progress during analysis
