/* Respool — recycler console
   ---------------------------------------------------------------------------
   Config contract (shared across all Respool pages):

     window.RESPOOL_CONFIG = {
       SUPABASE_URL:      '__SUPABASE_URL__',
       SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__',
       PRICING: { ... }          // served from the pricing engine (§9), never hardcoded
     }

   Placeholders are replaced at deploy. While they are still `__PLACEHOLDER__`
   the page runs on the demo dataset below so the UI is fully explorable, and
   every write is a no-op that reports success locally. Nothing silently
   pretends to have persisted — the DEMO chip in the topbar stays lit.
   --------------------------------------------------------------------------- */

const CFG = Object.assign({
  SUPABASE_URL: '__SUPABASE_URL__',
  SUPABASE_ANON_KEY: '__SUPABASE_ANON_KEY__',
  PRICING: null
}, window.RESPOOL_CONFIG || {});

const isPlaceholder = v => !v || /^__.*__$/.test(v);
const LIVE = !isPlaceholder(CFG.SUPABASE_URL) && !isPlaceholder(CFG.SUPABASE_ANON_KEY);

let sb = null;
if (LIVE && window.supabase) {
  // Tables live in the "respool" schema, not "public" (see supabase/schema.sql).
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
    { db: { schema: CFG.SUPABASE_SCHEMA || 'respool' } });
}

/* Identity and the intake switch are bridged into `public` so no page ever has
   to be told which recycler it is looking at (supabase/bridge-additions.sql).
   supabase-js v2 can retarget a schema per call; older builds cannot, so fall
   back to a second client rather than silently querying the wrong schema. */
let pubClient = null;
function pub() {
  if (!sb) return null;
  if (typeof sb.schema === 'function') return sb.schema('public');
  if (!pubClient) {
    pubClient = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
      { db: { schema: 'public' } });
  }
  return pubClient;
}

/* --- pricing engine defaults (§9.3: config, not code — these are only the
       fallback the engine overrides via RESPOOL_CONFIG.PRICING) ------------- */
const PRICING = Object.assign({
  currency: '£',
  creditRatePerKg: { PLA: 2.00, PETG: 1.70, ABS: 1.40, Mixed: 1.50 },
  floorPerKg: { A: 6.50, B: 5.25, C: 4.00 },
  guidanceBand: {                       // seeded founder estimates → sharpens on real sales
    A: [8.00, 10.50], B: [6.00, 7.50], C: [4.50, 5.50]
  },
  slaDays: 14,
  escalateDays: 21
}, CFG.PRICING || {});

const money = n => PRICING.currency + Number(n || 0).toFixed(2);
const kg = n => Number(n || 0).toFixed(2) + ' kg';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* =========================================================================
   Demo dataset
   ========================================================================= */
const daysFromNow = d => new Date(Date.now() + d * 864e5).toISOString();

const DEMO = {
  recycler: {
    name: 'Pentland Polymers', handle: 'pentland', initials: 'PP',
    tier: 'Established · Tier 2', tierLetter: 'T2',
    city: 'Edinburgh'
  },
  shipments: [
    { id:'RS-4417', sender:'M. Okafor', from:'Leeds', box:'Large', declaredKg:4.30,
      materials:['PLA','PETG'], received:daysFromNow(-12), due:daysFromNow(2), status:'awaiting' },
    { id:'RS-4421', sender:'Hollis Print Co', from:'Sheffield', box:'Large', declaredKg:7.85,
      materials:['PLA'], received:daysFromNow(-15), due:daysFromNow(-1), status:'awaiting' },
    { id:'RS-4430', sender:'J. Whitlock', from:'Carlisle', box:'Small', declaredKg:1.60,
      materials:['PLA'], received:daysFromNow(-3), due:daysFromNow(11), status:'awaiting' },
    { id:'RS-4433', sender:'Rowan Makerspace', from:'Glasgow', box:'Large', declaredKg:6.10,
      materials:['Mixed'], received:daysFromNow(-8), due:daysFromNow(6), status:'awaiting' },
    { id:'RS-4436', sender:'D. Ferreira', from:'Newcastle', box:'Small', declaredKg:2.05,
      materials:['PETG'], received:daysFromNow(-1), due:daysFromNow(13), status:'awaiting' },
    { id:'RS-4402', sender:'K. Bhatt', from:'Durham', box:'Small', declaredKg:1.90,
      materials:['PLA'], received:daysFromNow(-19), due:daysFromNow(-5), status:'credited',
      acceptedKg:1.72, credit:3.44 },
    { id:'RS-4398', sender:'Tyne Print Farm', from:'Gateshead', box:'Large', declaredKg:9.40,
      materials:['PLA','PETG'], received:daysFromNow(-24), due:daysFromNow(-10), status:'credited',
      acceptedKg:8.80, credit:16.94 }
  ],
  listings: [
    { id:'L-201', title:'Slate Marble PLA', grade:'A', kgNet:1.00, dia:1.75, tol:0.03,
      price:9.00, qty:12, c1:'#5B5F73', c2:'#9AA0B8', status:'live' },
    { id:'L-198', title:'Ember Swirl PLA', grade:'B', kgNet:1.00, dia:1.75, tol:0.05,
      price:6.50, qty:5, c1:'#FF6B3D', c2:'#FFB020', status:'live' },
    { id:'L-190', title:'Deep Teal PETG', grade:'A', kgNet:0.75, dia:1.75, tol:0.03,
      price:8.25, qty:3, c1:'#127C6E', c2:'#2ED9C3', status:'live' },
    { id:'L-186', title:'Static Grey PLA', grade:'C', kgNet:1.00, dia:2.85, tol:0.08,
      price:4.75, qty:22, c1:'#3A3543', c2:'#6E6579', status:'draft' }
  ],
  stats: {
    intakeKg90d: 412.5, soldKg90d: 288.0, disputeRate: 0.012, slaOnTime: 0.96,
    gradingAccuracy: 0.94, rank: 4, ofRecyclers: 27, creditIssued: 806.20,
    trend: [18, 26, 22, 31, 29, 44, 38, 52, 47, 61, 58, 73]
  },
  leaderboard: [
    { n:1, name:'Mersey Filament Works', v:'688 kg' },
    { n:2, name:'Brecon Reclaim', v:'571 kg' },
    { n:3, name:'Anvil & Arc', v:'488 kg' },
    { n:4, name:'Pentland Polymers', v:'412 kg', you:true },
    { n:5, name:'Fenland Extrusion', v:'377 kg' }
  ]
};

/* live state (demo data is the seed; live mode replaces it from Supabase) */
const state = {
  recycler: null,     // public.my_recycler row — the page's identity, never a constant
  shipments: DEMO.shipments.slice(),
  listings: DEMO.listings.slice(),
  filter: 'awaiting',
  q: '',
  active: null,       // shipment under verification
  verify: null        // working draft for the verification flow
};

/* =========================================================================
   Data access — one thin layer, so swapping demo → Supabase is a single edit
   ========================================================================= */
const api = {
  /* Who am I? One row, or none. "None" is a real answer — the caller shows the
     become-a-recycler state rather than treating it as a failure. */
  async loadIdentity() {
    if (!sb) return { ok: true, demo: true, recycler: null };
    const { data: { user } = {} } = await sb.auth.getUser();
    if (!user) return { ok: true, signedOut: true, recycler: null };
    const { data, error } = await pub().from('my_recycler').select('*').maybeSingle();
    if (error) return { ok: false, error: error.message };
    return { ok: true, recycler: data || null };
  },
  async setAcceptingIntake(next) {
    if (!sb) return { ok: true, demo: true, value: next };
    const { data, error } = await pub().rpc('set_accepting_intake', { p_accepting: next });
    if (error) return { ok: false, error: error.message };
    return { ok: true, value: data };
  },
  async loadShipments() {
    if (!sb || !state.recycler) return state.shipments;
    const { data, error } = await sb.from('shipments')
      .select('*').eq('recycler_id', state.recycler.id)
      .in('state', ['received', 'verified', 'credited', 'disputed'])
      .order('sla_due_at', { ascending: true, nullsFirst: false });
    if (error) { toast(error.message, 'err'); return state.shipments; }
    return data.map(fromShipmentRow);
  },
  async loadListings() {
    if (!sb || !state.recycler) return state.listings;
    const { data, error } = await sb.from('listings')
      .select('*').eq('recycler_id', state.recycler.id).order('created_at', { ascending: false });
    if (error) { toast(error.message, 'err'); return state.listings; }
    return data;
  },
  async releaseCredit(payload) {
    if (!sb) return { ok: true, demo: true };
    // Credit ledger is append-only (§19) — this is an RPC, never a balance write.
    const { error } = await sb.rpc('release_shipment_credit', payload);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
  async saveListing(payload) {
    if (!sb) return { ok: true, demo: true };
    const { error } = await sb.from('listings')
      .insert(Object.assign({ recycler_id: state.recycler && state.recycler.id }, payload));
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
  async uploadPhoto(file, path) {
    if (!sb) return { ok: true, demo: true, url: URL.createObjectURL(file) };
    const { error } = await sb.storage.from('intake-photos').upload(path, file, { upsert: true });
    if (error) return { ok: false, error: error.message };
    const { data } = sb.storage.from('intake-photos').getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  }
};

/* Live rows arrive in the shape the database keeps them in — grams, enum
   states, no denormalised sender name. The queue renders one shape, so the
   translation happens once, here, instead of leaking into every template. */
const G_TO_KG = g => (Number(g) || 0) / 1000;

function fromShipmentRow(r) {
  const mats = Object.keys(r.material_breakdown || {});
  const declared = r.sent_weight_g;
  return {
    id: r.id,
    ref: (r.tracking_code || r.id || '').toString().slice(0, 8).toUpperCase(),
    sender: r.sender_name || 'Sender withheld',
    from: r.sender_region || '—',
    box: r.box_size || 'Box',
    // Sender's own declaration in grams. Kept as the source figure so the
    // estimate can say plainly that it is an estimate.
    declaredG: declared,
    declaredKg: G_TO_KG(declared),
    materials: mats.length ? mats : ['Mixed'],
    received: r.received_at || r.posted_at || r.created_at,
    due: r.sla_due_at,
    status: r.state === 'credited' ? 'credited' : 'awaiting',
    acceptedKg: G_TO_KG(r.accepted_weight_g),
    credit: (Number(r.credit_pence) || 0) / 100
  };
}

/* Age in the queue, in whole days. The allocator does not rank on distance
   (§8.2) — what a recycler actually needs to see is how long this box has been
   sitting and how much of the SLA it has eaten. */
function ageDays(from) {
  if (!from) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(from)) / 864e5));
}
const ageLabel = d =>
  d === null ? 'arrival not logged'
  : d === 0 ? 'arrived today'
  : d === 1 ? '1 day in queue'
  : `${d} days in queue`;

/* Estimated grams. sent_weight_g is what the sender put on the form, not what
   your scale will say. Never present it as a weight you can pay on. */
function estimatedGrams(s) {
  const g = Number(s.declaredG);
  if (Number.isFinite(g) && g > 0) return g;
  const kgv = Number(s.declaredKg);
  return Number.isFinite(kgv) && kgv > 0 ? Math.round(kgv * 1000) : null;
}
const gramsLabel = g =>
  g === null ? 'no declared weight' : `~${g.toLocaleString('en-GB')} g estimated`;

/* =========================================================================
   Identity — public.my_recycler, never a hardcoded id
   ========================================================================= */
function renderIdentity() {
  const r = state.recycler;
  // Live mode with no recycler row: show nothing rather than the demo trader.
  if (!r && LIVE) { $('#who').innerHTML = ''; return; }
  const name = r ? r.trading_name : DEMO.recycler.name;
  const tier = r ? tierLabel(r.tier) : DEMO.recycler.tier;
  const initials = (name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  $('#who').innerHTML = `<div class="avatar">${esc(initials)}</div>
    <div><b>${esc(name)}</b><span>${esc(tier)}${r && r.region ? ' · ' + esc(r.region) : ''}</span></div>`;
}

const TIERS = {
  applicant: 'Applicant',
  new_and_notable: 'New and notable',
  established: 'Established',
  featured: 'Featured'
};
const tierLabel = t => TIERS[t] || (t ? String(t) : 'Applicant');

/* No recycler row for this account. Not an error — a doorway. */
function showNotRecycler(signedOut) {
  document.body.classList.add('no-recycler');
  $('#notRecycler').hidden = false;
  $('#notRecyclerBody').innerHTML = signedOut
    ? `<p>You are signed out. The console loads your intake queue from your own
         recycler record, so it needs to know who you are.</p>
       <p style="margin-top:14px"><a class="btn" href="/respool/app#signin">Sign in</a></p>`
    : `<p>This account is not set up as a recycler yet. Recyclers take in scrap
         boxes, weigh and grade them, release credit to the sender, and list the
         reground filament as their own batches.</p>
       <p style="margin-top:10px">Applying takes a scale, a business intake
         address, and agreement to the grading scale. We review each one by hand.</p>
       <p style="margin-top:14px"><a class="btn" href="/respool/app#become-a-recycler">Become a recycler</a>
         <a class="btn ghost" href="/respool/app" style="margin-left:8px">Back to the marketplace</a></p>`;
}

/* =========================================================================
   Accepting intake — the recycler's hand on the allocator tap
   ========================================================================= */
function renderIntakeSwitch() {
  const r = state.recycler;
  const on = r ? r.accepting_intake !== false : true;
  const open = r ? Number(r.open_shipments || 0)
                 : state.shipments.filter(s => s.status === 'awaiting').length;

  $('#intakeSwitch').innerHTML = `
    <div class="intake-copy">
      <div class="eyebrow">Allocator</div>
      <h3>Accepting intake</h3>
      <p>${on
        ? `New boxes are being routed to you. ${open} shipment${open === 1 ? '' : 's'} open on your desk.`
        : `Off = the allocator routes new boxes elsewhere. Your queue stays yours — ${open} shipment${open === 1 ? '' : 's'} already assigned to you stay assigned, and their 14-day SLA keeps running.`}</p>
    </div>
    <button class="switch" id="intakeToggle" role="switch"
            aria-checked="${on}" aria-label="Accepting intake">
      <span class="knob"></span>
    </button>
    <span class="switch-state ${on ? 'on' : 'off'}">${on ? 'On' : 'Off'}</span>`;
}

async function toggleIntake() {
  const btn = $('#intakeToggle');
  if (!btn) return;
  const next = btn.getAttribute('aria-checked') !== 'true';
  btn.disabled = true;
  const res = await api.setAcceptingIntake(next);
  btn.disabled = false;
  if (!res.ok) return toast(res.error || 'Could not change intake status', 'err');

  if (state.recycler) state.recycler.accepting_intake = res.value;
  else state.recycler = { accepting_intake: res.value };
  renderIntakeSwitch();
  toast(res.value
    ? 'Accepting intake. New boxes can be routed to you.'
    : 'Intake paused. New boxes go elsewhere; your queue is untouched.',
    res.value ? 'ok' : 'warn');
}

/* =========================================================================
   Chrome: routing, toasts, sheet
   ========================================================================= */
const VIEWS = {
  queue:      { title: 'Intake queue',   sub: 'Verify, weigh, release credit — 14-day SLA from delivery' },
  verify:     { title: 'Verification',   sub: 'Photograph, weigh per material, release credit' },
  listings:   { title: 'Listings',       sub: 'Each batch is its own product' },
  scoreboard: { title: 'Scoreboard',     sub: 'Your public stats, tier and flywheel rank' }
};

function go(view) {
  $$('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  $$('.nav button').forEach(b => b.setAttribute('aria-current', String(b.dataset.go === view)));
  const meta = VIEWS[view] || VIEWS.queue;
  $('#viewTitle').textContent = meta.title;
  $('#viewSub').textContent = meta.sub;
  document.body.classList.remove('rail-open');
  if (location.hash !== '#' + view) history.replaceState(null, '', '#' + view);
  window.scrollTo({ top: 0 });
}

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function openSheet(title, bodyHTML, footHTML) {
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = bodyHTML;
  $('#sheetFoot').innerHTML = footHTML || '';
  $('#sheet').hidden = false; $('#scrim').hidden = false;
}
function closeSheet() { $('#sheet').hidden = true; $('#scrim').hidden = true; }

/* =========================================================================
   SLA maths (§5.4)
   ========================================================================= */
function sla(due) {
  // sla_due_at is only stamped at 'received'. No clock yet is not "0 days left".
  if (!due || isNaN(new Date(due))) return { level: 'ok', label: 'clock not started', pct: 0 };
  const ms = new Date(due) - Date.now();
  const days = ms / 864e5;
  const total = PRICING.slaDays;
  const used = Math.min(1, Math.max(0, (total - days) / total));
  let level = 'ok', label;
  if (days < 0) {
    level = 'late';
    const over = Math.ceil(-days);
    label = over >= (PRICING.escalateDays - PRICING.slaDays) ? `Escalated · ${over}d over` : `${over}d over SLA`;
  } else if (days < 3) {
    level = 'warn';
    label = days < 1 ? `${Math.max(1, Math.round(days * 24))}h left` : `${Math.floor(days)}d left`;
  } else {
    label = `${Math.floor(days)}d left`;
  }
  return { level, label, pct: Math.round(used * 100) };
}

/* =========================================================================
   Intake queue
   ========================================================================= */
function renderQueue() {
  const list = state.shipments.filter(s => {
    if (state.filter === 'awaiting' && s.status !== 'awaiting') return false;
    if (state.filter === 'late' && !(s.status === 'awaiting' && new Date(s.due) < Date.now())) return false;
    if (state.filter === 'done' && s.status !== 'credited') return false;
    if (state.q) {
      const hay = (s.id + ' ' + s.sender + ' ' + s.from).toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });

  const open = state.shipments.filter(s => s.status === 'awaiting');
  const late = open.filter(s => new Date(s.due) < Date.now());
  const dueSoon = open.filter(s => { const d = (new Date(s.due) - Date.now()) / 864e5; return d >= 0 && d < 3; });
  const pendKg = open.reduce((a, s) => a + s.declaredKg, 0);

  $('#queueStats').innerHTML = [
    tile('Awaiting action', open.length, `${kg(pendKg)} declared`, ''),
    tile('Past SLA', late.length, late.length ? 'Ranking at risk' : 'All clear',
         late.length ? 'magenta' : 'teal'),
    tile('Due within 72h', dueSoon.length, 'Verify next', dueSoon.length ? 'amber' : ''),
    tile('Credit issued (90d)', money(DEMO.stats.creditIssued), 'Across all shipments', 'lime')
  ].join('');

  $('#navCount').textContent = open.length;
  $('#navCount').classList.toggle('zero', open.length === 0);

  if (!list.length) {
    $('#queueRows').innerHTML =
      `<div class="empty"><h4>Nothing here</h4><p>No shipments match this filter.</p></div>`;
    return;
  }

  $('#queueRows').innerHTML = list.map(s => {
    const done = s.status === 'credited';
    const t = done ? null : sla(s.due);
    const age = ageDays(s.received);
    const grams = estimatedGrams(s);
    return `<article class="row ${t && t.level === 'late' ? 'is-late' : ''}">
      <div class="ref"><b>${esc(s.ref || s.id)}</b>${esc(s.box)} box · ${kg(s.declaredKg)}</div>
      <div class="who2"><b>${esc(s.sender)}</b><span>${esc(s.from)} · received ${fmtDate(s.received)}</span>
        <span class="alloc">${esc(ageLabel(age))} · ${esc(gramsLabel(grams))}${done ? '' : ' declared'}</span></div>
      <div class="mats">${s.materials.map(m => `<span class="mat" data-m="${m}"><i></i>${m}</span>`).join('')}</div>
      ${done
        ? `<div class="sla ok"><div class="t"><span>Credited</span><b>${money(s.credit)}</b></div>
             <div class="bar"><i style="width:100%"></i></div>
             <div class="t"><span>${kg(s.acceptedKg)} accepted</span></div></div>`
        : `<div class="sla ${t.level}"><div class="t"><span>SLA</span><b>${t.label}</b></div>
             <div class="bar"><i style="width:${t.pct}%"></i></div>
             <div class="t"><span>due ${fmtDate(s.due)}</span></div></div>`}
      <div class="act">
        ${done
          ? `<button class="btn ghost sm" data-receipt="${s.id}">Receipt</button>`
          : `<button class="btn sm" data-verify="${s.id}">Verify</button>`}
      </div>
    </article>`;
  }).join('');
}

const tile = (k, v, d, tone) =>
  `<div class="stat"><div class="k">${k}</div><div class="v ${tone || ''}">${v}</div><div class="d">${d}</div></div>`;

const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/* =========================================================================
   Verification flow (§5.1, §5.2)
   ========================================================================= */
const PHOTO_SLOTS = [
  { id:'arrival',  label:'Parcel on arrival, seal intact', required:true },
  { id:'spread',   label:'Contents spread out',            required:true },
  { id:'scale',    label:'On the scale, reading legible',  required:true },
  { id:'closeup',  label:'Close-up of material surface',   required:false }
];

function startVerify(id) {
  const s = state.shipments.find(x => x.id === id);
  if (!s) return;
  state.active = s;
  state.verify = {
    photos: {},                                   // slotId → {url,name}
    rejectPhoto: null,
    lines: s.materials.map(m => ({ material: m, accepted: '', rejected: '' })),
    note: ''
  };
  renderVerify();
  go('verify');
}

function renderVerify() {
  const s = state.active, v = state.verify;
  if (!s) { $('#verifyBody').innerHTML = emptyVerify(); return; }

  const t = sla(s.due);
  const anyReject = v.lines.some(l => Number(l.rejected) > 0);
  const rejectOK = !anyReject || !!v.rejectPhoto;
  const photosOK = PHOTO_SLOTS.filter(p => p.required).every(p => v.photos[p.id]);
  const accepted = v.lines.reduce((a, l) => a + (Number(l.accepted) || 0), 0);
  const rejected = v.lines.reduce((a, l) => a + (Number(l.rejected) || 0), 0);
  const weighed = accepted + rejected;
  const overDeclared = weighed > s.declaredKg * 1.35 && weighed > 0;
  const anyWeight = accepted > 0;
  const canRelease = photosOK && rejectOK && anyWeight && !overDeclared;

  const creditLines = v.lines.map(l => {
    const rate = PRICING.creditRatePerKg[l.material] ?? PRICING.creditRatePerKg.Mixed;
    const acc = Number(l.accepted) || 0;
    return { ...l, rate, value: acc * rate };
  });
  const credit = creditLines.reduce((a, l) => a + l.value, 0);

  $('#verifyBody').innerHTML = `
    <div class="verify-head">
      <div>
        <div class="eyebrow">Shipment</div>
        <h2 style="font-family:var(--display);font-weight:800;font-size:24px;letter-spacing:-.03em;margin-top:4px">
          ${esc(s.ref || s.id)} · ${esc(s.sender)}</h2>
        <p style="color:var(--muted);font-size:13px;margin-top:4px">
          ${esc(s.from)} · ${esc(s.box)} box · ${kg(s.declaredKg)} declared by sender · received ${fmtDate(s.received)}</p>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <span class="badge ${t.level === 'late' ? 'late' : t.level === 'warn' ? 'warn' : 'ok'}">${t.label}</span>
        <button class="btn ghost sm" data-back>Back to queue</button>
      </div>
    </div>

    <div class="steps">
      <span class="s ${photosOK ? 'done' : 'now'}">1 · Photograph</span><span class="sep"></span>
      <span class="s ${!photosOK ? '' : anyWeight ? 'done' : 'now'}">2 · Weigh per material</span><span class="sep"></span>
      <span class="s ${canRelease ? 'now' : ''}">3 · Release credit</span>
    </div>

    <div class="split">
      <div style="display:flex;flex-direction:column;gap:16px">

        <section class="card">
          <div class="card-h"><h3>Intake photos</h3><div class="spacer"></div>
            <span class="badge ${photosOK ? 'ok' : 'warn'}">${photosOK ? 'Complete' : 'Required slots outstanding'}</span>
          </div>
          <div class="card-b">
            <div class="slots">
              ${PHOTO_SLOTS.map(p => slotHTML(p, v.photos[p.id])).join('')}
            </div>
            <div class="callout" style="margin-top:12px">
              <span>📐</span><div>Photograph from multiple angles with the scale reading legible.
              The sender's own pre-seal photos are attached to this record —
              <a href="#" data-sender-photos style="color:var(--f-teal)">compare them</a> before you weigh.</div>
            </div>
          </div>
        </section>

        <section class="card">
          <div class="card-h"><h3>Accepted weight</h3><div class="spacer"></div>
            <span class="eyebrow">Credit pays on accepted weight only</span></div>
          <div class="card-b">
            <table class="wt">
              <thead><tr><th>Material</th><th>Accepted</th><th>Rejected</th><th>Rate / kg</th><th style="text-align:right">Credit</th></tr></thead>
              <tbody>
                ${creditLines.map((l, i) => `<tr>
                  <td><span class="mat" data-m="${l.material}"><i></i>${l.material}</span></td>
                  <td><input class="num" type="number" min="0" step="0.01" inputmode="decimal"
                        value="${l.accepted}" data-line="${i}" data-k="accepted" aria-label="${l.material} accepted kg">
                      <span class="unit">kg</span></td>
                  <td><input class="num ${Number(l.rejected) > 0 && !v.rejectPhoto ? 'bad' : ''}" type="number" min="0" step="0.01"
                        inputmode="decimal" value="${l.rejected}" data-line="${i}" data-k="rejected"
                        aria-label="${l.material} rejected kg"><span class="unit">kg</span></td>
                  <td class="mono" style="color:var(--muted)">${money(l.rate)}</td>
                  <td class="mono" style="text-align:right">${money(l.value)}</td>
                </tr>`).join('')}
              </tbody>
              <tfoot><tr>
                <td style="color:var(--dim)">Weighed total</td>
                <td>${kg(accepted)}</td>
                <td class="${rejected > 0 ? 'rej' : ''}">${kg(rejected)}</td>
                <td colspan="2" style="text-align:right;color:var(--dim)">
                  vs ${kg(s.declaredKg)} declared</td>
              </tr></tfoot>
            </table>
            ${overDeclared ? `<div class="callout stop" style="margin-top:12px"><span>⚠</span><div>
              <b>Weight is more than 35% above declared.</b> Re-check the scale before releasing —
              outlier weights are flagged to the platform (§8.4).</div></div>` : ''}
          </div>
        </section>

        ${anyReject ? `<section class="card">
          <div class="card-h"><h3>Rejected material</h3><div class="spacer"></div>
            <span class="badge ${v.rejectPhoto ? 'ok' : 'late'}">${v.rejectPhoto ? 'Evidence attached' : 'Photo mandatory'}</span></div>
          <div class="card-b">
            <div class="callout stop" style="margin-bottom:12px"><span>!</span><div>
              <b>Photo evidence of rejected material is mandatory.</b> Credit cannot be released without it.
              Rejected material is not returned to the sender — they were told this before posting.</div></div>
            <div class="slots" style="max-width:320px">
              ${slotHTML({ id:'reject', label:'Rejected material, laid out separately', required:true, blocked:true }, v.rejectPhoto)}
            </div>
            <div class="field" style="margin-top:14px">
              <label for="rejNote">Reason shown to the sender</label>
              <textarea class="note" id="rejNote" placeholder="e.g. 1.2 kg of supports with embedded brass inserts; 0.3 kg glued assemblies.">${esc(v.note)}</textarea>
              <div class="hint">Plain and specific. This is the text that decides whether they dispute.</div>
            </div>
          </div>
        </section>` : ''}
      </div>

      <aside class="card credit-panel">
        <div class="card-h"><h3>Credit to release</h3></div>
        <div class="card-b">
          ${creditLines.map(l => `<div class="credit-line">
            <span>${l.material} · ${kg(Number(l.accepted) || 0)} @ ${money(l.rate)}</span>
            <b>${money(l.value)}</b></div>`).join('')}
          ${rejected > 0 ? `<div class="credit-line"><span class="rej">Rejected ${kg(rejected)}</span>
            <b class="rej">${money(0)}</b></div>` : ''}
          <div class="credit-total"><span>To sender</span><b>${money(credit)}</b></div>
          <p style="font-size:12px;color:var(--dim);margin-top:10px">
            Worth ${money(credit * 2)} against recycled filament at the 2× redemption rate.
            The sender sees both figures.</p>

          <div style="display:flex;flex-direction:column;gap:8px;margin-top:16px">
            <button class="btn credit" data-release ${canRelease ? '' : 'disabled'}>Release ${money(credit)} credit</button>
            <button class="btn ghost" data-save>Save progress</button>
          </div>
          ${!canRelease ? `<ul style="list-style:none;font-size:12px;color:var(--muted);margin-top:12px;display:flex;flex-direction:column;gap:5px">
            ${!photosOK ? '<li>· Required intake photos missing</li>' : ''}
            ${!rejectOK ? '<li>· Rejection photo required</li>' : ''}
            ${!anyWeight ? '<li>· Enter an accepted weight</li>' : ''}
            ${overDeclared ? '<li>· Weight outlier — re-check scale</li>' : ''}
          </ul>` : ''}
        </div>
      </aside>
    </div>`;
}

function slotHTML(p, filled) {
  return `<label class="slot ${filled ? 'filled' : ''} ${p.required ? 'required' : ''} ${p.blocked ? 'blocked' : ''}">
    ${filled ? `<img src="${filled.url}" alt="">` : ''}
    <span class="lab">${filled ? esc(filled.name) : `<span class="plus">+</span>${esc(p.label)}${p.required ? '<br>Required' : '<br>Optional'}`}</span>
    <input type="file" accept="image/*" capture="environment" data-slot="${p.id}">
  </label>`;
}

const emptyVerify = () => `<div class="empty"><h4>No shipment selected</h4>
  <p>Pick one from the intake queue to start verifying.</p>
  <p style="margin-top:14px"><button class="btn ghost" data-back>Go to queue</button></p></div>`;

/* =========================================================================
   Listings manager + live pricing guidance (§9.2)
   ========================================================================= */
function renderListings() {
  $('#listingTiles').innerHTML = state.listings.map(l => `
    <article class="tile">
      <div class="swatch" style="background:linear-gradient(140deg,${l.c1},${l.c2})">
        <span class="badge solid tag">Grade ${l.grade}</span>
      </div>
      <div class="tile-b">
        <h4>${esc(l.title)}</h4>
        <div class="sub">${l.dia} mm ±${l.tol.toFixed(2)} · ${kg(l.kgNet)} net · ${l.qty} left</div>
        <div class="tile-meta">
          <span class="kg">${money(l.price / l.kgNet)}<span style="font-size:11px;color:var(--muted)">/kg</span></span>
          <span class="badge ${l.status === 'live' ? 'ok' : ''}">${l.status}</span>
        </div>
      </div>
    </article>`).join('');
}

const GRADE_TEXT = {
  A: 'Consistent diameter, no visible inclusions, dried and sealed.',
  B: 'Minor colour variation or occasional inclusion. Prints reliably.',
  C: 'Visible variation or wider tolerance. Priced accordingly.'
};

function renderGuidance() {
  const grade = $('#lGrade').value;
  const priceEl = $('#lPrice'), netEl = $('#lNet');
  const price = Number(priceEl.value) || 0;
  const net = Number(netEl.value) || 1;
  const perKg = net > 0 ? price / net : 0;

  const floor = PRICING.floorPerKg[grade];
  const [lo, hi] = PRICING.guidanceBand[grade];
  const scaleMax = Math.max(hi * 1.45, perKg * 1.15, 12);

  const pct = v => Math.min(100, Math.max(0, (v / scaleMax) * 100));

  let cls = 'good', msg = `<b>${money(perKg)}/kg</b> sits inside the range comparable Grade ${grade} spools sell at.`;
  if (perKg > 0 && perKg < floor) {
    cls = 'floor';
    msg = `<b>Below the ${money(floor)}/kg floor for Grade ${grade}.</b> The floor is a hard minimum, not a suggestion — this listing cannot go live until you raise it.`;
  } else if (perKg > hi * 1.12) {
    cls = 'high';
    msg = `<b>This looks high for Grade ${grade}.</b> Similar spools sell at ${money(lo)}–${money(hi)}/kg. Price up if the quality genuinely justifies it — buyers compare on price per kilo.`;
  } else if (perKg > 0 && perKg < lo) {
    cls = 'good';
    msg = `<b>Cheap for Grade ${grade}.</b> Above the floor, so it will list — but you are leaving margin on the table against a ${money(lo)}–${money(hi)}/kg band.`;
  } else if (!perKg) {
    cls = ''; msg = 'Enter a price to see how it compares with what similar spools have actually sold for.';
  }

  $('#gaugeFloor').style.width = pct(floor) + '%';
  $('#gaugeBand').style.left = pct(lo) + '%';
  $('#gaugeBand').style.width = (pct(hi) - pct(lo)) + '%';
  const pin = $('#gaugePin');
  pin.style.left = pct(perKg) + '%';
  pin.dataset.v = money(perKg) + '/kg';
  pin.style.opacity = perKg ? 1 : 0;
  $('#gaugeMax').textContent = money(scaleMax) + '/kg';
  $('#gaugeFloorLab').textContent = `floor ${money(floor)}`;

  const vd = $('#verdict');
  vd.className = 'verdict ' + cls;
  vd.innerHTML = msg;

  $('#gradeText').textContent = GRADE_TEXT[grade];
  $('#compBand').textContent = `${money(lo)} – ${money(hi)}`;
  $('#compFloor').textContent = money(floor) + '/kg';
  $('#compCredit').textContent = money(perKg * net / 2) + ' of credit';
  $('#saveListing').disabled = !(perKg >= floor);
}

/* =========================================================================
   Scoreboard (§8, §10.5)
   ========================================================================= */
function renderScoreboard() {
  const s = DEMO.stats;
  $('#sbStats').innerHTML = [
    tile('Intake, 90 days', kg(s.intakeKg90d), 'Recency-weighted for ranking', 'teal'),
    tile('Sold, 90 days', kg(s.soldKg90d), 'Recycled filament shipped', 'amber'),
    tile('Dispute rate', (s.disputeRate * 100).toFixed(1) + '%', 'Platform median 2.4%', 'teal'),
    tile('Flywheel rank', '#' + s.rank, `of ${s.ofRecyclers} established recyclers`, 'violet')
  ].join('');

  $('#meters').innerHTML = [
    meter('SLA compliance', s.slaOnTime, 'Credit released inside 14 days', 0.9),
    meter('Grading accuracy', s.gradingAccuracy, 'Self-declared grade vs buyer reports', 0.9),
    meter('Dispute-free shipments', 1 - s.disputeRate, 'Rolling 90 days', 0.95)
  ].join('');

  $('#lead').innerHTML = DEMO.leaderboard.map(r =>
    `<div class="r ${r.you ? 'you' : ''}"><span class="n">${r.n}</span>
      <span>${esc(r.name)}${r.you ? ' <span class="badge ok" style="margin-left:6px">you</span>' : ''}</span>
      <span class="v">${r.v}</span></div>`).join('');

  $('#spark').innerHTML = sparkline(s.trend);
}

function meter(label, val, sub, target) {
  const cls = val >= target ? '' : val >= target - 0.08 ? 'warn' : 'bad';
  return `<div class="meter ${cls}">
    <div class="t"><span>${label}</span><b>${(val * 100).toFixed(1)}%</b></div>
    <div class="bar"><i style="width:${val * 100}%"></i></div>
    <div class="sub">${sub}</div></div>`;
}

function sparkline(data) {
  const w = 320, h = 52, max = Math.max(...data), min = 0;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((d - min) / (max - min || 1)) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--f-teal)" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="0,${h} ${pts.join(' ')} ${w},${h}" fill="rgba(46,217,195,.10)" stroke="none"/>
  </svg>`;
}

/* =========================================================================
   Events
   ========================================================================= */
function wire() {
  $$('.nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  $('#burger').addEventListener('click', () => document.body.classList.toggle('rail-open'));
  $('#scrim').addEventListener('click', closeSheet);
  $('#sheetClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

  /* queue */
  $$('#queueSeg button').forEach(b => b.addEventListener('click', () => {
    state.filter = b.dataset.f;
    $$('#queueSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    renderQueue();
  }));
  $('#queueSearch').addEventListener('input', e => { state.q = e.target.value; renderQueue(); });

  /* accepting intake — re-rendered on change, so delegate */
  $('#intakeSwitch').addEventListener('click', e => {
    if (e.target.closest('#intakeToggle')) toggleIntake();
  });

  $('#queueRows').addEventListener('click', e => {
    const v = e.target.closest('[data-verify]');
    if (v) return startVerify(v.dataset.verify);
    const r = e.target.closest('[data-receipt]');
    if (r) {
      const s = state.shipments.find(x => x.id === r.dataset.receipt);
      openSheet(`Receipt · ${s.ref || s.id}`, `
        <p style="color:var(--muted);font-size:13px;margin-bottom:14px">Append-only ledger entry. Adjustments are new entries, never edits.</p>
        <div class="credit-line"><span>Declared by sender</span><b>${kg(s.declaredKg)}</b></div>
        <div class="credit-line"><span>Accepted weight</span><b>${kg(s.acceptedKg)}</b></div>
        <div class="credit-line"><span>Rejected</span><b>${kg(s.declaredKg - s.acceptedKg)}</b></div>
        <div class="credit-total"><span>Credit released</span><b>${money(s.credit)}</b></div>`,
        `<button class="btn ghost" onclick="document.getElementById('sheetClose').click()">Close</button>`);
    }
  });

  /* verification — delegated because the panel re-renders on every keystroke */
  $('#verifyBody').addEventListener('click', e => {
    if (e.target.closest('[data-back]')) { state.active = null; go('queue'); }
    if (e.target.closest('[data-sender-photos]')) {
      e.preventDefault();
      openSheet('Sender photos · pre-seal',
        `<p style="color:var(--muted);font-size:13px">Captured in-app by the sender before sealing the box.
         Discrepancies between these and your arrival photos are the evidence base for any dispute.</p>
         <div class="slots" style="margin-top:14px">
           ${['Contents spread','Non-PLA separated','Box sealed'].map(l =>
             `<div class="slot filled" style="background:linear-gradient(140deg,#2A2235,#3A3543)">
                <span class="lab">${l}</span></div>`).join('')}
         </div>`);
    }
    if (e.target.closest('[data-save]')) toast('Progress saved to this shipment record.');
    if (e.target.closest('[data-release]')) release();
  });

  $('#verifyBody').addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.line !== undefined) {
      const line = state.verify.lines[Number(t.dataset.line)];
      line[t.dataset.k] = t.value;
      const focusSel = `[data-line="${t.dataset.line}"][data-k="${t.dataset.k}"]`;
      const pos = t.selectionStart;
      renderVerify();
      const again = $('#verifyBody ' + focusSel);
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) {} }
    }
    if (t.id === 'rejNote') state.verify.note = t.value;
  });

  $('#verifyBody').addEventListener('change', async e => {
    const slot = e.target.dataset && e.target.dataset.slot;
    if (!slot || !e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    const res = await api.uploadPhoto(file, `${state.active.id}/${slot}-${Date.now()}`);
    if (!res.ok) return toast(res.error || 'Upload failed', 'err');
    const rec = { url: res.url, name: file.name };
    if (slot === 'reject') state.verify.rejectPhoto = rec;
    else state.verify.photos[slot] = rec;
    renderVerify();
  });

  /* listings */
  $('#newListing').addEventListener('click', () => {
    $('#listingForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('#lTitle').focus();
  });
  ['lPrice', 'lNet', 'lGrade'].forEach(id =>
    $('#' + id).addEventListener('input', renderGuidance));
  $('#lGrade').addEventListener('change', renderGuidance);

  $('#listingForm').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      title: $('#lTitle').value.trim(),
      material: $('#lMaterial').value,
      grade: $('#lGrade').value,
      diameter_mm: Number($('#lDia').value),
      tolerance_mm: Number($('#lTol').value),
      net_weight_kg: Number($('#lNet').value),
      price_gbp: Number($('#lPrice').value),
      quantity: Number($('#lQty').value),
      nozzle_c: Number($('#lNozzle').value),
      bed_c: Number($('#lBed').value),
      flow_pct: Number($('#lFlow').value),
      description: $('#lDesc').value.trim()
    };
    if (!payload.title) return toast('Give the batch a name.', 'err');
    const res = await api.saveListing(payload);
    if (!res.ok) return toast(res.error, 'err');
    state.listings.unshift({
      id: 'L-' + Math.floor(Math.random() * 900 + 100), title: payload.title, grade: payload.grade,
      kgNet: payload.net_weight_kg, dia: payload.diameter_mm, tol: payload.tolerance_mm,
      price: payload.price_gbp, qty: payload.quantity, status: 'draft',
      c1: '#3A3543', c2: '#6E6579'
    });
    renderListings();
    e.target.reset(); renderGuidance();
    toast(res.demo ? 'Draft created (demo mode — not persisted).' : 'Draft listing created.');
  });
}

async function release() {
  const s = state.active, v = state.verify;
  const lines = v.lines.map(l => ({
    material: l.material,
    accepted_kg: Number(l.accepted) || 0,
    rejected_kg: Number(l.rejected) || 0,
    rate_per_kg: PRICING.creditRatePerKg[l.material] ?? PRICING.creditRatePerKg.Mixed
  }));
  const credit = lines.reduce((a, l) => a + l.accepted_kg * l.rate_per_kg, 0);

  const res = await api.releaseCredit({
    shipment_id: s.id, lines, reject_reason: v.note,
    photo_keys: Object.keys(v.photos), reject_photo: !!v.rejectPhoto
  });
  if (!res.ok) return toast(res.error || 'Could not release credit', 'err');

  s.status = 'credited';
  s.acceptedKg = lines.reduce((a, l) => a + l.accepted_kg, 0);
  s.credit = credit;
  state.active = null;
  renderQueue();
  go('queue');
  toast(`${money(credit)} released to ${s.sender}.` + (res.demo ? ' (demo mode)' : ''), 'ok');
}

/* =========================================================================
   Goods-in scan  —  /recycler?receive=<label_token>

   The QR on the shipping label resolves here. Receiving is the moment the
   SLA clock starts, so it is a single deliberate call with a spoken-aloud
   result; we then reload the queue so the box is visibly in it, and strip
   the token from the URL so a refresh cannot double-receive.
   ========================================================================= */
const LABEL_TOKEN_RE = /^[A-Za-z0-9_-]{4,64}$/;

function clearReceiveParam() {
  const u = new URL(location.href);
  u.searchParams.delete('receive');
  u.searchParams.delete('label');
  history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || ''));
}

async function handleReceiveParam() {
  const params = new URLSearchParams(location.search);
  const token = params.get('receive') || params.get('label');
  if (!token) return;

  clearReceiveParam();

  if (!LABEL_TOKEN_RE.test(token)) {
    return toast('That label code does not look right — scan it again', 'err');
  }

  if (!sb) {
    return toast(`Received ${token} (demo mode — nothing persisted).`, 'ok');
  }

  const { data, error } = await pub().rpc('receive_shipment', { label_token: token });

  if (error) {
    const msg = String(error.message || '').toLowerCase();
    if (msg.includes('not found') || msg.includes('unknown') || msg.includes('no rows')) {
      return toast('We do not recognise that label. Check the code and try again.', 'err');
    }
    if (msg.includes('not assigned') || msg.includes('permission') || msg.includes('denied') || msg.includes('rls')) {
      return toast('That box is not assigned to you — do not open it. Contact Respool ops.', 'err');
    }
    if (msg.includes('already')) {
      return toast('That box was already received — it is in your queue.', 'ok');
    }
    return toast(error.message || 'Could not receive that shipment', 'err');
  }

  const due = data && (data.sla_due_at || data.due_at || data.due);
  const dueTxt = due ? new Date(due).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : null;
  toast(dueTxt
    ? `Shipment received — SLA clock started, due ${dueTxt}`
    : 'Shipment received — SLA clock started', 'ok');

  // Reload the intake queue so the newly received box is actually there.
  state.shipments = await api.loadShipments();
  state.filter = 'awaiting';
  renderQueue();
  go('queue');
}

/* =========================================================================
   Boot
   ========================================================================= */
async function boot() {
  $('#demoFlag').hidden = LIVE;

  if (sb) {
    const who = await api.loadIdentity();
    if (!who.ok) {
      // Identity failed: say so, and do not guess at whose queue this is.
      renderIdentity();
      $('#notRecycler').hidden = false;
      document.body.classList.add('no-recycler');
      $('#notRecyclerBody').innerHTML =
        `<p>We could not load your recycler record.</p>
         <p class="mono" style="margin-top:8px;font-size:12px;color:var(--dim)">${esc(who.error || '')}</p>
         <p style="margin-top:14px"><button class="btn" onclick="location.reload()">Try again</button></p>`;
      return;
    }
    if (!who.recycler) {
      renderIdentity();
      return showNotRecycler(!!who.signedOut);
    }
    state.recycler = who.recycler;
    state.shipments = await api.loadShipments();
    state.listings = await api.loadListings();
  }

  renderIdentity();
  renderIntakeSwitch();
  wire();
  renderQueue();
  renderListings();
  renderGuidance();
  renderScoreboard();
  $('#verifyBody').innerHTML = emptyVerify();

  const hash = (location.hash || '').replace('#', '');
  go(VIEWS[hash] ? hash : 'queue');

  // A label QR was just scanned at the goods-in bench.
  await handleReceiveParam();

  // SLA countdowns are live — the queue re-renders on the minute.
  setInterval(() => { if (!$('#view-queue').hidden) renderQueue(); }, 60000);
}

document.addEventListener('DOMContentLoaded', boot);
