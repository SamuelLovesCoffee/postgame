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
  authMode = mode;
  document.getElementById('authModalTitle').textContent = mode === 'login' ? 'Log in' : 'Sign up';
  document.getElementById('authSubmitBtn').textContent = mode === 'login' ? 'Log in' : 'Sign up';
  document.getElementById('authSwitch').innerHTML = mode === 'login'
    ? 'Don\'t have an account? <a href="#" onclick="toggleAuthMode();return false">Sign up</a>'
    : 'Already have an account? <a href="#" onclick="toggleAuthMode();return false">Log in</a>';
  document.getElementById('authError').textContent = '';
  document.getElementById('authModal').style.display = 'flex';
}

function toggleAuthMode() {
  showAuthModal(authMode === 'login' ? 'signup' : 'login');
}

async function submitAuth() {
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.textContent = '';

  if (!email || !password) { errEl.textContent = 'Email and password required'; return; }

  const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/signup';
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
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
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function logout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('pg_token');
  showLoggedOut();
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
      return `<div class="history-item" onclick="loadAnalysis('${a.id}')">
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
    moves = replayMoves;
    flipped = data.player_color === 'b';
    playerColor = data.player_color;
    analysisResult = { analysis: { headers: data.headers || {}, openingName: data.opening_name, moves: replayMoves, playerColor: data.player_color, bookDepth: 0 }, coaching: data.coaching };

    hasEngineData = false;
    document.getElementById('evalBar').style.display = 'none';
    document.getElementById('evalDisplay').style.display = 'none';
    document.getElementById('bestToggle').style.display = 'none';
    renderCoaching(analysisResult.analysis, data.coaching);
    document.getElementById('landingView').style.display = 'none';
    document.getElementById('inputView').style.display = 'none';
    document.getElementById('analysisView').style.display = 'block';
    goToMove(0);
  } catch (err) { console.error(err); showError('Failed to load analysis'); }
}



// ═══════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════
let moves = [];
let coaching = {};
let analysisResult = null;
let currentPly = 0;
let flipped = false;
let showBest = false;
let playerColor = 'w';
let animating = false;

const PIECE_CDN = 'https://lichess1.org/assets/piece/cburnett/';
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
    const submitRes = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + authToken },
      body: JSON.stringify({ pgn, playerColor }),
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
    analysisResult = finalData;
    hasEngineData = true;
    document.getElementById('evalBar').style.display = '';
    document.getElementById('evalDisplay').style.display = '';
    document.getElementById('bestToggle').style.display = '';
    renderCoaching(finalData.analysis, finalData.coaching);
    document.getElementById('loadingView').style.display = 'none';
    document.getElementById('analysisView').style.display = 'block';
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
function mkPiece(code) {
  if (usePieceImg && pieceCache[code]) { const i = document.createElement('img'); i.src = pieceCache[code]; i.draggable = false; return i; }
  return null;
}
function renderBoardStatic(fen,from,to) {
  const board = parseFEN(fen), el = document.getElementById('board'); el.innerHTML = '';
  for (let vr=0;vr<8;vr++) for (let vf=0;vf<8;vf++) {
    const r=flipped?7-vr:vr, f=flipped?7-vf:vf;
    const sq=document.createElement('div'); sq.className='sq '+((r+f)%2===0?'l':'d');
    const name=String.fromCharCode(97+f)+(8-r);
    if(name===from||name===to) sq.classList.add('hl');
    if(board[r][f]){const p=mkPiece(board[r][f]);if(p)sq.appendChild(p);}
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
function updateEval(m){
  let cp=0,mate=null;
  if(m){cp=m.cpAfter||0;if(m.ply%2===1)cp=-cp;}
  const wpct=mate!=null?(mate>0?97:3):Math.max(3,Math.min(97,cpToWinPct(cp)));
  document.getElementById('evalBarWhite').style.height=wpct+'%';
  document.getElementById('evalBarBlack').style.height=(100-wpct)+'%';
  const str=m?m.evalAfterWhitePersp:'+0.00';
  document.getElementById('evalDisplay').textContent=str;
  const t=document.getElementById('evalLabelTop'),b=document.getElementById('evalLabelBot');
  if(str.startsWith('+')||str.startsWith('0')){b.textContent=str.replace('+','');t.textContent='';}
  else{t.textContent=str.replace('-','');b.textContent='';}
}
function drawArrow(uci){
  const svg=document.getElementById('arrowSvg');
  while(svg.childNodes.length>1)svg.removeChild(svg.lastChild);
  if(!uci||uci.length<4||!showBest)return;
  const s=100/8,ff=uci.charCodeAt(0)-97,fr=8-parseInt(uci[1]),tf=uci.charCodeAt(2)-97,tr=8-parseInt(uci[3]);
  const fv=flipped?{f:7-ff,r:7-fr}:{f:ff,r:fr},tv=flipped?{f:7-tf,r:7-tr}:{f:tf,r:tr};
  const x1=fv.f*s+s/2,y1=fv.r*s+s/2,x2=tv.f*s+s/2,y2=tv.r*s+s/2;
  const dx=x2-x1,dy=y2-y1,len=Math.sqrt(dx*dx+dy*dy);
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');
  line.setAttribute('x1',x1+(dx/len)*2);line.setAttribute('y1',y1+(dy/len)*2);
  line.setAttribute('x2',x2-(dx/len)*3);line.setAttribute('y2',y2-(dy/len)*3);
  line.setAttribute('stroke','rgba(22,163,74,.7)');line.setAttribute('stroke-width','2.8');
  line.setAttribute('stroke-linecap','round');line.setAttribute('marker-end','url(#ah)');
  svg.appendChild(line);
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
  const segments=coach.segments||[{startPly:1,endPly:(analysis.moves||[]).length,title:'Game',narrative:''}];
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
      if(critByPly[m.ply]||missedByPly[m.ply]){
        segEl.appendChild(cg);cg=document.createElement('div');cg.className='move-group';
        if(critByPly[m.ply])segEl.appendChild(mkCritCard(critByPly[m.ply]));
        if(missedByPly[m.ply])segEl.appendChild(mkMissedCard(missedByPly[m.ply]));
      }
    }
    if(cg.children.length>0)segEl.appendChild(cg);
    col.appendChild(segEl);
  }
  const tw=document.createElement('div');tw.className='takeaways';let h='<h3>Takeaways</h3>';
  if(coach.strengths?.length)h+=`<div class="takeaway-section"><h4>Strengths</h4><ul class="takeaway-list strengths">${coach.strengths.map(s=>`<li>${s}</li>`).join('')}</ul></div>`;
  if(coach.improvementAreas?.length)h+=`<div class="takeaway-section"><h4>Areas to improve</h4><ul class="takeaway-list areas">${coach.improvementAreas.map(s=>`<li>${s}</li>`).join('')}</ul></div>`;
  if(coach.studyRecommendation)h+=`<div class="takeaway-section"><h4>What to study</h4><div class="study-rec">${coach.studyRecommendation}</div></div>`;
  tw.innerHTML=h;col.appendChild(tw);
  const eb=document.createElement('button');eb.className='export-btn';eb.textContent='📥 Export coaching report';eb.onclick=exportReport;col.appendChild(eb);
}
function mkCritCard(cm){
  const c=document.createElement('div'),t=cm.type||'mistake';c.className=`critical-card type-${t}`;c.dataset.ply=cm.ply;c.onclick=()=>goToMove(cm.ply);
  const bc=['blunder','mistake','inaccuracy'].includes(t)?t:'mistake';
  c.innerHTML=`<div class="cc-header"><span class="cc-badge ${bc}">${t}</span><span class="cc-move">${cm.moveLabel||''}</span></div>
    <div class="cc-title">${cm.title||''}</div><div class="cc-explanation">${cm.explanation||''}</div>
    ${cm.concept?`<span class="cc-concept">${cm.concept}</span>`:''}${cm.studyTip?`<div class="cc-tip">💡 ${cm.studyTip}</div>`:''}`;
  return c;
}
function mkMissedCard(mi){
  const c=document.createElement('div');c.className='critical-card type-idea';c.dataset.ply=mi.ply;c.onclick=()=>goToMove(mi.ply);
  c.innerHTML=`<div class="cc-header"><span class="cc-badge idea">💡 idea</span><span class="cc-move">${mi.moveLabel||''}</span></div>
    <div class="cc-title">${mi.title||''}</div><div class="cc-explanation">${mi.explanation||''}</div>
    ${mi.engineLine?`<div class="cc-tip">Engine line: ${mi.engineLine}</div>`:''}`;
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
  showBest=false;document.getElementById('bestToggle').classList.remove('active');
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
  setTimeout(()=>{alert('Payment successful! Credits have been added.');checkAuth();},500);
  history.replaceState(null,'','/');
}



