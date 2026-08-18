/* =====================================================================
   Respool — printable shipping label

   Reads ?shipment=<uuid>, requires the same Supabase session the buyer
   app uses, and calls public.get_label(shipment_id). Nothing about the
   shipment is embedded in the HTML: the page is a renderer, the row is
   the source of truth, and RLS decides whether you may see it.

   The QR points at /recycler?receive=<label_token> — the RECYCLER side.
   It is generated server-side by /qr/receive/:token so the label prints
   identically on every device and needs no client QR library.
   ===================================================================== */
(function () {
'use strict';

const CFG = window.RESPOOL_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const HAS_SUPABASE =
  CFG.SUPABASE_URL && CFG.SUPABASE_URL !== 'SUPABASE_URL' &&
  CFG.SUPABASE_ANON_KEY && CFG.SUPABASE_ANON_KEY !== 'SUPABASE_ANON_KEY' &&
  typeof window.supabase !== 'undefined';

// Same client contract as app.js: tables live in `respool`, the delivery
// RPCs are bridged into `public`.
const db = HAS_SUPABASE
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY,
      { db: { schema: CFG.SUPABASE_SCHEMA || 'respool' } })
  : null;

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

const TOKEN_RE = /^[A-Za-z0-9_-]{4,64}$/;

function say(title, body, isErr) {
  const el = $('#state');
  el.className = 'state noprint' + (isErr ? ' is-err' : '');
  el.innerHTML = `<b>${esc(title)}</b><p>${body}</p>`;
  el.hidden = false;
}

function gbp(p) { return '£' + ((Number(p) || 0) / 100).toFixed(2); }

function renderLabel(L) {
  const to = L.to || {};
  const from = L.from || {};
  const token = String(L.label_token || '');
  const grams = Number(L.est_weight_g);
  const covered = Boolean(L.covered);

  const qr = TOKEN_RE.test(token)
    ? `<img src="/respool/qr/receive/${encodeURIComponent(token)}?mm=30&dark=%23000000&light=%23ffffff"
            alt="Scan to receive this shipment" width="113" height="113">`
    : '';

  $('#label').innerHTML = `
    <div class="label-main">
      <div class="label-hdr">
        <span class="label-brand">RESPOOL</span>
        <span class="label-carrier">${esc(L.carrier || '')}${L.service ? ' · ' + esc(L.service) : ''}</span>
      </div>

      <span class="lbl">Deliver to</span>
      <div class="to">
        <b>${esc(to.name || 'Respool recycler')}</b>
        ${to.line1 ? esc(to.line1) + '<br>' : ''}
        ${to.line2 ? esc(to.line2) + '<br>' : ''}
        ${esc(to.city || '')} ${esc(to.postcode || '')}
      </div>

      <div class="from">
        <span class="lbl">From</span><br>
        ${esc(from.name || 'Respool sender')}
      </div>

      <div class="meta">
        <span><span class="lbl">Box</span> <b>${esc(L.box_size || L.size || '—')}</b></span>
        <span><span class="lbl">Est. weight</span> <b>${Number.isFinite(grams) ? (grams / 1000).toFixed(2) + ' kg' : '—'}</b></span>
        <span><span class="lbl">Ref</span> <b>${esc(token.slice(0, 12))}</b></span>
      </div>

      ${L.dropoff ? `<div class="dropoff"><span class="lbl">Drop off</span> ${esc(L.dropoff)}</div>` : ''}
      <div class="covered">${covered
        ? 'Postage covered by Respool — nothing to pay'
        : `Postage ${gbp(L.price_pence)} — payable at drop-off`}</div>
    </div>

    <div class="qr">
      ${qr}
      <div class="token">${esc(token)}</div>
      <div class="cap">Recycler: scan on intake</div>
    </div>`;

  $('#label').hidden = false;
  $('#chrome').hidden = false;
}

async function boot() {
  $('#printBtn').addEventListener('click', () => window.print());

  const shipment = new URLSearchParams(location.search).get('shipment');
  if (!shipment) {
    return say('No shipment given',
      'This page needs a shipment reference — open it from the post-your-box flow.', true);
  }

  if (!db) {
    // Demo mode: the layout must be inspectable without a live backend, and
    // it must be obvious that this is not a real label.
    say('Demo label',
      'Supabase is not configured, so this is a sample layout — do not post it.');
    return renderLabel({
      label_token: 'DEMOLABEL123', carrier: 'Evri', service: 'Standard ParcelShop',
      covered: true, price_pence: 349, est_weight_g: 2400, box_size: 'small',
      to: { name: 'Pennine Polymers', line1: 'Unit 4, Calder Works', line2: 'Bridge Road',
            city: 'Halifax', postcode: 'HX3 6TT' },
      from: { name: 'M. Okafor' },
      dropoff: 'Any Evri ParcelShop'
    });
  }

  const { data: { session } = {} } = await db.auth.getSession();
  if (!session) {
    return say('Sign in to see this label',
      'Labels carry a real address, so we only show them to the account that owns the box. ' +
      '<a href="/respool/app#/account" style="color:var(--f-teal)">Sign in</a>, then reopen this page.', true);
  }

  const { data, error } = await pub().rpc('get_label', { shipment_id: shipment });
  if (error) {
    console.warn(error);
    return say('We could not load this label',
      'Either this shipment is not yours, or it has no carrier chosen yet. ' +
      'Go back to your box and pick a delivery option.', true);
  }
  if (!data) {
    return say('No label yet',
      'This shipment has no carrier chosen yet — pick a delivery option first.', true);
  }

  renderLabel(data);
}

document.addEventListener('DOMContentLoaded', boot);
})();
