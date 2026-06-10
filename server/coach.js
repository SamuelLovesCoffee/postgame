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
  "strengths": ["Pattern 1", "Pattern 2"],
  "improvementAreas": ["Area 1", "Area 2"],
  "studyRecommendation": "One specific, actionable study recommendation"
}

RULES:
- segments: 3-5 chunks covering the whole game, grouped by phase/theme
- criticalMoments: only student's side, max 4, most instructive
- missedIdeas: max 3, positions where a decent move missed something much stronger
- Keep explanations concise: 2-3 sentences each, not 5
- Every move reference must use standard notation (e.g. "7...Nf6", "12. Bxc6")
- Ply values must EXACTLY match the data provided. Only reference moves that appear in the ANNOTATED MOVES list.
- NEVER invent, guess, or assume moves that aren't in the provided move list. If you reference a move, it must be one that was actually played and given to you. Do not extrapolate continuations as if they were played.
- Return ONLY valid JSON`;

async function generateCoaching(analysisResult) {
  const { headers, openingName, playerColor, moves, criticalMoments, missedOpportunities, goodMoments, bookDepth } = analysisResult;
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
      criticalText += `\nPly ${m.ply}: ${m.moveLabel} | WP: ${m.wpBefore}%→${m.wpAfterMover}% (lost ${m.wpLoss}pp)\n`;
      criticalText += `Position before move (FEN): ${m.fenBefore}\n`;
      criticalText += `Position after move (FEN): ${m.fen}\n`;
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

  // Good moves
  let goodText = '';
  if (goodMoments.length > 0) {
    goodText = '\n\nGOOD MOVES:\n';
    for (const m of goodMoments) {
      goodText += `- ${m.moveLabel}: matched engine's top choice\n`;
    }
  }

  const userPrompt = `Analyse this game for the student who played ${color}.

Game: ${headers.White || '?'} vs ${headers.Black || '?'}, ${headers.Result || '?'}
Opening: ${openingName || headers.ECO || 'Unknown'}
Book depth: ${bookDepth} plies

ANNOTATED MOVES:
${moveText}
${criticalText}
${missedText}
${goodText}

Return ONLY valid JSON matching the schema.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
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
      strengths: [],
      improvementAreas: [],
      studyRecommendation: 'Review this game and note where the evaluation shifted.',
    };
  }
}

module.exports = { generateCoaching };








