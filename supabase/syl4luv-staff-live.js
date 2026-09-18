/* ============================================================================
   syl4luv-staff-live.js — puts a staff login in front of the therapist console
   and the income statement, and feeds both from the real database
   ----------------------------------------------------------------------------
   Loaded by:  syl4luv-admin-dashboard.html, syl4luv-income-summary.html

   In demo mode (no keys in supabase-config.js) this file does NOTHING and both
   pages behave exactly as they always have.

   When Supabase is configured:
     • anyone who opens the page must sign in, and must have role
       'therapist' or 'support', before seeing anything
     • the console shows real pending payments, real members, real bookings and
       real private messages, and confirming a payment writes to the database
     • the income statement is rebuilt from the real payments and expenses

   ABOUT THE GATE, HONESTLY: a static HTML file cannot hide itself — the gate is
   the lock on the door, but what stops a visitor reading member data is the
   row-level security in schema.sql (their browser would be refused by the
   database). The gate is here so that nobody stumbles in, and so the console
   cannot be used by mistake.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var DB = window.SYL4LUV_DB;
  if (!DB || !DB.isLive()) return;                 /* demo mode: change nothing */

  var IS_ADMIN = !!document.getElementById('paytable');
  var IS_INCOME = !!document.getElementById('chips');

  /* ------------------------------------------------------------------ utils */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function naira(n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); }
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }
  function palette(name) {
    var p = ['#ff6b6b,#ff8fc7', '#8e7cff,#cfc4ff', '#37c8bb,#63d8ff', '#ffd93d,#ffb03a', '#6a58e0,#37c8bb'];
    var i = 0, s = String(name || '');
    for (var k = 0; k < s.length; k++) i += s.charCodeAt(k);
    return p[i % p.length];
  }
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) { return; }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('show'); }, ms || 4000);
  }
  function yen(iso) {                                   /* 'DD Mon' as the statement wants */
    var d = new Date(iso);
    return isNaN(d) ? '' : d.getDate() + ' ' + d.toLocaleDateString('en-NG', { month: 'short' });
  }
  function longDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  function shortDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function timeOf(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  }
  function ago(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' minutes ago';
    if (s < 86400) return Math.round(s / 3600) + (Math.round(s / 3600) === 1 ? ' hour ago' : ' hours ago');
    return Math.round(s / 86400) + (Math.round(s / 86400) === 1 ? ' day ago' : ' days ago');
  }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function methodLabel(m) {
    return ({ bank_transfer: 'Bank transfer', cash: 'Cash at center', card: 'Card', pos: 'POS' })[m] || 'Bank transfer';
  }
  function pill(status) {
    return ({ confirmed: '<span class="pilltag s-ok">Paid</span>',
              pending: '<span class="pilltag s-warn">Unpaid</span>',
              declined: '<span class="pilltag s-miss">Declined</span>' })[status] || '<span class="pilltag s-done">Registered</span>';
  }
  function waLink(name, phone, email) {
    var msg = 'Hello ' + name + ', this is Dr. Syl4luv Relationship Therapy Center regarding your session. ';
    var num = String(phone || '').replace(/\D/g, '');
    if (num.indexOf('0') === 0) num = '234' + num.slice(1);
    return 'https://wa.me/' + (num || '2347033828292') + '?text=' + encodeURIComponent(msg);
  }

  /* ------------------------------------------------------------------- gate */
  function gate(kind, message) {
    var css = document.createElement('style');
    css.textContent =
      '#sylgate{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:22px;overflow:auto;' +
      'background:radial-gradient(900px 460px at 8% -4%,rgba(124,58,237,.35),transparent 62%),' +
      'radial-gradient(760px 420px at 96% 4%,rgba(219,39,119,.3),transparent 58%),linear-gradient(170deg,#241a3d,#3a2455)}' +
      '#sylgate .box{width:100%;max-width:430px;background:#fff;border-radius:22px;padding:26px 24px;box-shadow:0 26px 70px rgba(0,0,0,.4)}' +
      '#sylgate h1{margin:0 0 4px;font-size:1.22rem;color:#241a3d}' +
      '#sylgate p{margin:0 0 16px;color:#5c5473;font-size:.92rem;line-height:1.5}' +
      '#sylgate label{display:block;font-size:.82rem;font-weight:750;margin:12px 0 5px;color:#241a3d}' +
      '#sylgate input{width:100%;padding:12px 14px;border:1.6px solid #e6e2f2;border-radius:12px;font:inherit}' +
      '#sylgate button{margin-top:16px;width:100%;padding:14px;border:0;border-radius:13px;font:inherit;font-weight:750;' +
      'color:#fff;cursor:pointer;background:linear-gradient(135deg,#7c3aed,#db2777)}' +
      '#sylgate button.ghost{background:#fff;color:#7c3aed;border:1.6px solid rgba(124,58,237,.3);margin-top:10px}' +
      '#sylgate .err{display:none;margin-top:12px;padding:11px 13px;border-radius:11px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font-size:.87rem}' +
      '#sylgate .brand{display:flex;align-items:center;gap:10px;margin-bottom:16px;color:#241a3d;font-weight:800}';
    document.head.appendChild(css);

    var box = document.createElement('div');
    box.id = 'sylgate';
    if (kind === 'login') {
      box.innerHTML = '<div class="box"><div class="brand"><span style="width:34px;height:34px;border-radius:11px;' +
        'background:linear-gradient(135deg,#7c3aed,#db2777);display:grid;place-items:center;color:#fff">💜</span> Dr. Syl4luv — staff area</div>' +
        '<h1>Therapist console</h1><p>This area holds members\u2019 names, phone numbers, payments and private messages. ' +
        'Please sign in with your staff account.</p>' +
        '<form id="sylgateForm"><label for="gEmail">Email</label><input id="gEmail" type="email" required autocomplete="username" placeholder="syl4luv@gmail.com">' +
        '<label for="gPass">Password</label><input id="gPass" type="password" required autocomplete="current-password" placeholder="••••••••">' +
        '<button type="submit">Sign in</button></form>' +
        '<button class="ghost" type="button" id="gBack">← Back to the member site</button>' +
        '<div class="err" id="gErr"></div></div>';
      document.body.appendChild(box);
      document.body.style.overflow = 'hidden';
      $('#sylgateForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = this.querySelector('button');
        btn.disabled = true; btn.textContent = 'Signing in…';
        DB.signIn({ email: $('#gEmail').value.trim(), password: $('#gPass').value })
          .then(function () {
            if (DB.isStaff()) { window.location.reload(); return; }
            btn.disabled = false; btn.textContent = 'Sign in';
            /* Say exactly what to do — this is the moment a practice owner gets
               stuck: the site's own key can never grant staff rights (that is the
               point of it), so the promotion happens once, in the SQL Editor. */
            showErr('This is a member account, not the doctor\u2019s staff account. The console only ' +
                    'opens for an account with the therapist role, which is set once in the database: ' +
                    'open supabase/tools/make-staff.sql, run it in the Supabase SQL Editor and ' +
                    'promote this email — then sign in here again. Nothing is lost meanwhile: ' +
                    'members\u2019 messages are stored and waiting.');
          })
          .catch(function (err) {
            btn.disabled = false; btn.textContent = 'Sign in';
            showErr(err.message);
          });
      });
      $('#gBack').addEventListener('click', function () { window.location.href = 'syl4luv-chat-app.html'; });
      function showErr(m) { var e = $('#gErr'); e.textContent = m; e.style.display = 'block'; }
    } else {
      box.innerHTML = '<div class="box"><h1>Staff access only</h1>' +
        '<p>' + esc(message || 'This console is for Dr. Syl4luv and the support team.') + '</p>' +
        '<p style="font-size:.87rem;color:#6b6480">You are signed in as <strong>' + esc(DB.name()) + '</strong>' +
        (DB.user() && DB.user().email ? ' (' + esc(DB.user().email) + ')' : '') + '.</p>' +
        '<button id="gOut">Sign out and use a staff account</button>' +
        '<button class="ghost" id="gBack2" type="button">← Back to the member site</button></div>';
      document.body.appendChild(box);
      document.body.style.overflow = 'hidden';
      $('#gOut').addEventListener('click', function () { DB.signOut().then(function () { window.location.reload(); }); });
      $('#gBack2').addEventListener('click', function () { window.location.href = 'syl4luv-chat-app.html'; });
    }
  }

  /* how the console keeps itself current: instant, or a short poll */
  function paintLive(status) {
    var chip = document.getElementById('sylRt');
    if (!chip) return;
    var map = {
      live:  ['● Instant updates', 'background:#e9fbf3;color:#0f6b4f;border:1px solid #a7efd0'],
      connecting: ['◌ Connecting…', 'background:#fffbeb;color:#92400e;border:1px solid #fde68a'],
      offline:    ['◌ Renewing…', 'background:#fffbeb;color:#92400e;border:1px solid #fde68a'],
      error:      ['◌ Polling every 30s', 'background:#fffbeb;color:#92400e;border:1px solid #fde68a'],
      unsupported:['◌ Polling every 30s', 'background:#f1f0f7;color:#5c5473;border:1px solid #e6e2f2'],
      off:        ['◌ Polling every 30s', 'background:#f1f0f7;color:#5c5473;border:1px solid #e6e2f2']
    };
    var m = map[status] || map.off;
    chip.textContent = m[0];
    chip.style.cssText = 'display:inline-flex;align-items:center;margin-left:8px;padding:5px 11px;border-radius:999px;' +
      'font-size:.72rem;font-weight:800;' + m[1];
    chip.title = status === 'live'
      ? 'Connected to the database — new messages and payment claims appear the moment they happen.'
      : 'The instant connection is unavailable, so the console refreshes itself every 30 seconds instead.';
  }

  /* badge so it is obvious the console is running on live data */
  function liveBadge() {
    var host = $('.topbar .tb-left') || $('.topbar') || $('header');
    if (!host || $('#sylLive')) return;
    var b = document.createElement('span');
    b.id = 'sylLive';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:10px;padding:5px 11px;border-radius:999px;' +
      'background:#e9fbf3;color:#0f6b4f;font-size:.72rem;font-weight:800;border:1px solid #a7efd0';
    b.innerHTML = '<i style="width:7px;height:7px;border-radius:50%;background:#12b76a;display:inline-block"></i> LIVE database';
    host.appendChild(b);
    var rt = document.createElement('span');
    rt.id = 'sylRt';
    rt.className = 'sylrt';
    host.appendChild(rt);
    paintLive('connecting');
  }

  /* ======================================================================== */
  /*  ADMIN CONSOLE                                                          */
  /* ======================================================================== */
  function initAdmin() {
    liveBadge();
    var data = { payments: [], profiles: [], bookings: [], messages: [] };
    var byId = {};

    function load() {
      return Promise.all([DB.api.allPayments(), DB.api.allProfiles(), DB.api.allBookings(),
                          DB.select('messages', { eq: { room: 'private' }, order: 'created_at.desc', limit: 200 })])
        .then(function (r) {
          data.payments = r[0] || []; data.profiles = r[1] || []; data.bookings = r[2] || []; data.messages = r[3] || [];
          byId = {};
          data.profiles.forEach(function (p) { byId[p.id] = p; });
          renderAll();
        })
        .catch(function (e) { toast('Could not load the database: ' + e.message, 7000); });
    }

    function nameOfPayment(p) {
      var who = byId[p.member_id];
      if (who && who.full_name) return who.full_name;
      var bk = data.bookings.filter(function (b) { return b.id === p.booking_id; })[0];
      if (bk && bk.full_name) return bk.full_name;
      return 'Member';
    }
    function emailOf(p) {
      var who = byId[p.member_id];
      if (who && who.email) return who.email;
      var bk = data.bookings.filter(function (b) { return b.id === p.booking_id; })[0];
      return (bk && bk.email) || '';
    }
    function phoneOf(p) {
      var who = byId[p.member_id];
      if (who && who.phone) return who.phone;
      var bk = data.bookings.filter(function (b) { return b.id === p.booking_id; })[0];
      return (bk && bk.phone) || '';
    }
    function serviceOf(p) {
      var bk = data.bookings.filter(function (b) { return b.id === p.booking_id; })[0];
      return (bk && bk.service) || 'Consultation fee';
    }

    /* ---------------------------------------------------- payments queue */
    function renderPayments() {
      var tb = $('#paytable tbody');
      if (!tb) return;
      var pending = data.payments.filter(function (p) { return p.status === 'pending'; });
      var rows = pending.length ? pending : data.payments.filter(function (p) { return p.status === 'confirmed'; }).slice(0, 8);
      var viewingConfirmed = !pending.length;

      tb.innerHTML = rows.map(function (p) {
        var nm = nameOfPayment(p);
        return '<tr data-id="' + esc(p.id) + '" data-amount="' + esc(p.amount) + '" data-status="' + esc(p.status) + '">' +
          '<td>' + esc(nm) + '<br><small>' + esc(serviceOf(p)) + ' · ' + esc(shortDate(p.paid_on)) + '</small></td>' +
          '<td>' + naira(p.amount) + '</td>' +
          '<td class="hide-sm">' + esc(p.reference || '—') + '</td>' +
          '<td>' + (p.status === 'pending'
            ? '<div class="trow"><button class="btn btn-wa btn-sm js-confirm">Confirm</button>' +
              '<button class="btn btn-ghost btn-sm js-decline">Decline</button></div>'
            : '<div class="trow"><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="syl4luv-receipt.html?ref=' +
              encodeURIComponent(p.reference || '') + '&send=1">✉ Send receipt</a>' +
              '<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="syl4luv-receipt.html?ref=' +
              encodeURIComponent(p.reference || '') + '">🧾 View</a></div>') + '</td></tr>';
      }).join('');

      var head = $('#paytable').closest('.card').querySelector('h3');
      if (head) head.textContent = viewingConfirmed ? 'Recent confirmed payments' : 'Queue — awaiting confirmation';
      $('#payempty').style.display = rows.length ? 'none' : 'block';
      $('#payempty').textContent = viewingConfirmed
        ? 'No confirmed payments yet. Confirmed payments appear here with their receipt links.'
        : 'Queue is clear — nothing awaiting confirmation. 🎉';

      /* live totals */
      var today = todayISO();
      var confirmedToday = data.payments.filter(function (p) {
        return p.status === 'confirmed' && String(p.confirmed_at || p.paid_on || '').slice(0, 10) === today;
      });
      var totalSum = confirmedToday.reduce(function (a, p) { return a + Number(p.amount || 0); }, 0);
      var pSum = pending.reduce(function (a, p) { return a + Number(p.amount || 0); }, 0);

      setText('pendingmoney', naira(pSum));
      setText('pendingcount', pending.length + (pending.length === 1 ? ' payment' : ' payments'));
      setText('paycount', String(pending.length));
      setText('totaltile', naira(totalSum));
      setText('totalcount', confirmedToday.length + (confirmedToday.length === 1 ? ' payment' : ' payments'));
      setText('mtm', data.profiles.length + ' members');

      /* "needs you now" list on the Today tab */
      renderTiles(pending);

      var q = $('#quickqueue');
      if (q) {
        q.innerHTML = pending.slice(0, 3).map(function (p) {
          return '<div class="slot"><div><b>' + esc(nameOfPayment(p)) + '</b><div class="muted">' +
            esc(p.reference || '') + ' · ' + naira(p.amount) + ' claim</div></div>' +
            '<button class="btn btn-wa btn-sm" data-quick="' + esc(p.id) + '">Confirm ' + naira(p.amount) + '</button></div>';
        }).join('') || '<p class="muted" style="margin:0">Nothing waiting — every payment is accounted for. 🎉</p>';
      }

      /* money tiles that are not part of the original demo wiring */
      var grid = $$('#panel-payments .card.stat, #panel-payments .stat b');
      if (grid.length) {
        $$('#panel-payments .stat b').forEach(function (b) {
          if (/payments?$/i.test(b.textContent) && b.id === '') b.textContent = pending.length + ' pending';
        });
      }
    }

    function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

    /* the four number tiles at the top of the console */
    /* A conversation is "waiting" when the newest message in it came from the
       member — i.e. the doctor still owes an answer. That is the number that
       matters at the top of the console. */
    /* One conversation = one member + one private box (thread). A member can
       keep several boxes, so the console lists them separately, exactly like a
       phone's message list. Key: "<member id>|<thread>". */
    function threadKey(m) { return (m.member_id || 'unknown') + '|' + ((m && m.thread) || 'main'); }
    function threadIndex() {
      var meId = (DB.user() && DB.user().id) || null;
      var latest = {};
      data.messages.forEach(function (m) {
        if ((m.member_id || 'unknown') === meId) return;    /* the doctor's own room */
        var k = threadKey(m);
        if (!latest[k] || String(m.created_at || '') > String(latest[k].created_at || '')) latest[k] = m;
      });
      return { me: meId, latest: latest };
    }
    function waitingThreads() {
      var ix = threadIndex();
      return Object.keys(ix.latest).filter(function (k) {
        var m = ix.latest[k];
        return !m.sender_id || m.sender_id !== ix.me;   /* last word was the member's */
      });
    }
    function topicOfBox(m) {
      if (m && m.topic) return m.topic;
      return ((m && m.thread) || 'main') === 'main' ? 'private room' : 'private conversation';
    }
    function waitedFor(iso) {
      var then = new Date(iso || 0);
      if (isNaN(then)) return '';
      var mins = Math.max(0, Math.round((Date.now() - then.getTime()) / 60000));
      if (mins < 2) return 'waiting just now';
      if (mins < 60) return 'waiting ' + mins + ' min';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return 'waiting ' + hrs + 'h' + (mins % 60 >= 10 ? ' ' + (mins % 60) + 'm' : '');
      var days = Math.floor(hrs / 24);
      return 'waiting ' + days + ' day' + (days === 1 ? '' : 's');
    }

    function renderTiles(pending) {
      var stat = $$('.grid.g4 .card.stat');
      if (stat.length < 4) return;
      var today = todayISO();
      var todays = data.bookings.filter(function (b) {
        return String(b.preferred_date || '').slice(0, 10) === today;
      });
      var paidIds = {};
      data.payments.forEach(function (p) { if (p.status === 'confirmed' && p.booking_id) paidIds[p.booking_id] = true; });
      var doneCount = todays.filter(function (b) { return paidIds[b.id]; }).length;

      stat[0].querySelector('.cic').textContent = todays.length;
      stat[0].querySelector('span').textContent = todays.length
        ? doneCount + ' paid · ' + (todays.length - doneCount) + ' to go'
        : 'nothing booked for today';

      /* only real members count here — the therapist holds a profile row too */
      var people = data.profiles.filter(function (p) { return p.role !== 'therapist' && p.role !== 'staff'; });
      var week = new Date(Date.now() - 7 * 86400000);
      var fresh = people.filter(function (p) { return new Date(p.created_at) >= week; }).length;
      stat[2].querySelector('.cic').textContent = people.length;
      stat[2].querySelector('b').textContent = 'Members';
      stat[2].querySelector('span').textContent = fresh ? fresh + ' joined this week' : 'all from the database';

      /* the strip above the menu counts them too */
      var strips = $$('.tb-item');
      for (var si = 0; si < strips.length; si++) {
        if (/can reach you now/.test(strips[si].textContent)) {
          strips[si].innerHTML = '<strong>You are online</strong> — ' + people.length + ' member' +
            (people.length === 1 ? '' : 's') + ' can reach you now';
          break;
        }
      }

      var waiting = waitingThreads().length;
      var ut = document.getElementById('unreadtile');
      if (ut) ut.textContent = waiting;
      var wb = stat[3].querySelector('b');
      if (wb) wb.textContent = 'Waiting for a reply';
      stat[3].querySelector('span').textContent = waiting
        ? waiting + ' conversation' + (waiting === 1 ? '' : 's') + ' owed an answer'
        : 'everybody has been answered';
      var mt = document.getElementById('msgcount');
      if (mt) mt.textContent = waiting;

      /* the greeting and the summary line follow the real clock and the real rows */
      var h1 = document.querySelector('#today h1') || document.querySelector('h1');
      if (h1 && /^Good (morning|afternoon|evening)/.test(h1.textContent || '')) {
        var hr = new Date().getHours();
        var part = hr < 12 ? 'Good morning' : (hr < 17 ? 'Good afternoon' : 'Good evening');
        h1.innerHTML = part + ', <span class="hl">' + esc(DB.name()) + '</span>';
      }
      var line = document.getElementById('todayline');
      if (line) {
        line.textContent = longDate(new Date()) + ' · ' +
          todays.length + ' session' + (todays.length === 1 ? '' : 's') + ' booked · ' +
          (waiting ? waiting + ' conversation' + (waiting === 1 ? '' : 's') + ' waiting for you'
                   : 'every conversation answered');
      }
    }

    function confirmPayment(id, btn) {
      if (btn) { btn.disabled = true; btn.textContent = 'Confirming…'; }
      return DB.api.confirmPayment(id)
        .then(function () {
          toast('Payment confirmed ✅ The member\'s dashboard updates immediately and the receipt is ready to send.', 6000);
          return load();
        })
        .catch(function (e) {
          if (btn) { btn.disabled = false; btn.textContent = 'Confirm'; }
          toast('Could not confirm: ' + e.message, 7000);
        });
    }

    function declinePayment(id, btn) {
      if (btn) { btn.disabled = true; }
      DB.update('payments', { id: id }, { status: 'declined' })
        .then(function () { toast('Payment marked declined — the member will be asked to resend the receipt.'); return load(); })
        .catch(function (e) { if (btn) { btn.disabled = false; } toast('Could not update: ' + e.message, 7000); });
    }

    /* --------------------------------------------------------- members */
    function renderMembers() {
      var tb = $('#mtable tbody');
      if (!tb) return;
      var counts = {};
      data.bookings.forEach(function (b) { if (b.member_id) counts[b.member_id] = (counts[b.member_id] || 0) + 1; });
      var paid = {};
      data.payments.forEach(function (p) { if (p.status === 'confirmed' && p.member_id) paid[p.member_id] = true; });

      var people = data.profiles.filter(function (p) { return p.role !== 'therapist' && p.role !== 'staff'; });
      tb.innerHTML = people.map(function (m) {
        var nm = m.full_name || (m.email || 'Member').split('@')[0];
        var status = paid[m.id] ? '<span class="pilltag s-ok">Active · paid</span>'
                                 : '<span class="pilltag s-warn">Awaiting payment</span>';
        var phone = m.phone || '—';
        return '<tr><td><div style="display:flex;gap:10px;align-items:center">' +
          '<span class="mini-av" style="background:linear-gradient(135deg,' + palette(nm) + ')">' + esc(initials(nm)) + '</span>' +
          '<span>' + esc(nm) + '<br><small>' + esc(m.email || '') + '</small></span></div></td>' +
          '<td class="hide-sm">' + esc(phone) + '</td>' +
          '<td class="hide-sm">' + (counts[m.id] || 0) + '</td>' +
          '<td>' + status + (m.role !== 'member' ? ' <span class="pilltag s-done">' + esc(m.role) + '</span>' : '') + '</td>' +
          '<td><div class="trow">' +
            '<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" data-email="' + esc(m.email || '') + '" data-phone="' + esc(phone) + '" href="' +
              waLink(nm, m.phone, m.email) + '">WhatsApp</a>' +
            '<button class="btn btn-ghost btn-sm js-start" data-member="' + esc(m.id) + '" data-name="' + esc(nm) + '">Chat</button>' +
          '</div></td></tr>';
      }).join('') || '<tr><td colspan="5" style="padding:18px;text-align:center;color:#6b6480">No members have signed up yet.</td></tr>';

      setText('mcount', people.length + (people.length === 1 ? ' member' : ' members'));
      setText('mempty', '');
    }

    /* ---------------------------------------------------- appointments */
    function renderAppointments() {
      var tb = $('#appttable tbody');
      if (!tb) return;
      var confirmedRefs = {};
      data.payments.forEach(function (p) { if (p.status === 'confirmed' && p.reference) confirmedRefs[p.reference] = true; });

      tb.innerHTML = data.bookings.map(function (b) {
        var when = b.preferred_date || b.created_at;
        var isToday = String(b.preferred_date || '').slice(0, 10) === todayISO();
        var isPast = b.preferred_date && String(b.preferred_date) < todayISO();
        var payRow = data.payments.filter(function (p) { return p.booking_id === b.id; })[0];
        var isPaid = !!(payRow && payRow.status === 'confirmed');
        var nm = b.full_name || 'Member';
        var phone = b.phone || '';
        return '<tr data-paid="' + (isPaid ? 'yes' : 'no') + '" data-day="' + (isToday ? 'today' : 'later') + '">' +
          '<td><b>' + esc(shortDate(when)) + '</b><br><small>' + (b.preferred_date ? 'booked ' + esc(shortDate(b.created_at)) : 'registered') + '</small></td>' +
          '<td>' + esc(nm) + '<br><small>' + esc(b.reference || '') + '</small></td>' +
          '<td class="hide-sm">' + esc(b.service || '') + '</td>' +
          '<td>' + (isPaid ? '<span class="pilltag s-ok">Paid</span>' : '<span class="pilltag s-warn">' + esc(b.status === 'cancelled' ? 'Cancelled' : 'Unpaid') + '</span>') + '</td>' +
          '<td><div class="trow"><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" data-email="' + esc(b.email || '') + '" data-phone="' + esc(phone) + '" href="' +
            waLink(nm, phone, b.email) + '">WhatsApp</a>' +
            (isPaid ? '' : '<button class="btn btn-ghost btn-sm js-remind" data-name="' + esc(nm) + '">Remind to pay</button>') +
          '</div></td></tr>';
      }).join('') || '<tr><td colspan="5" style="padding:18px;text-align:center;color:#6b6480">No bookings yet. Registrations from the website appear here the moment they are submitted.</td></tr>';
    }

    /* -------------------------------------------------- today's schedule */
    function renderToday() {
      var card = $('#panel-todayp .card');
      if (!card) return;
      var host = card.querySelector('.tools + div');
      var h3 = card.querySelector('h3');
      if (h3) h3.textContent = longDate(new Date());
      if (!host) return;
      var todays = data.bookings.filter(function (b) { return String(b.preferred_date || '').slice(0, 10) === todayISO(); });
      var list = todays.length ? todays : data.bookings.slice(0, 5);
      host.innerHTML = list.map(function (b) {
        var payRow = data.payments.filter(function (p) { return p.booking_id === b.id; })[0];
        var isPaid = !!(payRow && payRow.status === 'confirmed');
        var nm = b.full_name || 'Member';
        return '<div class="slot"><div><time>' + esc(b.preferred_date ? timeOf(b.preferred_date + 'T00:00:00') === '12:00 AM' ? shortDate(b.preferred_date) : shortDate(b.preferred_date) : shortDate(b.created_at)) + '</time>' +
          '<div class="who">' + esc(nm) + ' · ' + esc(b.service || '') + '</div></div>' +
          '<div class="trow">' + (isPaid ? '<span class="pilltag s-ok">Paid' + (payRow && payRow.reference ? ' · ' + esc(payRow.reference) : '') + '</span>'
                                         : '<span class="pilltag s-warn">Awaiting payment</span>') +
          '<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="' + waLink(nm, b.phone, b.email) + '">WhatsApp</a>' +
          '</div></div>';
      }).join('') || '<div class="slot"><div class="who">Nothing scheduled — a quiet day.</div></div>';
    }

    /* -------------------------------------------------------- messages */
    function renderMessages() {
      var panel = $('#panel-messages');
      if (!panel) return;
      var listHost = panel.querySelector('.grid > div');
      if (!listHost) return;
      var meId = (DB.user() && DB.user().id) || null;

      DB.select('messages', { eq: { room: 'private' }, order: 'created_at.desc', limit: 200 })
        .then(function (rows) {
          var meId = (DB.user() && DB.user().id) || null;
          var threads = {};
          (rows || []).forEach(function (m) {
            var memberId = m.member_id || 'unknown';
            if (memberId === meId) return;          /* the doctor's own room is not a member conversation */
            var key = threadKey(m);
            if (!threads[key]) threads[key] = [];
            threads[key].push(m);
          });
          var keys = Object.keys(threads);
          var term = (searchTerm || '').toLowerCase().replace(/\s+/g, ' ');
          if (term) {
            keys = keys.filter(function (k) {
              var memberId = k.split('|')[0];
              var who = byId[memberId] || {};
              var hay = ((who.full_name || '') + ' ' + (who.email || '') + ' ' +
                         threads[k].map(function (m) { return (m.topic || '') + ' ' + (m.body || ''); }).join(' ')).toLowerCase();
              return hay.indexOf(term) !== -1;
            });
          }
          setText('msgcount', String(waitingThreads().length));
          listHost.innerHTML = keys.map(function (k) {
            var msgs = threads[k];
            var last = msgs[0];
            var memberId = k.split('|')[0];
            var who = byId[memberId];
            var nm = (who && who.full_name) || last.sender_name || 'Member';
            var boxLabel = topicOfBox(last);
            var fromMember = !last.sender_id || last.sender_id !== meId;
            var tag = fromMember
              ? '<span class="pilltag" style="background:#fdecee;color:#9c0f1b">Waiting</span> '
              : '<span class="pilltag s-ok">Answered</span> ';
            return '<div class="msg' + (fromMember ? ' unread' : '') + '" data-thread="' + esc(memberId) + '"' +
              ' data-tkey="' + esc(k) + '" data-topic="' + esc(boxLabel) + '" style="cursor:pointer">' +
              (fromMember ? '<span class="dotu"></span>' : '') +
              '<span class="mini-av" style="background:linear-gradient(135deg,' + palette(nm) + ')">' + esc(initials(nm)) + '</span>' +
              '<div style="flex:1;min-width:0"><b>' + esc(nm) + ' — ' + esc(boxLabel) + '</b>' + tag +
              '<p>“' + esc(String(last.body || '').slice(0, 110)) + (String(last.body || '').length > 110 ? '…' : '') + '”</p>' +
              '<time>' + esc(fromMember ? waitedFor(last.created_at) : 'you replied ' + ago(last.created_at)) + '</time></div></div>';
          }).join('') || (term
            ? '<p class="muted" style="padding:14px">Nothing matches “' + esc(searchTerm) + '”. Clear the search to see every conversation.</p>'
            : '<p class="muted" style="padding:14px">No private messages yet. When a member writes in the chat room it appears here.</p>');

          listHost.querySelectorAll('[data-tkey]').forEach(function (el) {
            el.addEventListener('click', function () {
              var key = el.getAttribute('data-tkey');
              var memberId = el.getAttribute('data-thread');
              var boxLabel = el.getAttribute('data-topic') || 'private room';
              var who = byId[memberId];
              var nm = (who && who.full_name) || 'Member';
              listHost.querySelectorAll('.msg').forEach(function (x) { x.classList.remove('sel'); });
              el.classList.add('sel');
              setText('replyto', 'Reply to ' + nm + ' · ' + boxLabel);
              setText('replyhint', (threads[key] || []).slice(0, 4).reverse().map(function (m) {
                var mine = !m.sender_name || m.sender_name === DB.name() || (DB.user() && m.sender_id === DB.user().id);
                return (mine ? 'You: ' : nm + ': ') + String(m.body || '').slice(0, 120);
              }).join('\n'));
              var box = $('#replybox');
              if (box) {
                box.dataset.member = memberId;
                box.dataset.memberName = nm;
                box.dataset.thread = key.split('|')[1] || 'main';
                box.dataset.topic = boxLabel;
                box.focus();
              }
            });
          });
        })
        .catch(function () {});
    }

    /* -------------------------------------------- writing to a member first
       A member does not have to write before the doctor can reach her. This
       fills the picker with every member, offers that member's existing boxes
       (or a new one), and sends the first message into the chosen box. */
    var starterWired = false;

    function boxesOf(memberId) {
      var seen = {}, out = [];
      (data.messages || []).forEach(function (m) {
        if (m.member_id !== memberId) return;
        var th = m.thread || 'main';
        if (seen[th]) return;
        seen[th] = true;
        out.push({ thread: th, label: topicOfBox(m) });
      });
      out.sort(function (a, b) { return a.thread === 'main' ? -1 : (b.thread === 'main' ? 1 : 0); });
      return out;
    }

    function paintBoxChoices(keepChoice) {
      var memSel = $('#newmsgmember'), boxSel = $('#newmsgbox'), wrap = $('#newmsgtopicwrap');
      if (!memSel || !boxSel) return;
      var who = memSel.value;
      var boxes = who ? boxesOf(who) : [];
      var was = boxSel.value;
      boxSel.innerHTML = boxes.map(function (b) {
        return '<option value="' + esc(b.thread) + '">' + esc(b.label) + '</option>';
      }).join('') + '<option value="__new__">＋ Open a new box…</option>';
      /* Rebuilding the list must not undo the doctor's own choice — that is what
         this flag is for: keep it when he picked a box, reset it when he changed
         member instead. */
      var valid = boxes.some(function (b) { return b.thread === was; }) || was === '__new__';
      boxSel.value = (keepChoice && valid) ? was : (boxes.length ? boxes[0].thread : '__new__');
      if (wrap) wrap.style.display = boxSel.value === '__new__' ? 'block' : 'none';
      if (boxSel.value === '__new__' && $('#newmsgboxtopic') && !$('#newmsgboxtopic').value) {
        $('#newmsgboxtopic').placeholder = boxes.length ? 'e.g. Check-in this week' : 'e.g. Our first conversation';
      }
    }

    function renderComposer() {
      var memSel = $('#newmsgmember');
      if (!memSel) return;
      var meId = (DB.user() && DB.user().id) || null;
      var keep = memSel.value;
      var people = (data.profiles || []).filter(function (p) {
        return p.role !== 'therapist' && p.role !== 'support' && p.id !== meId;
      });
      memSel.innerHTML = people.map(function (p) {
        var nm = p.full_name || (p.email || 'Member').split('@')[0];
        return '<option value="' + esc(p.id) + '">' + esc(nm) + (p.email ? ' · ' + esc(p.email) : '') + '</option>';
      }).join('') || '<option value="">No members have signed up yet</option>';
      if (keep && people.some(function (p) { return p.id === keep; })) memSel.value = keep;
      paintBoxChoices();
      if (starterWired) return;
      starterWired = true;

      memSel.addEventListener('change', function () { paintBoxChoices(false); });
      var boxSel = $('#newmsgbox');
      if (boxSel) boxSel.addEventListener('change', function () { paintBoxChoices(true); });

      var opener = $('#newmsgopener');
      if (opener) opener.addEventListener('click', function () {
        var t = $('#newmsgtext');
        if (!t) return;
        var nm = (memSel.options[memSel.selectedIndex] || {}).text || 'there';
        t.value = 'Hello ' + String(nm).split('·')[0].trim().split(' ')[0] +
                  ', I am thinking of you. Nothing is required of you today — just know that this box is open ' +
                  'whenever you want to talk, and whatever you write here stays between us.';
        t.focus();
      });

      var send = $('#newmsgsend');
      if (send) send.addEventListener('click', function () {
        var who = memSel.value;
        var text = ($('#newmsgtext') && $('#newmsgtext').value || '').trim();
        var status = $('#newmsgstatus');
        if (!who) { toast('No member to write to yet — nobody has signed up.'); return; }
        if (!text) { toast('Type the message first.'); return; }
        var chosen = boxSel ? boxSel.value : 'main';
        var isNew = chosen === '__new__';
        var thread = isNew ? ('t' + Date.now().toString(36)) : chosen;
        var topic = null;
        if (isNew) {
          topic = (($('#newmsgboxtopic') && $('#newmsgboxtopic').value || '').trim()) || 'Private conversation';
        } else if (chosen !== 'main') {
          var known = boxesOf(who).filter(function (b) { return b.thread === chosen; })[0];
          topic = known ? known.label : null;
        }
        send.disabled = true;
        if (status) status.textContent = 'Sending…';
        DB.insert('messages', {
          room: 'private', member_id: who,
          sender_id: DB.user().id, sender_name: DB.name(), body: text,
          thread: thread, topic: topic
        }).then(function () {
          send.disabled = false;
          if (status) status.textContent = '';
          $('#newmsgtext').value = '';
          if ($('#newmsgboxtopic')) $('#newmsgboxtopic').value = '';
          toast('Sent — it is in that member\u2019s private box now.');
          load().then(function () { armReply(who, thread, topic); });
        }).catch(function (err) {
          send.disabled = false;
          if (status) status.textContent = '';
          toast('Could not send: ' + err.message, 7000);
        });
      });
    }

    /* put the reply box on a chosen conversation, so the doctor can keep typing */
    function armReply(memberId, thread, topic) {
      var who = byId[memberId] || {};
      var nm = who.full_name || 'Member';
      var label = topic || (thread === 'main' ? 'private room' : 'private conversation');
      setText('replyto', 'Reply to ' + nm + ' · ' + label);
      var box = $('#replybox');
      if (box) {
        box.dataset.member = memberId;
        box.dataset.memberName = nm;
        box.dataset.thread = thread || 'main';
        box.dataset.topic = label;
        box.focus();
      }
      var list = document.querySelector('#panel-messages .grid > div');
      if (list) list.querySelectorAll('.msg').forEach(function (x) {
        x.classList.toggle('sel', x.getAttribute('data-thread') === memberId &&
          (x.getAttribute('data-tkey') || '').split('|')[1] === (thread || 'main'));
      });
    }

    /* reply from the console into the member's private room */
    var sendBtn = document.getElementById('sendreply');
    if (sendBtn) {
      sendBtn.addEventListener('click', function (e) {
        var box = $('#replybox');
        if (!box || !box.dataset.member || (DB.user() && box.dataset.member === DB.user().id)) {
          e.stopImmediatePropagation(); toast('Choose a conversation on the left first.'); return;
        }
        e.stopImmediatePropagation();
        var text = box.value.trim();
        if (!text) { toast('Type a reply first.'); return; }
        sendBtn.disabled = true;
        DB.insert('messages', {
          room: 'private', member_id: box.dataset.member,
          sender_id: DB.user().id, sender_name: DB.name(), body: text,
          thread: box.dataset.thread || 'main',
          topic: box.dataset.topic && box.dataset.topic !== 'private room' ? box.dataset.topic : null
        }).then(function () {
          box.value = '';
          toast('Reply sent to ' + (box.dataset.memberName || 'the member') + ' \u00b7 ' +
                (box.dataset.topic || 'private room') + ' ✅');
          renderMessages();
        }).catch(function (err) { toast(err.message, 7000); })
          .then(function () { sendBtn.disabled = false; });
      }, true);
    }

    function renderAll() { renderPayments(); renderMembers(); renderAppointments(); renderToday(); renderMessages(); renderComposer(); renderCosts(); }

    /* ------------------------------------------------- running costs ---
       Small form so the income statement is complete without touching the
       database by hand. Costs are staff-only in the schema. */
    var costCard = document.getElementById('costcard');
    function renderCosts() {
      if (!costCard) return;
      costCard.style.display = '';
      var monthEl = document.getElementById('costmonth');
      if (monthEl && !monthEl.value) monthEl.value = todayISO().slice(0, 7);
      DB.select('expenses', { order: 'month.desc', limit: 100 }).then(function (rows) {
        rows = rows || [];
        var month = (monthEl && monthEl.value) || todayISO().slice(0, 7);
        var mine = rows.filter(function (r) { return String(r.month || '').slice(0, 7) === month; });
        var total = mine.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
        var host = document.getElementById('costlist');
        if (!host) return;
        host.innerHTML =
          '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">' +
            '<b style="font-size:.86rem">This month\u2019s costs</b>' +
            '<b style="color:#c3352f">' + naira(total) + '</b></div>' +
          (mine.length ? mine.map(function (r) {
            var d = new Date(r.month);
            return '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between;padding:7px 0;border-top:1px dashed #e6e2f2">' +
              '<span style="min-width:0"><b style="font-size:.85rem">' + esc(r.item) + '</b>' +
              (r.note ? '<br><small style="color:#6b6480">' + esc(r.note) + '</small>' : '') +
              '<br><small style="color:#6b6480">' + (isNaN(d) ? '' : d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })) + '</small></span>' +
              '<span style="white-space:nowrap"><b>' + naira(r.amount) + '</b> ' +
              '<button class="btn btn-ghost btn-sm" data-delcost="' + esc(r.id) + '" title="Remove this cost" style="margin-left:6px">✕</button></span></div>';
          }).join('') : '<p class="muted" style="margin:6px 0 0">Nothing logged for this month yet. Every cost you add shows up in the income statement.</p>');
      }).catch(function () {});
    }

    var costForm = document.getElementById('costform');
    if (costForm) {
      costForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = costForm.querySelector('button[type="submit"]');
        var month = document.getElementById('costmonth').value;
        var item = document.getElementById('costitem').value.trim();
        var amount = Number(document.getElementById('costamt').value || 0);
        if (!item || !amount || !month) return;
        if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
        DB.api.addExpense({
          month: month + '-01', item: item, amount: amount,
          note: document.getElementById('costnote').value.trim() || null
        }).then(function () {
          document.getElementById('costitem').value = '';
          document.getElementById('costamt').value = '';
          document.getElementById('costnote').value = '';
          toast('Cost saved ✅ ' + naira(amount) + ' for ' + item + ' — it is already in the income statement.', 6000);
          renderCosts();
        }).catch(function (err) { toast('Could not save: ' + err.message, 7000); })
          .then(function () { if (btn) { btn.disabled = false; btn.textContent = 'Save this cost'; } });
      });
    }

    /* delegated clicks for the live rows */
    document.addEventListener('click', function (e) {
      var c = e.target.closest && e.target.closest('.js-confirm');
      var d = e.target.closest && e.target.closest('.js-decline');
      var q = e.target.closest && e.target.closest('[data-quick]');
      if (c) { var tr = c.closest('tr[data-id]'); if (tr) { e.preventDefault(); confirmPayment(tr.getAttribute('data-id'), c); } return; }
      if (d) { var tr2 = d.closest('tr[data-id]'); if (tr2) { e.preventDefault(); declinePayment(tr2.getAttribute('data-id'), d); } return; }
      if (q) { e.preventDefault(); confirmPayment(q.getAttribute('data-quick'), q); return; }
      var del = e.target.closest && e.target.closest('[data-delcost]');
      if (del) {
        e.preventDefault();
        var id = del.getAttribute('data-delcost');
        del.disabled = true;
        DB.remove('expenses', { id: id })
          .then(function () { toast('Cost removed — the income statement is updated.'); renderCosts(); })
          .catch(function (err) { del.disabled = false; toast('Could not remove: ' + err.message, 7000); });
        return;
      }
      var st = e.target.closest && e.target.closest('.js-start');
      if (st && st.getAttribute('data-member')) {
        e.preventDefault();
        var memberId = st.getAttribute('data-member');
        var tab = document.querySelector('.tab[data-tab="messages"]');
        if (tab) tab.click();
        var el = document.querySelector('[data-thread="' + memberId + '"]');   /* their first box, if any */
        if (el) { el.click(); return; }
        /* She has never written — and an empty console used to mean the doctor
           could not reach her at all. Hand it to the composer instead. */
        var memSel = $('#newmsgmember');
        if (memSel) {
          memSel.value = memberId;
          paintBoxChoices();
          var nm = (st.getAttribute('data-name') || 'that member');
          setText('replyto', 'Write the first message to ' + nm);
          var hint = $('#replyhint');
          if (hint) hint.textContent = nm + ' has not written yet. Send the first message below — it opens a box she can answer in.';
          var t = $('#newmsgtext');
          if (t) { t.focus(); t.scrollIntoView({ block: 'center' }); }
        }
      }
    });

    load();

    /* ---- find an old conversation fast ---- */
    var searchTerm = '';
    var searchBox = document.getElementById('msgsearch');
    if (searchBox) {
      searchBox.addEventListener('input', function () {
        searchTerm = searchBox.value || '';
        renderMessages();
      });
    }

    /* ---- tell the doctor when a member writes while the tab is in the
       background. The browser asks once for permission; nothing leaves the
       device and there is no server to pay for. ---- */
    var alertBtn = document.getElementById('alerttoggle');
    var alertState = document.getElementById('alertstate');
    function alertsOn() {
      try { return localStorage.getItem('sylAlerts') === '1'; } catch (e) { return false; }
    }
    function paintAlertButton() {
      if (!alertBtn) return;
      var granted = ('Notification' in window) && Notification.permission === 'granted';
      if (granted && alertsOn()) {
        alertBtn.textContent = '🔔 Alerts are on';
        alertBtn.classList.add('btn-wa');
        if (alertState) alertState.textContent = 'You will be told here whenever a member writes, even on another tab.';
      } else {
        alertBtn.textContent = '🔔 Alert me when a member writes';
        if (alertState) alertState.textContent = granted ? 'Alerts are allowed — switch them on.' : '';
      }
    }
    if (alertBtn) {
      alertBtn.addEventListener('click', function () {
        if (!('Notification' in window)) {
          toast('This browser cannot show desktop alerts — keep the console open instead.', 6000);
          return;
        }
        if (Notification.permission === 'denied') {
          toast('Alerts are blocked for this site. Allow notifications in the browser settings, then try again.', 8000);
          return;
        }
        Notification.requestPermission().then(function (perm) {
          try { localStorage.setItem('sylAlerts', perm === 'granted' ? '1' : '0'); } catch (e) {}
          paintAlertButton();
          toast(perm === 'granted' ? 'Alerts on — you will be told when a member writes.' : 'Alerts left off.', 5000);
        });
      });
      paintAlertButton();
    }
    function desktopAlert(name, text) {
      if (!alertsOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
      try {
        var n = new Notification('New message from ' + (name || 'a member'), {
          body: String(text || '').slice(0, 140),
          tag: 'syl4luv-chat'
        });
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) {}
    }

    /* ---- keep the console current without a refresh ---- */
    var pendingReload = null, pendingWhy = null, reloadDirty = false, reloading = false;
    function scheduleReload(why) {
      if (why) pendingWhy = why;
      /* a burst of events makes one reload — but an event that lands while that
         reload is already on its way must still be picked up, so note it down
         instead of throwing the notification away */
      if (pendingReload || reloading) { reloadDirty = true; return; }
      pendingReload = setTimeout(function () {
        pendingReload = null;
        reloading = true;
        var say = pendingWhy;
        pendingWhy = null;
        load().then(function () {
          reloading = false;
          if (say) toast(say, 3500);
          if (reloadDirty) { reloadDirty = false; scheduleReload(null); }
        });
      }, 400);
    }
    var rt = DB.live({
      channel: 'console',
      tables: ['messages', 'payments', 'bookings', 'forum_posts'],
      onStatus: paintLive,
      onEvent: function (table, d) {
        var rec = d.record || {};
        if (table === 'messages') {
          var mine = DB.user() && rec.sender_id === DB.user().id;
          if (!mine) desktopAlert(rec.sender_name, rec.body);
          scheduleReload(mine ? null : 'New message from ' + (rec.sender_name || 'a member') + ' 💬');
        }
        else if (table === 'payments') scheduleReload(rec.status === 'pending' ? 'A member says they have paid — check the queue.' : null);
        else if (table === 'bookings') scheduleReload('New booking: ' + (rec.full_name || 'a member') + ' 🗓');
        else scheduleReload(null);
      }
    });
    /* safety net if the instant connection is not available */
    setInterval(function () {
      if (document.hidden || DB.liveStatus() === 'live') return;
      load();
    }, 30000);
    /* and pull fresh data whenever the doctor comes back to the tab */
    document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  }

  /* ======================================================================== */
  /*  INCOME STATEMENT                                                       */
  /* ======================================================================== */
  function initIncome() {
    liveBadge();
    var host = window.SYL_INCOME;
    if (!host) { toast('Live statement hook missing — reload the page.', 7000); return; }
    /* the page shows the sample figures first — say so plainly until the real ones arrive */
    var note0 = document.querySelector('.statement .note');
    if (note0) note0.innerHTML = '<strong>Loading…</strong> fetching your confirmed payments and costs from the database. ' +
      'The figures on screen are still the <em>sample</em> numbers until they arrive.';
    var incomeTimer = null, firstPass = true;

    function rebuild(say) {
      /* stay on the month (or year) the doctor is reading while it refreshes */
      var active = document.querySelector('#chips [aria-pressed="true"]');
      var keepMonth = active && active.getAttribute('data-month');
      var keepYear = active && active.getAttribute('data-year');
      return Promise.all([DB.api.allPayments(), DB.api.allProfiles(), DB.api.allBookings(), DB.select('expenses', { order: 'month.desc' })])
      .then(function (r) {
        var payments = r[0] || [], profiles = r[1] || [], bookings = r[2] || [], expenses = r[3] || [];
        var name = {};
        profiles.forEach(function (p) { name[p.id] = p.full_name || (p.email || '').split('@')[0]; });
        var bkById = {};
        bookings.forEach(function (b) { bkById[b.id] = b; });

        var DATA = {};
        payments.forEach(function (p) {
          var day = String(p.paid_on || p.created_at || '').slice(0, 10);
          if (!day) return;
          var key = day.slice(0, 7);
          if (!DATA[key]) DATA[key] = { label: '', tx: [], expenses: [] };
          var bk = bkById[p.booking_id] || {};
          DATA[key].tx.push({
            date: yen(day), day: Number(day.slice(8, 10)),
            member: name[p.member_id] || bk.full_name || 'Member',
            id: bk.reference || (p.member_id ? String(p.member_id).slice(0, 8).toUpperCase() : '—'),
            service: bk.service || 'Consultation fee',
            amount: Number(p.amount || 0),
            method: methodLabel(p.method),
            ref: p.reference || '—',
            status: p.status === 'confirmed' ? 'confirmed' : 'pending'
          });
        });
        expenses.forEach(function (x) {
          var key = String(x.month || '').slice(0, 7);
          if (!key) return;
          if (!DATA[key]) DATA[key] = { label: '', tx: [], expenses: [] };
          DATA[key].expenses.push({ item: x.item, amount: Number(x.amount || 0) });
        });
        Object.keys(DATA).forEach(function (k) {
          var d = new Date(k + '-01T00:00:00');
          DATA[k].label = d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
          DATA[k].tx.sort(function (a, b) { return a.day - b.day; });
        });

        if (!Object.keys(DATA).length) {
          toast('No payments yet in the database — the statement will fill up as members pay. Showing the demo figures for now.', 8000);
          return;
        }
        host.load(DATA);
        if (keepMonth && document.querySelector('#chips [data-month="' + keepMonth + '"]')) {
          document.querySelector('#chips [data-month="' + keepMonth + '"]').click();
        } else if (!keepMonth && keepYear && document.querySelector('#chips [data-year="' + keepYear + '"]')) {
          document.querySelector('#chips [data-year="' + keepYear + '"]').click();
        }
        var note = document.querySelector('.statement .note');
        if (note) note.innerHTML = '<strong>Live data:</strong> these figures come from your database — ' +
          'confirmed payments as income, pending claims shown separately, and costs from the expenses table. ' +
          'Log a cost on the console (<em>Payments tab → Running costs</em>) and it appears here by itself.';
        if (say === 'first') {
          toast('Statement rebuilt from ' + payments.length + ' payment(s) and ' + expenses.length + ' cost row(s).', 6000);
        } else if (say && say !== 'quiet') {
          toast(say, 4500);
        }
      })
      .catch(function (e) { toast('Could not load the database: ' + e.message, 8000); });
    }

    rebuild('first').then(function () {
      firstPass = false;
      /* a report should still be current: payments and costs change while it is open */
      DB.live({
        channel: 'income',
        tables: ['payments', 'expenses', 'bookings'],
        onStatus: paintLive,
        onEvent: function (table, d) {
          var rec = d.record || {};
          clearTimeout(incomeTimer);
          incomeTimer = setTimeout(function () {
            rebuild(table === 'payments'
              ? 'Statement updated — a payment changed.'
              : (table === 'expenses' ? 'Statement updated — a cost changed.' : 'quiet'));
          }, 700);
        }
      });
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && !firstPass) rebuild('quiet');
      });
    });
  }

  /* ======================================================================== */
  DB.init().then(function () {
    var u = DB.user();
    if (!u) { gate('login'); return; }
    if (!DB.isStaff()) { gate('denied'); return; }
    if (IS_ADMIN) initAdmin();
    if (IS_INCOME) initIncome();
  });
})(window, document);
