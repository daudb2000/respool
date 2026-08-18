/* =====================================================================
   Respool — buyer app
   Vanilla JS, no build step. supabase-js v2 from CDN.

   Architecture
     CFG      config from window.RESPOOL_CONFIG (never hardcode prices, §19)
     db       supabase client (null in demo mode)
     state    in-memory app state, persisted to localStorage
     money    the credit maths — single source of truth for §3.2
     router   hash routes: #/shop #/p/:id #/wallet #/scrap #/account
              #/basket #/checkout  and  /claim?token=… (§4.2 QR)
     render   per-screen renderers, all string-templated

   Every price, rate and multiplier below comes from CFG.
   ===================================================================== */
(function () {
'use strict';

const CFG = window.RESPOOL_CONFIG || {};
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------------
   1. SUPABASE
   Placeholder creds → demo mode with seeded catalogue so the shelves are
   never empty (§10.4 — an empty results page kills trust).
   ------------------------------------------------------------------- */
const HAS_SUPABASE =
  CFG.SUPABASE_URL && CFG.SUPABASE_URL !== 'SUPABASE_URL' &&
  CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY !== 'SUPABASE_ANON_KEY' &&
  typeof window.supabase !== 'undefined';

// Tables live in the "respool" Postgres schema, not "public". PostgREST also
// has to be told to expose it (Supabase → Settings → API → Exposed schemas).
const db = HAS_SUPABASE
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
      { db: { schema: CFG.SUPABASE_SCHEMA || 'respool' } })
  : null;

if (!HAS_SUPABASE) {
  console.info('[respool] demo mode — set RESPOOL_CONFIG.SUPABASE_URL / _ANON_KEY to go live');
}

/* ---------------------------------------------------------------------
   2. MONEY  — the credit maths (§3.2)
   Three lines, always: face price / credit applied / final price.
   Credit redeems at CFG.creditMultiplierRecycled against recycled,
   creditMultiplierBranded (face) against branded.
   ------------------------------------------------------------------- */
const money = {
  gbp(n) {
    return '£' + (Math.round(n * 100) / 100).toFixed(2);
  },
  mult(listing) {
    return listing && listing.recycled
      ? (CFG.creditMultiplierRecycled || 2)
      : (CFG.creditMultiplierBranded || 1);
  },
  /* How much credit is needed to knock `off` pounds off a recycled item. */
  creditForDiscount(off, mult) { return off / mult; },

  /* What a credit balance actually unlocks, given the multiplier AND the cap.
     Credit covers cap% of face, so face F satisfies F*cap = credit*mult.
     Returns the honest triple: goods you can take home, cash you still pay,
     and that expressed in kilos at the cheapest recycled rate.
     §14.5 — scarcity and savings claims must be literally true. */
  power(credit, cheapestPerKg) {
    const mult = CFG.creditMultiplierRecycled || 2;
    const cap = money.cap();
    const goods = cap > 0 ? (credit * mult) / cap : credit * mult;
    return { goods, cash: goods - credit * mult, kg: cheapestPerKg ? goods / cheapestPerKg : 0 };
  },

  /* The canonical three-line breakdown for one listing (or a basket total). */
  cap() { return CFG.creditMaxSharePct == null ? 1 : CFG.creditMaxSharePct; },
  breakdown({ face, creditBalance, mult, creditCapPct = money.cap() }) {
    // Credit can wipe at most creditCapPct of the face price.
    const maxDiscount = face * creditCapPct;
    // Credit pounds we are able to spend, given the multiplier.
    const creditSpendable = Math.min(creditBalance, maxDiscount / mult);
    const discount = creditSpendable * mult;
    return {
      face,
      creditUsed: creditSpendable,   // pounds taken out of the wallet
      creditWorth: discount,         // pounds knocked off the price
      mult,
      final: Math.max(0, face - discount)
    };
  }
};

/* ---------------------------------------------------------------------
   3. SEED CATALOGUE  (demo only — replaced by `listings` table)
   Colours are CSS gradients standing in for the marbled-plastic
   photography described in §11. No stock imagery, no leaves.
   ------------------------------------------------------------------- */
const SWATCH = {
  ember:   'linear-gradient(150deg,#E06A34,#F4B63F 45%,#6B2C12)',
  orchid:  'linear-gradient(150deg,#5A4CC4,#C0497E 55%,#2A1C3F)',
  lagoon:  'linear-gradient(150deg,#5FC7B4,#1F6E7A 60%,#0E2D2A)',
  bone:    'linear-gradient(150deg,#F6F4EF,#C8BDAC 55%,#6E6152)',
  slate:   'linear-gradient(150deg,#6B675C,#3A3730 60%,#1B1A14)',
  terrazzo:'conic-gradient(from 210deg,#C0497E,#F4B63F,#5FC7B4,#5A4CC4,#C0497E)',
  mango:   'linear-gradient(150deg,#F4B63F,#C0497E 70%,#4A1428)',
  moss:    'linear-gradient(150deg,#93A87C,#0E4A38 60%,#122018)',
  ink:     'linear-gradient(150deg,#3A3730,#15140F 65%,#0C0B08)',
  glacier: 'linear-gradient(150deg,#D7EFE7,#8FD6C4 55%,#0E4A38)'
};

const RECYCLERS = {
  fold:   { id:'fold',   name:'Foldback Filament', city:'Sheffield',  tier:'Established', intake:'2,140 kg', spools:'1,880', since:'2024', blurb:'Grades hard, dries harder. Every batch dried to <0.2% moisture before it goes on a spool.' },
  quarry: { id:'quarry', name:'Quarry Works',      city:'Bristol',    tier:'Established', intake:'1,610 kg', spools:'1,240', since:'2024', blurb:'Deliberate colour blending. The marbling is designed, not accidental.' },
  bevel:  { id:'bevel',  name:'Bevel & Bin',       city:'Glasgow',    tier:'New & Notable', intake:'180 kg', spools:'96',   since:'2026', blurb:'Small batches, odd colours, obsessive tolerance logging.' },
  halden: { id:'halden', name:'Halden Reworks',    city:'Leeds',      tier:'New & Notable', intake:'240 kg', spools:'150',  since:'2026', blurb:'Ex-injection-moulding. Knows what a bad melt looks like.' }
};

const BRANDS = { sunlu:{ id:'sunlu', name:'Sunlu', tier:'Brand' }, esun:{ id:'esun', name:'eSUN', tier:'Brand' } };

const LISTINGS = [
  { id:'rc-ember-1',  title:'Ember Marble PLA',      seller:RECYCLERS.fold,   recycled:true,  material:'PLA',  colour:'Ember',   swatch:SWATCH.ember,
    price:6.00, kg:1.0, grade:'A', diameter:1.75, tolerance:0.03, temp:210, bed:60, flow:98, stock:14, rows:['newnotable'], tags:['Best £/kg'],
    note:'Failed prints and purge towers from three Sheffield print farms. Reds and oranges kept together so the marbling stays warm.' },

  { id:'rc-orchid-1', title:'Orchid Swirl PLA',      seller:RECYCLERS.quarry, recycled:true,  material:'PLA',  colour:'Orchid',  swatch:SWATCH.orchid,
    price:7.50, kg:1.0, grade:'A', diameter:1.75, tolerance:0.02, temp:212, bed:60, flow:99, stock:6,  rows:['featured','new'], tags:['Tightest tolerance'],
    note:'Violet and magenta scrap blended on purpose. Each metre shifts. No two spools are the same and we are not pretending otherwise.' },

  { id:'rc-lagoon-1', title:'Lagoon PETG',           seller:RECYCLERS.fold,   recycled:true,  material:'PETG', colour:'Lagoon',  swatch:SWATCH.lagoon,
    price:9.00, kg:1.0, grade:'A', diameter:1.75, tolerance:0.03, temp:240, bed:80, flow:100, stock:9, rows:['new'], tags:['PETG'],
    note:'Translucent teal, prints glassy at 240. Dried for 6 hours at 65 before spooling.' },

  { id:'rc-bone-1',   title:'Bone Grey PLA',         seller:RECYCLERS.quarry, recycled:true,  material:'PLA',  colour:'Bone',    swatch:SWATCH.bone,
    price:5.50, kg:1.0, grade:'B', diameter:1.75, tolerance:0.05, temp:208, bed:60, flow:97, stock:22, rows:['cheap'], tags:['Best £/kg'],
    note:'Mixed light scrap. Grade B for a visible speckle and a wider tolerance band — prints fine, looks industrial.' },

  { id:'rc-terra-1',  title:'Terrazzo Batch 014',    seller:RECYCLERS.bevel,  recycled:true,  material:'PLA',  colour:'Terrazzo',swatch:SWATCH.terrazzo,
    price:11.00, kg:1.0, grade:'A', diameter:1.75, tolerance:0.03, temp:210, bed:60, flow:98, stock:3, rows:['newnotable','featured'], tags:['3 left'],
    note:'One-off. Every colour we had, shredded together and extruded slowly. Genuinely finite — when batch 014 is gone it is gone.' },

  { id:'rc-mango-1',  title:'Mango Fade PLA',        seller:RECYCLERS.halden, recycled:true,  material:'PLA',  colour:'Mango',   swatch:SWATCH.mango,
    price:6.50, kg:1.0, grade:'B', diameter:1.75, tolerance:0.04, temp:209, bed:60, flow:98, stock:11, rows:['newnotable','new'], tags:[],
    note:'Amber into pink over roughly 300g. Colour shift is gradual enough that a single print reads as one colour.' },

  { id:'rc-glac-1',   title:'Glacier PETG',          seller:RECYCLERS.bevel,  recycled:true,  material:'PETG', colour:'Glacier', swatch:SWATCH.glacier,
    price:9.50, kg:1.0, grade:'A', diameter:2.85, tolerance:0.04, temp:245, bed:80, flow:101, stock:4, rows:['new'], tags:['2.85 mm'],
    note:'2.85 for the Ultimaker crowd. Small run, we do not make much at this diameter.' },

  { id:'rc-slate-3',  title:'Slate 3 kg Bundle',     seller:RECYCLERS.fold,   recycled:true,  material:'PLA',  colour:'Slate',   swatch:SWATCH.slate,
    price:15.00, kg:3.0, grade:'B', diameter:1.75, tolerance:0.04, temp:208, bed:60, flow:97, stock:8, rows:['cheap','bundles'], tags:['Bundle','Best £/kg'],
    note:'Three kilos of dark mixed scrap. The workhorse. Prototype with this and save the pretty stuff for the final print.' },

  { id:'br-sunlu-1',  title:'Sunlu PLA+ · Black',    seller:BRANDS.sunlu,     recycled:false, material:'PLA',  colour:'Black',   swatch:SWATCH.ink,
    price:13.99, kg:1.0, grade:null, diameter:1.75, tolerance:0.02, temp:215, bed:60, flow:100, stock:40, rows:['new'], tags:['Virgin'],
    note:'Branded virgin stock, dropshipped. Credit applies at face value here — it is worth double on recycled spools.' },

  { id:'br-esun-1',   title:'eSUN PETG · Solid Grey',seller:BRANDS.esun,      recycled:false, material:'PETG', colour:'Grey',    swatch:SWATCH.slate,
    price:16.49, kg:1.0, grade:null, diameter:1.75, tolerance:0.02, temp:240, bed:80, flow:100, stock:30, rows:[], tags:['Virgin'],
    note:'Branded virgin PETG. Reliable, boring, useful.' },

  { id:'mb-1kg',      title:'Mystery Kilo',          seller:RECYCLERS.quarry, recycled:true,  material:'PLA',  colour:'?',       swatch:SWATCH.terrazzo,
    price:4.50, kg:1.0, grade:'B', diameter:1.75, tolerance:0.05, temp:210, bed:60, flow:98, stock:30, rows:['bundles'], mystery:true, tags:['Mystery'],
    note:'Recycler’s choice. One kilo, colour is a surprise, grade B or better guaranteed. This is how odd batches find a home.' },

  { id:'mb-3kg',      title:'Mystery 3 kg Drop',     seller:RECYCLERS.fold,   recycled:true,  material:'PLA',  colour:'?',       swatch:SWATCH.orchid,
    price:11.00, kg:3.0, grade:'B', diameter:1.75, tolerance:0.05, temp:210, bed:60, flow:98, stock:12, rows:['bundles','cheap'], mystery:true, tags:['Mystery','Best £/kg'],
    note:'Three surprise kilos. At least one will be a colour you would not have chosen and will end up liking.' }
];

const byId = id => LISTINGS.find(l => l.id === id);
const perKg = l => l.price / l.kg;

/* ---------------------------------------------------------------------
   4. STATE
   ------------------------------------------------------------------- */
const LS = 'respool.app.v1';
const state = Object.assign({
  user: null,
  credit: 4.80,               // demo balance
  basket: [],                 // [{id, qty}]
  creditApplied: 0,           // pounds of credit selected at checkout
  filter: 'all',
  query: '',
  hookSeen: false,
  scrap: { material:'PLA', kg: 2.0, box:'small' },
  activeBox: null,            // {ref, size, fill, ordered}
  orders: 0
}, load());

function load() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch { return {}; } }
function save() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      credit: state.credit, basket: state.basket, hookSeen: state.hookSeen,
      scrap: state.scrap, activeBox: state.activeBox, orders: state.orders
    }));
  } catch {}
}

const basketLines = () => state.basket.map(b => ({ l: byId(b.id), qty: b.qty })).filter(x => x.l);
const basketFace  = () => basketLines().reduce((s, x) => s + x.l.price * x.qty, 0);
const basketQty   = () => state.basket.reduce((s, b) => s + b.qty, 0);
/* Blended multiplier: recycled lines earn 2x, branded lines face value.
   We apply credit greedily to recycled value first — best for the user,
   and it steers redemption to where margin lives (§3.2). */
function basketMult() {
  const rec = basketLines().filter(x => x.l.recycled).reduce((s, x) => s + x.l.price * x.qty, 0);
  return rec > 0 ? (CFG.creditMultiplierRecycled || 2) : (CFG.creditMultiplierBranded || 1);
}

/* ---------------------------------------------------------------------
   5. DATA ACCESS — supabase when live, seed when not
   ------------------------------------------------------------------- */
async function fetchListings() {
  if (!db) return LISTINGS;
  const { data, error } = await db
    .from('listings')
    .select('*')
    .eq('status', 'active')
    .limit(200);
  if (error) { console.warn('[respool] listings fetch failed, using seed', error); return LISTINGS; }
  return (data && data.length) ? data.map(normaliseListing) : LISTINGS;
}
function normaliseListing(r) {
  return {
    id: r.id, title: r.title, recycled: !!r.recycled, material: r.material, colour: r.colour,
    swatch: r.swatch_css || SWATCH.slate, price: Number(r.price_gbp), kg: Number(r.net_weight_kg),
    grade: r.grade, diameter: Number(r.diameter_mm), tolerance: Number(r.tolerance_mm),
    temp: r.nozzle_temp_c, bed: r.bed_temp_c, flow: r.flow_pct, stock: r.stock,
    rows: r.editorial_rows || [], tags: r.badges || [], mystery: !!r.mystery, note: r.description,
    seller: r.seller ? { id:r.seller.id, name:r.seller.name, city:r.seller.city, tier:r.seller.tier,
                         intake:r.seller.intake_kg, spools:r.seller.spools_sold, blurb:r.seller.blurb } : { name:'Respool' }
  };
}
async function refreshCredit() {
  if (!db || !state.user) return;
  const { data } = await db.from('credit_balances').select('balance_gbp').eq('user_id', state.user.id).maybeSingle();
  if (data) { state.credit = Number(data.balance_gbp); paintWallet(); }
}

/* ---------------------------------------------------------------------
   6. CHROME
   ------------------------------------------------------------------- */
function paintWallet() {
  $('#walletPillAmt').textContent = money.gbp(state.credit);
  const c = basketQty();
  const el = $('#basketCount');
  el.hidden = c === 0; el.textContent = c;
}
function bumpWallet() {
  const p = $('#walletPill');
  p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump');
}
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2400);
}

function openSheet(html) {
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false; $('#sheetScrim').hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  $('#sheet').hidden = true; $('#sheetScrim').hidden = true;
  document.body.style.overflow = '';
}
$('#sheetClose').addEventListener('click', closeSheet);
$('#sheetScrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* count-up used by the wallet and the rate estimator. Reduced motion →
   jump straight to the value; the number carries the meaning either way. */
function countUp(el, to, { prefix = '£', decimals = 2, ms = 900 } = {}) {
  const fmt = v => prefix + v.toFixed(decimals);
  if (REDUCED) { el.textContent = fmt(to); return; }
  const from = 0, t0 = performance.now();
  (function step(t) {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  })(t0);
}

/* ---------------------------------------------------------------------
   7. SHARED PARTIALS
   ------------------------------------------------------------------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function pcard(l) {
  const withCredit = l.recycled
    ? `<span class="withcredit">${money.gbp(money.breakdown({ face: l.price, creditBalance: state.credit, mult: money.mult(l) }).final / l.kg)}/kg with credit</span>`
    : `<span class="withcredit is-face">credit at face value</span>`;
  const badges = (l.tags || []).slice(0, 2).map(t =>
    `<span class="chip ${t === 'Mystery' ? 'chip-violet' : l.recycled ? 'chip-teal' : ''}">${esc(t)}</span>`).join('');
  return `
  <button class="pcard" data-goto="#/p/${l.id}">
    <div class="swatch" style="background:${l.swatch}">
      <div class="swatch-tags">${badges}</div>
    </div>
    <div class="pcard-b">
      <h4>${esc(l.title)}</h4>
      <div class="by">${esc(l.seller.name)}${l.grade ? ' · Grade ' + l.grade : ''}</div>
      <div class="pcard-foot">
        <span class="perkg">${money.gbp(perKg(l))}<small>/kg</small></span>
      </div>
      ${withCredit}
    </div>
  </button>`;
}

function rail(title, note, items, link) {
  if (!items.length) return '';
  return `
  <section class="row">
    <div class="row-head">
      <div>
        <h3 class="h-sec">${esc(title)}</h3>
        ${note ? `<p>${esc(note)}</p>` : ''}
      </div>
      ${link ? `<span class="row-link">${esc(link)}</span>` : ''}
    </div>
    <div class="rail">${items.map(pcard).join('')}</div>
  </section>`;
}

/* ---------------------------------------------------------------------
   8. SCREEN — SHOP  (§10.1 editorial rows, not a grid)
   ------------------------------------------------------------------- */
let CATALOGUE = LISTINGS;

function renderShop() {
  const q = state.query.trim().toLowerCase();
  const pass = l => {
    if (q && !(l.title + ' ' + l.colour + ' ' + l.seller.name + ' ' + l.material).toLowerCase().includes(q)) return false;
    switch (state.filter) {
      case 'recycled': return l.recycled;
      case 'virgin':   return !l.recycled;
      case 'PLA':      return l.material === 'PLA';
      case 'PETG':     return l.material === 'PETG';
      case 'bundles':  return l.kg > 1 || l.mystery;
      case '175':      return l.diameter === 1.75;
      case '285':      return l.diameter === 2.85;
      default: return true;
    }
  };
  const all = CATALOGUE.filter(pass);
  const feat = RECYCLERS.quarry;
  const featStock = all.filter(l => l.seller && l.seller.id === feat.id);
  const filtering = state.filter !== 'all' || q;

  const filters = [
    ['all','Everything'],['recycled','Recycled'],['virgin','Virgin'],
    ['PLA','PLA'],['PETG','PETG'],['bundles','Bundles'],['175','1.75 mm'],['285','2.85 mm']
  ];

  $('#screen-shop').innerHTML = `
    <div class="shop-hero">
      <div class="layers"></div>
      <span class="eyebrow">Recycled &amp; branded · United Kingdom</span>
      <h2>Filament from <em>£2 a kilo.</em></h2>
      <p>Every card shows price per kilo. Credit from your scrap is worth double on recycled spools.</p>
    </div>

    <div class="searchbar">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>
      <input id="q" type="search" placeholder="Colour, material, recycler…" value="${esc(state.query)}" autocomplete="off">
    </div>

    <div class="filterrow">
      ${filters.map(([k, label]) =>
        `<button class="fchip" data-filter="${k}" aria-pressed="${state.filter === k}">${label}</button>`).join('')}
    </div>

    ${filtering ? `
      <section class="row">
        <div class="row-head"><div><h3 class="h-sec">${all.length} spool${all.length === 1 ? '' : 's'}</h3><p>Sorted by price per kilo</p></div></div>
        <div class="rail">${all.slice().sort((a, b) => perKg(a) - perKg(b)).map(pcard).join('') || ''}</div>
      </section>
      ${all.length ? '' : `<div class="empty"><b>Nothing matches that</b>Try a wider filter — recycled stock turns over fast and batches are genuinely finite.</div>`}
    ` : `
      <!-- Featured Recycler, rotating weekly (§10.1) -->
      <section class="row">
        <div class="row-head"><div><h3 class="h-sec">Featured recycler</h3><p>Rotates weekly</p></div><span class="row-link">This week</span></div>
        <article class="feature">
          <div class="feature-art" style="background:${SWATCH.orchid}"></div>
          <div class="feature-b">
            <span class="chip chip-amber">${esc(feat.tier)}</span>
            <h3>${esc(feat.name)}</h3>
            <div class="sub">${esc(feat.city)} · recycling since ${esc(feat.since)}</div>
            <div class="feature-stats">
              <div class="fstat"><b>${esc(feat.intake)}</b><span>scrap taken in</span></div>
              <div class="fstat"><b>${esc(feat.spools)}</b><span>spools sold</span></div>
              <div class="fstat"><b>0.4%</b><span>dispute rate</span></div>
            </div>
            <p class="sub" style="margin-bottom:14px">${esc(feat.blurb)}</p>
            <div class="rail" style="padding-left:0;padding-right:0;grid-auto-columns:minmax(150px,42vw)">
              ${featStock.map(pcard).join('')}
            </div>
          </div>
        </article>
      </section>

      ${rail('New &amp; notable', 'The newcomer lane — ranked on distinctiveness, not volume',
             CATALOGUE.filter(l => (l.rows || []).includes('newnotable')), 'See all')}

      ${rail('Best £ per kilo', 'The comparison people actually make',
             CATALOGUE.slice().sort((a, b) => perKg(a) - perKg(b)).slice(0, 5), 'See all')}

      <!-- Mystery bundles (§14.3) — real scarcity, honest countdowns -->
      <section class="row">
        <div class="row-head"><div><h3 class="h-sec">Mystery bundles</h3><p>Recycler’s choice. Odd colours, good prices.</p></div></div>
        <div class="rail">
          ${CATALOGUE.filter(l => l.mystery).map(l => `
            <button class="mystery" data-goto="#/p/${l.id}">
              <div>
                <span class="chip chip-violet">${l.kg} kg</span>
                <h4 style="margin-top:10px">${esc(l.title)}</h4>
                <p>Grade B or better. Colour is the surprise.</p>
              </div>
              <div>
                <div class="perkg">${money.gbp(perKg(l))}<small>/kg</small></div>
                <div class="withcredit">${money.gbp(money.breakdown({ face: l.price, creditBalance: state.credit, mult: money.mult(l) }).final / l.kg)}/kg with credit</div>
              </div>
            </button>`).join('')}
        </div>
      </section>

      ${rail('New arrivals', 'Batches listed in the last fourteen days',
             CATALOGUE.filter(l => (l.rows || []).includes('new')))}

      <div style="margin:30px var(--gut) 0" class="card">
        <div style="padding:20px">
          <span class="eyebrow">Made with this filament</span>
          <h3 class="h-sec" style="margin:8px 0 6px">Yes, it prints properly.</h3>
          <p class="sub" style="margin-bottom:14px">Print showcases from spools actually sold here — the answer to the only objection that matters.</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${[SWATCH.ember, SWATCH.lagoon, SWATCH.terrazzo].map(s =>
              `<div style="aspect-ratio:1;border-radius:11px;background:${s};position:relative;overflow:hidden"><div class="layers"></div></div>`).join('')}
          </div>
        </div>
      </div>
    `}
  `;

  $('#q').addEventListener('input', e => {
    state.query = e.target.value;
    const pos = e.target.selectionStart;
    renderShop();
    const q2 = $('#q'); q2.focus(); q2.setSelectionRange(pos, pos);
  });
  $$('#screen-shop [data-filter]').forEach(b =>
    b.addEventListener('click', () => { state.filter = b.dataset.filter; renderShop(); }));
}

/* ---------------------------------------------------------------------
   9. SCREEN — PRODUCT  (§3.2 three-line maths, §7.1 spec)
   ------------------------------------------------------------------- */
function renderProduct(id) {
  const l = byId(id) || CATALOGUE.find(x => x.id === id);
  if (!l) { go('#/shop'); return; }

  const mult = money.mult(l);
  const b = money.breakdown({ face: l.price, creditBalance: state.credit, mult });
  const s = l.seller;

  $('#screen-product').innerHTML = `
    <div class="p-hero" style="background:${l.swatch}"><div class="fade"></div></div>
    <div class="p-body">
      <div class="p-tags">
        ${l.recycled ? '<span class="chip chip-teal">Recycled</span>' : '<span class="chip">Virgin · branded</span>'}
        <span class="chip">${esc(l.material)}</span>
        ${l.grade ? `<span class="chip chip-amber">Grade ${esc(l.grade)}</span>` : ''}
        ${s.tier ? `<span class="chip">${esc(s.tier)}</span>` : ''}
      </div>
      <h2>${esc(l.title)}</h2>
      <div class="p-by">by <b>${esc(s.name)}</b>${s.city ? ' · ' + esc(s.city) : ''}</div>

      <!-- ================= THREE-LINE CREDIT MATHS (§3.2) =================
           Face price / credit applied / final price. Never collapse this
           into a single "was £6 now £2" — people go cold when they can't
           work out what they are paying.                                -->
      <div class="maths">
        <div class="maths-hd">
          <span class="eyebrow">What you pay</span>
          <span class="chip ${l.recycled ? 'chip-teal' : ''}">Credit ×${mult}${l.recycled ? '' : ' · face value'}</span>
        </div>
        <div class="maths-rows">
          <div class="mrow"><span>Face price<small>${l.kg} kg · ${money.gbp(perKg(l))}/kg</small></span><b>${money.gbp(b.face)}</b></div>
          <div class="mrow credit"><span>Credit applied<small>${money.gbp(b.creditUsed)} from your wallet, worth ×${mult}</small></span><b>−${money.gbp(b.creditWorth)}</b></div>
        </div>
        <div class="maths-total">
          <span>You pay</span>
          <b>${money.gbp(b.final)}</b>
        </div>
        <p class="maths-note">${l.recycled
          ? `Credit is worth double on recycled spools. On branded stock it is worth face value.`
          : `Credit applies at face value on branded stock. It is worth double on recycled spools.`}
          Credit covers up to ${Math.round(money.cap() * 100)}% of a spool.
          ${b.creditUsed < state.credit ? `You have ${money.gbp(state.credit - b.creditUsed)} credit left over.` : ''}</p>
      </div>

      <dl class="speclist">
        <div class="spec"><dt>Material</dt><dd>${esc(l.material)}</dd></div>
        <div class="spec"><dt>Diameter</dt><dd>${l.diameter} mm <em>±${l.tolerance.toFixed(2)}</em></dd></div>
        <div class="spec"><dt>Net filament weight</dt><dd>${l.kg} kg <span style="color:var(--ink-2)">(excl. spool)</span></dd></div>
        ${l.grade ? `<div class="spec"><dt>Quality grade</dt><dd>${esc(l.grade)} <span style="color:var(--ink-2)">self-declared</span></dd></div>` : ''}
        <div class="spec"><dt>Colour</dt><dd>${esc(l.colour)}</dd></div>
        <div class="spec"><dt>Available</dt><dd>${l.stock} spool${l.stock === 1 ? '' : 's'}</dd></div>
      </dl>

      <span class="eyebrow">Suggested print settings · this batch</span>
      <div class="settings" style="margin-top:10px">
        <div class="setting"><b>${l.temp}°</b><span>Nozzle</span></div>
        <div class="setting"><b>${l.bed}°</b><span>Bed</span></div>
        <div class="setting"><b>${l.flow}%</b><span>Flow</span></div>
      </div>

      <div class="grade-note">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" style="flex:0 0 auto;color:var(--forest)"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01" stroke-linecap="round"/></svg>
        <div>${esc(l.note)}</div>
      </div>

      ${s.blurb ? `
      <div class="card" style="padding:16px;margin-bottom:20px">
        <span class="eyebrow">The recycler</span>
        <h4 style="font-family:var(--disp);font-weight:700;font-size:18px;letter-spacing:-.035em;margin:8px 0 4px">${esc(s.name)}</h4>
        <p class="sub">${esc(s.blurb)}</p>
        ${s.intake ? `<div class="feature-stats" style="margin-bottom:0">
          <div class="fstat"><b>${esc(s.intake)}</b><span>taken in</span></div>
          <div class="fstat"><b>${esc(s.spools)}</b><span>spools sold</span></div>
        </div>` : ''}
      </div>` : ''}
    </div>

    <div class="stickybar">
      <div class="price-lead">
        <b>${money.gbp(b.final)}</b>
        ${b.creditWorth > 0 ? `<span>${money.gbp(b.face)} − ${money.gbp(b.creditWorth)} credit</span>` : `<span style="color:var(--ink-2)">${money.gbp(perKg(l))}/kg</span>`}
      </div>
      <button class="btn btn-lg" id="addBtn">Add to basket</button>
    </div>
  `;
  $('#addBtn').addEventListener('click', () => addToBasket(l.id));
}

function addToBasket(id) {
  const line = state.basket.find(b => b.id === id);
  if (line) line.qty++; else state.basket.push({ id, qty: 1 });
  save(); paintWallet(); toast('Added to basket');
}

/* ---------------------------------------------------------------------
   10. SCREEN — WALLET  (§14.7 the first-order hook)
   The animation must show THE GAP, not just the balance.
   ------------------------------------------------------------------- */
function renderWallet() {
  const rate = (CFG.creditRatePerKg && CFG.creditRatePerKg.PLA) || 2;
  const potential = rate * (CFG.boxCapacityKg ? CFG.boxCapacityKg.small : 2.5);   // what a small box is worth
  const total = state.credit + potential;
  const mult = CFG.creditMultiplierRecycled || 2;
  const havePct = Math.max(4, Math.min(96, (state.credit / total) * 100));

  // Reference price for "what it buys" — the cheapest real recycled spool on sale.
  const cheapest = CATALOGUE.filter(l => l.recycled && !l.mystery)
    .reduce((m, l) => Math.min(m, perKg(l)), Infinity);
  const nowP  = money.power(state.credit, cheapest);
  const thenP = money.power(total, cheapest);

  $('#screen-wallet').innerHTML = `
    <div class="wallet-hero">
      <div class="layers"></div>
      <span class="eyebrow" style="position:relative">Your credit</span>
      <div class="balance" id="balNum">£0.00</div>
      <div class="balance-sub">Spends here only. Worth ×${mult} on recycled spools, face value on branded.</div>

      <!-- THE GAP: £4.80 of £9.80, missing half labelled "send scrap" -->
      <div class="gapbar">
        <div class="gapbar-track">
          <div class="gapbar-have" id="gapHave"></div>
          <div class="gapbar-gap"></div>
        </div>
        <div class="gapbar-legend">
          <span class="have">${money.gbp(state.credit)} held</span>
          <span class="gap">${money.gbp(potential)} still in the bin</span>
        </div>
      </div>
    </div>

    <!-- §14.7 the hook — same maths in the order confirmation, the delivery
         notification and the "how did it print?" follow-up, decreasing prominence -->
    <div class="hook" id="hook">
      <span class="eyebrow">Your scrap is worth</span>
      <div class="hook-maths">
        <div class="hook-line is-have" data-i="0"><span>Credit you hold</span><b>${money.gbp(state.credit)}</b></div>
        <div class="hook-line is-gap" data-i="1"><span>One small box of scrap${state.orders ? ', at your rate' : ', estimated'}</span><b>+ ${money.gbp(potential)}</b></div>
        <div class="hook-line" data-i="2"><span>Both, at ×${mult} on recycled</span><b>${money.gbp(total * mult)} off</b></div>
      </div>
      <div class="hook-out" id="hookOut">
        <b>${thenP.kg.toFixed(1)} kg for ${money.gbp(thenP.cash)}</b>
        <span>Today your ${money.gbp(state.credit)} takes home ${nowP.kg.toFixed(1)} kg for ${money.gbp(nowP.cash)}.
              One box doubles it.</span>
      </div>
      <button class="btn btn-teal btn-block btn-lg" style="margin-top:14px" data-goto="#/scrap">Order a free box</button>
      <p class="sub" style="text-align:center;margin-top:10px;font-size:12px">No account step — you already have one.</p>
    </div>

    <div class="ledger">
      <span class="eyebrow">Ledger</span>
      <div style="margin-top:10px">
        ${[
          { d:'in',  t:'Shipment RSP-0041 credited', s:'2.4 kg PLA accepted · Foldback Filament', a:'+ £4.80' },
          { d:'in',  t:'Referral credit',            s:'Your mate Tom ordered a box',             a:'+ £2.00' },
          { d:'out', t:'Order #1182',                s:'Ember Marble PLA · credit at ×2',         a:'− £2.00' }
        ].map(r => `
          <div class="lrow ${r.d}">
            <div class="licon">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                ${r.d === 'in' ? '<path d="M12 5v14M6 13l6 6 6-6"/>' : '<path d="M12 19V5M6 11l6-6 6 6"/>'}
              </svg>
            </div>
            <div class="lmeta"><b>${r.t}</b><span>${r.s}</span></div>
            <div class="lamt">${r.a}</div>
          </div>`).join('')}
      </div>
      <p class="sub" style="margin-top:16px;font-size:12px">
        Credit is non-withdrawable and non-transferable. It expires 24 months after it is issued.
      </p>
    </div>
  `;

  // run the hook
  countUp($('#balNum'), state.credit);
  requestAnimationFrame(() => { $('#gapHave').style.width = havePct + '%'; });
  const lines = $$('#hook .hook-line');
  if (REDUCED) {
    lines.forEach(x => x.classList.add('in'));
    $('#hookOut').classList.add('in');
  } else {
    lines.forEach((x, i) => setTimeout(() => x.classList.add('in'), 450 + i * 320));
    setTimeout(() => $('#hookOut').classList.add('in'), 450 + lines.length * 320);
  }
  state.hookSeen = true; save();
}

/* ---------------------------------------------------------------------
   11. SCREEN — SEND SCRAP  (§4.3 — rate visible BEFORE any gate)
   ------------------------------------------------------------------- */
function renderScrap() {
  const s = state.scrap;
  const rates = CFG.creditRatePerKg || { PLA: 2, PETG: 2.4 };
  const est = rates[s.material] * s.kg;
  const box = state.activeBox;
  const cheapest = CATALOGUE.filter(l => l.recycled && !l.mystery).reduce((m, l) => Math.min(m, perKg(l)), Infinity);
  const sub = kg => {
    const p = money.power(rates[state.scrap.material] * kg, cheapest);
    return `≈ ${p.kg.toFixed(1)} kg of recycled filament, for ${money.gbp(p.cash)} on top`;
  };

  $('#screen-scrap').innerHTML = `
    <div class="wrap" style="padding-top:20px">
      <span class="eyebrow">Send scrap</span>
      <h2 class="h-scr" style="margin:10px 0 8px">What is in your bin worth?</h2>
      <p class="sub" style="max-width:36ch">Failed prints, brims, purge towers, supports, rafts. Work it out first — no account, no email, nothing to sign up to.</p>
    </div>

    <!-- ESTIMATOR — sits above every form field. Gating this kills the funnel. -->
    <div class="rate-card">
      <div class="layers"></div>
      <span class="eyebrow" style="position:relative">Estimated credit</span>
      <div class="rate-out" id="rateOut">£0.00</div>
      <div class="rate-sub">${sub(s.kg)}</div>

      <div class="matgrid">
        ${Object.keys(rates).map(m => `
          <button class="matbtn" data-mat="${m}" aria-pressed="${s.material === m}">
            <b>${m}</b><span>${money.gbp(rates[m])}/kg</span>
          </button>`).join('')}
      </div>

      <div style="position:relative">
        <div class="slider-labels"><span>0.5 kg</span><span class="mono" id="kgRead">${s.kg.toFixed(1)} kg</span><span>10 kg</span></div>
        <input class="slider" id="kgSlide" type="range" min="0.5" max="10" step="0.1" value="${s.kg}" aria-label="Weight of scrap in kilograms">
      </div>
    </div>

    <div class="honesty">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" style="flex:0 0 auto"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5v.01" stroke-linecap="round"/></svg>
      <div><b>This is an estimate.</b> Credit is paid on accepted weight, not sent weight — contamination, moisture and mixed material all reduce it. Rejected material is not returned, because return postage costs more than the plastic is worth.</div>
    </div>

    ${box ? renderActiveBox(box) : renderBoxForm(s)}

    <div class="wrap" style="margin-top:28px">
      <span class="eyebrow">What we take</span>
      <div class="card" style="padding:16px;margin-top:10px">
        <p class="sub" style="margin-bottom:10px"><b style="color:var(--ink)">Yes:</b> PLA and PETG failed prints, brims, skirts, rafts, supports, purge towers, old spool ends.</p>
        <p class="sub"><b style="color:var(--ink)">No:</b> anything with glue, silicone, paint, metal inserts, screws or embedded hardware. Label PLA and PETG separately using the bags in the box.</p>
      </div>
    </div>
  `;

  countUp($('#rateOut'), est);
  $$('#screen-scrap [data-mat]').forEach(b => b.addEventListener('click', () => {
    state.scrap.material = b.dataset.mat; save(); renderScrap();
  }));
  const slide = $('#kgSlide');
  if (slide) slide.addEventListener('input', e => {
    state.scrap.kg = Number(e.target.value);
    const v = rates[state.scrap.material] * state.scrap.kg;
    $('#rateOut').textContent = money.gbp(v);
    $('#kgRead').textContent = state.scrap.kg.toFixed(1) + ' kg';
    $('.rate-sub').textContent = sub(state.scrap.kg);
  });
  if (slide) slide.addEventListener('change', save);

  const form = $('#boxForm');
  if (form) form.addEventListener('submit', submitBoxOrder);
  $$('#screen-scrap [data-box]').forEach(b => b.addEventListener('click', () => {
    state.scrap.box = b.dataset.box; save(); renderScrap();
  }));
  $$('#screen-scrap [data-fill]').forEach(b => b.addEventListener('click', () => {
    // Re-filling a reusable box clears the posted state (§4.2 times_used).
    state.activeBox.fill = Number(b.dataset.fill); state.activeBox.posted = null;
    save(); renderScrap();
  }));
  const postBtn = $('#postBtn');
  if (postBtn) postBtn.addEventListener('click', openPostSheet);
}

function renderBoxForm(s) {
  const caps = CFG.boxCapacityKg || { small: 2.5, large: 6 };
  return `
    <form class="form" id="boxForm" novalidate>
      <div>
        <span class="eyebrow">Order your free box</span>
        <p class="sub" style="margin-top:6px">Name, address, email. That is the whole thing — the account comes later, when the box arrives.</p>
      </div>

      <div class="boxpick">
        <button type="button" class="boxopt" data-box="small" aria-pressed="${s.box === 'small'}">
          <b>Small box</b><span>up to ${caps.small} kg · send often</span>
        </button>
        <button type="button" class="boxopt" data-box="large" aria-pressed="${s.box === 'large'}">
          <b>Large box</b><span>up to ${caps.large} kg · print farms</span>
        </button>
      </div>

      <div class="field"><label for="bn">Name</label><input id="bn" name="name" required autocomplete="name" placeholder="Sam Whitfield"></div>
      <div class="field"><label for="be">Email</label><input id="be" name="email" type="email" required autocomplete="email" inputmode="email" placeholder="sam@example.co.uk"></div>
      <div class="field"><label for="ba">Address</label><textarea id="ba" name="address" rows="3" required autocomplete="street-address" placeholder="12 Ellerby Lane&#10;Leeds"></textarea></div>
      <div class="field-row">
        <div class="field"><label for="bp">Postcode</label><input id="bp" name="postcode" required autocomplete="postal-code" placeholder="LS9 8LD" style="text-transform:uppercase"></div>
        <div class="field"><label for="bc">Country</label><input id="bc" value="United Kingdom" disabled></div>
      </div>

      <button class="btn btn-lg btn-block" type="submit">Send me a free box</button>
      <p class="sub" style="text-align:center;font-size:12px">Free box, free return postage above the weight threshold. No card, no account.</p>
    </form>`;
}

function renderActiveBox(box) {
  const caps = CFG.boxCapacityKg || { small: 2.5, large: 6 };
  const cap = caps[box.size] || 2.5;
  const kg = (cap * box.fill / 100);
  const rate = (CFG.creditRatePerKg || {})[state.scrap.material] || 2;
  const steps = [0, 25, 50, 75, 100];
  return `
    <!-- Fill-level self-tracker (§4.4) — the dead-time problem.
         Days-to-weeks between box arriving and box being full is where
         enthusiasm dies. Keep the box mentally alive. -->
    <div class="filltrack">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <div>
          <span class="eyebrow">Your box · ${esc(box.ref)}</span>
          <h3 class="h-sec" style="margin-top:6px">How is it looking?</h3>
        </div>
        <span class="chip chip-amber">${box.size === 'large' ? 'Large' : 'Small'}</span>
      </div>

      <div class="fill-vis">
        <div class="fill-box">
          <div class="layers"></div>
          <div class="fill-liquid" style="height:${box.fill}%"></div>
        </div>
        <div class="fill-read">
          <b>${box.fill}%</b>
          <span>≈ ${kg.toFixed(1)} kg · worth about ${money.gbp(kg * rate)} in credit</span>
        </div>
      </div>

      <div class="fill-steps">
        ${steps.map(v => `<button class="fill-step" data-fill="${v}" aria-pressed="${box.fill === v}">${v}%</button>`).join('')}
      </div>

      <div class="timeline" style="margin-left:0;margin-right:0;margin-top:20px">
        <div class="tstep done"><b>Box ordered</b><span>Posted to you, free</span></div>
        <div class="tstep ${box.fill > 0 ? 'done' : 'now'}"><b>Filling</b><span>Label PLA and PETG separately using the bags</span></div>
        <div class="tstep ${box.fill >= 75 ? 'now' : ''}"><b>Photograph and post</b><span>Photo the contents before sealing — it settles disputes in your favour</span></div>
        <div class="tstep"><b>Weighed and verified</b><span>Within 2 weeks of arrival at the recycler</span></div>
        <div class="tstep"><b>Credit lands</b><span>Paid on accepted weight</span></div>
      </div>

      ${box.posted ? `
      <div class="posted-note">
        <b>Posted.</b> It is with a recycler now. Credit lands on accepted weight, usually inside two weeks of arrival.
      </div>` : `
      <button class="btn ${box.fill >= 75 ? '' : 'btn-quiet'} btn-block btn-lg" style="margin-top:18px" id="postBtn">
        ${box.fill >= 75 ? 'Post it' : 'Post it part-full anyway'}
      </button>`}
    </div>`;
}

async function submitBoxOrder(e) {
  e.preventDefault();
  const f = e.target;
  if (!f.name.value.trim() || !f.email.value.trim() || !f.address.value.trim() || !f.postcode.value.trim()) {
    toast('Name, email and address, please'); return;
  }
  const payload = {
    name: f.name.value.trim(), email: f.email.value.trim(),
    address: f.address.value.trim(), postcode: f.postcode.value.trim().toUpperCase(),
    box_size: state.scrap.box,
    // channel attribution: captured from /go/<code> QR redirects (§13.9)
    source: localStorage.getItem('rs_src') || null
  };
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending…';

  if (db) {
    // No auth required — box orders are anonymous by design (§4.3);
    // goes through the order_box RPC (direct table insert is RLS-blocked)
    const { error } = await db.rpc('order_box_simple', payload);
    if (error) { console.warn(error); toast('Could not send that — try again'); btn.disabled = false; btn.textContent = 'Send me a free box'; return; }
  }
  state.activeBox = { ref: 'RSP-' + String(1000 + Math.floor(Math.random() * 8999)), size: state.scrap.box, fill: 0, ordered: Date.now() };
  save();
  renderScrap();
  toast('Box on its way. Check your email.');
}

/* ---------------------------------------------------------------------
   11b. POST MY BOX  (§3.1 estimate, §4.5 matching, §5.1 photo evidence)

   The claimed box is a physical object sitting in someone's hallway.
   Posting it is the single highest-value action in the product, so it
   gets a sheet of its own rather than a link buried in the timeline.

   Four beats, in this order:
     1  ESTIMATE   — material mix, live credit, labelled an estimate.
     2  PHOTO      — the thing that settles disputes in the user's favour.
     3  LOCATION   — optional, declinable, only ever sent to the RPC.
     4  MATCH      — a named recycler, honestly explained if far away.

   Backend: respool.create_shipment(p_box_id, p_est_grams, p_lat, p_lng,
   p_sender_photos) is SECURITY DEFINER and granted to `authenticated`,
   and the client is already bound to the `respool` schema (see the
   createClient call at the top of this file), so db.rpc reaches it
   directly. No public bridge wrapper is needed for this call.
   ------------------------------------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAM_STEP = 50;

/* Sheet-local state. Deliberately NOT persisted: a half-filled post form
   restored three days later is a lie about what is in the box. */
let post = null;

function postRates() { return CFG.creditRatePerKg || { PLA: 2, PETG: 2.4 }; }
function postMaterials() { return Object.keys(postRates()); }

/* Seed the steppers from the fill tracker the user has already been
   maintaining (§4.4). They can correct it; they should not retype it. */
function seedPostGrams() {
  const box = state.activeBox || {};
  const caps = CFG.boxCapacityKg || { small: 2.5, large: 6 };
  const kg = (caps[box.size] || 2.5) * (box.fill || 0) / 100;
  const grams = {};
  postMaterials().forEach(m => { grams[m] = 0; });
  const primary = grams[state.scrap.material] != null ? state.scrap.material : postMaterials()[0];
  grams[primary] = Math.max(0, Math.round(kg * 1000 / GRAM_STEP) * GRAM_STEP);
  return grams;
}

function postEstimate(grams) {
  const rates = postRates();
  const lines = postMaterials()
    .filter(m => grams[m] > 0)
    .map(m => ({ material: m, grams: grams[m], credit: (grams[m] / 1000) * (rates[m] || 0) }));
  return {
    lines,
    grams: postMaterials().reduce((a, m) => a + (grams[m] || 0), 0),
    credit: lines.reduce((a, l) => a + l.credit, 0)
  };
}

/* The box row in `boxes` is the thing create_shipment wants. Locally we
   only ever kept a printed reference, so resolve the real id lazily —
   RLS already narrows `boxes` to the signed-in owner. */
async function resolveBoxId() {
  const box = state.activeBox;
  if (!box) return null;
  if (UUID_RE.test(box.id || '')) return box.id;
  if (!db || !state.user) return null;
  const { data, error } = await db.from('boxes')
    .select('id,size,fill_percent')
    .is('retired_at', null)
    .order('claimed_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) return null;
  box.id = data[0].id;
  if (data[0].size) box.size = data[0].size;
  save();
  return box.id;
}

function openPostSheet() {
  if (!state.activeBox) { toast('No box yet — order one first'); return; }
  post = {
    grams: seedPostGrams(),
    coords: null,
    geo: 'idle',        // idle | asking | granted | declined | unsupported
    photo: null,
    busy: false,
    error: null
  };
  openSheet('<div id="postFlow"></div>');
  paintPostSheet();
}

function paintPostSheet() {
  const host = $('#postFlow');
  if (!host) return;
  const rates = postRates();
  const est = postEstimate(post.grams);
  const box = state.activeBox;
  const needsAuth = Boolean(db) && !state.user;

  const geoLine = {
    idle: 'Optional. It only picks who receives the box — we never store the coordinates.',
    asking: 'Asking your browser…',
    granted: 'Thanks — we will match you to the nearest recycler with capacity.',
    declined: 'No problem. We will match on your delivery region instead.',
    unsupported: 'Your browser will not share it. We will match on region instead.'
  }[post.geo];

  host.innerHTML = `
    <h3>Post your box</h3>
    <p>Box ${esc(box.ref || '')} · tell us roughly what is inside, then we will name the recycler it goes to.</p>

    <!-- 1 — ESTIMATE ------------------------------------------------ -->
    <span class="eyebrow">Step 1 · What is in it</span>
    <div class="pmix">
      ${postMaterials().map(m => `
        <div class="pmix-row">
          <div class="pmix-label">
            <b>${esc(m)}</b>
            <span class="mono">${money.gbp(rates[m] || 0)}/kg</span>
          </div>
          <div class="pstep">
            <button type="button" data-grams="${esc(m)}" data-dir="-1"
              aria-label="Less ${esc(m)}" ${post.grams[m] <= 0 ? 'disabled' : ''}>−</button>
            <b class="mono">${post.grams[m]} g</b>
            <button type="button" data-grams="${esc(m)}" data-dir="1" aria-label="More ${esc(m)}">+</button>
          </div>
        </div>`).join('')}
    </div>

    <div class="est-block">
      <span class="eyebrow">Estimate</span>
      <div class="est-figure mono" id="postEst">${money.gbp(est.credit)}</div>
      <div class="est-lines">
        ${est.lines.length
          ? est.lines.map(l => `<div><span>${esc(l.material)} · ${l.grams} g</span><b>${money.gbp(l.credit)}</b></div>`).join('')
          : '<div><span>Nothing added yet</span><b>—</b></div>'}
      </div>
      <p class="est-note">
        <b>This is an estimate, not a promise.</b> Credit is paid on <em>accepted</em> weight after
        the recycler checks material, contamination and moisture. Mixed or damp scrap comes back lower.
      </p>
    </div>

    <!-- 2 — PHOTO --------------------------------------------------- -->
    <span class="eyebrow" style="display:block;margin-top:22px">Step 2 · Photograph the contents</span>
    <label class="photo-slot ${post.photo ? 'has' : ''}" for="postPhoto">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.4"/>
      </svg>
      <div>
        <b>${post.photo ? esc(post.photo) : 'Take a photo before you seal it'}</b>
        <span>${post.photo ? 'Attached to this shipment.' : 'One shot of the open box. It settles any weight dispute in your favour.'}</span>
      </div>
    </label>
    <input id="postPhoto" type="file" accept="image/*" capture="environment" hidden>

    <!-- 3 — LOCATION ------------------------------------------------ -->
    <span class="eyebrow" style="display:block;margin-top:22px">Step 3 · Better matching</span>
    <div class="loc-row ${post.geo === 'granted' ? 'has' : ''}">
      <div>
        <b>Use my location</b>
        <span>${esc(geoLine)}</span>
      </div>
      <button class="btn btn-ghost btn-sm" id="postGeo" type="button"
        ${post.geo === 'asking' || post.geo === 'granted' ? 'disabled' : ''}>
        ${post.geo === 'granted' ? 'Shared' : post.geo === 'asking' ? 'Asking…' : 'Share'}
      </button>
    </div>

    ${needsAuth ? `<p class="post-warn">Sign in first — a shipment has to belong to an account so the credit has somewhere to land.</p>` : ''}
    ${post.error ? `<p class="post-warn">${esc(post.error)}</p>` : ''}

    <button class="btn btn-teal btn-block btn-lg" style="margin-top:20px" id="postGo"
      ${post.busy || est.grams <= 0 ? 'disabled' : ''}>
      ${post.busy ? 'Finding you a recycler…' : 'Post it'}
    </button>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" id="postCancel">Not yet</button>
    <p class="sub" style="text-align:center;font-size:12px;margin-top:10px">
      Return postage is covered above the weight threshold. Rejected material is not sent back.
    </p>`;

  bindPostSheet();
}

function bindPostSheet() {
  $$('#postFlow [data-grams]').forEach(b => b.addEventListener('click', () => {
    const m = b.dataset.grams;
    const next = (post.grams[m] || 0) + Number(b.dataset.dir) * GRAM_STEP;
    post.grams[m] = Math.max(0, Math.min(20000, next));
    paintPostSheet();
  }));

  const file = $('#postPhoto');
  if (file) file.addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    // Placeholder: the file is acknowledged locally and recorded as a
    // pending sender photo on the shipment. Upload to storage is TODO —
    // see the sender_photos jsonb column on respool.shipments (§5.1).
    post.photo = f ? f.name : null;
    paintPostSheet();
  });

  const geo = $('#postGeo');
  if (geo) geo.addEventListener('click', requestPostLocation);

  const submit = $('#postGo');
  if (submit) submit.addEventListener('click', submitPost);

  const cancel = $('#postCancel');
  if (cancel) cancel.addEventListener('click', closeSheet);
}

/* Graceful decline is the whole point: a refusal is a normal outcome,
   not an error state, and the flow continues unchanged without it. */
function requestPostLocation() {
  if (!navigator.geolocation) { post.geo = 'unsupported'; paintPostSheet(); return; }
  post.geo = 'asking'; paintPostSheet();
  navigator.geolocation.getCurrentPosition(
    p => {
      post.coords = {
        lat: Math.round(p.coords.latitude * 1e4) / 1e4,     // ~11 m — plenty for matching
        lng: Math.round(p.coords.longitude * 1e4) / 1e4
      };
      post.geo = 'granted';
      paintPostSheet();
    },
    () => { post.coords = null; post.geo = 'declined'; paintPostSheet(); },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
  );
}

async function submitPost() {
  const est = postEstimate(post.grams);
  if (est.grams <= 0) return;

  if (db && !state.user) { closeSheet(); toast('Sign in first — then post the box'); go('#/account'); return; }

  post.busy = true; post.error = null; paintPostSheet();

  // Photo evidence is recorded as pending until storage upload is wired.
  const photos = post.photo
    ? [{ kind: 'sender_pre_seal', status: 'pending_upload', taken_at: new Date().toISOString() }]
    : [];

  let result = null;
  if (db) {
    const boxId = await resolveBoxId();
    if (!boxId) {
      post.busy = false;
      post.error = 'We could not find your box on your account. Try claiming it from the QR code again.';
      paintPostSheet();
      return;
    }
    const grams = {};
    postMaterials().forEach(m => { if (post.grams[m] > 0) grams[m] = post.grams[m]; });

    const { data, error } = await db.rpc('create_shipment', {
      p_box_id: boxId,
      p_est_grams: grams,
      p_lat: post.coords ? post.coords.lat : null,
      p_lng: post.coords ? post.coords.lng : null,
      p_sender_photos: photos
    });
    if (error) {
      console.warn(error);
      post.busy = false;
      post.error = 'That did not go through. Nothing has been sent — try again in a moment.';
      paintPostSheet();
      return;
    }
    result = data;
  } else {
    // Demo mode mirrors the RPC's shape so the success moment is real.
    result = {
      estimated_credit_pence: Math.round(est.credit * 100),
      allocated: true,
      is_estimate: true,
      shipment_id: 'demo-shipment',
      recycler: { trading_name: 'Pennine Polymers', region: 'West Yorkshire', distance_km: 34, widened: false }
    };
  }

  state.activeBox.posted = Date.now();
  state.activeBox.fill = 100;
  save();
  renderScrap();
  postSuccessSheet(result, est);
}

/* The moment the loop closes: a named human in a named place, then the
   §14.7 gap animation replayed against THIS box's estimate. */
function postSuccessSheet(res, est) {
  const r = (res && res.recycler) || {};
  const credit = res && res.estimated_credit_pence != null
    ? res.estimated_credit_pence / 100
    : est.credit;
  const dist = Number(r.distance_km);
  const hasDist = Number.isFinite(dist) && dist >= 0;
  const mult = CFG.creditMultiplierRecycled || 2;
  const cheapest = CATALOGUE.filter(l => l.recycled && !l.mystery).reduce((m, l) => Math.min(m, perKg(l)), Infinity);
  const nowP = money.power(state.credit, cheapest);
  const thenP = money.power(state.credit + credit, cheapest);
  const havePct = (state.credit + credit) > 0 ? (state.credit / (state.credit + credit)) * 100 : 0;

  openSheet(`
    <h3>${res && res.allocated === false ? 'Box logged' : 'Matched'}</h3>
    ${res && res.allocated === false ? `
      <p>Every recycler is at capacity right now. Your box is queued and our team has been alerted —
         you will get the address by email before you need to post it.</p>` : `
      <p>Print the label in your email, seal it, and drop it at any post office.</p>
      <div class="match-card">
        <span class="eyebrow">Going to</span>
        <b>${esc(r.trading_name || 'A Respool recycler')}</b>
        <span class="match-where">${esc(r.region || 'UK')}${hasDist ? ` · about ${Math.round(dist)} km away` : ''}</span>
      </div>
      ${r.widened ? `
        <p class="widened-note">
          Recyclers are busy near you — we matched you further afield so you are not waiting.
          Postage is on us either way, and it makes no difference to your credit.
        </p>` : ''}`}

    <!-- delivery step — filled in by startDelivery() once we have a quote -->
    <div id="deliveryStep" class="deliv"></div>

    <!-- §14.7 gap, replayed against this box's estimate -->
    <div class="hook" style="margin:18px 0 0">
      <span class="eyebrow">Estimated on this box</span>
      <div class="balance" id="postEarn" style="font-size:clamp(38px,11vw,50px);color:var(--ink)">£0.00</div>
      <div class="gapbar" aria-hidden="true">
        <div class="gapbar-track"><div class="gapbar-have" id="postHave"></div><div class="gapbar-gap"></div></div>
        <div class="gapbar-legend">
          <span class="have">${money.gbp(state.credit)} in your wallet</span>
          <span class="gap">+ ${money.gbp(credit)} in the post</span>
        </div>
      </div>
      <div class="hook-maths">
        <div class="hook-line is-have"><span>Credit you already hold</span><b>${money.gbp(state.credit)}</b></div>
        <div class="hook-line is-gap"><span>This box, once accepted</span><b>+ ${money.gbp(credit)}</b></div>
        <div class="hook-line"><span>Both, at ×${mult} on recycled</span><b>${money.gbp((state.credit + credit) * mult)} off</b></div>
      </div>
      <div class="hook-out">
        <b>${thenP.kg.toFixed(1)} kg for ${money.gbp(thenP.cash)}</b>
        <span>Today your credit takes home ${nowP.kg.toFixed(1)} kg for ${money.gbp(nowP.cash)}.
              The rest is in the box you just posted — still an estimate until it is weighed.</span>
      </div>
      <button class="btn btn-teal btn-block btn-lg" style="margin-top:14px" data-goto="#/shop">See what it buys</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px" id="postDone">Done</button>
    </div>`);

  countUp($('#postEarn'), credit);
  const bar = $('#postHave');
  const lines = $$('#sheetBody .hook-line');
  const out = $('#sheetBody .hook-out');
  if (REDUCED) {
    if (bar) bar.style.width = havePct + '%';
    lines.forEach(x => x.classList.add('in'));
    if (out) out.classList.add('in');
  } else {
    requestAnimationFrame(() => { if (bar) bar.style.width = havePct + '%'; });
    lines.forEach((x, i) => setTimeout(() => x.classList.add('in'), 420 + i * 300));
    setTimeout(() => { if (out) out.classList.add('in'); }, 420 + lines.length * 300);
  }
  const done = $('#postDone');
  if (done) done.addEventListener('click', closeSheet);

  if (!res || res.allocated === false) {
    const host = $('#deliveryStep');
    if (host) host.hidden = true;
  } else {
    startDelivery(res, est, credit);
  }
}

/* ---------------------------------------------------------------------
   11c. DELIVERY  — quote → choose → label → posted

   Backed by four public-schema RPCs (quote_delivery, choose_delivery,
   get_label, mark_posted). The buyer client is bound to `respool`, so
   every call here goes through pub().

   Honesty rules that shape this UI (§14.5):
     · options are shown cheapest-first, and the cheapest is *labelled*
       as cheapest rather than merely being first;
     · when postage is covered we say so in words and repeat the note the
       backend gives us verbatim — no invented terms;
     · when it is not covered we show the real pence the user will pay.
   ------------------------------------------------------------------- */

/* supabase-js v2 can retarget a schema per call; older builds cannot, so
   fall back to a second client rather than querying the wrong schema. */
let pubClient = null;
function pub() {
  if (!db) return null;
  if (typeof db.schema === 'function') return db.schema('public');
  if (!pubClient) {
    pubClient = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
      { db: { schema: 'public' } });
  }
  return pubClient;
}

let deliv = null;

function shipmentIdOf(res) {
  if (!res) return null;
  return res.shipment_id || res.id || (res.shipment && res.shipment.id) || null;
}

function pence(p) { return money.gbp((Number(p) || 0) / 100); }

async function startDelivery(res, est, credit) {
  const host = $('#deliveryStep');
  if (!host) return;

  deliv = {
    shipmentId: shipmentIdOf(res),
    boxSize: (state.activeBox && state.activeBox.size) || 'small',
    grams: est.grams,
    credit: credit,
    options: [],
    covered: false,
    note: '',
    chosen: null,
    label: null,
    posted: false,
    busy: true,
    error: null
  };
  paintDelivery();

  if (!deliv.shipmentId) {
    deliv.busy = false;
    deliv.error = 'We could not read the shipment reference. Your box is logged — open Scrap to finish the label.';
    return paintDelivery();
  }

  if (!db) {
    // Demo mode mirrors the RPC shape so the step is explorable.
    deliv.options = [
      { carrier: 'Evri', service: 'Standard ParcelShop', price_pence: 349, user_pays_pence: 0, covered: true, dropoff: 'Any Evri ParcelShop' },
      { carrier: 'Royal Mail', service: 'Tracked 48', price_pence: 489, user_pays_pence: 0, covered: true, dropoff: 'Any Post Office branch' }
    ];
    deliv.covered = true;
    deliv.note = 'Postage on this box is covered by Respool.';
    deliv.busy = false;
    return paintDelivery();
  }

  const { data, error } = await pub().rpc('quote_delivery', {
    box_size: deliv.boxSize,
    est_weight_g: Math.round(deliv.grams)
  });
  deliv.busy = false;
  if (error) {
    console.warn(error);
    deliv.error = 'We could not fetch postage options just now. Your box is logged — try again from Scrap.';
    return paintDelivery();
  }
  deliv.options = (data && data.options) || [];
  deliv.covered = Boolean(data && data.covered);
  deliv.note = (data && data.note) || '';
  paintDelivery();
}

function paintDelivery() {
  const host = $('#deliveryStep');
  if (!host || !deliv) return;

  if (deliv.busy) {
    host.innerHTML = `
      <span class="eyebrow">Step 2 · Getting it there</span>
      <p class="sub" style="margin-top:6px">Checking postage options…</p>`;
    return;
  }

  if (deliv.error) {
    host.innerHTML = `
      <span class="eyebrow">Step 2 · Getting it there</span>
      <p class="deliv-err">${esc(deliv.error)}</p>`;
    return;
  }

  if (deliv.chosen) return paintDeliveryChosen();

  if (!deliv.options.length) {
    host.innerHTML = `
      <span class="eyebrow">Step 2 · Getting it there</span>
      <p class="sub" style="margin-top:6px">No carrier options came back. We will email you a label instead — nothing else to do.</p>`;
    return;
  }

  host.innerHTML = `
    <span class="eyebrow">Step 2 · Getting it there</span>
    ${deliv.covered ? `
      <div class="deliv-free">
        <b>FREE — covered</b>
        <span>${esc(deliv.note || 'Respool covers the postage on this box.')}</span>
      </div>` : (deliv.note ? `<p class="sub" style="margin-top:6px">${esc(deliv.note)}</p>` : '')}
    <div class="deliv-list">
      ${deliv.options.map((o, i) => {
        const pays = Number(o.user_pays_pence) || 0;
        return `
        <button class="deliv-opt" data-deliv="${i}">
          <div class="deliv-opt-main">
            <b>${esc(o.carrier || 'Carrier')}${i === 0 ? ' <span class="chip chip-teal">Best price</span>' : ''}</b>
            <span>${esc(o.service || '')}</span>
            ${o.dropoff ? `<span class="deliv-drop">Drop off: ${esc(o.dropoff)}</span>` : ''}
          </div>
          <div class="deliv-opt-price">
            ${o.covered || pays === 0
              ? `<b class="is-free">Free</b><span>we pay ${pence(o.price_pence)}</span>`
              : `<b>${pence(pays)}</b><span>you pay</span>`}
          </div>
        </button>`;
      }).join('')}
    </div>
    <p class="sub" style="font-size:12px;margin-top:8px">Cheapest first. Pick whichever drop-off is easiest for you.</p>`;

  $$('#deliveryStep [data-deliv]').forEach(b =>
    b.addEventListener('click', () => chooseDelivery(Number(b.dataset.deliv))));
}

async function chooseDelivery(i) {
  const opt = deliv.options[i];
  if (!opt) return;
  deliv.busy = true; deliv.error = null; paintDelivery();

  if (db) {
    const { data, error } = await pub().rpc('choose_delivery', {
      shipment_id: deliv.shipmentId,
      carrier: opt.carrier,
      service: opt.service
    });
    if (error) {
      console.warn(error);
      deliv.busy = false;
      deliv.error = 'That carrier did not stick. Nothing is booked — try another option.';
      return paintDelivery();
    }
    deliv.label = data || null;
  } else {
    deliv.label = { label_token: 'DEMOLABEL123', dropoff: opt.dropoff };
  }

  deliv.chosen = opt;
  deliv.busy = false;
  paintDelivery();
}

function paintDeliveryChosen() {
  const host = $('#deliveryStep');
  const o = deliv.chosen;
  const pays = Number(o.user_pays_pence) || 0;
  const dropoff = (deliv.label && deliv.label.dropoff) || o.dropoff || '';

  host.innerHTML = `
    <span class="eyebrow">Step 2 · Getting it there</span>
    <div class="match-card" style="margin-top:8px">
      <span class="eyebrow">Posting with</span>
      <b>${esc(o.carrier || '')} · ${esc(o.service || '')}</b>
      <span class="match-where">${o.covered || pays === 0 ? 'Postage covered by Respool' : `${pence(pays)} to pay at drop-off`}${dropoff ? ` · ${esc(dropoff)}` : ''}</span>
    </div>
    ${deliv.posted ? `
      <div class="deliv-free" style="margin-top:12px">
        <b>Posted 🎉</b>
        <span>That is the loop closed. We will email you when it is weighed —
              your estimate of ${money.gbp(deliv.credit)} lands as credit once it is accepted.</span>
      </div>` : `
      <button class="btn btn-block" style="margin-top:12px" id="delivPrint">Print your label</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px" id="delivPosted">I've posted it</button>
      <p class="sub" style="font-size:12px;margin-top:8px">
        No printer? The drop-off shop can print it from the QR on the label page.</p>`}`;

  const print = $('#delivPrint');
  if (print) print.addEventListener('click', () => {
    window.open('/respool/label?shipment=' + encodeURIComponent(deliv.shipmentId), '_blank', 'noopener');
  });

  const posted = $('#delivPosted');
  if (posted) posted.addEventListener('click', markPosted);
}

async function markPosted() {
  const btn = $('#delivPosted');
  if (btn) btn.disabled = true;

  if (db) {
    const { error } = await pub().rpc('mark_posted', { shipment_id: deliv.shipmentId });
    if (error) {
      console.warn(error);
      if (btn) btn.disabled = false;
      toast('Could not mark it posted — try again');
      return;
    }
  }

  deliv.posted = true;
  if (state.activeBox) { state.activeBox.postedAt = Date.now(); save(); }
  paintDelivery();
  toast('Posted — ' + money.gbp(deliv.credit) + ' estimated on its way');
}

/* ---------------------------------------------------------------------
   12. SCREEN — BASKET
   ------------------------------------------------------------------- */
function renderBasket() {
  const lines = basketLines();
  const face = basketFace();
  const ship = face >= (CFG.freeShippingThreshold || 40) ? 0 : (CFG.shippingFlat || 3.95);

  $('#screen-basket').innerHTML = !lines.length ? `
    <div class="empty"><b>Nothing in the basket</b>Recycled batches are genuinely finite — the good colours do not hang around.
      <div style="margin-top:20px"><button class="btn" data-goto="#/shop">Browse filament</button></div></div>` : `
    <div class="wrap" style="padding-top:20px">
      <h2 class="h-scr">Basket</h2>
      <div style="margin-top:14px">
        ${lines.map(({ l, qty }) => `
          <div class="brow">
            <div class="bthumb" style="background:${l.swatch}"></div>
            <div class="bmeta">
              <b>${esc(l.title)}</b>
              <span>${esc(l.seller.name)} · ${l.kg} kg · ${money.gbp(perKg(l))}/kg</span>
              <div class="qty">
                <button data-dec="${l.id}" aria-label="Fewer">−</button><b>${qty}</b><button data-inc="${l.id}" aria-label="More">+</button>
              </div>
            </div>
            <div class="bprice">${money.gbp(l.price * qty)}</div>
          </div>`).join('')}
      </div>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--line)">
        <div class="mrow" style="border:0"><span>Subtotal</span><b>${money.gbp(face)}</b></div>
        <div class="mrow" style="border:0"><span>Shipping${ship === 0 ? ' · free over ' + money.gbp(CFG.freeShippingThreshold || 40) : ''}</span><b>${ship === 0 ? 'Free' : money.gbp(ship)}</b></div>
      </div>
      ${ship > 0 ? `<p class="sub" style="font-size:12.5px">Add ${money.gbp((CFG.freeShippingThreshold || 40) - face)} for free shipping.</p>` : ''}

      <button class="btn btn-lg btn-block" style="margin-top:18px" data-goto="#/checkout">Checkout</button>
      <p class="sub" style="text-align:center;font-size:12px;margin-top:10px">Credit applies on the next step.</p>
    </div>`;

  $$('#screen-basket [data-inc]').forEach(b => b.addEventListener('click', () => {
    state.basket.find(x => x.id === b.dataset.inc).qty++; save(); paintWallet(); renderBasket();
  }));
  $$('#screen-basket [data-dec]').forEach(b => b.addEventListener('click', () => {
    const line = state.basket.find(x => x.id === b.dataset.dec);
    line.qty--; if (line.qty <= 0) state.basket = state.basket.filter(x => x !== line);
    save(); paintWallet(); renderBasket();
  }));
}

/* ---------------------------------------------------------------------
   13. SCREEN — CHECKOUT
   Credit slider showing the 2x effect (§14.8). No dark patterns: nothing
   pre-ticked, shipping shown, no manufactured urgency (§14.5).
   ------------------------------------------------------------------- */
function renderCheckout() {
  const lines = basketLines();
  if (!lines.length) { go('#/basket'); return; }

  const face = basketFace();
  const ship = face >= (CFG.freeShippingThreshold || 40) ? 0 : (CFG.shippingFlat || 3.95);
  const mult = basketMult();
  const maxCredit = Math.min(state.credit, (face * money.cap()) / mult);   // credit can't overshoot the goods
  const applied = Math.min(state.creditApplied, maxCredit);
  const worth = applied * mult;
  const total = Math.max(0, face - worth) + ship;
  const recCount = lines.filter(x => x.l.recycled).length;

  $('#screen-checkout').innerHTML = `
    <div class="wrap" style="padding-top:20px">
      <h2 class="h-scr">Checkout</h2>

      <div class="creditslider">
        <div class="cs-head">
          <b>Apply credit</b>
          <span>${money.gbp(state.credit)} available</span>
        </div>
        <div class="cs-effect">
          <span class="used">${money.gbp(applied)} credit</span>
          <span class="arrow">→</span>
          <span class="worth">${money.gbp(worth)} off</span>
        </div>
        <input class="slider" id="creditSlide" type="range" min="0" max="${maxCredit.toFixed(2)}" step="0.10" value="${applied.toFixed(2)}" aria-label="Credit to apply">
        <div class="slider-labels"><span>None</span><span>All ${money.gbp(maxCredit)}</span></div>
        <p class="cs-note">
          ${recCount ? `Worth ×${mult} because this basket contains recycled spools.` : `Worth face value — this basket is branded stock only. Add a recycled spool and your credit doubles.`}
        </p>
        <div class="cs-split">
          <button class="chip" data-credit="0">Use none</button>
          <button class="chip chip-teal" data-credit="${maxCredit.toFixed(2)}">Use all ${money.gbp(maxCredit)}</button>
        </div>
      </div>

      <!-- Three lines. Always three lines. (§3.2, §14.5) -->
      <div class="maths">
        <div class="maths-hd"><span class="eyebrow">What you pay</span><span class="chip ${recCount ? 'chip-teal' : ''}">Credit ×${mult}</span></div>
        <div class="maths-rows">
          <div class="mrow"><span>Face price<small>${lines.length} line${lines.length === 1 ? '' : 's'} · ${basketQty()} spool${basketQty() === 1 ? '' : 's'}</small></span><b>${money.gbp(face)}</b></div>
          <div class="mrow credit"><span>Credit applied<small>${money.gbp(applied)} from wallet, worth ×${mult}</small></span><b>−${money.gbp(worth)}</b></div>
          <div class="mrow"><span>Shipping</span><b>${ship === 0 ? 'Free' : money.gbp(ship)}</b></div>
        </div>
        <div class="maths-total"><span>Total</span><b>${money.gbp(total)}</b></div>
      </div>

      <!-- ================= STRIPE — TODO: WIRING ==================== -->
      <div class="paystub">
        <span class="todo">TODO · Stripe not wired</span>
        <h4>Payment</h4>
        <p>Test-mode stub. In production this mounts a Stripe Payment Element against a PaymentIntent from
           <code class="mono">${esc(CFG.STRIPE_CHECKOUT_ENDPOINT || '/create-payment-intent')}</code>,
           with Apple Pay, Google Pay and Link enabled (§14.8). Nothing below is submitted anywhere.</p>
        <div class="walletpay">
          <button type="button" disabled> Pay</button>
          <button type="button" disabled>G Pay</button>
        </div>
        <div class="fakecard">
          <input inputmode="numeric" placeholder="4242 4242 4242 4242" aria-label="Card number (test)">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input inputmode="numeric" placeholder="MM / YY" aria-label="Expiry (test)">
            <input inputmode="numeric" placeholder="CVC" aria-label="CVC (test)">
          </div>
        </div>
      </div>

      <button class="btn btn-lg btn-block" id="payBtn">Pay ${money.gbp(total)}</button>
      <p class="sub" style="text-align:center;font-size:12px;margin-top:10px">
        Credit is non-refundable to cash. Recycled batches are finite; if a spool sells out before payment clears you are not charged.
      </p>
    </div>`;

  $('#creditSlide').addEventListener('input', e => {
    state.creditApplied = Number(e.target.value); renderCheckout();
    const s = $('#creditSlide'); if (s) s.focus();
  });
  $$('#screen-checkout [data-credit]').forEach(b => b.addEventListener('click', () => {
    state.creditApplied = Number(b.dataset.credit); renderCheckout();
  }));
  $('#payBtn').addEventListener('click', () => completeOrder({ applied, total, face }));
}

/* Order placed → the §14.7 moment fires. This is the conversion point
   where the marketplace turns into the loop. */
async function completeOrder({ applied, total }) {
  // TODO: confirm the Stripe PaymentIntent here before mutating any state.
  const rate = (CFG.creditRatePerKg || {}).PLA || 2;
  const earned = Math.round(total * (CFG.orderCreditPct || 0.05) * 100) / 100;   // every order earns credit (§14.7)
  const potential = rate * ((CFG.boxCapacityKg || {}).small || 2.5);
  const mult = CFG.creditMultiplierRecycled || 2;

  state.credit = Math.max(0, state.credit - applied) + earned;
  state.basket = []; state.creditApplied = 0; state.orders++;
  save(); paintWallet(); bumpWallet();

  const total2 = state.credit + potential;
  const cheapest = CATALOGUE.filter(l => l.recycled && !l.mystery).reduce((m, l) => Math.min(m, perKg(l)), Infinity);
  const nowP = money.power(state.credit, cheapest);
  const thenP = money.power(total2, cheapest);
  openSheet(`
    <h3>Order placed</h3>
    <p>Confirmation on its way. Now the interesting bit.</p>
    <div class="hook" style="margin:0">
      <span class="eyebrow">You just earned</span>
      <div class="balance" id="earnNum" style="font-size:clamp(40px,12vw,54px);color:var(--ink)">£0.00</div>
      <div class="hook-maths">
        <div class="hook-line is-have in"><span>Credit now in your wallet</span><b>${money.gbp(state.credit)}</b></div>
        <div class="hook-line is-gap in"><span>What the scrap from this order is worth</span><b>+ ${money.gbp(potential)}</b></div>
        <div class="hook-line in"><span>Both, at ×${mult} on recycled</span><b>${money.gbp(total2 * mult)} off</b></div>
      </div>
      <div class="hook-out in" style="margin-top:12px">
        <b>${thenP.kg.toFixed(1)} kg for ${money.gbp(thenP.cash)}</b>
        <span>Right now your credit takes home ${nowP.kg.toFixed(1)} kg for ${money.gbp(nowP.cash)}.
              The other half is in the bin.</span>
      </div>
      <button class="btn btn-teal btn-block btn-lg" style="margin-top:14px" data-goto="#/scrap">Order a free box</button>
      <button class="btn btn-ghost btn-block" style="margin-top:8px" id="hookSkip">Not now</button>
    </div>`);
  countUp($('#earnNum'), earned);
  $('#hookSkip').addEventListener('click', () => { closeSheet(); go('#/shop'); });
}

/* ---------------------------------------------------------------------
   14. SCREEN — CLAIM  (/respool/claim?token=…  §4.2 QR on the box)
   Scanning the box opens account creation with the box already linked.
   No reference numbers to type, no email hunting.
   ------------------------------------------------------------------- */
let claimToken = null;

function renderClaim() {
  const t = claimToken;
  $('#screen-claim').innerHTML = `
    <div class="claim">
      <div class="claim-badge">
        <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="var(--forest)" stroke-width="1.6" stroke-linejoin="round">
          <path d="M3 8.5l9-4.5 9 4.5v7L12 20l-9-4.5z"/><path d="M3 8.5l9 4.5 9-4.5M12 13v7"/>
        </svg>
      </div>
      <h2>This box is yours.</h2>
      <p>Scanned box <b class="mono">${esc(t || 'unknown')}</b>. Confirm your email and we will link it to your account — every kilo it comes back with lands as credit.</p>
      ${t ? `<div class="token">box token · ${esc(t)}</div>` : `<div class="token" style="color:var(--amber-ink);background:var(--amber-wash);border-color:var(--amber)">No token in the link. Open the app from the QR code on the box.</div>`}

      <form id="claimForm" class="form" style="margin:0;text-align:left">
        <div class="field">
          <label for="ce">Email</label>
          <input id="ce" type="email" required inputmode="email" autocomplete="email" placeholder="sam@example.co.uk">
        </div>
        <button class="btn btn-lg btn-block" type="submit" ${t ? '' : 'disabled'}>Send me a code</button>
      </form>
      <p class="sub" style="font-size:12px;margin-top:14px">
        We send a six-digit code. No password to invent, no password to forget.
      </p>
    </div>`;
  $('#claimForm').addEventListener('submit', startOtp);
}

async function startOtp(e) {
  e.preventDefault();
  const email = $('#ce').value.trim();
  if (!email) return;
  const btn = e.target.querySelector('button');
  btn.disabled = true; btn.textContent = 'Sending…';

  if (db) {
    const { error } = await db.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, data: { box_token: claimToken } }
    });
    if (error) { toast(error.message); btn.disabled = false; btn.textContent = 'Send me a code'; return; }
  }
  openOtpSheet(email);
  btn.disabled = false; btn.textContent = 'Send me a code';
}

function openOtpSheet(email) {
  openSheet(`
    <h3>Check your email</h3>
    <p>Six digits, sent to <b>${esc(email)}</b>. It expires in ten minutes.</p>
    <div class="otpgrid" id="otp">
      ${[0,1,2,3,4,5].map(i => `<input inputmode="numeric" maxlength="1" data-i="${i}" aria-label="Digit ${i+1}">`).join('')}
    </div>
    <button class="btn btn-lg btn-block" id="otpGo">Link my box</button>
    <button class="btn btn-ghost btn-block" style="margin-top:8px" id="otpResend">Send it again</button>`);

  const inputs = $$('#otp input');
  inputs[0].focus();
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/g, '').slice(0, 1);
      if (inp.value && inputs[i + 1]) inputs[i + 1].focus();
    });
    inp.addEventListener('keydown', ev => {
      if (ev.key === 'Backspace' && !inp.value && inputs[i - 1]) inputs[i - 1].focus();
    });
    inp.addEventListener('paste', ev => {
      const d = (ev.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!d) return;
      ev.preventDefault();
      d.split('').forEach((c, k) => { if (inputs[k]) inputs[k].value = c; });
      inputs[Math.min(d.length, 5)].focus();
    });
  });
  $('#otpResend').addEventListener('click', () => { if (db) db.auth.signInWithOtp({ email }); toast('Code sent again'); });
  $('#otpGo').addEventListener('click', () => verifyOtp(email, inputs.map(i => i.value).join('')));
}

async function verifyOtp(email, token) {
  if (token.length !== 6) { toast('Six digits, please'); return; }
  if (db) {
    const { data, error } = await db.auth.verifyOtp({ email, token, type: 'email' });
    if (error) { toast(error.message); return; }
    state.user = data.user;
    if (claimToken) {
      // Links this box to the fresh account. RLS should scope this to the caller.
      const { error: linkErr } = await db.rpc('link_box_to_user', { p_token: claimToken });
      if (linkErr) console.warn('[respool] box link failed', linkErr);
    }
    await refreshCredit();
  } else {
    state.user = { email, id: 'demo' };
  }
  state.activeBox = state.activeBox || { ref: 'RSP-' + (claimToken || '0000').slice(-4).toUpperCase(), size: 'small', fill: 0, ordered: Date.now() };
  save(); closeSheet();
  toast('Box linked. Go and fill it.');
  go('#/scrap');
}

/* ---------------------------------------------------------------------
   15. SCREEN — ACCOUNT
   ------------------------------------------------------------------- */
function renderAccount() {
  const u = state.user;
  const initial = (u && u.email ? u.email[0] : 'R').toUpperCase();
  $('#screen-account').innerHTML = `
    ${u ? `
      <div class="acct-head">
        <div class="avatar">${initial}</div>
        <div><b>${esc(u.email)}</b><span>Buyer · Tier 1 · joined this year</span></div>
      </div>` : `
      <div class="wrap" style="padding-top:20px">
        <h2 class="h-scr">Account</h2>
        <p class="sub" style="margin-top:8px;max-width:36ch">You do not need one to order a box or to browse. You do need one to spend credit.</p>
        <button class="btn btn-lg btn-block" style="margin-top:18px" id="signinBtn">Sign in with email</button>
      </div>`}

    <div class="statgrid">
      <div class="card"><b>${money.gbp(state.credit)}</b><span>Credit</span></div>
      <div class="card"><b>2.4</b><span>kg recycled</span></div>
      <div class="card"><b>${state.orders}</b><span>Orders</span></div>
    </div>

    <div class="menu">
      ${[
        ['Orders', 'Track and reorder', '#/shop'],
        ['Shipments', 'Boxes out and in', '#/scrap'],
        ['Refer a mate', 'Both of you get credit', null],
        ['Market rates', 'Public dashboard — average credit per kg', null],
        ['How grading works', 'The published standard', null],
        ['Raise a query on a shipment', 'Under £1 auto-resolves your way', null],
        ['Terms, credit expiry &amp; privacy', '', null]
      ].map(([t, s, href]) => `
        <button class="mitem" ${href ? `data-goto="${href}"` : ''}>
          <span><b style="font-weight:500;display:block">${t}</b>${s ? `<em>${s}</em>` : ''}</span>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>`).join('')}
    </div>

    ${u ? `<div class="wrap" style="margin-top:18px"><button class="btn btn-ghost btn-block" id="signoutBtn">Sign out</button></div>` : ''}
    <p class="sub" style="text-align:center;font-size:11.5px;margin:24px var(--gut) 0">Respool · UK · credit is non-withdrawable and non-transferable</p>
  `;
  const si = $('#signinBtn');
  if (si) si.addEventListener('click', () => openSheet(`
    <h3>Sign in</h3>
    <p>We send a six-digit code. No password.</p>
    <form class="form" id="siForm" style="margin:0">
      <div class="field"><label for="sie">Email</label><input id="sie" type="email" required inputmode="email" autocomplete="email" placeholder="sam@example.co.uk"></div>
      <button class="btn btn-lg btn-block" type="submit">Send me a code</button>
    </form>`));
  const so = $('#signoutBtn');
  if (so) so.addEventListener('click', async () => {
    if (db) await db.auth.signOut();
    state.user = null; save(); renderAccount(); toast('Signed out');
  });
}
async function onSigninSubmit(e) {
  if (!e.target.matches('#siForm')) return;
  e.preventDefault();
  const email = $('#sie').value.trim(); if (!email) return;
  if (db) {
    const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) { toast(error.message); return; }
  }
  openOtpSheet(email);
}

/* ---------------------------------------------------------------------
   16. ROUTER
   ------------------------------------------------------------------- */
const TABS = { shop:'#/shop', wallet:'#/wallet', scrap:'#/scrap', account:'#/account' };
const TITLES = { product:'', wallet:'Wallet', scrap:'Send scrap', account:'Account', basket:'Basket', checkout:'Checkout', claim:'Claim your box' };

function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

function route() {
  // /claim?token=… — the QR path. Works with or without the hash router.
  const isClaimPath = location.pathname.replace(/\/+$/, '').endsWith('/respool/claim');
  const urlToken = new URLSearchParams(location.search).get('token');
  const h = location.hash || (isClaimPath ? '#/claim' : '#/shop');
  const parts = h.replace(/^#\/?/, '').split('/');
  let screen = parts[0] || 'shop';

  if (isClaimPath || screen === 'claim') { screen = 'claim'; claimToken = urlToken || parts[1] || claimToken; }
  if (screen === 'p') screen = 'product';                       // #/p/:id is the short form
  if (!$(`#screen-${screen}`)) { go('#/shop'); return; }

  $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === screen));

  switch (screen) {
    case 'shop':     renderShop(); break;
    case 'product':  renderProduct(parts[1]); break;
    case 'wallet':   renderWallet(); break;
    case 'scrap':    renderScrap(); break;
    case 'account':  renderAccount(); break;
    case 'basket':   renderBasket(); break;
    case 'checkout': renderCheckout(); break;
    case 'claim':    renderClaim(); break;
  }

  // chrome: tabs, back button, title
  const tabKey = screen === 'product' ? 'shop' : screen;
  $$('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === tabKey)));
  const deep = !['shop', 'wallet', 'scrap', 'account'].includes(screen);
  $('#backBtn').hidden = !deep;
  $('#markHome').hidden = deep;
  const title = TITLES[screen === 'p' ? 'product' : screen];
  $('#appbarTitle').hidden = !(deep && title);
  $('#appbarTitle').textContent = title || '';
  window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  paintWallet();
}

window.addEventListener('hashchange', route);
document.addEventListener('submit', onSigninSubmit);   // sheet-rendered sign-in form

/* Global delegated navigation — any [data-goto] anywhere. */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-goto]');
  if (nav) { closeSheet(); go(nav.dataset.goto); }
});
$$('.tab').forEach(t => t.addEventListener('click', () => go(TABS[t.dataset.tab])));
$('#backBtn').addEventListener('click', () => history.length > 1 ? history.back() : go('#/shop'));
$('#markHome').addEventListener('click', () => go('#/shop'));
$('#walletPill').addEventListener('click', () => go('#/wallet'));
$('#basketBtn').addEventListener('click', () => go('#/basket'));

/* ---------------------------------------------------------------------
   17. BOOT
   ------------------------------------------------------------------- */
(async function boot() {
  // channel attribution: /go/<code> redirects land here with ?src=<code>;
  // remember it so the box order carries the source (§13.9)
  const src = new URLSearchParams(location.search).get('src');
  if (src && /^[a-z0-9_-]{1,40}$/i.test(src)) localStorage.setItem('rs_src', src.toLowerCase());
  if (db) {
    const { data } = await db.auth.getSession();
    state.user = data && data.session ? data.session.user : null;
    db.auth.onAuthStateChange((_e, session) => {
      state.user = session ? session.user : null;
      refreshCredit(); paintWallet();
    });
    await refreshCredit();
    CATALOGUE = await fetchListings();
  }
  paintWallet();
  route();
})();

})();
