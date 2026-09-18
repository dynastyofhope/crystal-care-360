/* ============================================================================
   syl4luv-ui.js — connects the Syl4luv pages to the database layer
   ----------------------------------------------------------------------------
   Load it after supabase-config.js and syl4luv-db.js:

       <script src="supabase/supabase-config.js"></script>
       <script src="supabase/syl4luv-db.js"></script>
       <script src="supabase/syl4luv-ui.js"></script>

   IT CHANGES NOTHING UNTIL YOU ADD YOUR KEYS. With supabase-config.js left
   empty, every page keeps behaving exactly as it does today (the demo). The
   moment your Project URL and anon key are in place, this file takes over:
   real accounts, real bookings, real private room, real forum.

   It decides what to do by looking at the page: a page with #loginform is the
   chat app, a page with #booktable is the members dashboard.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var DB = window.SYL4LUV_DB;
  if (!DB) return;                       /* library not loaded — stay in demo mode */

  /* ------------------------------------------------------------------ utils */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function toast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) { return; }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(function () { t.classList.remove('show'); }, ms || 3600);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  function naira(n) { return '₦' + Number(n || 0).toLocaleString('en-NG'); }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2)
      .map(function (w) { return w.charAt(0).toUpperCase(); }).join('') || '?';
  }

  function avatarColour(name) {
    /* A page can set --syl-avatar (two comma-separated colours) to bring avatars
       into its own palette — the red-and-white chat app does. Pages that do not
       set it keep the friendly multi-colour set. */
    var themed = '';
    try { themed = getComputedStyle(document.documentElement).getPropertyValue('--syl-avatar').trim(); } catch (e) {}
    if (themed) return themed;
    var palette = ['#ff6b6b,#ff8fc7', '#8e7cff,#cfc4ff', '#37c8bb,#63d8ff', '#ffd93d,#ffb03a', '#63d8ff,#8ee6ff'];
    var i = 0, s = String(name || '');
    for (var k = 0; k < s.length; k++) i += s.charCodeAt(k);
    return palette[i % palette.length];
  }

  function niceDate(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  function niceDateTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return niceDate(iso);
    return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' }) +
           ', ' + d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  }
  function niceTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-NG', { hour: 'numeric', minute: '2-digit' });
  }

  function statusPill(status) {
    var map = { confirmed: ['s-ok', 'Confirmed'], pending: ['s-warn', 'Awaiting confirmation'],
                declined: ['s-warn', 'Declined'], registered: ['s-done', 'Registered'],
                scheduled: ['s-done', 'Scheduled'], completed: ['s-ok', 'Completed'],
                cancelled: ['s-warn', 'Cancelled'] };
    var m = map[status] || ['s-done', status || '—'];
    return '<span class="pilltag ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  function closeModals() { $$('.modal.open').forEach(function (o) { o.classList.remove('open'); }); }

  function scrollTo(el, ms) {
    setTimeout(function () { if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, ms || 400);
  }

  /* ======================================================================== */
  /*  CHAT APP  (the public page)                                             */
  /* ======================================================================== */
  function initChatApp() {
    var roomTimer = null;

    /* ---- header: show who is signed in ---- */
    function paintHeader() {
      var u = DB.user();
      var bar = $('.auth-btns') || $('.hdr-actions');
      var mobile = $('#mobnav');
      var BTNS = '[data-open="login"], [data-open="signup"]';
      if (!u) {
        var old = $('#sylwho'); if (old) old.remove();
        var oldm = $('#sylwho-m'); if (oldm) oldm.remove();
        $$(bar ? '.auth-btns ' + BTNS + ', .hdr-actions ' + BTNS : '.auth-btns ' + BTNS).forEach(function (b) { b.style.display = ''; });
        $$(BTNS).forEach(function (b) { if (b.classList && (b.classList.contains('btn') || b.classList.contains('go'))) b.style.display = ''; });
        return;
      }
      $$('.auth-btns ' + BTNS + ', .hdr-actions ' + BTNS).forEach(function (b) { b.style.display = 'none'; });
      if (bar && !$('#sylwho')) {
        var chip = document.createElement('span');
        chip.id = 'sylwho';
        chip.className = 'member-chip';
        chip.style.cssText = 'display:flex;align-items:center;gap:9px;background:#fff;border:1.6px solid var(--line,rgba(140,124,255,.3));border-radius:999px;padding:5px 12px 5px 5px';
        chip.innerHTML = '<span class="av-sm" style="width:30px;height:30px;background:linear-gradient(135deg,' + avatarColour(DB.name()) + ')">' + esc(initials(DB.name())) + '</span>' +
          '<span style="min-width:0"><b style="display:block;font-size:.83rem;line-height:1.1">' + esc(DB.name()) + '</b>' +
          '<small style="color:var(--ink-soft,#6b6480);font-size:.7rem">' + esc(DB.isStaff() ? 'Therapist console' : 'Member') + '</small></span>';
        bar.insertBefore(chip, bar.firstChild);
        var dash = document.createElement('a');
        dash.className = 'btn btn-ghost'; dash.href = 'syl4luv-members-dashboard.html'; dash.textContent = 'Dashboard';
        var out = document.createElement('button');
        out.className = 'btn btn-ghost'; out.type = 'button'; out.textContent = 'Log out';
        out.addEventListener('click', function () {
          DB.signOut().then(function () { toast('Signed out. Take care of yourself 💜'); paintHeader(); paintRoom(); });
        });
        bar.insertBefore(dash, chip.nextSibling);
        bar.insertBefore(out, dash.nextSibling);
      }
      if (mobile && !$('#sylwho-m')) {
        var row = document.createElement('div');
        row.id = 'sylwho-m';
        row.innerHTML = '<a href="syl4luv-members-dashboard.html">My dashboard — ' + esc(DB.name()) + '</a>' +
                        '<a href="#" id="sylout-m">Log out</a>';
        mobile.appendChild(row);
        $('#sylout-m').addEventListener('click', function (e) {
          e.preventDefault();
          DB.signOut().then(function () { toast('Signed out. Take care of yourself 💜'); paintHeader(); paintRoom(); });
        });
      }
    }

    /* ---- private conversations: one box per member, one box per topic ----
       The member's sidebar is a real inbox: every message carries a `thread`
       key and a `topic`, so a member can keep several separate boxes with
       Dr. Syl4luv (a question now, a session follow-up later). Nothing is
       written into the page — it is all read from the messages table, and the
       database rules make sure a member only ever receives their own rows. */
    var roomSeen = {}, roomLast = null, roomUser = null, rtUser = null, rt = null, pollTimer = null;
    var HOME = 'main';
    var HOME_TOPIC = 'Private room with Dr. Syl4luv';
    var openThread = HOME, openTopic = HOME_TOPIC;
    var inbox = [];            /* [{key, topic, last, unread, msgs, extra}] */
    var seenMap = {}, extraThreads = [];

    function uidKey() { return ((DB.user() || {}).id || 'anon'); }
    function seenKey() { return 'sylSeen:' + uidKey(); }
    function extraKey() { return 'sylThreads:' + uidKey(); }
    function loadLocal() {
      try { seenMap = JSON.parse(localStorage.getItem(seenKey()) || '{}') || {}; } catch (e) { seenMap = {}; }
      try { extraThreads = JSON.parse(localStorage.getItem(extraKey()) || '[]') || []; } catch (e) { extraThreads = []; }
    }
    function saveSeen() { try { localStorage.setItem(seenKey(), JSON.stringify(seenMap)); } catch (e) {} }
    function saveExtras() { try { localStorage.setItem(extraKey(), JSON.stringify(extraThreads)); } catch (e) {} }
    function threadKeyOf(m) { return (m && m.thread) || HOME; }
    function topicOf(m) {
      if (m && m.topic) return m.topic;
      return threadKeyOf(m) === HOME ? HOME_TOPIC : 'Private conversation';
    }
    function newerThan(a, b) { return String(a.created_at || '') > String(b.created_at || ''); }

    /* what the sidebar shows, newest first, the home room always on top */
    function buildInbox(rows) {
      var me = (DB.user() || {}).id;
      var byKey = {};
      (rows || []).forEach(function (m) {
        var k = threadKeyOf(m);
        if (!byKey[k]) byKey[k] = { key: k, topic: topicOf(m), msgs: [], last: null, unread: false, extra: false };
        byKey[k].msgs.push(m);
        byKey[k].topic = topicOf(m) || byKey[k].topic;
        if (!byKey[k].last || newerThan(m, byKey[k].last)) byKey[k].last = m;
      });
      extraThreads.forEach(function (t) {
        if (!byKey[t.key]) byKey[t.key] = { key: t.key, topic: t.topic, msgs: [], last: null, unread: false, extra: true };
      });
      if (!byKey[HOME]) byKey[HOME] = { key: HOME, topic: HOME_TOPIC, msgs: [], last: null, unread: false, extra: false };
      var list = Object.keys(byKey).map(function (k) { return byKey[k]; });
      list.forEach(function (t) {
        t.msgs.sort(function (a, b) { return String(a.created_at || '').localeCompare(String(b.created_at || '')); });
        var last = t.last;
        var fromThem = last && last.sender_id !== me;
        var seenAt = seenMap[t.key] || '';
        t.unread = !!(fromThem && String(last.created_at || '') > seenAt);
      });
      list.sort(function (a, b) {
        if (a.key === HOME) return -1;
        if (b.key === HOME) return 1;
        var at = a.last ? a.last.created_at : '', bt = b.last ? b.last.created_at : '';
        return String(bt).localeCompare(String(at));
      });
      inbox = list;
      return list;
    }

    function paintConvList() {
      var host = $('#convlist');
      if (!host) return;
      if (!DB.user()) {
        host.innerHTML = '<p class="convnote">Log in to see your private boxes.</p>';
        return;
      }
      var box = $('#convsearch');
      var term = (box && box.value || '').trim().toLowerCase();
      var rows = inbox.filter(function (t) {
        if (!term) return true;
        var last = t.last ? String(t.last.body || '') : '';
        return (t.topic + ' ' + last).toLowerCase().indexOf(term) !== -1;
      });
      if (!rows.length) {
        host.innerHTML = '<p class="convnote">' + (term
          ? 'Nothing matches “' + esc(term) + '”. Clear the search to see every box.'
          : 'No boxes yet — write below and one is made for you.') + '</p>';
        return;
      }
      host.innerHTML = rows.map(function (t) {
        var mine = t.last && t.last.sender_id === (DB.user() || {}).id;
        var snip = t.last
          ? (mine ? 'You: ' : '') + String(t.last.body || '').slice(0, 60)
          : 'Say what is on your mind — Dr. Syl4luv answers in this box only.';
        var when = t.last ? niceTime(t.last.created_at) : 'new';
        return '<div class="convitem' + (t.key === openThread ? ' on' : '') + '" data-conv="' + esc(t.key) + '"' +
            ' role="button" tabindex="0" aria-label="' + esc(t.topic) + '">' +
          '<div class="av-sm" style="background:linear-gradient(135deg,' + avatarColour('Dr. Syl4luv') + ')">DS</div>' +
          '<div style="min-width:0;flex:1"><b>' + esc(t.topic) + '</b><small>' + esc(snip) + '</small>' +
          '<time>' + esc(when) + '</time></div>' +
          (t.unread ? '<span class="convdot" aria-label="New message"></span>' : '') + '</div>';
      }).join('');
      $$('.convitem', host).forEach(function (el) {
        var key = el.getAttribute('data-conv');
        var go = function () { openBox(key); };
        el.addEventListener('click', go);
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      });
    }

    function bubble(kind, text, when) {
      var d = document.createElement('div');
      d.className = 'bub ' + kind;
      d.appendChild(document.createTextNode(text));
      if (when) {
        var t = document.createElement('time');
        t.textContent = when;
        d.appendChild(t);
      }
      return d;
    }

    /* If Dr. Syl4luv (or an assistant) is signed in on the member page he sees
       his own empty room and may think the chat is broken. Tell him the truth:
       members are answered from the console, and give him the link. */
    function paintStaffHint() {
      var host = $('#staffhint');
      if (!host) {
        var room = document.querySelector('#panel-private .chatroom-head');
        if (!room) return;
        host = document.createElement('div');
        host.id = 'staffhint';
        host.className = 'staffhint';
        host.style.cssText = 'display:none;margin:0 0 12px;padding:11px 13px;border-radius:14px;' +
          'background:#eef7ff;border:1.5px solid #bcd9f5;color:#14406b;font-size:.87rem;line-height:1.5';
        room.parentNode.insertBefore(host, room);
      }
      if (!(DB.isStaff && DB.isStaff())) { host.style.display = 'none'; return; }
      host.style.display = 'block';
      host.innerHTML = '<b>You are signed in as staff.</b> This page is the members\u2019 side — your own ' +
        'box here is empty by design. Members\u2019 private boxes are answered from the therapist console: ' +
        '<a href="syl4luv-admin-dashboard.html" style="color:inherit;font-weight:800">open the console \u2192</a> ' +
        '(Messages tab), where every member is listed separately.';
    }

    function paintPromise() {
      var host = $('#replypromise');
      if (!host) return;
      var h = new Date().getHours();
      var night = h >= 21 || h < 8;
      host.className = 'replypromise' + (night ? ' away' : '');
      host.innerHTML = night
        ? '<b>🌙 It is late now.</b> Dr. Syl4luv reads this private room in the morning and will reply then — only you and Dr. Syl4luv can read it, and your message is already safely stored. ' +
          'If tonight feels unsafe or urgent, call <a href="tel:07033828292" style="color:inherit;font-weight:800">0703 382 8292</a>.'
        : '<b>💬 Dr. Syl4luv replies in person.</b> Messages written here are private — only you and Dr. Syl4luv can read them. ' +
          'You will usually hear back within a few hours. If it cannot wait, call <a href="tel:07033828292" style="color:inherit;font-weight:800">0703 382 8292</a>.';
    }

    /* The little status chip beside the room title. It is made here, once, so
       the page itself stays free of anything that pretends to be live. */
    function ensureChip() {
      var chip = $('#rtChip');
      if (chip) return chip;
      var head = document.querySelector('#panel-private .chatroom-head') ||
                 document.querySelector('#panel-private .msgs');
      if (!head) return null;
      chip = document.createElement('span');
      chip.id = 'rtChip';
      chip.className = 'badge';
      chip.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-weight:800';
      head.appendChild(chip);
      return chip;
    }

    function paintConnection(status) {
      if (!DB.user()) status = 'idle';          /* nothing is being listened to yet */
      else if (status === 'live-check' || status == null) {
        status = (DB.liveStatus && DB.liveStatus()) || '';
        if (!status) {
          var seen = $('#rtChip');
          if (seen && seen.textContent) return; /* keep what the socket last said */
          status = 'idle';
        }
      }
      var chip = ensureChip();
      if (!chip) return;
      var live = status === 'live';
      chip.textContent = live ? '● Live' : (status === 'connecting' ? '◌ Connecting…' : '◌ Checking for new messages');
      chip.title = live
        ? 'Connected — new messages arrive by themselves'
        : 'Not connected right now: this page checks for new messages every few seconds instead';
      chip.style.color = live ? '#0f7b3f' : '';
    }

    function paintMode() {
      var note = $('#sylmodenote');
      if (!note) return;
      if (DB.isLive()) { note.hidden = true; note.innerHTML = ''; return; }
      note.hidden = false;
      note.innerHTML = '<b>This is the demo.</b> The boxes below are samples held in the page, so nothing is collected yet. ' +
        'To collect real chats, connect a database — <b>CHAT-SETUP.md</b> shows two ways (a folder on your own computer in 2 minutes, ' +
        'or a free Supabase project). A member\'s own boxes are private either way: the database rules stop one member reading another\'s rows.';
    }

    /* only the open box goes on screen */
    function applyRoom(rows) {
      var msgs = $('#msgs');
      var u = DB.user();
      if (!msgs || !u) return;
      var nearBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 140;
      var added = 0, firstName = DB.name().split(' ')[0];
      rows.forEach(function (m) {
        if (!m || roomSeen[m.id]) return;
        roomSeen[m.id] = 1; added++;
        var mine = m.sender_id === u.id;
        msgs.appendChild(bubble(mine ? 'me' : 'them', m.body, niceTime(m.created_at)));
        if (!mine && m.sender_name && m.sender_name !== firstName && /Dr\.|Syl4luv/i.test(m.sender_name)) {
          var tag = document.createElement('div');
          tag.style.cssText = 'font-size:.68rem;color:var(--ink-soft,#6b6480);margin:-6px 0 8px 12px';
          tag.textContent = 'Dr. Syl4luv · ' + niceTime(m.created_at);
          msgs.appendChild(tag);
        }
        if (m.created_at && (!roomLast || m.created_at > roomLast)) roomLast = m.created_at;
      });
      if (added && (nearBottom || added === rows.length && msgs.children.length <= 2)) msgs.scrollTop = msgs.scrollHeight;
    }

    /* the open box's title, above the messages */
    function paintThreadHead() {
      var el = $('#threadtopic');
      if (el) el.textContent = openThread === HOME ? HOME_TOPIC : openTopic;
    }

    /* one fetch drives both the sidebar and the open box */
    function loadInbox(paint) {
      if (!DB.user()) { inbox = []; paintConvList(); return Promise.resolve([]); }
      return DB.api.roomMessages({ room: 'private', limit: 200 }).then(function (rows) {
        var list = buildInbox(rows || []);
        paintConvList();
        if (paint !== false) {
          /* the open box: draw everything not on screen yet */
          var mine = (list.filter(function (t) { return t.key === openThread; })[0] || { msgs: [] }).msgs;
          if (!mine.length && openThread === HOME) {
            var msgs = $('#msgs');
            if (msgs && !msgs.querySelector('.bub')) {
              msgs.appendChild(bubble('them', 'Welcome to your private room, ' + DB.name().split(' ')[0] +
                '. 🙏 Whatever you write here stays between us.'));
            }
          }
          applyRoom(mine);
          var newest = mine.length ? mine[mine.length - 1] : null;
          if (newest) { seenMap[openThread] = newest.created_at; saveSeen(); }
        }
        return list;
      }).catch(function () { return []; });
    }

    function paintRoom() {
      var msgs = $('#msgs');
      if (!msgs) return Promise.resolve();
      var u = DB.user();
      roomSeen = {}; roomLast = null;
      loadLocal();
      paintMode();
      paintPromise();
      paintStaffHint();
      if (!u) {
        msgs.innerHTML = '<div class="day">Private room</div>' +
          '<div class="bub them">Welcome 💜 To keep this box truly private, messages are tied to your account. ' +
          'Please log in or create a free account — then everything you write here stays between you and Dr. Syl4luv.</div>';
        inbox = []; paintConvList(); paintThreadHead();
        paintConnection(DB.liveStatus && DB.liveStatus());
        return Promise.resolve();
      }
      if (roomUser !== u.id) { openThread = HOME; openTopic = HOME_TOPIC; roomUser = u.id; }
      paintThreadHead();
      paintConnection('live-check');   /* signed in: show what the socket says */
      msgs.innerHTML = '<div class="day">' + niceDate() + '</div>';
      return loadInbox(true);
    }

    /* switching boxes: same fetch, a fresh screen */
    function openBox(key) {
      var t = inbox.filter(function (x) { return x.key === key; })[0];
      openThread = key;
      openTopic = (t && t.topic) || 'Private conversation';
      if (t && t.last) { seenMap[key] = t.last.created_at; saveSeen(); }
      if (t) t.unread = false;
      var msgs = $('#msgs');
      if (msgs) msgs.innerHTML = '<div class="day">' + niceDate() + '</div>';
      roomSeen = {}; roomLast = null;
      paintThreadHead();
      paintConvList();
      var panel = $('#panel-private');
      if (window.innerWidth < 900 && panel) scrollTo($('#msgs'), 120);
      return loadInbox(true);
    }

    /* a new, empty box — it is kept on this device until the first message
       lands in the database, then the database owns it like any other */
    function startBox(topic) {
      var key = 't' + Date.now().toString(36);
      var name = (topic || '').trim() || 'New private conversation';
      extraThreads.push({ key: key, topic: name });
      saveExtras();
      buildInbox([]);
      openBox(key);
      var input = $('#newtopic'); if (input) input.value = '';
      var msg = $('#msginput'); if (msg) msg.focus();
      toast('New private box “' + name + '” — say what is on your mind.');
    }

    /* ---- sending ---- */
    function sendFromComposer() {
      var input = $('#msginput');
      if (!input) return;
      var text = (input.value || '').trim();
      if (!text) return;
      if (!DB.user()) {
        toast('Please log in or create a free account first.');
        var btn = document.querySelector('#chat [data-open="login"]');
        if (btn) btn.click();
        return;
      }
      input.value = '';
      DB.api.sendMessage(text, 'private', { thread: openThread, topic: openTopic })
        .then(function () { return loadInbox(true); })
        .then(function () {
          var panel = document.querySelector('.tab[data-tab="private"]');
          if (panel) panel.classList.add('active');
        })
        .catch(function (err) { input.value = text; toast(err.message || 'Could not send that — try again.', 6000); });
    }

    function startRealtime() {
      var uid = (DB.user() || {}).id || 'anon';
      if (rt && uid === rtUser) return;
      if (rt) { try { rt.stop(); } catch (e) {} rt = null; }
      rtUser = uid;
      rt = DB.live({
        channel: 'member-' + uid.slice(0, 8),
        tables: ['messages'],
        onStatus: paintConnection,
        onEvent: function (table, d) {
          var rec = d.record || {};
          if (table !== 'messages' || !rec.id) return;
          if (rec.room !== 'private') { paintForum(); return; }
          if (rec.member_id !== (DB.user() || {}).id) return;   /* not my box */
          if (roomSeen[rec.id]) return;
          loadInbox(true);
        }
      });
      clearInterval(pollTimer);
      pollTimer = setInterval(function () {
        if (!DB.user() || document.hidden) return;
        loadInbox(true);
      }, DB.liveStatus() === 'live' ? 60000 : 12000);
    }

    function wireInbox() {
      var search = $('#convsearch');
      if (search) {
        search.addEventListener('input', paintConvList);
        search.addEventListener('keydown', function (e) { if (e.key === 'Escape') { search.value = ''; paintConvList(); } });
      }
      var newBtn = $('#newconv');
      var topicBox = $('#newtopic');
      if (newBtn) newBtn.addEventListener('click', function () {
        if (!DB.user()) { toast('Log in first — then you can open as many private boxes as you like.'); return; }
        startBox(topicBox ? topicBox.value : '');
      });
      if (topicBox) topicBox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (newBtn) newBtn.click(); }
      });
    }

    /* the composer is the site's own form — take it over so a message goes
       into the open box (and is stored), instead of the demo array */
    function wireComposer() {
      var form = $('#composer');
      if (!form || form.dataset.sylWired === '1') return;
      form.dataset.sylWired = '1';
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        sendFromComposer();
      }, true);
    }

        /* ---- forum ---- */
    function paintForum() {
      var panel = $('#panel-forum');
      if (!panel) return;
      var host = $('#forumLive', panel);
      if (!host) {
        host = document.createElement('div');
        host.id = 'forumLive';
        var box = $('.forum', panel);
        box.insertBefore(host, box.firstChild);
      }
      DB.api.forumTopics().then(function (rows) {
        if (!rows || !rows.length) { host.innerHTML = ''; return; }
        $$('.post', panel).forEach(function (p) { p.style.display = 'none'; });
        host.innerHTML = rows.map(function (t) {
          return '<div class="post"><div class="av-sm" style="width:44px;height:44px;background:linear-gradient(135deg,' + avatarColour(t.author_name) + ')">' + esc(initials(t.author_name)) + '</div>' +
            '<div><h4>' + esc(t.title || 'Discussion') + '</h4><p>' + esc(t.body) + '</p>' +
            '<div class="postmeta">' + (t.pinned ? '<span class="badge-pill live">Pinned</span>' : '<span class="badge-pill">Forum</span>') +
            '<span>' + esc(t.author_name) + '</span><span>· ' + niceDate(t.created_at) + '</span></div></div></div>';
        }).join('') + composeBox();
        wireCompose();
      }).catch(function () {});
    }

    function composeBox() {
      if (!DB.user()) {
        return '<div class="note" style="margin-top:8px">Log in to post a topic or reply in the forum — it keeps the discussion accountable and confidential.</div>';
      }
      return '<form id="forumCompose" style="margin-top:14px;background:#fff;border:1.6px solid rgba(140,124,255,.25);border-radius:14px;padding:14px">' +
        '<label for="ftopic" style="font-size:.82rem;font-weight:750">Start a topic or ask a question</label>' +
        '<input id="ftopic" placeholder="Topic (e.g. How do we argue better?)" style="width:100%;padding:11px 14px;border:1.6px solid var(--line,#e6e2f2);border-radius:12px;font:inherit;margin:6px 0 10px">' +
        '<textarea id="fbody" rows="2" required placeholder="Write your message…" style="width:100%;padding:11px 14px;border:1.6px solid var(--line,#e6e2f2);border-radius:12px;font:inherit"></textarea>' +
        '<button class="btn btn-teal btn-sm" type="submit" style="margin-top:10px">Post to the forum</button></form>';
    }

    function wireCompose() {
      var f = $('#forumCompose');
      if (!f) return;
      f.addEventListener('submit', function (e) {
        e.preventDefault();
        var body = $('#fbody').value.trim();
        if (!body) return;
        DB.api.addForumPost({ title: $('#ftopic').value.trim() || null, body: body })
          .then(function () { toast('Posted to the forum ✅'); paintForum(); })
          .catch(function (err) { toast(err.message); });
      });
    }

    /* ---- announcements ---- */
    function paintAnnouncements() {
      var panel = $('#panel-info');
      if (!panel) return;
      var host = $('#annLive', panel);
      if (!host) {
        host = document.createElement('div');
        host.id = 'annLive';
        var box = $('.forum', panel);
        box.insertBefore(host, box.firstChild);
      }
      DB.api.announcements().then(function (rows) {
        if (!rows || !rows.length) { host.innerHTML = ''; return; }
        $$('.post', panel).forEach(function (p) { p.style.display = 'none'; });
        host.innerHTML = rows.map(function (a) {
          return '<div class="post"><div class="av-sm" style="width:44px;height:44px;background:linear-gradient(135deg,' + avatarColour('Syl4luv') + ')">SY</div>' +
            '<div><h4>' + esc(a.title) + '</h4><p>' + esc(a.body) + '</p>' +
            '<div class="postmeta"><span class="badge-pill live">From the centre</span>' +
            '<span>' + niceDate(a.published_at) + '</span></div></div></div>';
        }).join('');
      }).catch(function () {});
    }

    /* ---- actions the page's own handlers call ---- */
    var actions = {
      login: function (email, password) {
        return DB.signIn({ email: email, password: password }).then(function () {
          toast('Welcome back, ' + DB.name().split(' ')[0] + '! 💜');
          paintHeader(); paintRoom(); paintForum();
        });
      },
      signup: function (data) {
        return DB.signUp(data).then(function (res) {
          if (!res.confirmed) {
            toast('Account created ✅ Check your email for the confirmation link, then log in. If you do not see it, check spam.', 7000);
          } else {
            toast('Account created 🎉 Welcome to the Dr. Syl4luv family, ' + DB.name().split(' ')[0] + '!');
            paintHeader(); paintRoom(); paintForum();
          }
        });
      },
      booking: function (data) {
        return DB.api.createBooking(data).then(function (row) {
          toast('Registration received ✅ Reference ' + row.reference + ' — transfer ₦5,000 to Access Bank 0032601495 (Adidi Sylvanus Osigbemeh).', 7000);
          scrollTo($('#consult'), 200);
        });
      },
      send: function (text) {
        return DB.api.sendMessage(text, 'private', { thread: openThread, topic: openTopic });
      },
      sendNow: function () { return sendFromComposer(); },
      refresh: function () { paintHeader(); paintRoom(); paintForum(); paintAnnouncements(); },
      /* Called by the page once the database has accepted a message. The
         instant copy sometimes arrives on the socket BEFORE this answer does,
         so if it already drew the message we remove the page's own copy
         instead of leaving the member staring at two identical bubbles. */
      sent: function (row, el) {
        if (!row) return;
        if (row.id && roomSeen[row.id]) {
          if (el && el.parentNode) el.parentNode.removeChild(el);
          return;
        }
        if (row.id) { roomSeen[row.id] = 1; if (el) el.setAttribute('data-mid', row.id); }
        if (row.created_at) roomLast = row.created_at;
      }
    };

    /* the page's own handlers call these */
    window.SYL4LUV_UI = {
      login:   function (email, pw) { return actions.login(email, pw); },
      signup:  function (data)     { return actions.signup(data); },
      booking: function (data)     { return actions.booking(data); },
      send:    function (text)     { return actions.send(text); },
      sendNow: function ()         { return actions.sendNow(); },
      sent:    function (row, el)  { return actions.sent(row, el); },
      refresh: function ()         { return actions.refresh(); },
      signedIn: function ()        { return !!DB.user(); }
    };

    /* ---- keep the room fresh: instant when possible, gentle polling otherwise ---- */
    function startRoomPolling() {
      if (roomTimer) clearInterval(roomTimer);
      startRealtime();
    }

    DB.onChange(function () {
      paintHeader();
      if ((DB.user() || {}).id !== roomUser) {
        roomUser = (DB.user() || {}).id;
        openThread = HOME; openTopic = HOME_TOPIC;
        inbox = []; seenMap = {}; extraThreads = [];
        paintRoom();
        if (DB.isLive && DB.isLive()) startRealtime();   /* sign in / out: re-join or drop the socket */
      }
    });
    var boot = function () {
      var u = DB.user();
      roomUser = (u || {}).id;
      if (u) toast('Signed in as ' + DB.name() + ' 💜');
      wireInbox(); wireComposer();
      paintHeader(); paintRoom(); paintForum(); paintAnnouncements(); paintConfetti(u);
      startRoomPolling();
    };
    if (DB.user()) boot(); else DB.init().then(boot);
  }

  /* A small welcome touch: a member who is signed in gets their name in the
     hero instead of "Log in now". */
  function paintConfetti(user) {
    if (!user) return;
    $$('.go[data-open="login"]').forEach(function (b) { b.style.display = 'none'; });
    $$('.go[data-open="signup"]').forEach(function (b) { b.style.display = 'none'; });
  }

  /* ======================================================================== */
  /*  MEMBERS DASHBOARD                                                      */
  /* ======================================================================== */
  function initDashboard() {
    function renderBookings(rows) {
      var tb = $('#booktable tbody');
      if (!tb) return;
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-soft,#6b6480);padding:18px">No bookings yet — register below and your session will appear here.</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function (b) {
        var when = b.preferred_date ? niceDate(b.preferred_date) : niceDate(b.created_at);
        return '<tr><td><b>' + esc(when) + '</b><br><small>registered ' + esc(niceDate(b.created_at)) + '</small></td>' +
          '<td>' + esc(b.service) + '</td><td>' + statusPill(b.status) + '</td>' +
          '<td>' + naira(b.amount) + '</td><td>' + esc(b.reference || '—') + '</td></tr>';
      }).join('');
    }

    function renderPayments(rows) {
      var tb = $('#paytable tbody');
      if (!tb) return;
      if (!rows.length) {
        tb.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--ink-soft,#6b6480);padding:18px">No payments recorded yet. Once your transfer is confirmed it appears here with your receipt.</td></tr>';
        return;
      }
      tb.innerHTML = rows.map(function (p) {
        return '<tr><td>' + esc(niceDate(p.paid_on)) + '</td><td>Consultation fee — ' + esc(p.method.replace('_', ' ')) + '</td>' +
          '<td>' + naira(p.amount) + '</td><td>' + statusPill(p.status) + '</td>' +
          '<td>' + esc(p.reference || '—') + (p.status === 'confirmed' && p.reference ?
            '<br><a href="syl4luv-receipt.html?ref=' + encodeURIComponent(p.reference) + '" style="color:var(--purple,#5a45c9);font-weight:800;font-size:.8rem">receipt →</a>' : '') + '</td></tr>';
      }).join('');
    }

    function paint() {
      var u = DB.user();
      if (!u) {
        var box = $('#demoNotice') || $('.notice-demo');
        if (box) {
          box.innerHTML = '<strong>You are not signed in.</strong> Log in to see your own bookings, payments and receipts — ' +
            '<a href="syl4luv-chat-app.html#chat" style="color:var(--purple,#5a45c9);font-weight:800">log in or create a free account →</a>' +
            '<br><small>The tables below show sample data until then.</small>';
        }
        var chip = $('.member-chip');
        if (chip) chip.title = 'Not signed in';
        return;
      }
      var box2 = $('#demoNotice') || $('.notice-demo');
      if (box2) {
        box2.innerHTML = '✅ <strong>Connected to your account</strong> (' + esc(String(u.email || '')) + '). ' +
          'These are your real bookings and payments, loaded from the centre\u2019s database.';
      }
      var chip = $('.member-chip');
      if (chip) {
        var b = chip.querySelector('b'); if (b) b.textContent = DB.name();
        var av = chip.querySelector('.avatar') || chip.querySelector('.av-sm');
        if (av) av.textContent = initials(DB.name());
        chip.title = 'Signed in as ' + DB.name();
      }
      $$('.greetname, .hero-name').forEach(function (el) { el.textContent = DB.name().split(' ')[0]; });
      Promise.all([DB.api.myBookings(), DB.api.myPayments()])
        .then(function (r) { renderBookings(r[0] || []); renderPayments(r[1] || []); })
        .catch(function () {});
    }

    /* quick booking form → a real row */
    var qb = document.getElementById('quickbook');
    if (qb) {
      qb.addEventListener('submit', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!DB.user()) { toast('Please log in first so the booking is tied to your account.'); return; }
        DB.api.createBooking({
          service: (document.getElementById('qb-type') || {}).value,
          date: (document.getElementById('qb-date') || {}).value || null,
          fullName: DB.name(), email: (DB.user() || {}).email
        }).then(function (row) {
          toast('Session registered ✅ Reference ' + row.reference + ' — transfer ₦5,000 to Access Bank 0032601495, then send the receipt.', 7000);
          paint();
        }).catch(function (err) { toast(err.message); });
      }, true);
    }

    /* The receipt upload becomes a real "I have paid" claim: the therapist sees
       it in the queue (instantly, on the console) and confirms or declines it.
       One open claim at a time — no point telling him twice. */
    var dz = document.getElementById('dropzone');
    var file = document.getElementById('file');
    if (dz && file) {
      file.addEventListener('change', function (e) {
        e.stopImmediatePropagation();
        if (!DB.user()) { toast('Please log in first so the payment is tied to your account.'); return; }
        var name = file.files && file.files[0] ? file.files[0].name : 'receipt';
        DB.api.myPayments().then(function (rows) {
          var open = (rows || []).filter(function (x) { return x.status === 'pending'; });
          if (open.length) {
            toast('Your receipt is already with Dr. Syl4luv — you will see it here the moment it is confirmed. 💜', 6500);
            return null;
          }
          return DB.api.declarePayment({ amount: 5000 }).then(function (row) {
            toast('Receipt “' + name + '” received ✅ Reference ' + row.reference +
                  ' — Dr. Syl4luv will confirm it shortly.', 7000);
            paint();
          });
        }).catch(function (err) { toast(err.message, 7000); });
      }, true);
    }

    /* log out should really log out */
    ['logout', 'logout2'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function (e) {
        e.preventDefault(); e.stopImmediatePropagation();
        DB.signOut().then(function () { window.location.href = 'syl4luv-chat-app.html'; });
      }, true);
    });

    DB.onChange(paint);
    if (DB.user()) paint(); else DB.init().then(paint);
  }

  /* ======================================================================== */
  /*  PICK THE PAGE                                                          */
  /* ======================================================================== */
  /* In demo mode nothing is wired to a database — but the page still has to be
     honest about it, so it says so plainly and points at CHAT-SETUP.md. */
  function paintDemoNotice() {
    var note = document.getElementById('sylmodenote');
    if (note) {
      note.hidden = false;
      note.innerHTML = '<b>This is the demo.</b> No database is connected, so nothing written here is collected or stored — ' +
        'the messages you see are samples. To collect real chats from real members, switch a database on: <b>CHAT-SETUP.md</b> ' +
        'shows two ways (a database on your own computer in about two minutes, or a free Supabase project). ' +
        'Once it is on, every registered member gets their own private boxes and this page reads them live.';
    }
    /* the sample bubbles in the page are examples, not a history — say so where
       they sit, so nobody mistakes them for a conversation that happened */
    var msgs = document.getElementById('msgs');
    if (msgs) {
      msgs.innerHTML = '<div class="day">Demo</div>' +
        '<div class="bub them">This is the demo — the two sample bubbles that were here are examples, not a real ' +
        'conversation. Connect a database (CHAT-SETUP.md) and this room holds <b>your</b> messages: stored against your ' +
        'own account, private between you and Dr. Syl4luv, and still here tomorrow on your phone or laptop.</div>';
    }
    var list = document.getElementById('convlist');
    if (list) {
      list.innerHTML = '<p class="convnote">This is the demo — connect a database and each registered member\'s own ' +
        'private boxes are listed here (see <b>CHAT-SETUP.md</b>).</p>';
    }
    var head = document.querySelector('#panel-private .chatroom-head');
    if (head) {
      var chip = document.getElementById('rtChip');
      if (!chip) {
        chip = document.createElement('span');
        chip.id = 'rtChip';
        chip.className = 'badge';
        chip.style.cssText = 'margin-left:auto;display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-weight:800';
        head.appendChild(chip);
      }
      chip.textContent = '◌ Demo — nothing stored';
      chip.title = 'No database is connected, so messages are not collected. CHAT-SETUP.md shows how to switch one on.';
    }
  }

  function boot() {
    var onChat = !!document.getElementById('loginform');
    var onDash = !!document.getElementById('booktable');
    if (!DB.isLive()) {                        /* demo mode: say so, change nothing else */
      if (onChat) paintDemoNotice();
      return;
    }
    if (onChat) initChatApp();
    if (onDash) initDashboard();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window, document);
