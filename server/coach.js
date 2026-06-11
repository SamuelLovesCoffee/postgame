const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert chess coach giving a post-game review to your student. Your goal is to help them understand what happened and improve.

VOICE:
- Write as a warm, experienced club coach. Talk directly to the student ("you", "your").
- Sound like a human, not a computer. Never say "the engine prefers", "the engine suggests", or "according to Stockfish". Instead say "the stronger move here is", "the idea is", "a better plan was".
- NEVER quote engine evaluation numbers: no centipawns, no Win%, no eval bars. If someone is winning, say "you had a big advantage" or "the position is very difficult for White". Use human language.
- For forced mates, use judgement based on length: a SHORT forced mate (mate in 1-6 moves) is a concrete, learnable pattern worth flagging — say something like "you had a forced mate in 3 starting with Qh5+". A LONG mate (7+ moves) is not humanly useful — just describe it as "a winning attack" or "a decisive advantage" without mentioning the mate. Never say "mate in 17" or similar long mates; no human calculates that far and it sounds robotic.
- Explain IDEAS, not just moves. "Bg4 develops the bishop while putting pressure on the knight that defends the centre" is coaching. "Bg4 (eval +1.5)" is not.
- Name chess concepts when relevant: pins, forks, discovered attacks, outposts, pawn structure weaknesses, king safety, piece activity, initiative, tempo. But only name a tactic if you are certain from the position.
- Be encouraging about good play. Be honest about mistakes, but frame them as learning opportunities, not failures.
- Keep recommendations practical for a club player (rating 800-2000). Don't suggest lines that are 15 moves deep.

ACCURACY (critical):
- You receive the FEN for each critical moment. STUDY IT to verify which pieces are on which squares before naming any tactic.
- NEVER guess at tactical motifs. If you're unsure whether something is a pin, fork, or skewer, describe the effect instead: "this wins a piece", "this creates a dangerous threat against the king".
- A PIN: a piece can't move because it would expose a more valuable piece behind it. A FORK: one piece attacks two or more enemy pieces. A SKEWER: an attack on a valuable piece that, when it moves, exposes a less valuable piece behind it. Don't confuse these.
- Focus on the IDEA behind the recommended move, not just naming it. "Bg4 pins the knight to the queen" is good. "Bg4 is better" is not enough.

RESPONSE FORMAT:
Return valid JSON only (no markdown, no backticks, no preamble). The structure:

{
  "summary": "2-3 sentence overall assessment of the game",
  "opening": "Brief comment on the opening phase (1-2 sentences). Include the opening name if known.",
  "segments": [
    {
      "startPly": 1,
      "endPly": 8,
      "title": "Short phase title",
      "narrative": "Coaching commentary for this chunk. 2-3 sentences. Reference specific moves."
    }
  ],
  "criticalMoments": [
    {
      "ply": 14,
      "moveLabel": "7...Nf6",
      "type": "mistake",
      "title": "Short title (e.g. 'Missing the fork')",
      "explanation": "What the student played, why it was wrong, what the engine suggests and why. 2-4 sentences.",
      "concept": "The chess concept (e.g. 'piece coordination', 'central control')",
      "studyTip": "One concrete thing to practise"
    }
  ],
  "missedIdeas": [
    {
      "ply": 20,
      "moveLabel": "10...Be7",
      "title": "Short title (e.g. 'Knight outpost on d4')",
      "explanation": "What the student played was okay, but there was a stronger idea. Explain the idea and the resulting position. 2-3 sentences.",
      "engineLine": "The engine's preferred continuation in words"
    }
  ],
  "brilliantMoves": [
    {
      "ply": 24,
      "moveLabel": "12.Nxf7",
      "title": "Short title (e.g. 'The knight sacrifice')",
      "explanation": "Why this move is brilliant — what was sacrificed and what it achieves. 2-3 sentences."
    }
  ],
  "brilliantMoves": [
    {
      "ply": 12,
      "moveLabel": "12. Nxf7",
      "title": "Short title (e.g. 'A clearing sacrifice')",
      "explanation": "Why this move is brilliant — what it sacrifices and what it achieves. 2-3 sentences."
    }
  ],
  "strengths": ["Pattern 1", "Pattern 2"],
  "improvementAreas": ["Area 1", "Area 2"],
  "studyRecommendation": "One specific, actionable study recommendation"
}

RULES:
- brilliantMoves: ONLY include if a candidate brilliant move was provided AND it genuinely merits it (a sound sacrifice or a difficult only-move). Most games have zero. Never invent brilliancies. Max 2.
- segments: 3-6 chunks that MUST cover the ENTIRE game from move 1 to the final move. The first segment's startPly must be 1, and the LAST segment's endPly MUST equal the ply of the very last move played. Never stop short — every move must fall within a segment's range. Group by phase/theme.
- criticalMoments: only student's side, max 4, most instructive
- missedIdeas: max 3, positions where a decent move missed something much stronger
- Keep explanations concise: 2-3 sentences each, not 5
- Every move reference must use standard notation (e.g. "7...Nf6", "12. Bxc6")
- When OPENING THEORY data is provided, you may reference the opening's typical plans and cite the notable master games listed (e.g. "this structure appeared in Carlsen vs Caruana, 2018"). NEVER invent or cite master games that are not in the provided list.
- When a Tablebase verdict is provided for an endgame position, treat it as ground truth (it is perfect play). Translate it into human terms: "this endgame is a theoretical draw with best play" — never contradict it.
- Use the pawn structure notes to ground positional advice (weak pawns, passed pawns, files to target).
- Only mark a move as brilliant if it is a genuine sacrifice (giving up real material) that leads to a winning or clearly better position, AND it is non-obvious. Be conservative — a brilliant move is rare. If the brilliant candidates aren't truly special, return an empty brilliantMoves array. Never call a simple good move or recapture brilliant.
- Ply values must EXACTLY match the data provided. Only reference moves that appear in the ANNOTATED MOVES list.
- NEVER invent, guess, or assume moves that aren't in the provided move list. If you reference a move, it must be one that was actually played and given to you. Do not extrapolate continuations as if they were played.
- Return ONLY valid JSON`;

async function generateCoaching(analysisResult, detailed = false) {
  const { headers, openingName, playerColor, moves, criticalMoments, missedOpportunities, goodMoments, brilliantMoves, bookDepth, masterInfo } = analysisResult;
  const color = playerColor === 'w' ? 'White' : 'Black';

  let moveText = '';
  for (const m of moves) {
    const prefix = m.color === 'w' ? `${m.moveNumber}. ` : '';
    const bookTag = m.isBook ? ' [BOOK]' : '';
    const evalTag = ` [eval: ${m.evalAfterWhitePersp}]`;

    let annotation = '';
    if (!m.isBook && m.color === playerColor) {
      if (m.wpLoss > 16) annotation = ' ?? BLUNDER';
      else if (m.wpLoss > 8) annotation = ' ? MISTAKE';
      else if (m.wpLoss > 5) annotation = ' ?! INACCURACY';
      else if (m.isEngineTop) annotation = ' ✓ BEST';
      else if (m.isMissedOpportunity) annotation = ' △ MISSED IDEA';

      if (m.wpLoss > 3 && m.bestMoveSan) {
        annotation += ` (best: ${m.bestMoveSan})`;
        if (m.pvLines.length > 0) {
          annotation += ` → ${m.pvLines[0].san.join(' ')}`;
        }
      }
    }

    moveText += `${prefix}${m.san}${bookTag}${evalTag}${annotation}\n`;
  }

  // Critical moments detail
  let criticalText = '';
  if (criticalMoments.length > 0) {
    criticalText = '\n\nCRITICAL MOMENTS (biggest errors):\n';
    for (const m of criticalMoments) {
      criticalText += `\nPly ${m.ply}: ${m.moveLabel} [${m.phase || 'middlegame'}] | WP: ${m.wpBefore}%→${m.wpAfterMover}% (lost ${m.wpLoss}pp)\n`;
      criticalText += `Position before move (FEN): ${m.fenBefore}\n`;
      criticalText += `Position after move (FEN): ${m.fen}\n`;
      if (m.pawnNotes && m.pawnNotes.length) criticalText += `Pawn structure: ${m.pawnNotes.join('; ')}\n`;
      if (m.tbBefore) criticalText += `Tablebase (perfect play): position before was a theoretical ${m.tbBefore} for the side to move`;
      if (m.tbAfter) criticalText += `; after the move it is a theoretical ${m.tbAfter} for the side to move`;
      if (m.tbBefore || m.tbAfter) criticalText += `\n`;
      criticalText += `Engine best: ${m.bestMoveSan}`;
      if (m.pvLines.length > 0) criticalText += ` → ${m.pvLines[0].san.join(' ')} (${m.pvLines[0].eval})`;
      criticalText += '\n';
      if (m.pvLines.length > 1) criticalText += `Alt: ${m.pvLines[1].san.join(' ')} (${m.pvLines[1].eval})\n`;
    }
  }

  // Missed opportunities
  let missedText = '';
  if (missedOpportunities && missedOpportunities.length > 0) {
    missedText = '\n\nMISSED OPPORTUNITIES (decent moves that missed something better):\n';
    for (const m of missedOpportunities) {
      missedText += `\nPly ${m.ply}: ${m.moveLabel} | WP: ${m.wpBefore}%→${m.wpAfterMover}% (lost ${m.wpLoss}pp)\n`;
      missedText += `Position before move (FEN): ${m.fenBefore}\n`;
      missedText += `Position after move (FEN): ${m.fen}\n`;
      missedText += `Stronger idea: ${m.bestMoveSan}`;
      if (m.pvLines.length > 0) missedText += ` → ${m.pvLines[0].san.join(' ')} (${m.pvLines[0].eval})`;
      missedText += '\n';
    }
  }

  // Brilliant moves (sacrifices / only-moves that keep advantage)
  let brilliantText = '';
  if (brilliantMoves && brilliantMoves.length > 0) {
    brilliantText = '\n\nCANDIDATE BRILLIANT MOVES (engine-best AND involve a sacrifice or are the only winning move):\n';
    for (const m of brilliantMoves) {
      brilliantText += `- Ply ${m.ply}: ${m.moveLabel} (${m.brilliantReason})\n`;
    }
    brilliantText += 'Only call a move brilliant if it is genuinely impressive: a real sacrifice that works, or a hard-to-find only-move. Be conservative — most games have none.\n';
  }

  // Good moves
  let goodText = '';
  if (goodMoments.length > 0) {
    goodText = '\n\nGOOD MOVES:\n';
    for (const m of goodMoments) {
      goodText += `- ${m.moveLabel}: matched engine's top choice\n`;
    }
  }

  // Opening theory + master game references
  let theoryText = '';
  if (masterInfo) {
    theoryText = '\n\nOPENING THEORY (from master practice):\n';
    if (masterInfo.opening) theoryText += `Opening: ${masterInfo.opening}\n`;
    if (masterInfo.topMoves && masterInfo.topMoves.length) {
      theoryText += `Main continuations in master games: ${masterInfo.topMoves.map(t => `${t.san} (${t.games} games)`).join(', ')}\n`;
    }
    if (masterInfo.games && masterInfo.games.length) {
      theoryText += 'Notable master games from this opening:\n';
      for (const g of masterInfo.games) {
        const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : '½-½';
        theoryText += `- ${g.white} vs ${g.black}, ${g.year} (${result})\n`;
      }
    }
  }

  // Brilliant move candidates (verified sacrifices that are best + winning)
  let brilliantText = '';
  if (brilliantMoves && brilliantMoves.length) {
    brilliantText = '\n\nBRILLIANT MOVE CANDIDATES (the engine confirms these are strong sacrifices — only praise them if they genuinely sacrifice material for a winning/equal position; if a candidate is not actually brilliant on inspection, omit it):\n';
    for (const m of brilliantMoves) {
      brilliantText += `Ply ${m.ply}: ${m.moveLabel} (sacrifice, stayed at ${m.wpAfterMover}% win chance)\n`;
      brilliantText += `Position before (FEN): ${m.fenBefore}\n`;
    }
  }

  const userPrompt = `Analyse this game for the student who played ${color}.

Game: ${headers.White || '?'} vs ${headers.Black || '?'}, ${headers.Result || '?'}
Opening: ${openingName || headers.ECO || 'Unknown'}
Book depth: ${bookDepth} plies
TOTAL MOVES IN THIS GAME: ${moves.length} plies (the final move is ply ${moves.length}). Your segments MUST cover all ${moves.length} plies — do not stop before the end of the game.${theoryText}${brilliantText}

ANNOTATED MOVES:
${moveText}
${criticalText}
${missedText}
${goodText}${brilliantText}

Return ONLY valid JSON matching the schema.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],

  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    // Validate: drop any critical moment / missed idea referencing a ply that
    // doesn't exist in the actual game (prevents showing invented moves)
    const validPlies = new Set(moves.map(m => m.ply));
    if (Array.isArray(parsed.criticalMoments)) {
      parsed.criticalMoments = parsed.criticalMoments.filter(cm => validPlies.has(cm.ply));
    }
    if (Array.isArray(parsed.missedIdeas)) {
      parsed.missedIdeas = parsed.missedIdeas.filter(mi => validPlies.has(mi.ply));
    }
    if (Array.isArray(parsed.brilliantMoves)) {
      parsed.brilliantMoves = parsed.brilliantMoves.filter(bm => validPlies.has(bm.ply));
    }
    if (Array.isArray(parsed.brilliantMoves)) {
      parsed.brilliantMoves = parsed.brilliantMoves.filter(bm => validPlies.has(bm.ply));
    }
    return parsed;
  } catch (err) {
    console.error('Failed to parse coaching JSON:', err.message);
    console.error('Raw response:', text.slice(0, 500));
    return {
      summary: text.slice(0, 300),
      opening: '',
      segments: [],
      criticalMoments: [],
      missedIdeas: [],
      brilliantMoves: [],
      strengths: [],
      improvementAreas: [],
      studyRecommendation: 'Review this game and note where the evaluation shifted.',
    };
  }
}


// Generate brief move-by-move commentary for the player's moves (Deep tier).
// Returns an object mapping ply -> short comment string.
async function generateMoveByMove(analysisResult) {
  const { headers, playerColor, moves } = analysisResult;
  const color = playerColor === 'w' ? 'White' : 'Black';

  // Only comment on the player's own moves to keep cost/length reasonable
  const playerMoves = moves.filter(m => m.color === playerColor && !m.isBook);

  // Build compact context
  let moveText = '';
  for (const m of moves) {
    const prefix = m.color === 'w' ? `${m.moveNumber}. ` : '';
    const tag = m.color === playerColor && !m.isBook
      ? (m.wpLoss > 8 ? ' [mistake]' : m.wpLoss > 4 ? ' [inaccuracy]' : m.isEngineTop ? ' [best]' : '')
      : '';
    moveText += `${prefix}${m.san} (ply ${m.ply})${tag}\n`;
  }

  const sys = `You are a chess coach giving brief move-by-move notes. For each of the student's moves, write ONE short sentence (max 15 words) of insight: what the move does, or what was better. Be human, no engine numbers. Return ONLY valid JSON: an array of {ply: number, comment: string}. Only include plies for ${color}'s moves. Keep comments concise and varied.`;

  const user = `Game: ${headers.White || '?'} vs ${headers.Black || '?'}. Student played ${color}.\n\nMoves:\n${moveText}\n\nReturn a JSON array of brief comments for each of ${color}'s moves. Format: [{"ply": 1, "comment": "..."}]. Only valid JSON.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: sys,
      messages: [{ role: 'user', content: user }],
    });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const arr = JSON.parse(cleaned);
    const validPlies = new Set(moves.map(m => m.ply));
    const out = {};
    for (const item of arr) {
      if (validPlies.has(item.ply) && item.comment) out[item.ply] = item.comment;
    }
    return out;
  } catch (err) {
    console.error('Move-by-move generation failed:', err.message);
    return {};
  }
}

module.exports = { generateCoaching, generateMoveByMove };














