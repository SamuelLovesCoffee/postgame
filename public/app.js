// ── Local-currency display (approximate; the charge is ALWAYS in USD via Stripe) ──
// Static, approximate USD->X rates. Exact total is shown in USD at Stripe checkout.
// Refresh these occasionally; precision is not important (a disclaimer is shown).
(function(){
  var RATES = { USD:1, EUR:0.92, GBP:0.79, CHF:0.88, CAD:1.37, AUD:1.52, NZD:1.65,
    JPY:157, INR:83, BRL:5.4, MXN:18, SEK:10.6, NOK:10.7, DKK:6.9, PLN:4.0,
    ZAR:18.5, SGD:1.35, HKD:7.8, CNY:7.2, AED:3.67, TRY:32, CZK:23, RUB:90 };
  var REGION_CCY = { US:'USD', GB:'GBP', IE:'EUR', DE:'EUR', FR:'EUR', IT:'EUR',
    ES:'EUR', NL:'EUR', BE:'EUR', AT:'EUR', PT:'EUR', FI:'EUR', GR:'EUR', LU:'EUR',
    CH:'CHF', CA:'CAD', AU:'AUD', NZ:'NZD', JP:'JPY', IN:'INR', BR:'BRL', MX:'MXN',
    SE:'SEK', NO:'NOK', DK:'DKK', PL:'PLN', ZA:'ZAR', SG:'SGD', HK:'HKD', CN:'CNY',
    AE:'AED', TR:'TRY', CZ:'CZK' };
  // Timezone reflects the user's actual location (e.g. Europe/Zurich), unlike
  // navigator.language which only reflects their chosen browser language.
  var TZ_CCY = {
    'Europe/London':'GBP','Europe/Zurich':'CHF','Europe/Vaduz':'CHF',
    'Europe/Oslo':'NOK','Europe/Stockholm':'SEK','Europe/Copenhagen':'DKK',
    'Europe/Warsaw':'PLN','Europe/Prague':'CZK','Europe/Istanbul':'TRY','Europe/Moscow':'RUB',
    'America/Toronto':'CAD','America/Vancouver':'CAD','America/Edmonton':'CAD',
    'America/Winnipeg':'CAD','America/Halifax':'CAD',
    'America/Sao_Paulo':'BRL','America/Mexico_City':'MXN',
    'Asia/Tokyo':'JPY','Asia/Kolkata':'INR','Asia/Calcutta':'INR','Asia/Shanghai':'CNY',
    'Asia/Singapore':'SGD','Asia/Hong_Kong':'HKD','Asia/Dubai':'AED',
    'Australia/Sydney':'AUD','Australia/Melbourne':'AUD','Australia/Brisbane':'AUD',
    'Australia/Perth':'AUD','Australia/Adelaide':'AUD',
    'Pacific/Auckland':'NZD','Africa/Johannesburg':'ZAR'
  };
  function fromTimezone(){
    try {
      var tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
      if (TZ_CCY[tz]) return TZ_CCY[tz];
      if (tz.indexOf('Europe/') === 0) return 'EUR';   // most of the eurozone
      if (tz.indexOf('Australia/') === 0) return 'AUD';
      return null;
    } catch(e){ return null; }
  }
  function fromLanguage(){
    try {
      var region = ((navigator.language || '').split('-')[1] || '').toUpperCase();
      return REGION_CCY[region] || null;
    } catch(e){ return null; }
  }
  function detectCurrency(){
    // Prefer location (timezone); fall back to browser-language region; then USD.
    return fromTimezone() || fromLanguage() || 'USD';
  }
  function fmt(ccy, usd){
    var amt = usd * (RATES[ccy] || 1);
    try {
      return new Intl.NumberFormat(navigator.language || 'en-US',
        { style:'currency', currency:ccy, maximumFractionDigits:(ccy==='JPY'?0:2) }).format(amt);
    } catch(e){ return '$' + usd.toFixed(2); }
  }
  document.addEventListener('DOMContentLoaded', function(){
    var ccy = detectCurrency();
    document.querySelectorAll('[data-usd]').forEach(function(el){
      var usd = parseFloat(el.getAttribute('data-usd'));
      if (isNaN(usd)) return;
      el.textContent = el.hasAttribute('data-usd-per') ? (fmt(ccy, usd) + ' / game') : fmt(ccy, usd);
    });
    var note = document.getElementById('currencyNote');
    if (note){
      if (ccy === 'USD'){ note.style.display = 'none'; }
      else { note.textContent = '* Local prices are approximate. Payment is processed in USD; your final total may vary slightly with the exchange rate applied by your bank.'; }
    }
  });
})();

// Mobile burger menu
function toggleBurger(){
  const items = document.getElementById('navItems');
  const btn = document.getElementById('burgerBtn');
  if (!items) return;
  const open = items.classList.toggle('open');
  if (btn){ btn.classList.toggle('active', open); btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
}
// Close burger when tapping outside or selecting an item
document.addEventListener('click', function(e){
  const items = document.getElementById('navItems');
  const btn = document.getElementById('burgerBtn');
  if (!items || !btn) return;
  if (items.classList.contains('open')){
    if (e.target.closest('#navItems a, #navItems button')){ items.classList.remove('open'); btn.classList.remove('active'); btn.setAttribute('aria-expanded','false'); return; }
    if (!items.contains(e.target) && !btn.contains(e.target)){ items.classList.remove('open'); btn.classList.remove('active'); btn.setAttribute('aria-expanded','false'); }
  }
});

// ═══════════════════════════════════════
// AUTH STATE
// ═══════════════════════════════════════
let authToken = localStorage.getItem('pg_token');
let currentUser = null;
let authMode = 'login';

async function checkAuth() {
  if (!authToken) { showLoggedOut(); showLanding(); return; }
  try {
    const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + authToken } });
    if (!r.ok) throw new Error();
    const data = await r.json();
    currentUser = data.user;
    document.getElementById('creditBadge').textContent = data.credits;
    showLoggedIn();
    // Show input view if not already in analysis
    if (document.getElementById('analysisView').style.display === 'none'
        && document.getElementById('loadingView').style.display === 'none') {
      showInputView();
    }
  } catch {
    authToken = null;
    localStorage.removeItem('pg_token');
    showLoggedOut();
    showLanding();
  }
}

function showLanding() {
  document.getElementById('landingView').style.display = 'block';
  document.getElementById('inputView').style.display = 'none';
}

function showInputView() {
  document.getElementById('landingView').style.display = 'none';
  document.getElementById('inputView').style.display = 'flex';
}

function showLoggedIn() {
  document.getElementById('authBtns').style.display = 'none';
  document.getElementById('userInfo').style.display = 'flex';
}
function showLoggedOut() {
  document.getElementById('authBtns').style.display = 'flex';
  document.getElementById('userInfo').style.display = 'none';
}

function showAuthModal(mode) {
  // Reset terms checkbox whenever the modal opens
  const cb = document.getElementById('termsCheckbox');
  if (cb) cb.checked = false;
  authMode = mode;
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Log in' : 'Sign up free';
  document.getElementById('authSwitch').innerHTML = mode === 'login'
    ? 'Don\'t have an account? <a href="#" onclick="toggleAuthMode();return false">Sign up</a>'
    : 'Already have an account? <a href="#" onclick="toggleAuthMode();return false">Log in</a>';
  document.getElementById('authError').textContent = '';
  document.getElementById('nameRow').style.display = mode === 'signup' ? 'flex' : 'none';
  document.getElementById('optionalFields').style.display = mode === 'signup' ? 'block' : 'none';
  const termsRow = document.getElementById('termsRow');
  if (termsRow) termsRow.style.display = mode === 'signup' ? 'block' : 'none';
  const subtitle = document.getElementById('authSubtitle');
  if (subtitle) subtitle.textContent = mode === 'signup' ? 'Create your free account. No card needed.' : 'Welcome back.';
  document.getElementById('authModalTitle').textContent = mode === 'signup' ? 'Sign up' : 'Log in';
  document.getElementById('forgotLink').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('authModal').style.display = 'flex';
}

function toggleAuthMode() {
  showAuthModal(authMode === 'login' ? 'signup' : 'login');
}

function showForgotPassword() {
  closeModal('authModal');
  document.getElementById('forgotForm').style.display = 'block';
  document.getElementById('forgotDone').style.display = 'none';
  document.getElementById('forgotError').textContent = '';
  document.getElementById('forgotEmail').value = document.getElementById('authEmail').value.trim();
  document.getElementById('forgotModal').style.display = 'flex';
}

async function submitForgot() {
  const email = document.getElementById('forgotEmail').value.trim();
  const err = document.getElementById('forgotError');
  err.textContent = '';
  if (!email) { err.textContent = 'Please enter your email'; return; }
  try {
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    // Always show success (we don't reveal whether the email exists)
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('forgotDone').style.display = 'block';
  } catch (e) {
    // Even on network error, show the neutral message
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('forgotDone').style.display = 'block';
  }
}

async function submitAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Email and password required'; return; }

  if (authMode === 'signup') {
    const cb = document.getElementById('termsCheckbox');
    if (cb && !cb.checked) {
      errEl.textContent = 'Please agree to the Terms of Service and Privacy Policy to continue.';
      return;
    }
  }

  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
  const body = { email, password };
  if (authMode === 'signup') {
    body.firstName = (document.getElementById('authFirstName').value || '').trim();
    body.lastName = (document.getElementById('authLastName').value || '').trim();
    body.rating = document.getElementById('authRating').value || null;
    body.chessUsername = (document.getElementById('authChessUsername').value || '').trim() || null;
    if (!body.firstName) { errEl.textContent = 'First name is required'; return; }
  }
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    authToken = data.access_token;
    localStorage.setItem('pg_token', authToken);
    currentUser = data.user;
    if (!data.access_token) {
      // Email confirmation required
      document.getElementById('authError').textContent = '';
      document.getElementById('authEmail').value = '';
      document.getElementById('authPassword').value = '';
      closeModal('authModal');
      alert('Check your email for a confirmation link. Once confirmed, log in to start analysing.');
      return;
    }
    closeModal('authModal');
    await checkAuth();
    showInputView();
    // First-login welcome: show right after signup (the very first authenticated moment)
    if (authMode === 'signup'){
      const fn = (currentUser && currentUser.firstName) ? currentUser.firstName : '';
      showWelcome(fn);
    }
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function showWelcome(firstName){
  try { if (localStorage.getItem('pg_welcomed') === '1') return; } catch(e){}
  const title = document.getElementById('welcomeTitle');
  if (title) title.textContent = firstName ? `Welcome, ${firstName}!` : 'Welcome!';
  const m = document.getElementById('welcomeModal');
  if (m) m.style.display = 'flex';
  try { localStorage.setItem('pg_welcomed', '1'); } catch(e){}
}
function closeWelcome(){
  const m = document.getElementById('welcomeModal');
  if (m) m.style.display = 'none';
}

function logout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('pg_token');
  showLoggedOut();
  // Redirect to landing page
  document.getElementById('analysisView').style.display = 'none';
  document.getElementById('inputView').style.display = 'none';
  document.getElementById('loadingView').style.display = 'none';
  showLanding();
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// ═══════════════════════════════════════
// CREDITS
// ═══════════════════════════════════════
async function showCreditsModal() {
  const list = document.getElementById('packageList');
  list.innerHTML = '<p style="color:var(--text-3)">Loading...</p>';
  document.getElementById('creditsModal').style.display = 'flex';
  try {
    const r = await fetch('/api/packages');
    const packages = await r.json();
    list.innerHTML = packages.map(p => `
      <button class="package-card" onclick="buyPackage('${p.id}')">
        <span class="pkg-credits">${p.credits}</span>
        <span class="pkg-label">${p.label}</span>
      </button>
    `).join('');
  } catch { list.innerHTML = '<p>Failed to load packages</p>'; }
}

async function buyPackage(packageId) {
  try {
    const r = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ packageId }),
    });
    const data = await r.json();
    if (data.url) window.location.href = data.url;
  } catch (err) { alert('Checkout failed: ' + err.message); }
}

// ═══════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════
async function showHistory() {
  const list = document.getElementById('historyList');
  list.innerHTML = '<p style="color:var(--text-3)">Loading...</p>';
  document.getElementById('historyModal').style.display = 'flex';
  try {
    const r = await fetch('/api/history', { headers: { Authorization: 'Bearer ' + authToken } });
    const analyses = await r.json();
    if (!analyses.length) { list.innerHTML = '<p style="color:var(--text-3)">No games analysed yet.</p>'; return; }
    list.innerHTML = analyses.map(a => {
      const h = a.headers || {};
      const date = new Date(a.created_at).toLocaleDateString();
      const color = a.player_color === 'w' ? 'White' : 'Black';
      const summary = a.coaching?.summary?.slice(0, 120) || '';
      const trash = '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 6h18\"/><path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/></svg>';
      return `<div class="history-item" onclick="loadAnalysis('${a.id}')">
        <button class="history-delete" title="Delete game" onclick="event.stopPropagation();deleteGame('${a.id}',this)">${trash}</button>
        <div class="hi-header">
          <strong>${h.White || '?'} vs ${h.Black || '?'}</strong>
          <span class="hi-date">${date}</span>
        </div>
        <div class="hi-meta">${a.opening_name || ''} · Played ${color} · ${h.Result || ''}</div>
        <div class="hi-summary">${summary}${summary.length >= 120 ? '...' : ''}</div>
      </div>`;
    }).join('');
  } catch { list.innerHTML = '<p>Failed to load history</p>'; }
}

async function deleteGame(id, btn) {
  if (!confirm('Delete this game analysis? This cannot be undone.')) return;
  try {
    const r = await fetch('/api/analysis/' + id, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + authToken },
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
    // Remove the item from the list
    const item = btn.closest('.history-item');
    if (item) item.remove();
    // If the list is now empty, show the empty message
    const list = document.getElementById('historyList');
    if (list && !list.querySelector('.history-item')) {
      list.innerHTML = '<p style="color:var(--text-3)">No games analysed yet.</p>';
    }
  } catch (e) { alert('Could not delete: ' + e.message); }
}

async function loadAnalysis(id) {
  closeModal('historyModal');
  try {
    const r = await fetch('/api/history/' + id, { headers: { Authorization: 'Bearer ' + authToken } });
    const data = await r.json();
    if (!data.coaching) throw new Error('No coaching data');

    // Rebuild moves from PGN via server-side parsing
    let replayMoves = [];
    try {
      const pr = await fetch('/api/parse-pgn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pgn: data.pgn, playerColor: data.player_color }),
      });
      if (pr.ok) {
        const pd = await pr.json();
        replayMoves = pd.moves || [];
      }
    } catch (e) { console.warn('PGN parse failed:', e); }

    coaching = data.coaching;
    moveComments = {};
    moves = replayMoves;
    flipped = data.player_color === 'b';
    playerColor = data.player_color;
    analysisResult = { analysis: { headers: data.headers || {}, openingName: data.opening_name, moves: replayMoves, playerColor: data.player_color, bookDepth: 0 }, coaching: data.coaching };

    hasEngineData = false;


    document.getElementById('bestToggle').style.display = 'none';
    renderCoaching(analysisResult.analysis, data.coaching);
    document.getElementById('landingView').style.display = 'none';
    document.getElementById('inputView').style.display = 'none';
    document.getElementById('analysisView').style.display = 'block';
    document.getElementById('bestToggle').classList.toggle('active', showBest);
    goToMove(0);
  } catch (err) { console.error(err); showError('Failed to load analysis'); }
}



// ═══════════════════════════════════════
// ACCOUNT MANAGEMENT
// ═══════════════════════════════════════
async function showAccount() {
  document.getElementById('accountModal').style.display = 'flex';
  switchAcctTab('profile');
  try {
    const r = await fetch('/api/account', { headers: { Authorization: 'Bearer ' + authToken } });
    const p = await r.json();
    document.getElementById('acctFirstName').value = p.firstName || '';
    document.getElementById('acctLastName').value = p.lastName || '';
    document.getElementById('acctEmail').value = p.email || '';
    document.getElementById('acctRating').value = p.chessRating || '';
    document.getElementById('acctChessUsername').value = p.chessUsername || '';
    const creditsHtml = `<span class="credit-pill">${p.credits} credit${p.credits === 1 ? '' : 's'}</span>`;
    document.getElementById('acctCredits').innerHTML = creditsHtml;
    document.getElementById('acctCreditsBilling').innerHTML = creditsHtml;
  } catch (e) { console.error(e); }
}

function switchAcctTab(tab) {
  ['profile','security','billing'].forEach(t => {
    document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1)).style.display = t === tab ? 'block' : 'none';
    document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1)).classList.toggle('active', t === tab);
  });
  if (tab === 'billing') loadTransactions();
}

async function saveProfile() {
  const msg = document.getElementById('acctProfileMsg');
  msg.textContent = ''; msg.style.color = '';
  try {
    const r = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({
        firstName: document.getElementById('acctFirstName').value.trim(),
        lastName: document.getElementById('acctLastName').value.trim(),
        chessRating: document.getElementById('acctRating').value || null,
        chessUsername: document.getElementById('acctChessUsername').value.trim() || null,
      }),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
    msg.style.color = 'var(--green)';
    msg.textContent = 'Saved.';
  } catch (e) { msg.textContent = e.message; }
}

async function changePassword() {
  const msg = document.getElementById('acctPasswordMsg');
  msg.textContent = ''; msg.style.color = '';
  const pw = document.getElementById('acctNewPassword').value;
  const confirm = document.getElementById('acctConfirmPassword').value;
  if (pw.length < 6) { msg.textContent = 'Password must be at least 6 characters'; return; }
  if (pw !== confirm) { msg.textContent = 'Passwords do not match'; return; }
  try {
    const r = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ newPassword: pw }),
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
    msg.style.color = 'var(--green)';
    msg.textContent = 'Password changed.';
    document.getElementById('acctNewPassword').value = '';
    document.getElementById('acctConfirmPassword').value = '';
  } catch (e) { msg.textContent = e.message; }
}

async function loadTransactions() {
  const list = document.getElementById('txnList');
  list.innerHTML = '<p style="color:var(--text-3);font-size:13px">Loading...</p>';
  try {
    const r = await fetch('/api/account/transactions', { headers: { Authorization: 'Bearer ' + authToken } });
    const txns = await r.json();
    if (!txns.length) { list.innerHTML = '<p style="color:var(--text-3);font-size:13px">No purchases yet.</p>'; return; }
    list.innerHTML = txns.map(t => {
      const date = new Date(t.created_at).toLocaleDateString();
      const amount = (t.amount_cents / 100).toFixed(2);
      return `<div class="txn-item"><span>+${t.credits_added} credits</span><span class="txn-meta">$${amount} · ${date}</span></div>`;
    }).join('');
  } catch (e) { list.innerHTML = '<p style="color:var(--text-3)">Failed to load.</p>'; }
}

async function confirmDeleteAccount() {
  if (!confirm('Delete your account permanently? This removes all your analyses and remaining credits. This cannot be undone.')) return;
  if (!confirm('Are you absolutely sure? This is your last chance to keep your account.')) return;
  try {
    const r = await fetch('/api/account', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + authToken },
    });
    if (!r.ok) { const e = await r.json(); throw new Error(e.error || 'Failed'); }
    alert('Your account has been deleted.');
    logout();
    closeModal('accountModal');
  } catch (e) { alert('Failed to delete account: ' + e.message); }
}

// ═══════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════
let moves = [];
let coaching = {};
let analysisResult = null;
let currentPly = 0;
let flipped = false;
let showBest = true;
let playerColor = 'w';
let selectedTier = 'quick';

function switchImport(mode) {
  document.getElementById('importPaste').style.display = mode === 'paste' ? 'block' : 'none';
  document.getElementById('importLichess').style.display = mode === 'lichess' ? 'block' : 'none';
  document.getElementById('importChesscom').style.display = mode === 'chesscom' ? 'block' : 'none';
  document.getElementById('importTabPaste').classList.toggle('active', mode === 'paste');
  document.getElementById('importTabLichess').classList.toggle('active', mode === 'lichess');
  document.getElementById('importTabChesscom').classList.toggle('active', mode === 'chesscom');
}

async function fetchLichessGames() {
  const username = document.getElementById('lichessUsername').value.trim();
  const container = document.getElementById('lichessGames');
  if (!username) { container.innerHTML = '<p class="lichess-msg">Enter your Lichess username.</p>'; return; }
  container.innerHTML = '<p class="lichess-msg">Fetching games...</p>';
  try {
    const r = await fetch('/api/lichess/' + encodeURIComponent(username), {
      headers: { Authorization: 'Bearer ' + authToken },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    if (!data.games || !data.games.length) {
      container.innerHTML = '<p class="lichess-msg">No games found for that user.</p>';
      return;
    }
    container.innerHTML = data.games.map((g, i) => {
      const resultClass = g.result === 'win' ? 'win' : g.result === 'loss' ? 'loss' : 'draw';
      const resultLabel = g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw';
      const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '';
      const opp = g.playerColor === 'w' ? g.black : g.white;
      window._lichessGames = window._lichessGames || {};
      window._lichessGames[g.id] = g;
      return `<div class="lichess-game" onclick="selectLichessGame('${g.id}')">
        <div class="lg-main">
          <span class="lg-result ${resultClass}">${resultLabel}</span>
          <span class="lg-opp">vs ${opp || 'Anonymous'}</span>
        </div>
        <div class="lg-meta">${g.opening || g.speed || ''} · ${date} · played ${g.playerColor === 'w' ? 'White' : 'Black'}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="lichess-msg">' + e.message + '</p>';
  }
}

function selectLichessGame(id) {
  const g = window._lichessGames && window._lichessGames[id];
  if (!g) return;
  // Fill the PGN + colour, switch to paste view so the normal flow takes over
  document.getElementById('pgnInput').value = g.pgn;
  document.getElementById('playerColor').value = g.playerColor;
  // Highlight selection
  document.querySelectorAll('.lichess-game').forEach(el => el.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  // Scroll the analyse button into view
  document.getElementById('analyseBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function fetchChesscomGames() {
  const username = document.getElementById('chesscomUsername').value.trim();
  const container = document.getElementById('chesscomGames');
  if (!username) { container.innerHTML = '<p class="lichess-msg">Enter your Chess.com username.</p>'; return; }
  container.innerHTML = '<p class="lichess-msg">Fetching games...</p>';
  try {
    const r = await fetch('/api/chesscom/' + encodeURIComponent(username), {
      headers: { Authorization: 'Bearer ' + authToken },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Failed');
    if (!data.games || !data.games.length) {
      container.innerHTML = '<p class="lichess-msg">No games found for that user.</p>';
      return;
    }
    window._chesscomGames = {};
    container.innerHTML = data.games.map((g) => {
      const resultClass = g.result === 'win' ? 'win' : g.result === 'loss' ? 'loss' : 'draw';
      const resultLabel = g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw';
      const date = g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '';
      const opp = g.playerColor === 'w' ? g.black : g.white;
      window._chesscomGames[g.id] = g;
      return `<div class="lichess-game" onclick="selectChesscomGame('${g.id}')">
        <div class="lg-main">
          <span class="lg-result ${resultClass}">${resultLabel}</span>
          <span class="lg-opp">vs ${opp || 'Unknown'}</span>
        </div>
        <div class="lg-meta">${g.speed || ''} · ${date} · played ${g.playerColor === 'w' ? 'White' : 'Black'}</div>
      </div>`;
    }).join('');
  } catch (e) {
    container.innerHTML = '<p class="lichess-msg">' + e.message + '</p>';
  }
}

function selectChesscomGame(id) {
  const g = window._chesscomGames && window._chesscomGames[id];
  if (!g) return;
  document.getElementById('pgnInput').value = g.pgn;
  document.getElementById('playerColor').value = g.playerColor;
  document.querySelectorAll('#chesscomGames .lichess-game').forEach(el => el.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
  document.getElementById('analyseBtn').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function selectTier(t) {
  selectedTier = t;
  document.getElementById('tierQuick').classList.toggle('selected', t === 'quick');
  document.getElementById('tierDeep').classList.toggle('selected', t === 'deep');
}
let animating = false;
let moveComments = {};
let variationMoves = null; // active clicked variation overlay
let variationBaseFen = null;

const PIECE_CDN = '/pieces/';
const pieceCache = {};
let usePieceImg = true;
(async () => {
  const keys = ['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'];
  const results = await Promise.allSettled(keys.map(k => new Promise((ok, no) => {
    const img = new Image(); img.onload = () => { pieceCache[k] = img.src; ok(); }; img.onerror = no;
    img.src = PIECE_CDN + k + '.svg';
  })));
  if (results.filter(r => r.status === 'rejected').length > 3) usePieceImg = false;
})();

// ═══════════════════════════════════════
// ANALYSIS
// ═══════════════════════════════════════
async function startAnalysis() {
  if (!authToken) { showAuthModal('signup'); return; }

  const pgn = document.getElementById('pgnInput').value.trim();
  if (!pgn) { showError('Please paste a PGN.'); return; }
  playerColor = document.getElementById('playerColor').value;
  flipped = playerColor === 'b';

  const btn = document.getElementById('analyseBtn');
  btn.classList.add('loading'); btn.disabled = true;
  document.getElementById('inputView').style.display = 'none';
  document.getElementById('loadingView').style.display = 'flex';
  document.getElementById('loadingFill').style.width = '0%';
  document.getElementById('loadingMsg').textContent = 'Submitting game...';

  try {
    document.getElementById('loadingMsg').textContent = 'Submitting your game…';

    const submitRes = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ pgn, playerColor, tier: selectedTier }),
    });
    if (!submitRes.ok) {
      const err = await submitRes.json().catch(() => ({}));
      if (submitRes.status === 403) { showCreditsModal(); throw new Error(err.error || 'No credits'); }
      throw new Error(err.error || 'Submission failed');
    }
    const { jobId } = await submitRes.json();

    let finalData = null;
    while (!finalData) {
      await new Promise(r => setTimeout(r, 1500));
      const pollRes = await fetch(`/api/job/${jobId}`);
      if (!pollRes.ok) throw new Error('Lost connection');
      const job = await pollRes.json();
      if (job.status === 'running') {
        document.getElementById('loadingFill').style.width = job.progress + '%';
        document.getElementById('loadingMsg').textContent = job.message;
      } else if (job.status === 'error') { throw new Error(job.error); }
      else if (job.status === 'complete') { finalData = job; }
    }

    moves = finalData.analysis.moves;
    coaching = finalData.coaching;
    moveComments = finalData.moveComments || {};
    analysisResult = finalData;
    hasEngineData = true;


    document.getElementById('bestToggle').style.display = '';
    renderCoaching(finalData.analysis, finalData.coaching);
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('analysisView').style.display = 'block';
    document.getElementById('bestToggle').classList.toggle('active', showBest);
    goToMove(0);
    await checkAuth(); // refresh credit count
  } catch (err) {
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('inputView').style.display = 'block';
    showError(err.message);
  }
  btn.classList.remove('loading'); btn.disabled = false;
}

// ═══════════════════════════════════════
// BOARD
// ═══════════════════════════════════════
function parseFEN(fen) {
  const board = [];
  for (const rank of fen.split(' ')[0].split('/')) {
    const row = [];
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) row.push(null);
      else row.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
    } board.push(row);
  } return board;
}
function sqToVisual(f,r) { return flipped ? {vr:7-r,vf:7-f} : {vr:r,vf:f}; }
function sqNameToCoords(sq) { return {f:sq.charCodeAt(0)-97,r:8-parseInt(sq[1])}; }
const PIECE_GLYPHS = {
  wK:'\u2654', wQ:'\u2655', wR:'\u2656', wB:'\u2657', wN:'\u2658', wP:'\u2659',
  bK:'\u265A', bQ:'\u265B', bR:'\u265C', bB:'\u265D', bN:'\u265E', bP:'\u265F'
};
function mkPiece(code) {
  // Prefer the loaded SVG image if available
  if (usePieceImg && pieceCache[code]) {
    const i = document.createElement('img');
    i.src = pieceCache[code];
    i.draggable = false;
    i.className = 'piece-img';
    // If the image fails to render for any reason, swap to the glyph
    i.onerror = function(){
      const span = document.createElement('span');
      span.className = 'piece-glyph ' + (code[0] === 'w' ? 'piece-white' : 'piece-black');
      span.textContent = PIECE_GLYPHS[code] || '';
      if (i.parentNode) i.parentNode.replaceChild(span, i);
    };
    return i;
  }
  // Fallback: always render a Unicode glyph so a piece is never missing
  const span = document.createElement('span');
  span.className = 'piece-glyph ' + (code[0] === 'w' ? 'piece-white' : 'piece-black');
  span.textContent = PIECE_GLYPHS[code] || '';
  return span;
}
function renderBoardStatic(fen,from,to) {
  const board = parseFEN(fen), el = document.getElementById('board'); el.innerHTML = '';
  for (let vr=0;vr<8;vr++) for (let vf=0;vf<8;vf++) {
    const r=flipped?7-vr:vr, f=flipped?7-vf:vf;
    const sq=document.createElement('div'); sq.className='sq '+((r+f)%2===0?'l':'d');
    const name=String.fromCharCode(97+f)+(8-r);
    if(name===from||name===to) sq.classList.add('hl');
    if(board[r][f]){const p=mkPiece(board[r][f]);if(p)sq.appendChild(p);}
    // Coordinates: rank number on leftmost visual column, file letter on bottom visual row
    if(vf===0){const c=document.createElement('span');c.className='coord coord-rank';c.textContent=(8-r);sq.appendChild(c);}
    if(vr===7){const c=document.createElement('span');c.className='coord coord-file';c.textContent=String.fromCharCode(97+f);sq.appendChild(c);}
    el.appendChild(sq);
  }
}
function renderBoardAnimated(newFen,from,to,dir) {
  if(animating||!from||!to){renderBoardStatic(newFen,from,to);return;}
  const boardEl=document.getElementById('board'),rect=boardEl.getBoundingClientRect(),sz=rect.width/8;
  const newBoard=parseFEN(newFen);
  const src=sqNameToCoords(dir==='forward'?from:to),dst=sqNameToCoords(dir==='forward'?to:from);
  const mp=newBoard[dst.r][dst.f];
  if(!mp||!pieceCache[mp]){renderBoardStatic(newFen,from,to);return;}
  const temp=newBoard.map(r=>[...r]);temp[dst.r][dst.f]=null;
  boardEl.innerHTML='';
  for(let vr=0;vr<8;vr++) for(let vf=0;vf<8;vf++){
    const r=flipped?7-vr:vr,f=flipped?7-vf:vf;
    const sq=document.createElement('div');sq.className='sq '+((r+f)%2===0?'l':'d');
    const name=String.fromCharCode(97+f)+(8-r);
    if(name===from||name===to)sq.classList.add('hl');
    if(temp[r][f]){const p=mkPiece(temp[r][f]);if(p)sq.appendChild(p);}
    boardEl.appendChild(sq);
  }
  animating=true;
  const srcV=sqToVisual(src.f,src.r),dstV=sqToVisual(dst.f,dst.r);
  const anim=document.createElement('div');
  anim.style.cssText=`position:absolute;width:${sz}px;height:${sz}px;z-index:10;pointer-events:none;transition:left .18s ease-out,top .18s ease-out;left:${srcV.vf*sz}px;top:${srcV.vr*sz}px;`;
  const img=document.createElement('img');img.src=pieceCache[mp];
  img.style.cssText='width:85%;height:85%;object-fit:contain;margin:7.5%;filter:drop-shadow(1px 2px 2px rgba(0,0,0,.3))';
  anim.appendChild(img);boardEl.style.position='relative';boardEl.appendChild(anim);
  requestAnimationFrame(()=>{anim.style.left=(dstV.vf*sz)+'px';anim.style.top=(dstV.vr*sz)+'px';});
  const done=()=>{anim.remove();renderBoardStatic(newFen,from,to);animating=false;};
  anim.addEventListener('transitionend',done,{once:true});
  setTimeout(()=>{if(animating)done();},280);
}

// ═══════════════════════════════════════
// EVAL + ARROWS + NAV
// ═══════════════════════════════════════
function cpToWinPct(cp){return 50+50*(2/(1+Math.exp(-0.00368208*cp))-1);}
function updateEval(m){}
function drawArrow(uci){
  const svg=document.getElementById('arrowSvg');
  svg.innerHTML='';
  if(!uci||uci.length<4||!showBest)return;
  const s=100/8;
  const ff=uci.charCodeAt(0)-97,fr=8-parseInt(uci[1]),tf=uci.charCodeAt(2)-97,tr=8-parseInt(uci[3]);
  const fv=flipped?{f:7-ff,r:7-fr}:{f:ff,r:fr},tv=flipped?{f:7-tf,r:7-tr}:{f:tf,r:tr};
  const x1=fv.f*s+s/2,y1=fv.r*s+s/2,x2=tv.f*s+s/2,y2=tv.r*s+s/2;
  let dx=x2-x1,dy=y2-y1;const len=Math.sqrt(dx*dx+dy*dy);if(len<0.01)return;
  const ux=dx/len,uy=dy/len;            // unit vector
  const px=-uy,py=ux;                    // perpendicular
  const shaftW=2.4;                      // half-width of the shaft
  const headLen=5.5, headW=4.6;          // arrowhead dimensions
  // Pull the tip slightly inside the destination square
  const tipX=x2-ux*1.5, tipY=y2-uy*1.5;
  // Base of the arrowhead
  const baseX=tipX-ux*headLen, baseY=tipY-uy*headLen;
  // Start of shaft pulled out of the origin square center a touch
  const startX=x1+ux*1.0, startY=y1+uy*1.0;
  // Build a single polygon: shaft rectangle + triangular head
  const pts=[
    [startX+px*shaftW, startY+py*shaftW],
    [baseX+px*shaftW,  baseY+py*shaftW],
    [baseX+px*headW,   baseY+py*headW],
    [tipX, tipY],
    [baseX-px*headW,   baseY-py*headW],
    [baseX-px*shaftW,  baseY-py*shaftW],
    [startX-px*shaftW, startY-py*shaftW],
  ].map(p=>p[0].toFixed(2)+','+p[1].toFixed(2)).join(' ');
  const poly=document.createElementNS('http://www.w3.org/2000/svg','polygon');
  poly.setAttribute('points',pts);
  poly.setAttribute('fill','rgba(21,128,61,0.78)');
  svg.appendChild(poly);
}
function toggleBest(){showBest=!showBest;document.getElementById('bestToggle').classList.toggle('active',showBest);goToMove(currentPly);}

let hasEngineData = false;

function goToMove(ply){
  ply=Math.max(0,Math.min(ply,moves.length));
  const prev=currentPly;currentPly=ply;
  const single=Math.abs(ply-prev)===1,dir=ply>prev?'forward':'backward';
  if(ply===0){
    const sf='rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    if(single&&prev===1)renderBoardAnimated(sf,moves[0].from,moves[0].to,'backward');
    else renderBoardStatic(sf,null,null);
    updateEval(null);drawArrow(moves.length>0?moves[0].bestMove:null);
  }else{
    const m=moves[ply-1];
    if(single)renderBoardAnimated(m.fen,m.from,m.to,dir);
    else renderBoardStatic(m.fen,m.from,m.to);
    updateEval(m);drawArrow(m.bestMove);
  }
  document.querySelectorAll('.move-chip').forEach(el=>el.classList.remove('active'));
  const ac=document.querySelector(`.move-chip[data-ply="${ply}"]`);
  if(ac){ac.classList.add('active');if(window.innerWidth>900)ac.scrollIntoView({block:'nearest',behavior:'smooth'});}
  document.querySelectorAll('.critical-card').forEach(el=>el.classList.remove('active'));
  const card=document.querySelector(`.critical-card[data-ply="${ply}"]`);if(card)card.classList.add('active');

  // Show engine variation for the move at this ply (if engine data present)
  showVariationForPly(ply);
}

// ── Clickable engine variations ──
function showVariationForPly(ply){
  const panel=document.getElementById('variationPanel');
  if(!panel||!hasEngineData||ply===0){ if(panel)panel.style.display='none'; return; }
  const m=moves[ply-1];
  if(!m||!m.pvLines||!m.pvLines.length||!m.fenBefore){ panel.style.display='none'; return; }
  const best=m.pvLines[0];
  if(!best||!best.san||!best.san.length){ panel.style.display='none'; return; }

  variationBaseFen=m.fenBefore;
  variationMoves=best.san;
  // Determine the move number + side to move at the start of the line
  const startNum=m.moveNumber;           // the move number of the played move
  const whiteToMove=(m.color==='w');     // the line starts with the same side that was to move
  const box=document.getElementById('varMoves');
  box.innerHTML='';
  let num=startNum, white=whiteToMove;
  best.san.forEach((san,i)=>{
    // Add a move-number label before White's moves (and before the very first move)
    if(white){
      const lbl=document.createElement('span');
      lbl.className='var-num';
      lbl.textContent=num+'.';
      box.appendChild(lbl);
    } else if(i===0){
      const lbl=document.createElement('span');
      lbl.className='var-num';
      lbl.textContent=num+'...';
      box.appendChild(lbl);
    }
    const chip=document.createElement('span');
    chip.className='var-move';
    chip.textContent=san;
    chip.onclick=()=>playVariation(i);
    box.appendChild(chip);
    if(!white)num++;
    white=!white;
  });
  panel.style.display='block';
}

function getChessCtor(){
  // chess.js CDN may expose Chess globally or as a property
  if(typeof Chess!=='undefined') return Chess;
  if(typeof window!=='undefined'){
    if(window.Chess) return window.Chess;
    if(window.Chess && window.Chess.Chess) return window.Chess.Chess;
  }
  return null;
}

function playVariation(uptoIndex){
  const Ctor=getChessCtor();
  if(!Ctor||!variationBaseFen||!variationMoves){ console.warn('Variation playback unavailable'); return; }
  let chess;
  try{ chess=new Ctor(variationBaseFen); }catch(e){ console.warn('Chess init failed',e); return; }
  let lastMove=null;
  for(let i=0;i<=uptoIndex;i++){
    let mv=null;
    try{ mv=chess.move(variationMoves[i],{sloppy:true}); }catch(e){ mv=null; }
    if(!mv){ try{ mv=chess.move(variationMoves[i]); }catch(e){ mv=null; } }
    if(!mv)break;
    lastMove=mv;
  }
  if(lastMove){
    renderBoardStatic(chess.fen(),lastMove.from,lastMove.to);
    document.querySelectorAll('.var-move').forEach((el,idx)=>el.classList.toggle('active',idx<=uptoIndex));
  }
}

function clearVariation(){
  document.querySelectorAll('.var-move').forEach(el=>el.classList.remove('active'));
  goToMove(currentPly);
}

// Lucide SVG icons (monochrome, inherit currentColor) — match the landing page
const ICON = {
  lightbulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
  book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>',
  sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>',
};

// ═══════════════════════════════════════
// STUDY RESOURCES (links; affiliate-ready)
// ═══════════════════════════════════════
// Each entry maps detection keywords to a resource. The `url` is what we link to.
// To monetise later, swap these URLs for affiliate/sponsored links in one place.
const STUDY_RESOURCES = [
  // Openings — Lichess opening pages (free, high quality)
  { keys:['slav defense','slav defence','slav'], label:'Slav Defense', url:'https://lichess.org/opening/Slav_Defense' },
  { keys:['queen\'s gambit declined','qgd'], label:"Queen's Gambit Declined", url:'https://lichess.org/opening/Queens_Gambit_Declined' },
  { keys:['queen\'s gambit'], label:"Queen's Gambit", url:'https://lichess.org/opening/Queens_Gambit' },
  { keys:['sicilian'], label:'Sicilian Defense', url:'https://lichess.org/opening/Sicilian_Defense' },
  { keys:['french defense','french defence'], label:'French Defense', url:'https://lichess.org/opening/French_Defense' },
  { keys:['caro-kann','caro kann'], label:'Caro-Kann Defense', url:'https://lichess.org/opening/Caro-Kann_Defense' },
  { keys:['ruy lopez','spanish'], label:'Ruy Lopez', url:'https://lichess.org/opening/Ruy_Lopez' },
  { keys:['italian game','italian'], label:'Italian Game', url:'https://lichess.org/opening/Italian_Game' },
  { keys:['london system','london'], label:'London System', url:'https://lichess.org/opening/London_System' },
  { keys:['king\'s indian'], label:"King's Indian Defense", url:'https://lichess.org/opening/Kings_Indian_Defense' },
  { keys:['nimzo-indian','nimzo indian'], label:'Nimzo-Indian Defense', url:'https://lichess.org/opening/Nimzo-Indian_Defense' },
  { keys:['english opening'], label:'English Opening', url:'https://lichess.org/opening/English_Opening' },
  { keys:['scandinavian'], label:'Scandinavian Defense', url:'https://lichess.org/opening/Scandinavian_Defense' },
  { keys:['vienna'], label:'Vienna Game', url:'https://lichess.org/opening/Vienna_Game' },
  // Tactics & themes — Lichess practice/puzzle themes
  { keys:['pin','pinning'], label:'Pin tactics', url:'https://lichess.org/training/pin' },
  { keys:['fork','forking'], label:'Fork tactics', url:'https://lichess.org/training/fork' },
  { keys:['skewer'], label:'Skewer tactics', url:'https://lichess.org/training/skewer' },
  { keys:['discovered attack','discovery'], label:'Discovered attacks', url:'https://lichess.org/training/discoveredAttack' },
  { keys:['double check'], label:'Double check', url:'https://lichess.org/training/doubleCheck' },
  { keys:['back rank','back-rank'], label:'Back-rank mates', url:'https://lichess.org/training/backRankMate' },
  { keys:['hanging piece','hanging'], label:'Hanging pieces', url:'https://lichess.org/training/hangingPiece' },
  { keys:['deflection'], label:'Deflection', url:'https://lichess.org/training/deflection' },
  { keys:['pawn endgame','pawn ending','king and pawn'], label:'Pawn endgames', url:'https://lichess.org/practice/pawn-endgames/opposition/A4ujYOer' },
  { keys:['rook endgame','rook ending'], label:'Rook endgames', url:'https://lichess.org/practice/rook-endgames/basic-rook-endgames/pqUSUw8Y' },
  { keys:['endgame','endings'], label:'Endgame practice', url:'https://lichess.org/practice' },
  { keys:['opening principles','development','develop your pieces'], label:'Opening principles', url:'https://lichess.org/practice/fundamentals/the-opening/' },
  { keys:['tactics','tactical','combination'], label:'Tactics trainer', url:'https://lichess.org/training' },
];

// Find resources whose keywords appear in the text. Returns up to `max` matches.
function findStudyResources(text, max){
  if(!text) return [];
  const lower=text.toLowerCase();
  const hits=[];
  const seen=new Set();
  for(const r of STUDY_RESOURCES){
    if(seen.has(r.url)) continue;
    if(r.keys.some(k=>lower.includes(k))){
      hits.push(r); seen.add(r.url);
      if(hits.length>=(max||3)) break;
    }
  }
  return hits;
}

// ═══════════════════════════════════════
// COACHING RENDERER
// ═══════════════════════════════════════
function renderCoaching(analysis,coach){
  const col=document.getElementById('coachCol');col.innerHTML='';
  const summary=document.createElement('div');summary.className='coach-summary';
  summary.innerHTML=`<h2>${(analysis.headers||{}).White||'?'} vs ${(analysis.headers||{}).Black||'?'}</h2>
    <div class="summary-text">${coach.summary||''}</div>
    ${analysis.openingName?`<span class="opening-tag">${analysis.openingName}</span>`:''}
    ${coach.opening?`<div class="summary-text" style="margin-top:8px">${coach.opening}</div>`:''}`;
  col.appendChild(summary);
  const critByPly={},missedByPly={};
  (coach.criticalMoments||[]).forEach(cm=>{critByPly[cm.ply]=cm;});
  (coach.missedIdeas||[]).forEach(mi=>{missedByPly[mi.ply]=mi;});
  const brilliantByPly={};(coach.brilliantMoves||[]).forEach(bm=>{brilliantByPly[bm.ply]=bm;});
  let segments=coach.segments||[{startPly:1,endPly:(analysis.moves||[]).length,title:'Game',narrative:''}];
  const allMoves=(analysis.moves||[]);
  // Safety net: ensure the segments cover every move. If the last segment stops
  // short of the final move, extend it (or add a final segment) so no moves vanish.
  if(segments.length&&allMoves.length){
    let maxEnd=Math.max(...segments.map(s=>s.endPly||0));
    if(maxEnd<allMoves.length){
      segments=segments.slice();
      segments.push({startPly:maxEnd+1,endPly:allMoves.length,title:'Final phase',narrative:''});
    }
  }
  for(const seg of segments){
    const segEl=document.createElement('div');segEl.className='segment';
    const header=document.createElement('div');header.className='segment-header';header.textContent=seg.title||'Continuation';segEl.appendChild(header);
    if(seg.narrative){const n=document.createElement('div');n.className='segment-narrative';n.textContent=seg.narrative;segEl.appendChild(n);}
    const sp=seg.startPly||1,ep=Math.min(seg.endPly||(analysis.moves||[]).length,(analysis.moves||[]).length);
    let cg=document.createElement('div');cg.className='move-group';
    for(let i=sp-1;i<ep;i++){
      const m=(analysis.moves||[])[i];if(!m)continue;
      const chip=document.createElement('span');chip.className='move-chip';chip.dataset.ply=m.ply;
      if(m.isBook)chip.classList.add('book');
      chip.innerHTML=(m.color==='w'?`<span class="num">${m.moveNumber}.</span>`:'')+m.san;
      chip.onclick=()=>goToMove(m.ply);cg.appendChild(chip);
      // Move-by-move comment (Deep tier)
      if(moveComments[m.ply]){
        segEl.appendChild(cg);cg=document.createElement('div');cg.className='move-group';
        const mc=document.createElement('div');mc.className='move-comment';
        mc.dataset.ply=m.ply;
        mc.innerHTML=`<span class="mc-move">${m.moveLabel}</span> ${moveComments[m.ply]}`;
        mc.onclick=()=>goToMove(m.ply);
        segEl.appendChild(mc);
      }
      if(critByPly[m.ply]||missedByPly[m.ply]||brilliantByPly[m.ply]){
        segEl.appendChild(cg);cg=document.createElement('div');cg.className='move-group';
        if(critByPly[m.ply])segEl.appendChild(mkCritCard(critByPly[m.ply]));
        if(missedByPly[m.ply])segEl.appendChild(mkMissedCard(missedByPly[m.ply]));
        if(brilliantByPly[m.ply])segEl.appendChild(mkBrilliantCard(brilliantByPly[m.ply]));
      }
    }
    if(cg.children.length>0)segEl.appendChild(cg);
    col.appendChild(segEl);
  }
  const tw=document.createElement('div');tw.className='takeaways';let h='<h3>Takeaways</h3>';
  if(coach.strengths?.length)h+=`<div class="takeaway-section"><h4>Strengths</h4><ul class="takeaway-list strengths">${coach.strengths.map(s=>`<li>${s}</li>`).join('')}</ul></div>`;
  if(coach.improvementAreas?.length)h+=`<div class="takeaway-section"><h4>Areas to improve</h4><ul class="takeaway-list areas">${coach.improvementAreas.map(s=>`<li>${s}</li>`).join('')}</ul></div>`;
  if(coach.studyRecommendation){
    // Search the study rec + improvement areas + opening name for linkable topics
    const searchText=[coach.studyRecommendation,(coach.improvementAreas||[]).join(' '),(analysis.openingName||'')].join(' ');
    const resources=findStudyResources(searchText,3);
    let recHtml=`<div class="takeaway-section"><h4>What to study</h4><div class="study-rec">${coach.studyRecommendation}</div>`;
    if(resources.length){
      recHtml+=`<div class="study-resources"><div class="sr-label">Recommended resources</div>`;
      recHtml+=resources.map(r=>`<a class="sr-link" href="${r.url}" target="_blank" rel="noopener">${ICON.book}<span>${r.label}</span><span class="sr-ext">${ICON.external}</span></a>`).join('');
      recHtml+=`</div>`;
    }
    recHtml+=`</div>`;
    h+=recHtml;
  }
  tw.innerHTML=h;col.appendChild(tw);
  const eb=document.createElement('button');eb.className='export-btn';eb.innerHTML=`<span class="export-icon">${ICON.download}</span> Export coaching report`;eb.onclick=exportReport;col.appendChild(eb);
}
// Get the REAL move label from analysed data by ply (never trust AI's moveLabel text)
function verifiedMoveLabel(ply, fallback) {
  const m = moves.find(mv => mv.ply === ply);
  if (m && m.moveLabel) return m.moveLabel;
  return fallback || '';
}

function mkCritCard(cm){
  const c=document.createElement('div'),t=cm.type||'mistake';c.className=`critical-card type-${t}`;c.dataset.ply=cm.ply;c.onclick=()=>goToMove(cm.ply);
  const bc=['blunder','mistake','inaccuracy'].includes(t)?t:'mistake';
  c.innerHTML=`<div class="cc-header"><span class="cc-badge ${bc}">${t}</span><span class="cc-move">${verifiedMoveLabel(cm.ply, cm.moveLabel)}</span></div>
    <div class="cc-title">${cm.title||''}</div><div class="cc-explanation">${cm.explanation||''}</div>
    ${cm.concept?`<span class="cc-concept">${cm.concept}</span>`:''}${cm.studyTip?`<div class="cc-tip"><span class="cc-tip-icon">${ICON.target}</span><span>${cm.studyTip}</span></div>`:''}`;
  return c;
}
function mkMissedCard(mi){
  const c=document.createElement('div');c.className='critical-card type-idea';c.dataset.ply=mi.ply;c.onclick=()=>goToMove(mi.ply);
  c.innerHTML=`<div class="cc-header"><span class="cc-badge idea"><span class="cc-badge-icon">${ICON.lightbulb}</span>idea</span><span class="cc-move">${verifiedMoveLabel(mi.ply, mi.moveLabel)}</span></div>
    <div class="cc-title">${mi.title||''}</div><div class="cc-explanation">${mi.explanation||''}</div>
    ${mi.engineLine?`<div class="cc-tip"><span class="cc-tip-icon">${ICON.book}</span><span>Engine line: ${mi.engineLine}</span></div>`:''}`;
  return c;
}
function mkBrilliantCard(bm){
  const c=document.createElement('div');c.className='critical-card type-brilliant';c.dataset.ply=bm.ply;c.onclick=()=>goToMove(bm.ply);
  c.innerHTML=`<div class="cc-header"><span class="cc-badge brilliant"><span class="cc-badge-icon">${ICON.sparkles}</span>brilliant</span><span class="cc-move">${verifiedMoveLabel(bm.ply, bm.moveLabel)}</span></div>
    <div class="cc-title">${bm.title||''}</div><div class="cc-explanation">${bm.explanation||''}</div>`;
  return c;
}

// ═══════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════
function exportReport(){
  if(!coaching||!analysisResult)return;
  const a=analysisResult.analysis,c=coaching;
  let md=`# postgame Coaching Report\n\n**${(a.headers||{}).White||'?'} vs ${(a.headers||{}).Black||'?'}** — ${(a.headers||{}).Result||'?'}\n`;
  md+=`**Opening:** ${a.openingName||(a.headers||{}).ECO||'Unknown'}\n**Reviewed as:** ${a.playerColor==='w'?'White':'Black'}\n\n---\n\n## Summary\n\n${c.summary||''}\n\n`;
  if(c.opening)md+=`**Opening:** ${c.opening}\n\n`;
  if(c.segments?.length){md+=`---\n\n## Game Phases\n\n`;for(const s of c.segments)md+=`### ${s.title}\n\n${s.narrative||''}\n\n`;}
  if(c.criticalMoments?.length){md+=`---\n\n## Critical Moments\n\n`;for(const cm of c.criticalMoments)md+=`### ${cm.moveLabel} — ${cm.title}\n\n**${(cm.type||'mistake').toUpperCase()}**\n\n${cm.explanation||''}\n\n${cm.concept?`**Concept:** ${cm.concept}\n\n`:''}${cm.studyTip?`> 💡 ${cm.studyTip}\n\n`:''}`;}
  if(c.missedIdeas?.length){md+=`---\n\n## Missed Ideas\n\n`;for(const mi of c.missedIdeas)md+=`### ${mi.moveLabel} — ${mi.title}\n\n${mi.explanation||''}\n\n${mi.engineLine?`**Engine line:** ${mi.engineLine}\n\n`:''}`;}
  if(c.strengths?.length){md+=`---\n\n## Strengths\n\n`;c.strengths.forEach(s=>{md+=`- ${s}\n`;});md+='\n';}
  if(c.improvementAreas?.length){md+=`## Areas to Improve\n\n`;c.improvementAreas.forEach(s=>{md+=`- ${s}\n`;});md+='\n';}
  if(c.studyRecommendation)md+=`---\n\n## Study Recommendation\n\n${c.studyRecommendation}\n`;
  const blob=new Blob([md],{type:'text/markdown'}),url=URL.createObjectURL(blob);
  const link=document.createElement('a');link.download=`postgame-${((a.headers||{}).White||'w').replace(/\s+/g,'-')}-vs-${((a.headers||{}).Black||'b').replace(/\s+/g,'-')}.md`;
  link.href=url;document.body.appendChild(link);link.click();document.body.removeChild(link);URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════
// UI
// ═══════════════════════════════════════
function showError(m){const e=document.getElementById('errorMsg');e.textContent=m;e.style.display='inline';setTimeout(()=>{e.style.display='none';},6000);}
function showInput(){
  document.getElementById('analysisView').style.display='none';
  showBest=true;document.getElementById('bestToggle').classList.add('active');
  if(authToken){showInputView();}else{showLanding();}
}

document.addEventListener('keydown',e=>{
  if(document.getElementById('analysisView').style.display==='none')return;
  if(e.key==='ArrowLeft'){e.preventDefault();goToMove(currentPly-1);}
  if(e.key==='ArrowRight'){e.preventDefault();goToMove(currentPly+1);}
  if(e.key==='Home'){e.preventDefault();goToMove(0);}
  if(e.key==='End'){e.preventDefault();goToMove(moves.length);}
});

// Check auth on load
checkAuth();
// Check for payment return
if(window.location.search.includes('payment=success')){
  history.replaceState(null,'','/');
  // The webhook adds credits server-side and may lag a second or two behind the
  // redirect, so poll the balance a few times until it updates.
  (async function pollForCredits(){
    let before=null;
    try{ const r=await fetch('/api/account',{headers:{Authorization:'Bearer '+authToken}}); before=(await r.json()).credits; }catch(e){}
    let attempts=0;
    const iv=setInterval(async()=>{
      attempts++;
      await checkAuth();
      let now=null;
      try{ const r=await fetch('/api/account',{headers:{Authorization:'Bearer '+authToken}}); now=(await r.json()).credits; }catch(e){}
      if((before!==null&&now!==null&&now>before)||attempts>=6){
        clearInterval(iv);
        alert('Payment successful! Your credits have been added.');
      }
    },1500);
  })();
}
if(window.location.search.includes('payment=cancelled')){
  history.replaceState(null,'','/');
}








// (Landing board is now a video element — no JS needed)



































// ── Landing-page live "games analysed" stat ──
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    var el = document.getElementById('lpGamesNum');
    var box = document.getElementById('lpTrustGames');
    if (!el || !box) return;
    fetch('/api/stats/public').then(function(r){ return r.json(); }).then(function(d){
      var n = (d && d.gamesAnalysed) || 0;
      // Only surface the count once it reads as credible; below this it stays hidden.
      if (n < 50) return;
      el.textContent = (n >= 1000) ? (Math.floor(n/100)*100).toLocaleString('en-US') + '+'
                                   : (Math.floor(n/50)*50) + '+';
      box.style.display = '';
    }).catch(function(){});
  });
})();

// ── Landing-page testimonials. Add entries to TESTIMONIALS and the section
//    appears automatically; leave it empty and the section stays hidden. ──
(function(){
  var TESTIMONIALS = [
    // { quote: "Finally understood why I keep losing the same way.", name: "Alex R.", detail: "1500 rapid · Chess.com" },
  ];
  document.addEventListener('DOMContentLoaded', function(){
    var wrap = document.getElementById('lpQuotes');
    var sec = document.getElementById('lp-testimonials');
    if (!wrap || !sec || !TESTIMONIALS.length) return;
    function esc(s){ var d = document.createElement('div'); d.textContent = (s == null ? '' : String(s)); return d.innerHTML; }
    wrap.innerHTML = TESTIMONIALS.map(function(t){
      return '<figure class="lp-quote"><blockquote>“' + esc(t.quote) + '”</blockquote>' +
             '<figcaption><span class="lp-quote-name">' + esc(t.name) + '</span>' +
             (t.detail ? '<span class="lp-quote-detail">' + esc(t.detail) + '</span>' : '') +
             '</figcaption></figure>';
    }).join('');
    sec.style.display = '';
  });
})();
