const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an expert chess coach giving a post-game review to your student. Your goal is to help them understand what happened and improve.

STYLE:
- Write as a coach talking directly to the student ("you", "your")
- Be concrete: reference specific moves, squares, and pieces
- Explain the WHY, not just the what — strategic concepts, tactical patterns, positional ideas
- When the student's move was wrong, explain what the engine move achieves that theirs didn't
- Be encouraging about good play; be honest about mistakes without being harsh
- Use chess concepts by name (pins, forks, outposts, weak squares, initiative, tempo, pawn structure)

RESPONSE FORMAT:
Return valid JSON only (no markdown, no backticks, no preamble). The structure:

{
  "summary": "2-3 sentence overall assessment of the game",
  "opening": "Brief comment on the opening phase and how it went for the student (1-2 sentences). Include the opening name if known.",
  "segments": [
    {
      "startPly": 1,
      "endPly": 8,
      "title": "Short phase title (e.g. 'Opening preparation', 'Middlegame initiative')",
      "narrative": "Coaching commentary for this chunk of moves. 2-4 sentences. Reference specific moves."
    }
  ],
  "criticalMoments": [
    {
      "ply": 14,
      "moveLabel": "7...Nf6",
      "type": "mistake",
      "title": "Short title for the mistake (e.g. 'Missing the fork')",
      "explanation": "Detailed explanation: what the student played, why it was wrong, what the engine suggests instead and why that's better. 3-5 sentences. Be specific about the resulting position.",
      "concept": "The underlying chess concept (e.g. 'piece coordination', 'central control', 'king safety')",
      "studyTip": "One concrete thing the student can practise to avoid this pattern"
    }
  ],
  "strengths": ["Pattern 1 the student showed", "Pattern 2"],
  "improvementAreas": ["Area 1 to work on", "Area 2"],
  "studyRecommendation": "One specific, actionable study recommendation based on the patterns in this game"
}

RULES:
- segments should cover the whole game in 3-6 chunks, grouping moves by phase/theme
- criticalMoments are only for the student's side, only non-book moves with significant errors
- Include at most 5 critical moments; focus on the most instructive ones
- If the student played well, say so — don't invent problems
- Every move reference must use standard notation (e.g. "7...Nf6", "12. Bxc6")
- The ply values must match the data provided
- Return ONLY valid JSON`;

/**
 * Generate coaching review from analysis data
 */
async function generateCoaching(analysisResult) {
  const { headers, openingName, playerColor, moves, criticalMoments, goodMoments, bookDepth } = analysisResult;
  const color = playerColor === 'w' ? 'White' : 'Black';

  // Build annotated move text for the prompt
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

      if (m.wpLoss > 3 && m.bestMoveSan) {
        annotation += ` (best: ${m.bestMoveSan})`;
      }
    }

    moveText += `${prefix}${m.san}${bookTag}${evalTag}${annotation}\n`;
  }

  // Build critical moments detail
  let criticalText = '';
  if (criticalMoments.length > 0) {
    criticalText = '\n\nCRITICAL MOMENTS FOR THE STUDENT (most significant Win% drops):\n';
    for (const cm of criticalMoments) {
      const m = cm;
      criticalText += `\n--- Ply ${m.ply}: ${m.moveLabel} ---\n`;
      criticalText += `Position eval before: ${m.evalBefore} | After: ${m.evalAfterWhitePersp}\n`;
      criticalText += `Student's Win% dropped: ${m.wpBefore}% → ${m.wpAfterMover}% (lost ${m.wpLoss}pp)\n`;
      criticalText += `Engine's best: ${m.bestMoveSan}\n`;
      if (m.pvLines.length > 0) {
        criticalText += `Engine's top line: ${m.pvLines[0].san.join(' ')} (eval: ${m.pvLines[0].eval})\n`;
      }
      if (m.pvLines.length > 1) {
        criticalText += `Alternative: ${m.pvLines[1].san.join(' ')} (eval: ${m.pvLines[1].eval})\n`;
      }
    }
  }

  // Build good moments
  let goodText = '';
  if (goodMoments.length > 0) {
    goodText = '\n\nGOOD MOVES BY THE STUDENT:\n';
    for (const m of goodMoments) {
      goodText += `- ${m.moveLabel}: matched engine's top choice in a meaningful position\n`;
    }
  }

  const userPrompt = `Analyse this game for the student who played ${color}.

GAME INFO:
White: ${headers.White || '?'} | Black: ${headers.Black || '?'}
Result: ${headers.Result || '?'}
Opening: ${openingName || headers.ECO || 'Unknown'}
Book depth: ${bookDepth} positions in opening theory

ANNOTATED MOVES:
${moveText}
${criticalText}
${goodText}

Remember: return ONLY valid JSON matching the schema described in your instructions.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Parse JSON (handle potential markdown fences)
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('Failed to parse coaching JSON:', err.message);
    console.error('Raw response:', text.slice(0, 500));
    // Return a fallback structure
    return {
      summary: text.slice(0, 300),
      opening: '',
      segments: [],
      criticalMoments: [],
      strengths: [],
      improvementAreas: [],
      studyRecommendation: 'Review this game carefully and note where the evaluation shifted.',
    };
  }
}

module.exports = { generateCoaching };
