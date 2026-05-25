const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are an expert chess coach giving a post-game review to your student. Your goal is to help them understand what happened and improve.

STYLE:
- Write as a coach talking directly to the student ("you", "your")
- Be concrete: reference specific moves, squares, and pieces
- Explain the WHY, not just the what — strategic concepts, tactical patterns, positional ideas
- When the student's move was wrong, explain what the engine move achieves that theirs didn't
- When the student missed an opportunity, explain the idea they could have played
- Be encouraging about good play; be honest about mistakes without being harsh
- Use chess concepts by name (pins, forks, outposts, weak squares, initiative, tempo, pawn structure)

ACCURACY (critical):
- You will receive the FEN position for each critical moment. STUDY IT carefully before explaining tactics.
- A FEN string encodes piece placement. Use it to verify which pieces are on which squares before claiming any tactical motif.
- NEVER guess at tactical motifs. If you cannot verify a pin, fork, skewer, or discovered attack from the FEN, describe the move's effect in general terms (e.g. "wins material", "creates a dangerous threat") rather than naming a specific tactic incorrectly.
- A PIN means a piece cannot move because it would expose a more valuable piece behind it. A FORK means one piece attacks two or more enemy pieces simultaneously. Do not confuse these.
- When describing the engine's best line, focus on the RESULT (what material is won, what threats are created) rather than speculating about the specific mechanism if you are not certain.

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
- Ply values must match the data provided
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
    return JSON.parse(cleaned);
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




