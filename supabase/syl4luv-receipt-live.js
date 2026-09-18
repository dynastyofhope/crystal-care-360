/* ============================================================================
   syl4luv-receipt-live.js — real receipts from the database
   ----------------------------------------------------------------------------
   Loaded by syl4luv-receipt.html. In demo mode it does nothing at all.

   When Supabase is configured it looks up real payments. Who sees what is
   decided by the database, not by this file:
     • a member sees only their own payments  (row-level security)
     • Dr. Syl4luv sees every payment
   The console's "✉ Send receipt" button lands here with ?ref=SLV-…&send=1.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var DB = window.SYL4LUV_DB;
  if (!DB || !DB.isLive()) return;                 /* demo mode: change nothing */

  var host = window.SYL_RECEIPT;
  var want = null;
  try { want = new URLSearchParams(window.location.search).get('ref'); } catch (e) {}

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  function longDate(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }
  function shortDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toDateString().replace(/^\w+ /, function (w) { return d.toLocaleDateString('en-NG', { weekday: 'long' }) + ', '; }) +
           ' · ' + d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  }
  function words(n) {
    var units = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
      'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    var tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    function under1000(x) {
      if (x < 20) return units[x];
      if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? '-' + units[x % 10] : '');
      return units[Math.floor(x / 100)] + ' hundred' + (x % 100 ? ' and ' + under1000(x % 100) : '');
    }
    n = Math.round(Number(n) || 0);
    if (!n) return 'Zero naira only';
    var out = '';
    if (n >= 1000000) { out += under1000(Math.floor(n / 1000000)) + ' million '; n %= 1000000; }
    if (n >= 1000) { out += under1000(Math.floor(n / 1000)) + ' thousand '; n %= 1000; }
    if (n) out += under1000(n);
    out = out.trim().replace(/\s+/g, ' ');
    return out.charAt(0).toUpperCase() + out.slice(1) + ' naira only';
  }
  function methodLabel(m) {
    return ({ bank_transfer: 'Bank transfer — Access Bank', cash: 'Cash at center',
              card: 'Card payment', pos: 'POS at center' })[m] || 'Bank transfer — Access Bank';
  }
  function serviceLabel(p, booking) {
    if (booking && booking.service) {
      return booking.service + (booking.preferred_date
        ? '' : '');
    }
    return p.amount && Number(p.amount) === 20000 ? 'Confirmation deposit — 4 sessions' : 'Consultation fee';
  }

  function notice(html) {
    var bar = document.getElementById('sylRecNote');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'sylRecNote';
      bar.style.cssText = 'max-width:900px;margin:12px auto 0;padding:11px 15px;border-radius:13px;font-size:.86rem;' +
        'background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46';
      var top = document.querySelector('.wrap') || document.body;
      top.insertBefore(bar, top.firstChild);
    }
    bar.innerHTML = html;
    bar.style.display = html ? 'block' : 'none';
  }

  DB.init().then(function () {
    var user = DB.user();
    if (!user) {
      notice('🔒 <strong>Please log in to see a receipt.</strong> Receipts are private — ' +
        '<a href="syl4luv-chat-app.html#chat" style="font-weight:800;color:#0f6b4f">log in or create a free account</a>, ' +
        'or call the center on 0703 382 8292 and we will send yours.');
      return;
    }
    var staff = DB.isStaff();

    return Promise.all([
      staff ? DB.api.allPayments() : DB.api.myPayments(),    /* RLS decides what comes back */
      staff ? DB.api.allBookings() : DB.api.myBookings(),
      staff ? DB.api.allProfiles() : Promise.resolve([DB.profile()].filter(Boolean))
    ]).then(function (r) {
      var payments = r[0] || [], bookings = r[1] || [], profiles = r[2] || [];
      var me = profiles.filter(function (p) { return p.id === user.id; })[0] || DB.profile() || {};
      var bkById = {};
      bookings.forEach(function (b) { bkById[b.id] = b; });

      if (!payments.length) {
        notice(staff
          ? 'No payments yet — as soon as a member pays and you confirm it, the receipt appears here.'
          : 'No payments on record yet for this account. Once Dr. Syl4luv confirms your ₦5,000 transfer, your receipt appears here.');
        if (host && host.empty) host.empty();     /* never show the demo receipts as if they were real */
        return;
      }

      var whoById = {};
      profiles.forEach(function (p) { whoById[p.id] = p; });

      var list = payments.map(function (p) {
        var bk = bkById[p.booking_id] || {};
        var who = whoById[p.member_id] || me;
        var when = p.paid_on || p.created_at;
        return {
          ref: p.reference || 'SLV-PAY',
          email: (who && who.email) || bk.email || '',
          phone: (who && who.phone) || bk.phone || '',
          member: (who && who.full_name) || bk.full_name || 'Member',
          id: bk.reference || 'SLV',
          date: longDate(when),
          session: serviceLabel(p, bk),
          sessionDate: bk.preferred_date
            ? shortDateTime(bk.preferred_date + 'T12:00:00')
            : 'Paid on ' + longDate(when),
          amount: Number(p.amount || 0),
          words: words(p.amount),
          method: methodLabel(p.method),
          account: '0032601495 · Adidi Sylvanus Osigbemeh',
          by: 'Dr. Syl4luv, Relationship Therapy Center',
          status: p.status === 'confirmed' ? 'Paid' : (p.status === 'declined' ? 'Declined' : 'Awaiting confirmation')
        };
      }).sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
      });

      var ok = host && host.load(list, want);
      if (!ok) { notice('Live receipts are unavailable on this page build — reload the page.'); return; }
      if (want && !list.some(function (r) { return String(r.ref).toLowerCase() === String(want).toLowerCase(); })) {
        if (host.notFound) host.notFound(want);
        notice('No receipt found for <strong>' + String(want).replace(/[<>]/g, '') + '</strong> — showing the most recent one instead.');
      } else {
        notice(staff
          ? 'You are signed in as staff — showing <strong>' + list.length + ' receipt' + (list.length === 1 ? '' : 's') + '</strong> from the database.'
          : 'These are <strong>your</strong> receipts, loaded from the centre\u2019s database.');
      }
    }).catch(function (e) {
      notice('Could not load receipts: ' + DB.friendly(e));
    });
  });
})(window, document);
