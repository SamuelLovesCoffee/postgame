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
- Before claiming a move "attacks", "chases", "hits", or "targets" a specific piece, VERIFY from the FEN that the named enemy piece is actually on a square that move attacks. A pawn move to c6, for example, attacks the d5 and b5 squares — do not claim it "chases a bishop" unless a bishop is genuinely on one of those squares. When unsure what a move targets, describe its general purpose ("gains space", "supports the centre", "prepares development") rather than naming a specific target you have not verified.
- Do not narrate a move's intention as fact. Prefer "this looks like it was meant to..." or describe what the move objectively does on the board over asserting the player's or position's specific intent.
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

async function generateCoaching(analysisResult, detailed = false, playerProfile = null) {
  const { headers, openingName, playerColor, moves, criticalMoments, missedOpportunities, goodMoments, brilliantMoves, bookDepth, masterInfo, gameQuality, timeControl } = analysisResult;
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

  // ── Coaching calibration: player level, game quality, time, history ──
  const q = gameQuality || {};
  const ps = q.player || {};
  const os = q.opponent || {};

  // Player rating: prefer the rating from this game's headers, else profile
  const ratingTag = playerColor === 'w' ? 'WhiteElo' : 'BlackElo';
  const gameRating = headers[ratingTag] ? parseInt(headers[ratingTag]) : null;
  const rating = gameRating || (playerProfile && playerProfile.rating) || null;
  let ratingBand = 'intermediate';
  if (rating) {
    if (rating < 1000) ratingBand = 'beginner (focus on basic safety: hanging pieces, simple tactics, not losing material)';
    else if (rating < 1400) ratingBand = 'novice (focus on tactics, basic opening principles, simple plans)';
    else if (rating < 1800) ratingBand = 'intermediate (focus on positional ideas, pawn structure, calculation, opening understanding)';
    else if (rating < 2100) ratingBand = 'advanced (focus on subtle positional nuance, prophylaxis, deep calculation, endgame technique)';
    else ratingBand = 'expert (assume strong fundamentals; focus on the highest-level subtleties)';
  }

  const tc = timeControl || q.timeControl || {};
  const tcCategory = tc.category || 'unknown';

  let calibration = '\n\nCOACHING CALIBRATION:\n';
  calibration += `- Student level: ${rating ? rating + ' rating, ' : ''}${ratingBand}. Pitch your advice to this level — do not over-explain basics to a strong player or overload a beginner with deep theory.\n`;
  calibration += `- Time control: ${tcCategory}. ${tcCategory === 'bullet' || tcCategory === 'blitz' ? 'This is a fast game — be forgiving of small slips that are really just time pressure, and focus on the most important recurring patterns rather than every minor inaccuracy.' : 'This is a slower game — the student had time to think, so hold them to a higher standard on calculation and planning.'}\n`;

  // Game quality assessment. Use ERROR COUNTS (reliable) for the verbal read.
  // Only cite an accuracy PERCENTAGE if it came from the platform import — never
  // our own engine-derived figure, which is not calibrated to the platforms.
  const importedAcc = (analysisResult.headers && (analysisResult.headers[playerColor === 'w' ? 'WhiteAccuracy' : 'BlackAccuracy'])) || null;
  if (ps.moves != null) {
    calibration += `\nGAME QUALITY (use this to open with an honest, earned assessment of how well the game was played):\n`;
    calibration += `- Your student (${color}) made ${ps.blunders} blunder(s), ${ps.mistakes} mistake(s), and ${ps.inaccuracies} inaccuracy(ies) across ${ps.moves} moves.\n`;
    calibration += `- Opponent made ${os.blunders} blunder(s), ${os.mistakes} mistake(s), ${os.inaccuracies} inaccuracy(ies).\n`;
    if (importedAcc) {
      calibration += `- The platform reported an accuracy of ${importedAcc}% for your student this game — you MAY cite this figure since it comes from their platform.\n`;
    } else {
      calibration += `- Do NOT cite any accuracy percentage for this game — none was provided by the platform. Characterise quality qualitatively, using the error counts above (few errors = cleanly played; many = messy). Speak in words, not invented percentages.\n`;
    }
    calibration += `- Be fair and grounded: do not invent praise or criticism the error counts do not support.\n`;
  }

  // Time-management signal
  if (q.timeSignal && q.timeSignal.fastMoves >= 3) {
    const ts = q.timeSignal;
    calibration += `\nTIME MANAGEMENT: The student made ${ts.fastMoves} very fast moves (under 5 seconds), and ${ts.ratio}% of those were mistakes or blunders. ${ts.ratio >= 40 ? 'This is a real discipline issue worth raising: they are blundering when they move too quickly.' : 'Their fast moves were mostly fine.'} Only mention time management if it is genuinely relevant.\n`;
  }

  // Cross-game memory: recurring patterns from the player's history
  if (playerProfile && playerProfile.summary) {
    calibration += `\nSTUDENT HISTORY (from their previous analysed games — use this to spot recurring patterns, but be appropriately humble: frame these as tendencies to watch, not certainties, and only raise them if THIS game shows the same pattern):\n${playerProfile.summary}\n`;
  }

  const userPrompt = calibration + `\n\nAnalyse this game for the student who played ${color}.

Game: ${headers.White || '?'} vs ${headers.Black || '?'}, ${headers.Result || '?'}
Opening: ${openingName || headers.ECO || 'Unknown'}
Book depth: ${bookDepth} plies
TOTAL MOVES IN THIS GAME: ${moves.length} plies (the final move is ply ${moves.length}). Your segments MUST cover all ${moves.length} plies — do not stop before the end of the game.${theoryText}

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


// ═══════════════════════════════════════
// PLAYER FEEDBACK SYNTHESIS (the qualitative portal)
// Takes the coaching from a user's analysed games and synthesises a
// coach's-notebook view of the player. Reasons over stored text + imported
// quantitative data; never re-analyses games.
// ═══════════════════════════════════════

async function generatePlayerFeedback(games) {
  // games: [{ openingName, playerColor, headers, metrics, coaching, createdAt }]
  if (!games || games.length === 0) return null;

  // Build a compact digest of each game for the AI to reason over.
  const digest = games.slice(0, 30).map((g, idx) => {
    const co = g.coaching || {};
    const m = g.metrics || {};
    const ratingTag = g.playerColor === 'w' ? 'WhiteElo' : 'BlackElo';
    const rating = (g.headers && g.headers[ratingTag]) || m.rating || null;
    // Only include accuracy if it came from the platform import, never self-calculated
    const importedAccuracy = (m.platformAccuracy != null) ? m.platformAccuracy : null;
    return {
      game: idx + 1,
      opening: g.openingName || 'Unknown',
      colour: g.playerColor === 'w' ? 'White' : 'Black',
      result: (g.headers && g.headers.Result) || '?',
      rating: rating ? Number(rating) : null,
      source: m.source || 'other',
      timeControl: m.timeControl || null,
      importedAccuracy,
      summary: co.summary || '',
      strengths: co.strengths || [],
      improvementAreas: co.improvementAreas || [],
      study: co.studyRecommendation || '',
    };
  });

  const gameCount = games.length;

  const systemPrompt = `You are a chess coach reviewing your private notes on a student, written after coaching them through several of their games. Your job is to step back and synthesise what you have learned about this player into a coherent, honest picture — the way a real coach mentally holds a model of each student.

You are writing a CURATED FEEDBACK PORTAL, not a stats page. The student's online platforms already show them numbers (accuracy, rating graphs). Your value is the qualitative read they cannot get elsewhere: the patterns, the recurring themes, the human-language understanding of how they play and what would most help them improve.

CRITICAL RULES:
- Base everything ONLY on the game notes provided. Do not invent games, moves, or patterns not supported by the notes.
- This is based on the games the student CHOSE to analyse (${gameCount} of them), which may not be their complete play. Frame your read as "based on the games you've reviewed with me" — never claim it is their complete record.
- Be appropriately humble and honest: distinguish strong recurring patterns (seen across several games) from one-offs. If you have only a few games, say the picture is still forming.
- Any mention of accuracy MUST come only from the importedAccuracy values provided (these are from the player's actual platform). NEVER cite or invent an accuracy percentage that is not in the data. If no importedAccuracy is present, do not mention accuracy numbers at all — speak qualitatively instead.
- Write in warm, direct, experienced-coach prose. Address the student as "you".
- Prioritise actionability: what should they actually work on next?
- NEVER refer to games by number (e.g. "game 3", "games 3, 4, 5"). The student has no way to identify a numbered game. Refer to games qualitatively instead — by how often ("in several recent games"), by opening ("in your Scandinavian games"), by colour, or by result ("in a couple of your losses as Black").

Respond ONLY with valid JSON, no preamble or markdown:
{
  "headline": "One sentence capturing where this player is right now, in a coach's voice",
  "recurringThemes": [
    { "theme": "Short name of the pattern", "detail": "1-2 sentences explaining it in plain language", "games": "how often it showed up, described QUALITATIVELY (e.g. 'in several of your recent games' or 'in your Sicilian games as Black') — NEVER use game numbers like 'game 3' or 'games 3, 4, 5', because the student cannot identify those." }
  ],
  "strengths": [
    { "strength": "Short name", "detail": "1-2 sentences on what they do well" }
  ],
  "focusNext": {
    "priority": "The single most important thing to work on next",
    "why": "1-2 sentences on why this matters most for their results",
    "how": "Concrete, specific advice on how to work on it"
  },
  "phaseRead": "A short paragraph on where in the game (opening/middlegame/endgame) their strengths and weaknesses tend to fall",
  "encouragement": "One honest, motivating closing line — not empty praise, grounded in what you've seen",
  "trainingPlan": [
    { "task": "A specific, concrete practice task the student can act on (e.g. 'Play 5 slow games focusing on completing development before move 10')", "topic": "A short keyword for the chess theme this relates to, for linking resources (e.g. 'opening principles', 'tactics', 'endgames', 'pins', 'Scandinavian Defense')" }
  ]

recurringThemes: 2-4 items, the most important patterns. strengths: 1-3 items. trainingPlan: 2-3 concrete, actionable tasks the student can work on now, each with a topic keyword for linking study resources.`;

  const userPrompt = `Here are my notes from this student's ${gameCount} analysed game(s):\n\n${JSON.stringify(digest, null, 2)}\n\nSynthesise your coaching read of this player.`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    let text = response.content[0].text.trim();
    text = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    const parsed = JSON.parse(text);
    return parsed;
  } catch (err) {
    console.error('Player feedback synthesis error:', err.message);
    return null;
  }
}

module.exports = { generateCoaching, generateMoveByMove, generatePlayerFeedback };





















