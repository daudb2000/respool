/* Respool — founder ops console (/respool/ops)
   ---------------------------------------------------------------------------
   Reads three bridge views in the PUBLIC schema (they are is_admin-gated
   server-side, so a non-admin session simply gets zero rows — that is the
   "not authorised" state, not an error):

     public.ops_box_queue       one row per box order awaiting/at dispatch
     public.ops_supply          single row: capacity vs inbound pressure
     public.ops_channel_funnel  one row per channel code

   Writes exactly one thing: rpc public.ops_dispatch_box(box_order_id).

   Column names are read defensively (pick()) so a view that spells a column
   slightly differently still renders rather than showing blanks.
   --------------------------------------------------------------------------- */

const CFG = window.RESPOOL_CONFIG || {};
const isPlaceholder = v => !v || v === 'SUPABASE_URL' || v === 'SUPABASE_ANON_KEY' || /^__.*__$/.test(v);
const LIVE = !isPlaceholder(CFG.SUPABASE_URL) && !isPlaceholder(CFG.SUPABASE_ANON_KEY) && typeof window.supabase !== 'undefined';

// The ops views are bridged into `public` (auth + rpc live there too), unlike
// the rest of the platform which sits in the `respool` schema.
const db = LIVE
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { db: { schema: 'public' } })
  : null;

const REFRESH_MS = 60_000;
const CHANNELS = ['mw-bin', 'mw-swatch', 'printables-bin', 'printables-swatch'];

const $ = s => document.querySelector(s);
const el = (t, c, txt) => { const n = document.createElement(t); if (c) n.className = c; if (txt != null) n.textContent = txt; return n; };
const pick = (row, ...keys) => { for (const k of keys) if (row && row[k] != null) return row[k]; return null; };
const num = v => (v == null || v === '' || Number.isNaN(Number(v))) ? null : Number(v);
const fmt = v => v == null ? '—' : new Intl.NumberFormat('en-GB').format(v);
const pct = v => v == null ? '—' : `${(v * 100).toFixed(v * 100 >= 10 ? 0 : 1)}%`;

function age(from) {
  if (!from) return { label: '—', days: 0 };
  const ms = Date.now() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return { label: '—', days: 0 };
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  if (days >= 1) return { label: `${days}d`, days };
  return { label: hours >= 1 ? `${hours}h` : 'just now', days: 0 };
}

/* =========================================================================
   1. AUTH — email OTP
   ========================================================================= */
let session = null;

function gateNote(msg, bad) {
  const n = $('#gateNote');
  n.textContent = msg || '';
  n.style.color = bad ? 'var(--danger)' : 'var(--ink-muted)';
}

function showGate() {
  $('#gate').hidden = false; $('#denied').hidden = true; $('#dash').hidden = true;
  $('#signOut').hidden = true; $('#liveDot').hidden = true; $('#whoami').textContent = '';
  document.title = 'Ops — Respool';
}
function showDenied(email) {
  $('#gate').hidden = true; $('#denied').hidden = false; $('#dash').hidden = true;
  $('#signOut').hidden = false; $('#whoami').textContent = email || '';
  document.title = 'Ops — Respool';
}
function showDash(email) {
  $('#gate').hidden = true; $('#denied').hidden = true; $('#dash').hidden = false;
  $('#signOut').hidden = false; $('#liveDot').hidden = false; $('#whoami').textContent = email || '';
}

let pendingEmail = '';

$('#emailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#email').value.trim();
  if (!email) return;
  if (!db) return gateNote('Supabase is not configured on this deploy — /config.js served no keys.', true);
  $('#sendCode').disabled = true;
  gateNote('Sending…');
  const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  $('#sendCode').disabled = false;
  if (error) return gateNote(error.message, true);
  pendingEmail = email;
  $('#emailForm').hidden = true;
  $('#otpForm').hidden = false;
  $('#otp').focus();
  gateNote(`Code sent to ${email}. It expires in a few minutes.`);
});

$('#otpForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#otp').value.trim();
  if (!token || !db) return;
  gateNote('Checking…');
  const { data, error } = await db.auth.verifyOtp({ email: pendingEmail, token, type: 'email' });
  if (error) return gateNote(error.message, true);
  session = data.session;
  gateNote('');
  boot();
});

$('#resend').addEventListener('click', async () => {
  if (!db || !pendingEmail) return;
  await db.auth.signInWithOtp({ email: pendingEmail, options: { shouldCreateUser: false } });
  gateNote('Code sent again.');
});

async function signOut() {
  if (db) await db.auth.signOut();
  session = null;
  $('#emailForm').hidden = false;
  $('#otpForm').hidden = true;
  $('#otp').value = '';
  showGate();
}
$('#signOut').addEventListener('click', signOut);
$('#deniedSignOut').addEventListener('click', signOut);

/* =========================================================================
   2. PANEL 01 — BOX DISPATCH QUEUE
   ========================================================================= */
let requestedCount = 0;

function setTitleCount(n) {
  document.title = n > 0 ? `(${n}) Ops — Respool` : 'Ops — Respool';
}

function renderQueue(rows) {
  const body = $('#queueBody');
  body.textContent = '';
  requestedCount = 0;

  rows.forEach((r) => {
    const id = pick(r, 'box_order_id', 'id', 'order_id');
    const state = String(pick(r, 'state', 'status') || 'requested').toLowerCase();
    const a = age(pick(r, 'requested_at', 'created_at', 'inserted_at', 'age_from'));
    const ageDaysCol = num(pick(r, 'age_days', 'days_waiting'));
    const days = ageDaysCol != null ? ageDaysCol : a.days;
    if (state === 'requested') requestedCount++;

    const tr = el('tr');
    tr.appendChild(el('td', 'name', pick(r, 'full_name', 'name', 'recipient') || '—'));
    tr.appendChild(el('td', 'mono', String(pick(r, 'postcode', 'post_code') || '—').toUpperCase()));
    tr.appendChild(el('td', 'mono', pick(r, 'size', 'box_size') || '—'));

    const tdState = el('td');
    const tag = el('span', `tag tag-${state}`, state);
    tdState.appendChild(tag);
    tr.appendChild(tdState);

    const tdAge = el('td', `num${days >= 3 ? ' stale' : ''}`, ageDaysCol != null ? `${ageDaysCol}d` : a.label);
    tr.appendChild(tdAge);

    const tdAct = el('td');
    if (state === 'requested' && id) {
      const btn = el('button', 'btn btn-primary btn-sm', 'Dispatched');
      btn.addEventListener('click', () => dispatch(id, btn, tr));
      tdAct.appendChild(btn);
    }
    tr.appendChild(tdAct);
    body.appendChild(tr);
  });

  $('#queueEmpty').hidden = rows.length > 0;
  $('#queueMeta').textContent = `${rows.length} in queue · ${requestedCount} to post`;

  const badge = $('#queueBadge');
  badge.hidden = requestedCount === 0;
  if (requestedCount) badge.querySelector('b').textContent = String(requestedCount);
  setTitleCount(requestedCount);
}

async function dispatch(boxOrderId, btn, tr) {
  if (!db) return;
  btn.disabled = true;
  btn.textContent = 'Marking…';
  const { error } = await db.rpc('ops_dispatch_box', { box_order_id: boxOrderId });
  if (error) {
    btn.disabled = false;
    btn.textContent = 'Retry';
    $('#queueMeta').textContent = `Could not mark dispatched: ${error.message}`;
    return;
  }
  // Optimistic: flip the row now, then reconcile on the next load.
  const tag = tr.querySelector('.tag');
  if (tag) { tag.className = 'tag tag-dispatched'; tag.textContent = 'dispatched'; }
  btn.remove();
  requestedCount = Math.max(0, requestedCount - 1);
  const badge = $('#queueBadge');
  badge.hidden = requestedCount === 0;
  if (requestedCount) badge.querySelector('b').textContent = String(requestedCount);
  setTitleCount(requestedCount);
  load();
}

/* =========================================================================
   3. PANEL 02 — SUPPLY PRESSURE
   ========================================================================= */
function renderSupply(row) {
  const recyclers = num(pick(row, 'active_recyclers', 'recyclers'));
  const headroom  = num(pick(row, 'headroom_kg', 'headroom'));
  const capacity  = num(pick(row, 'capacity_kg', 'total_capacity_kg'));
  const unalloc   = num(pick(row, 'unallocated_shipments', 'unallocated'));
  const boxes     = num(pick(row, 'boxes_awaiting_dispatch', 'boxes_awaiting', 'boxes_pending', 'boxes_requested'));

  $('#sRecyclers').textContent = fmt(recyclers);
  $('#sHeadroom').textContent  = fmt(headroom);
  $('#sUnalloc').textContent   = fmt(unalloc);
  $('#sBoxes').textContent     = fmt(boxes);

  // Fill = how much headroom is left against capacity when we know capacity;
  // otherwise a coarse read off absolute headroom (100kg = comfortable).
  const share = (capacity && capacity > 0 && headroom != null)
    ? Math.max(0, Math.min(1, headroom / capacity))
    : (headroom == null ? 0 : Math.max(0, Math.min(1, headroom / 100)));

  const gauge = $('#gauge');
  gauge.classList.remove('warn', 'crit');
  let line;
  if (headroom != null && headroom <= 0) {
    gauge.classList.add('crit');
    line = 'No headroom left. Nothing new should be routed until a recycler frees capacity — pause box dispatch if this holds.';
  } else if ((unalloc || 0) > 0 && share < 0.2) {
    gauge.classList.add('crit');
    line = `${fmt(unalloc)} shipment${unalloc === 1 ? '' : 's'} with nowhere to go and headroom nearly gone — allocation is widening its search radius.`;
  } else if ((unalloc || 0) > 0) {
    gauge.classList.add('warn');
    line = `${fmt(unalloc)} shipment${unalloc === 1 ? '' : 's'} not yet allocated — allocation is widening its search radius.`;
  } else if (share < 0.25) {
    gauge.classList.add('warn');
    line = 'Headroom is thin. One busy week and inbound scrap will queue — worth signing another recycler now.';
  } else {
    line = 'Comfortable. Everything arriving has a recycler to go to.';
  }

  $('#gaugeFill').style.width = `${Math.round(share * 100)}%`;
  $('#gaugeLine').textContent = line;
  $('#supplyMeta').textContent = capacity ? `${fmt(headroom)} of ${fmt(capacity)} kg free` : '';
}

/* =========================================================================
   4. PANEL 03 — CHANNEL FUNNEL
   ========================================================================= */
function renderFunnel(rows) {
  const body = $('#funnelBody');
  body.textContent = '';

  let hits = 0, orders = 0;
  rows.forEach((r) => {
    const code = pick(r, 'code', 'channel_code', 'channel') || '—';
    const dl   = num(pick(r, 'downloads', 'download_count', 'downloads_manual'));
    const qr   = num(pick(r, 'qr_hits', 'hits', 'hits_total'));
    const h7   = num(pick(r, 'hits_7d', 'qr_hits_7d', 'hits_last_7d'));
    const bo   = num(pick(r, 'box_orders', 'orders', 'box_order_count'));
    // pct() renders a 0-1 ratio, so everything below is normalised to a ratio.
    // The *_pct columns are percent units by name and by definition — the live
    // view computes round(x / y * 100, 1) — so they are ALWAYS divided by 100.
    // Sniffing the magnitude instead would render a real 1.2% funnel as "120%",
    // and sub-1.5% is exactly where a download-to-hit rate normally sits.
    let dlHit  = num(pick(r, 'download_to_hit_pct', 'dl_to_hit_pct'));
    let hitBox = num(pick(r, 'hit_to_box_pct', 'hit_to_box_pct'));
    if (dlHit != null) dlHit /= 100;
    if (hitBox != null) hitBox /= 100;
    // Ratio-named aliases, then a client-side fallback — both already 0-1.
    if (dlHit == null) dlHit = num(pick(r, 'dl_to_hit', 'download_to_hit'));
    if (hitBox == null) hitBox = num(pick(r, 'hit_to_box'));
    if (dlHit == null && dl) dlHit = (qr || 0) / dl;
    if (hitBox == null && qr) hitBox = (bo || 0) / qr;

    hits += qr || 0; orders += bo || 0;

    const tr = el('tr');
    tr.appendChild(el('td', 'mono', code));
    tr.appendChild(el('td', 'num', fmt(dl)));
    tr.appendChild(el('td', 'num', fmt(qr)));
    tr.appendChild(el('td', 'num', fmt(h7)));
    tr.appendChild(el('td', 'num', fmt(bo)));
    tr.appendChild(el('td', 'num', pct(dlHit)));
    tr.appendChild(el('td', 'num', pct(hitBox)));
    body.appendChild(tr);
  });

  if (!rows.length) {
    const tr = el('tr');
    const td = el('td', '', 'No channels yet. Print a QR, publish a model, and this fills itself.');
    td.colSpan = 7; td.style.color = 'var(--ink-muted)';
    tr.appendChild(td); body.appendChild(tr);
  }
  $('#funnelMeta').textContent = `${fmt(hits)} hits → ${fmt(orders)} box orders`;
}

/* =========================================================================
   5. PANEL 04 — QR TOOLKIT
   ========================================================================= */
const qrUrl = (code, mm) => `/respool/qr/channel/${encodeURIComponent(code)}?mm=${encodeURIComponent(mm || 40)}`;

function renderQrToolkit() {
  const grid = $('#qrGrid');
  grid.textContent = '';
  CHANNELS.forEach((code) => {
    const card = el('div', 'qr-card');
    card.appendChild(el('p', 'kicker', 'channel'));
    card.appendChild(el('h3', null, code));
    card.appendChild(el('p', null, `${location.origin}/go/${code}`));
    const row = el('div', 'row');
    [40, 25].forEach((mm) => {
      const a = el('a', 'btn btn-ghost btn-sm', `${mm} mm`);
      a.href = qrUrl(code, mm);
      a.target = '_blank'; a.rel = 'noopener';
      row.appendChild(a);
    });
    card.appendChild(row);
    grid.appendChild(card);
  });
}

$('#qrForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = $('#qrCode').value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{1,64}$/.test(code)) return;
  window.open(qrUrl(code, $('#qrMm').value), '_blank', 'noopener');
});

/* =========================================================================
   6. LOAD + REFRESH
   ========================================================================= */
let timer = null;

async function load() {
  if (!db) return;
  const [queue, supply, funnel] = await Promise.all([
    db.from('ops_box_queue').select('*'),
    db.from('ops_supply').select('*').limit(1),
    db.from('ops_channel_funnel').select('*'),
  ]);

  const anyError = queue.error || supply.error || funnel.error;
  const rows = (queue.data || []).length + (supply.data || []).length + (funnel.data || []).length;

  // Views are is_admin-gated in the database. Nothing back at all = not an
  // admin (or the grant is missing) — say so plainly rather than showing an
  // empty dashboard that looks like a quiet day.
  if (anyError || rows === 0) {
    showDenied(session?.user?.email);
    return;
  }

  showDash(session?.user?.email);
  renderQueue(queue.data || []);
  renderSupply((supply.data || [])[0] || {});
  renderFunnel(funnel.data || []);
  $('#foot').textContent = `Auto-refreshes every 60 seconds · last ${new Date().toLocaleTimeString('en-GB')}`;
}

async function boot() {
  renderQrToolkit();
  if (!db) {
    showGate();
    gateNote('Supabase is not configured on this deploy — /config.js served no keys.', true);
    return;
  }
  const { data } = await db.auth.getSession();
  session = data.session;
  if (!session) return showGate();

  await load();
  clearInterval(timer);
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
}

document.addEventListener('visibilitychange', () => { if (!document.hidden && session) load(); });
boot();
