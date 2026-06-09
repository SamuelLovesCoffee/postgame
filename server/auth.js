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
  { id: 'starter', credits: 10, price_cents: 499, label: '10 analyses — $4.99' },
  { id: 'club', credits: 40, price_cents: 1499, label: '40 analyses — $14.99' },
  { id: 'serious', credits: 100, price_cents: 2999, label: '100 analyses — $29.99' },
];

// ── Auth helpers ──

async function signUp(email, password) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // auto-confirm for now
  });
  if (error) throw new Error(error.message);
  return { user: { id: data.user.id, email: data.user.email } };
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

async function saveAnalysis(userId, pgn, playerColor, headers, openingName, coaching, engineSummary) {
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
    })
    .select('id')
    .single();
  if (error) console.error('Save analysis error:', error.message);
  return data ? data.id : null;
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
  if (!stripe) throw new Error('Stripe not configured');
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  if (webhookSecret) {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } else {
    event = JSON.parse(body);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.user_id;
    const credits = parseInt(session.metadata.credits);
    const packageId = session.metadata.package_id;
    const pkg = PACKAGES.find(p => p.id === packageId);

    if (userId && credits > 0) {
      await addCredits(userId, credits);
      await supabase.from('transactions').insert({
        user_id: userId,
        credits_added: credits,
        amount_cents: pkg ? pkg.price_cents : 0,
        stripe_session_id: session.id,
      });
      console.log(`  Credits added: ${credits} for user ${userId}`);
    }
  }
}

module.exports = {
  signUp, signIn, authMiddleware, optionalAuth,
  getCredits, deductCredit, addCredits,
  saveAnalysis, getAnalyses, getAnalysis,
  createCheckoutSession, handleStripeWebhook,
  PACKAGES,
};
