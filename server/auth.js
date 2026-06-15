const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');

// Supabase admin client (service role - bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Stripe
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// Credit packages
const PACKAGES = [
  { id: 'starter', credits: 10, price_cents: 499, label: '10 credits — $4.99' },
  { id: 'club', credits: 30, price_cents: 1199, label: '30 credits — $11.99' },
  { id: 'serious', credits: 75, price_cents: 2499, label: '75 credits — $24.99' },
];

// ── Auth helpers ──

// Resend email config (shared)
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.SMTP_PASS;
const RESEND_FROM = process.env.RESEND_FROM || 'postgame <info@post-game.net>';

async function signUp(email, password, metadata = {}) {
  // Create user with email pre-confirmed so they can sign in immediately
  // (no email validation step).
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      first_name: metadata.firstName || '',
      last_name: metadata.lastName || '',
      chess_rating: metadata.rating || null,
      chess_username: metadata.chessUsername || null,
    },
  });
  if (error) throw new Error(error.message);
  if (!data.user) throw new Error('Signup failed');
  // Notify admin of new signup (fire-and-forget)
  sendAdminNotification(
    `New signup: ${metadata.firstName || ''} ${metadata.lastName || ''} <${email}>`,
    `New account created on postgame\n\nName: ${metadata.firstName || ''} ${metadata.lastName || ''}\nEmail: ${email}\nRating: ${metadata.rating || 'not provided'}\nChess username: ${metadata.chessUsername || 'not provided'}\nTime: ${new Date().toUTCString()}`
  );
  // Send welcome email to new user (fire-and-forget)
  sendWelcomeEmail(email, metadata.firstName || '');
  return { user: { id: data.user.id, email: data.user.email, firstName: metadata.firstName } };
}


async function sendWelcomeEmail(email, firstName) {
  if (!RESEND_API_KEY) { console.log('[welcome] No Resend API key, skipping'); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Samuel at postgame <info@post-game.net>',
        to: email,
        subject: `Welcome to postgame, ${firstName || 'there'}.`,
        template: { id: 'welcome-email', variables: { first_name: firstName || 'there' } },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || JSON.stringify(data));
    console.log('[welcome] Sent to', email, '— id:', data.id);
  } catch (err) {
    console.error('[welcome] Failed:', err.message);
  }
}

async function signIn(email, password) {
  // Use Supabase's signInWithPassword via a temporary client
  const { createClient: createAnonClient } = require('@supabase/supabase-js');
  const anonClient = createAnonClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const { data, error } = await anonClient.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return {
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  };
}

// Middleware: extract and verify user from Bearer token
async function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const token = auth.split(' ')[1];
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = data.user;
  next();
}

// Optional auth: sets req.user if token present, but doesn't block
async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.split(' ')[1];
    const { data } = await supabase.auth.getUser(token);
    if (data && data.user) req.user = data.user;
  }
  next();
}

// ── Credits ──

async function getCredits(userId) {
  const { data, error } = await supabase
    .from('credits')
    .select('balance')
    .eq('user_id', userId)
    .single();
  if (error) return 0;
  return data.balance;
}

async function deductCredit(userId) {
  const balance = await getCredits(userId);
  if (balance <= 0) return false;
  const { error } = await supabase
    .from('credits')
    .update({ balance: balance - 1, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return !error;
}

async function addCredits(userId, amount) {
  const balance = await getCredits(userId);
  const { error } = await supabase
    .from('credits')
    .update({ balance: balance + amount, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return !error;
}

// ── Analyses storage ──

async function saveAnalysis(userId, pgn, playerColor, headers, openingName, coaching, engineSummary, metrics = null) {
  const { data, error } = await supabase
    .from('analyses')
    .insert({
      user_id: userId,
      pgn,
      player_color: playerColor,
      headers,
      opening_name: openingName,
      coaching,
      engine_summary: engineSummary,
      metrics,
    })
    .select('id')
    .single();
  if (error) console.error('Save analysis error:', error.message);
  return data ? data.id : null;
}

// Build a coaching profile from a user's past analysed games.
// Returns { rating, summary, dashboard } or null if too little history.
async function deleteAnalysis(userId, analysisId) {
  const { error } = await supabase
    .from('analyses')
    .delete()
    .eq('id', analysisId)
    .eq('user_id', userId); // ensure users can only delete their own
  if (error) throw new Error(error.message);
  return true;
}

async function getGamesForFeedback(userId, limit = 30) {
  const { data, error } = await supabase
    .from('analyses')
    .select('opening_name, player_color, headers, metrics, coaching, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data.map(g => ({
    openingName: g.opening_name,
    playerColor: g.player_color,
    headers: g.headers,
    metrics: g.metrics,
    coaching: g.coaching,
    createdAt: g.created_at,
  }));
}

async function buildPlayerProfile(userId) {
  const { data, error } = await supabase
    .from('analyses')
    .select('opening_name, player_color, headers, metrics, coaching, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);
  if (error || !data || data.length === 0) return null;

  const games = data.filter(g => g.metrics);
  if (games.length === 0) return { rating: null, summary: null, dashboard: null };

  // Elo time-series per source (lichess / chesscom / other)
  const eloBySource = { lichess: [], chesscom: [], other: [] };

  // Aggregate error counts
  let blunders = 0, mistakes = 0, inaccuracies = 0, totalMoves = 0;
  const openings = {};
  const weaknessThemes = {};
  let fastErrorGames = 0, gamesWithClocks = 0;
  let latestRating = null;

  // Process oldest -> newest for the time-series
  const chronological = games.slice().reverse();
  for (const g of chronological) {
    const m = g.metrics;
    if (m.rating) {
      const src = m.source || 'other';
      const bucket = eloBySource[src] || eloBySource.other;
      bucket.push({ date: m.gameDate || g.created_at, elo: m.rating });
    }
  }

  for (const g of games) {
    const m = g.metrics;
    blunders += m.blunders || 0;
    mistakes += m.mistakes || 0;
    inaccuracies += m.inaccuracies || 0;
    totalMoves += m.moves || 0;
    if (g.opening_name) {
      const o = openings[g.opening_name] || { games: 0, wins: 0 };
      o.games++;
      openings[g.opening_name] = o;
    }
    const areas = (g.coaching && g.coaching.improvementAreas) || [];
    for (const a of areas) {
      const key = a.toLowerCase().slice(0, 60);
      weaknessThemes[key] = (weaknessThemes[key] || 0) + 1;
    }
    if (m.hasClocks) { gamesWithClocks++; if (m.fastErrorRatio >= 40) fastErrorGames++; }
    if (!latestRating && m.rating) latestRating = m.rating;
  }

  // Drop empty source buckets
  Object.keys(eloBySource).forEach(k => { if (!eloBySource[k].length) delete eloBySource[k]; });

  // Top recurring weaknesses (appearing in 2+ games)
  const recurring = Object.entries(weaknessThemes)
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([theme, n]) => ({ theme, count: n }));

  // Build a compact text summary for the coaching prompt
  let summary = `The student has ${games.length} analysed game(s).`;
  summary += ` Across these games: ${blunders} blunders, ${mistakes} mistakes, ${inaccuracies} inaccuracies.`;
  if (recurring.length) {
    summary += ` Recurring themes the coach has flagged before: ${recurring.map(r => r.theme).join('; ')}.`;
  }
  if (gamesWithClocks >= 3 && fastErrorGames / gamesWithClocks >= 0.4) {
    summary += ` They have a tendency to blunder when moving too quickly.`;
  }

  // Opening dashboard data (by frequency)
  const openingStats = Object.entries(openings)
    .map(([name, o]) => ({ name, games: o.games }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 6);

  return {
    rating: latestRating,
    summary,
    dashboard: {
      gameCount: games.length,
      eloBySource,
      errorTotals: { blunders, mistakes, inaccuracies, totalMoves },
      recurringWeaknesses: recurring,
      openings: openingStats,
      timeTrouble: gamesWithClocks >= 3 ? Math.round((fastErrorGames / gamesWithClocks) * 100) : null,
    },
  };
}

async function getAnalyses(userId, limit = 20) {
  const { data, error } = await supabase
    .from('analyses')
    .select('id, pgn, player_color, headers, opening_name, coaching, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return [];
  return data;
}

async function getAnalysis(userId, analysisId) {
  const { data, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('user_id', userId)
    .eq('id', analysisId)
    .single();
  if (error) return null;
  return data;
}

// ── Stripe ──

async function createCheckoutSession(userId, email, packageId, baseUrl) {
  if (!stripe) throw new Error('Stripe not configured');
  const pkg = PACKAGES.find(p => p.id === packageId);
  if (!pkg) throw new Error('Invalid package');

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: email,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: `postgame: ${pkg.label}` },
        unit_amount: pkg.price_cents,
      },
      quantity: 1,
    }],
    metadata: { user_id: userId, package_id: pkg.id, credits: String(pkg.credits) },
    success_url: `${baseUrl}/?payment=success`,
    cancel_url: `${baseUrl}/?payment=cancelled`,
  });

  return { url: session.url, sessionId: session.id };
}

async function handleStripeWebhook(body, signature) {
  console.log('[WEBHOOK] Received Stripe event');
  if (!stripe) throw new Error('Stripe not configured');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    if (webhookSecret) {
      console.log('[WEBHOOK] Verifying signature with webhook secret');
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      console.log('[WEBHOOK] Signature verified');
    } else {
      console.log('[WEBHOOK] WARNING: No webhook secret configured, parsing raw JSON (unsafe for production)');
      event = JSON.parse(body);
    }
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err.message);
    throw err;
  }

  console.log(`[WEBHOOK] Event type: ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.user_id;
    const credits = parseInt(session.metadata?.credits);
    const packageId = session.metadata?.package_id;
    const pkg = PACKAGES.find(p => p.id === packageId);

    console.log(`[WEBHOOK] Checkout completed: session=${session.id}, userId=${userId}, credits=${credits}, pkg=${packageId}`);

    if (userId && credits > 0) {
      // Idempotency: if we've already recorded this session, skip (Stripe may
      // deliver the same event more than once).
      const { data: existing } = await supabase
        .from('transactions')
        .select('id')
        .eq('stripe_session_id', session.id)
        .maybeSingle();
      if (existing) {
        console.log(`[WEBHOOK] Duplicate webhook for session ${session.id}, skipping`);
        return;
      }
      console.log(`[WEBHOOK] Adding ${credits} credits to user ${userId}`);
      await addCredits(userId, credits);
      await supabase.from('transactions').insert({
        user_id: userId,
        credits_added: credits,
        amount_cents: pkg ? pkg.price_cents : 0,
        stripe_session_id: session.id,
      });
      console.log(`[WEBHOOK] ✓ Credits added: ${credits} for user ${userId}`);
    } else {
      console.log(`[WEBHOOK] Invalid session data: userId=${userId}, credits=${credits}`);
    }
  } else {
    console.log(`[WEBHOOK] Ignoring event type: ${event.type}`);
  }
}

// ── Account management ──

async function getProfile(userId) {
  const { data: userData, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !userData.user) return null;
  const meta = userData.user.user_metadata || {};
  const balance = await getCredits(userId);
  return {
    id: userId,
    email: userData.user.email,
    firstName: meta.first_name || '',
    lastName: meta.last_name || '',
    chessRating: meta.chess_rating || null,
    chessUsername: meta.chess_username || null,
    credits: balance,
    createdAt: userData.user.created_at,
  };
}

async function updateProfile(userId, updates) {
  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const existing = (userData && userData.user && userData.user.user_metadata) || {};
  const merged = {
    first_name: updates.firstName !== undefined ? updates.firstName : existing.first_name,
    last_name: updates.lastName !== undefined ? updates.lastName : existing.last_name,
    chess_rating: updates.chessRating !== undefined ? updates.chessRating : existing.chess_rating,
    chess_username: updates.chessUsername !== undefined ? updates.chessUsername : existing.chess_username,
  };
  const { error } = await supabase.auth.admin.updateUserById(userId, { user_metadata: merged });
  return !error;
}

async function changePassword(userId, newPassword) {
  const { error } = await supabase.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) throw new Error(error.message);
  return true;
}

async function getTransactions(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('credits_added, amount_cents, currency, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return data;
}

async function deleteAccount(userId) {
  // Cascading deletes handle credits/analyses/transactions via FK on delete cascade
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
  return true;
}


// ── Email (via Resend HTTP API) ──
async function sendAdminNotification(subject, text) {
  if (!RESEND_API_KEY) { console.log('[notify] No Resend API key, skipping'); return; }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: process.env.ADMIN_NOTIFY_EMAIL || 'samueljosephdavies@gmail.com',
        subject,
        text,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || JSON.stringify(data));
    console.log('[notify] Admin email sent — id:', data.id);
  } catch (err) {
    // Never let a notification failure break the main flow
    console.error('[notify] Email failed:', err.message);
  }
}

// ── Password reset ──

// Request a reset email. Supabase sends it via its own SMTP (bypasses Railway's block).
async function requestPasswordReset(email, redirectUrl) {
  const { createClient: mk } = require('@supabase/supabase-js');
  const anon = mk(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
  // We intentionally do not surface "user not found" — avoid leaking which emails exist.
  if (error && !/not found|no user/i.test(error.message)) {
    console.error('Password reset request error:', error.message);
  }
  return true;
}

// Apply a new password using the recovery token from the email link.
async function applyPasswordReset(accessToken, newPassword) {
  const { createClient: mk } = require('@supabase/supabase-js');
  // A client scoped to the recovery session token from the email link
  const scoped = mk(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { error } = await scoped.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
  return true;
}

// ── Admin dashboard stats ──

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'samueljosephdavies@gmail.com')
  .split(',').map(e => e.trim().toLowerCase());

function isAdmin(email) {
  return email && ADMIN_EMAILS.includes(email.toLowerCase());
}

async function logAnalysisFailure(userId, tier, errorMessage) {
  try {
    await supabase.from('analysis_failures').insert({
      user_id: userId || null,
      tier: tier || null,
      error_message: (errorMessage || '').slice(0, 500),
    });
  } catch (e) {
    console.error('Could not log analysis failure:', e.message);
  }
}

async function getAdminStats() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString();

  // Users
  const { data: usersList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const users = (usersList && usersList.users) || [];
  const totalUsers = users.length;
  const newUsersToday = users.filter(u => u.created_at >= startOfDay).length;
  const newUsersWeek = users.filter(u => u.created_at >= weekAgo).length;

  // Analyses
  const { count: totalAnalyses } = await supabase
    .from('analyses').select('id', { count: 'exact', head: true });
  const { count: analysesToday } = await supabase
    .from('analyses').select('id', { count: 'exact', head: true })
    .gte('created_at', startOfDay);
  const { count: analysesWeek } = await supabase
    .from('analyses').select('id', { count: 'exact', head: true })
    .gte('created_at', weekAgo);

  // Failed analyses
  const { count: failuresTotal } = await supabase
    .from('analysis_failures').select('id', { count: 'exact', head: true });
  const { count: failuresToday } = await supabase
    .from('analysis_failures').select('id', { count: 'exact', head: true })
    .gte('created_at', startOfDay);
  const { count: failuresWeek } = await supabase
    .from('analysis_failures').select('id', { count: 'exact', head: true })
    .gte('created_at', weekAgo);

  // Credits outstanding (sum of balances)
  const { data: creditRows } = await supabase.from('credits').select('balance');
  const creditsOutstanding = (creditRows || []).reduce((s, r) => s + (r.balance || 0), 0);

  // Revenue + credits sold (from transactions)
  const { data: txns } = await supabase
    .from('transactions').select('credits_added, amount_cents, created_at');
  const allTxns = txns || [];
  const revenueCents = allTxns.reduce((s, t) => s + (t.amount_cents || 0), 0);
  const creditsSold = allTxns.reduce((s, t) => s + (t.credits_added || 0), 0);
  const revenueWeekCents = allTxns
    .filter(t => t.created_at >= weekAgo)
    .reduce((s, t) => s + (t.amount_cents || 0), 0);

  return {
    users: { total: totalUsers, today: newUsersToday, week: newUsersWeek },
    analyses: { total: totalAnalyses || 0, today: analysesToday || 0, week: analysesWeek || 0 },
    failures: { total: failuresTotal || 0, today: failuresToday || 0, week: failuresWeek || 0 },
    credits: { outstanding: creditsOutstanding, sold: creditsSold },
    revenue: { totalCents: revenueCents, weekCents: revenueWeekCents, transactions: allTxns.length },
  };
}

// ── Player feedback persistence ──

async function saveFeedback(userId, feedback, gameCount) {
  // Read existing generation count so we can increment it
  const existing = await getSavedFeedback(userId);
  const prevCount = existing ? (existing.generation_count || 0) : 0;
  const { error } = await supabase
    .from('player_feedback')
    .upsert({
      user_id: userId,
      feedback,
      game_count: gameCount,
      generation_count: prevCount + 1,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
  if (error) console.error('Save feedback error:', error.message);
  return !error;
}

async function getSavedFeedback(userId) {
  const { data, error } = await supabase
    .from('player_feedback')
    .select('feedback, game_count, generated_at, generation_count')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

async function getUserFirstName(userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    const meta = (data && data.user && data.user.user_metadata) || {};
    return (meta.first_name || '').trim();
  } catch { return ''; }
}

// Has the user ever purchased credits? (one transaction row = yes)
async function hasEverPurchased(userId) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('user_id', userId)
    .limit(1);
  if (error || !data) return false;
  return data.length > 0;
}


async function getRecentAnalysesAdmin(limit = 100) {
  // Fetch recent analyses
  const { data: rows, error } = await supabase
    .from('analyses')
    .select('id, user_id, opening_name, player_color, headers, metrics, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !rows) return [];

  // Fetch all users to map user_id -> email + name
  const { data: usersList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const users = (usersList && usersList.users) || [];
  const userMap = {};
  for (const u of users) {
    const meta = u.user_metadata || {};
    userMap[u.id] = {
      email: u.email,
      name: [meta.first_name, meta.last_name].filter(Boolean).join(' ') || u.email,
    };
  }

  return rows.map(r => {
    const u = userMap[r.user_id] || { email: 'unknown', name: 'unknown' };
    const headers = r.headers || {};
    const metrics = r.metrics || {};
    const result = headers.Result || '?';
    const tier = metrics.tier || 'quick';
    return {
      id: r.id,
      userEmail: u.email,
      userName: u.name,
      opening: r.opening_name || 'Unknown opening',
      color: r.player_color === 'w' ? 'White' : 'Black',
      result,
      tier,
      createdAt: r.created_at,
    };
  });
}

module.exports = {
  signUp, signIn, authMiddleware, optionalAuth,
  isAdmin, getAdminStats, getRecentAnalysesAdmin, logAnalysisFailure,
  buildPlayerProfile, deleteAnalysis, getGamesForFeedback,
  saveFeedback, getSavedFeedback, hasEverPurchased, getUserFirstName,
  requestPasswordReset, applyPasswordReset,
  getCredits, deductCredit, addCredits,
  saveAnalysis, getAnalyses, getAnalysis,
  createCheckoutSession, handleStripeWebhook,
  getProfile, updateProfile, changePassword, getTransactions, deleteAccount,
  PACKAGES,
};





















