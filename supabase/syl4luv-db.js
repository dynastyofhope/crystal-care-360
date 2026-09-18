/* ============================================================================
   syl4luv-db.js — the bridge between the Syl4luv pages and your Supabase project
   ----------------------------------------------------------------------------
   Deliberately has NO dependencies: no CDN, no npm, no build step. It talks to
   Supabase's own HTTP endpoints (GoTrue for accounts, PostgREST for data) with
   plain fetch(), so the pages stay single files you can open anywhere.

   USAGE — in a page, after this file:
       <script src="supabase/supabase-config.js"></script>
       <script src="supabase/syl4luv-db.js"></script>
       <script>
         SYL4LUV_DB.init().then(function(){
           if (SYL4LUV_DB.isLive()) { ...real accounts... }   // Supabase is set up
           else { ...keep the demo behaviour... }             // no keys yet
         });
       </script>

   THE API KEY IN supabase-config.js IS *PUBLIC*. That is by design — Supabase
   calls it the "anon" key and expects it to sit in web pages. What protects your
   members is the row-level security in schema.sql, not the key. NEVER put the
   "service_role" key in a webpage — that one bypasses all rules.
   ========================================================================== */
(function (window, document) {
  'use strict';

  var CFG  = window.SYL4LUV_CONFIG || {};
  var BASE = String(CFG.supabaseUrl || '').replace(/\/+$/, '');
  var KEY  = String(CFG.supabaseAnonKey || '');
  var STORE_KEY = 'syl4luv.session.v1';
  var LIVE = !!(BASE && KEY);

  var state = { session: null, user: null, profile: null, listeners: [] };

  /* ---------------------------------------------------------------- storage */
  function store(k, v) {
    try {
      if (v === undefined) return window.localStorage.getItem(k);
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
      return v;
    } catch (e) { return null; }          /* private mode / file:// — fine */
  }

  /* ------------------------------------------------------- friendly errors */
  var MESSAGES = {
    'Invalid login credentials': 'That email or password does not match our records. Please try again.',
    'User already registered': 'An account with that email already exists — log in instead.',
    'Email not confirmed': 'Almost there — please click the confirmation link we emailed you (check your spam folder too).',
    'Password should be at least 6 characters': 'Please choose a password with at least 6 characters.',
    'Unable to validate email address: invalid format': 'That email address does not look right — please check it.',
    'signup requires a valid password': 'Please choose a password.',
    'Email address not authorized': 'That email address cannot be used to sign up. Please contact the center.',
    'over_email_send_rate_limit': 'Please wait a moment — too many emails requested just now.'
  };

  function friendly(err) {
    var raw = (err && (err.message || err.error_description || err.msg)) || String(err || 'Something went wrong.');
    for (var k in MESSAGES) if (raw.indexOf(k) !== -1) return MESSAGES[k];
    if (/fetch|network|failed to load|load failed/i.test(raw)) {
      return 'Could not reach Supabase. Check the internet connection — and if you opened this file straight from your computer, browsers often block network calls from file:// pages. Upload the site first (see DEPLOY.md) or run a local server.';
    }
    if (/JWT|token|401|403/i.test(raw)) return 'Your session has expired. Please log in again.';
    return raw;
  }

  /* ------------------------------------------------------------ low level */
  function authHeaders(anonOnly) {
    var h = { apikey: KEY, 'Content-Type': 'application/json' };
    if (!anonOnly && state.session && state.session.access_token) {
      h.Authorization = 'Bearer ' + state.session.access_token;
    }
    return h;
  }

  function http(method, path, body, anonOnly) {
    return fetch(BASE + path, {
      method: method,
      headers: authHeaders(anonOnly),
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = { message: text }; }
        if (!res.ok) {
          var msg = (json && (json.msg || json.message || json.error_description || json.hint || json.error)) || ('HTTP ' + res.status);
          throw new Error(msg);
        }
        return json;
      });
    }, function (netErr) {
      throw new Error('Could not reach Supabase: ' + (netErr && netErr.message ? netErr.message : 'network error'));
    });
  }

  /* -------------------------------------------------------------- session */
  function expiresAt(session) {
    if (!session || !session.expires_at) return 0;
    return Number(session.expires_at) * 1000;
  }

  function saveSession(session, user) {
    state.session = session || null;
    state.user = user || (session && session.user) || null;
    store(STORE_KEY, session ? JSON.stringify({ session: session, user: state.user }) : null);
    fire();
  }

  function fire() {
    state.listeners.forEach(function (fn) { try { fn(state.user, state.profile); } catch (e) {} });
    try {
      window.dispatchEvent(new CustomEvent('syl4luv:auth', { detail: { user: state.user } }));
    } catch (e) {}
  }

  function refreshIfNeeded() {
    if (!state.session || !state.session.refresh_token) return Promise.resolve(state.session);
    if (expiresAt(state.session) - Date.now() > 60 * 1000) return Promise.resolve(state.session);
    return http('POST', '/auth/v1/token?grant_type=refresh_token',
                { refresh_token: state.session.refresh_token }, true)
      .then(function (s) { saveSession(s); return s; })
      .catch(function () { saveSession(null); return null; });
  }

  function loadProfile() {
    if (!state.user) { state.profile = null; return Promise.resolve(null); }
    return select('profiles', { eq: { id: state.user.id }, limit: 1 })
      .then(function (rows) { state.profile = (rows && rows[0]) || null; fire(); return state.profile; })
      .catch(function () { state.profile = null; return null; });
  }

  /* ------------------------------------------------------------- accounts */
  function signUp(opts) {
    opts = opts || {};
    if (!LIVE) return Promise.reject(new Error('Supabase is not configured yet (see supabase/supabase-config.js).'));
    return http('POST', '/auth/v1/signup', {
      email: opts.email,
      password: opts.password,
      data: { full_name: opts.fullName || '', phone: opts.phone || '' }
    }, true).then(function (res) {
      /* Two possible shapes: a session (email confirmation off) or just a user */
      if (res && res.access_token) {
        saveSession(res, res.user);
        return loadProfile().then(function () { return { confirmed: true, user: state.user }; });
      }
      return { confirmed: false, user: (res && res.user) || (res && res.id ? res : null) };
    }).catch(function (e) { throw new Error(friendly(e)); });
  }

  function signIn(opts) {
    opts = opts || {};
    if (!LIVE) return Promise.reject(new Error('Supabase is not configured yet (see supabase/supabase-config.js).'));
    return http('POST', '/auth/v1/token?grant_type=password',
                { email: opts.email, password: opts.password }, true)
      .then(function (s) {
        saveSession(s);
        return loadProfile().then(function () { return state.user; });
      })
      .catch(function (e) { throw new Error(friendly(e)); });
  }

  function signOut() {
    var had = !!state.session;
    saveSession(null); state.profile = null; fire();
    if (!LIVE || !had) return Promise.resolve(true);
    return http('POST', '/auth/v1/logout', undefined).then(function () { return true; })
      .catch(function () { return true; });   /* local session is gone either way */
  }

  function updateProfile(patch) {
    if (!state.user) return Promise.reject(new Error('Please log in first.'));
    return update('profiles', { id: state.user.id }, patch)
      .then(function () { return loadProfile(); })
      .catch(function (e) { throw new Error(friendly(e)); });
  }

  /* ------------------------------------------------------------- REST calls */
  function qs(opts) {
    opts = opts || {};
    var parts = ['select=' + encodeURIComponent(opts.select || '*')];
    var eq = opts.eq || {};
    Object.keys(eq).forEach(function (col) {
      if (eq[col] === undefined) return;
      if (eq[col] === null) { parts.push(encodeURIComponent(col) + '=is.null'); return; }
      parts.push(encodeURIComponent(col) + '=eq.' + encodeURIComponent(eq[col]));
    });
    ['gt', 'gte', 'lt', 'lte'].forEach(function (op) {
      var set = opts[op] || {};
      Object.keys(set).forEach(function (col) {
        if (set[col] === undefined || set[col] === null) return;
        parts.push(encodeURIComponent(col) + '=' + op + '.' + encodeURIComponent(set[col]));
      });
    });
    if (opts.or) parts.push('or=' + encodeURIComponent(opts.or));
    if (opts.order) parts.push('order=' + opts.order);
    if (opts.limit) parts.push('limit=' + opts.limit);
    return parts.join('&');
  }

  function select(table, opts) {
    if (!LIVE) return Promise.resolve(null);
    return refreshIfNeeded().then(function () {
      return http('GET', '/rest/v1/' + table + '?' + qs(opts));
    }).catch(function (e) { throw new Error(friendly(e)); });
  }

  function insert(table, rows) {
    if (!LIVE) return Promise.resolve(null);
    var list = Array.isArray(rows) ? rows : [rows];
    return refreshIfNeeded().then(function () {
      return fetch(BASE + '/rest/v1/' + table, {
        method: 'POST',
        headers: Object.assign(authHeaders(), { Prefer: 'return=representation' }),
        body: JSON.stringify(list)
      }).then(function (res) {
        return res.text().then(function (t) {
          var json = null; try { json = t ? JSON.parse(t) : null; } catch (e) {}
          if (!res.ok) throw new Error((json && (json.message || json.hint || json.error)) || ('HTTP ' + res.status));
          return json;
        });
      });
    }).catch(function (e) { throw new Error(friendly(e)); });
  }

  function remove(table, match) {
    if (!LIVE) return Promise.resolve(null);
    return refreshIfNeeded().then(function () {
      return fetch(BASE + '/rest/v1/' + table + '?' + qs({ eq: match }).replace('select=*&', ''), {
        method: 'DELETE', headers: authHeaders()
      }).then(function (res) {
        if (!res.ok) return res.text().then(function (t) {
          var json = null; try { json = t ? JSON.parse(t) : null; } catch (e) {}
          throw new Error((json && (json.message || json.hint)) || ('HTTP ' + res.status));
        });
        return true;
      });
    }).catch(function (e) { throw new Error(friendly(e)); });
  }

  function update(table, match, patch) {
    if (!LIVE) return Promise.resolve(null);
    return refreshIfNeeded().then(function () {
      return http('PATCH', '/rest/v1/' + table + '?' + qs({ eq: match }).replace('select=*&', ''), patch);
    }).catch(function (e) { throw new Error(friendly(e)); });
  }

  /* --------------------------------------------------- what the pages use */
  function makeReference(prefix) {
    var stamp = Date.now().toString(36).toUpperCase().slice(-5);
    var rand = Math.floor(Math.random() * 9000 + 1000);
    return (prefix || 'SLV') + '-' + stamp + rand;
  }

  function nameOf(user) {
    if (state.profile && state.profile.full_name) return state.profile.full_name;
    if (user && user.user_metadata && user.user_metadata.full_name) return user.user_metadata.full_name;
    if (user && user.email) return user.email.split('@')[0];
    return 'Member';
  }

  var api = {
    /* health */
    ping: function () {
      if (!LIVE) return Promise.resolve({ live: false });
      return http('GET', '/rest/v1/announcements?select=id&limit=1', undefined, true)
        .then(function () { return { live: true, reachable: true }; })
        .catch(function () { return { live: true, reachable: false }; });
    },

    /* ---- bookings ---- */
    createBooking: function (b) {
      var row = {
        member_id: state.user ? state.user.id : null,
        full_name: b.fullName || '',
        phone: b.phone || '',
        email: b.email || '',
        service: b.service || 'Relationship / marriage counselling',
        preferred_date: b.date || null,
        notes: b.notes || '',
        amount: b.amount || 5000,
        reference: makeReference('SLV')
      };
      return insert('bookings', row).then(function (rows) { return (rows && rows[0]) || row; });
    },
    myBookings: function () {
      if (!state.user) return Promise.resolve([]);
      return select('bookings', { eq: { member_id: state.user.id }, order: 'created_at.desc' })
        .then(function (r) { return r || []; });
    },

    /* ---- payments ---- */
    declarePayment: function (p) {
      if (!state.user) return Promise.reject(new Error('Please log in first.'));
      return insert('payments', {
        member_id: state.user.id,
        booking_id: p.bookingId || null,
        amount: p.amount || 5000,
        method: p.method || 'bank_transfer',
        reference: p.reference || makeReference('SLV-PAY'),
        status: 'pending'
      }).then(function (rows) { return (rows && rows[0]) || null; });
    },
    myPayments: function () {
      if (!state.user) return Promise.resolve([]);
      return select('payments', { eq: { member_id: state.user.id }, order: 'paid_on.desc' })
        .then(function (r) { return r || []; });
    },
    pendingPayments: function () {
      return select('payments', { eq: { status: 'pending' }, order: 'created_at.asc' }).then(function (r) { return r || []; });
    },
    confirmPayment: function (id, amountPaid) {
      return update('payments', { id: id },
        { status: 'confirmed', confirmed_at: new Date().toISOString(), confirmed_by: state.user ? state.user.id : null })
        .then(function () { return true; });
    },

    /* ---- private chat room + forum messages --------------------------------
       Every private message carries three things the inbox needs:
         member_id  whose private box it belongs to  (the database enforces this)
         thread     which box inside that member's area — 'main' is the first one
         topic      the name the member gave it, shown in the sidebar and console
       So one member can keep several separate conversations with Dr. Syl4luv and
       the two sides always agree on which box a message belongs to.
       ---------------------------------------------------------------------- */
    sendMessage: function (body, room, opts) {
      opts = opts || {};
      if (!state.user) return Promise.reject(new Error('Please log in to send a message.'));
      var row = {
        room: room || 'private',
        member_id: opts.memberId || state.user.id,
        sender_id: state.user.id,
        sender_name: opts.asName || nameOf(state.user),
        body: body,
        thread: opts.thread || 'main'
      };
      if (opts.topic) row.topic = opts.topic;
      return insert('messages', row).then(function (rows) { return (rows && rows[0]) || null; });
    },
    roomMessages: function (opts) {
      opts = opts || {};
      var eq = { room: opts.room || 'private' };
      if ((opts.room || 'private') === 'private') eq.member_id = opts.memberId || (state.user && state.user.id);
      if (opts.thread) eq.thread = opts.thread;
      return select('messages', { eq: eq, order: 'created_at.asc', limit: opts.limit || 50 })
        .then(function (r) { return r || []; });
    },

    /* ---- forum ---- */
    forumTopics: function () {
      return select('forum_posts', { eq: { parent_id: null }, order: 'pinned.desc,created_at.desc', limit: 20 })
        .then(function (r) { return r || []; });
    },
    forumReplies: function (topicId) {
      return select('forum_posts', { eq: { parent_id: topicId }, order: 'created_at.asc' })
        .then(function (r) { return r || []; });
    },
    addForumPost: function (p) {
      if (!state.user) return Promise.reject(new Error('Please log in to post in the forum.'));
      return insert('forum_posts', {
        parent_id: p.parentId || null,
        author_id: state.user.id,
        author_name: nameOf(state.user),
        title: p.title || null,
        body: p.body
      }).then(function (rows) { return (rows && rows[0]) || null; });
    },

    /* ---- announcements + money ---- */
    announcements: function () {
      return select('announcements', { order: 'published_at.desc', limit: 10 }).then(function (r) { return r || []; });
    },
    expenses: function (monthISO) {
      return select('expenses', { eq: monthISO ? { month: monthISO } : {}, order: 'month.desc' })
        .then(function (r) { return r || []; });
    },
    addExpense: function (e) {
      return insert('expenses', { month: e.month, item: e.item, amount: e.amount, note: e.note || null })
        .then(function (rows) { return (rows && rows[0]) || null; });
    },

    /* ---- staff: everyone's data ---- */
    allBookings: function () { return select('bookings', { order: 'created_at.desc', limit: 200 }).then(function (r) { return r || []; }); },
    allPayments: function () { return select('payments', { order: 'created_at.desc', limit: 200 }).then(function (r) { return r || []; }); },
    allProfiles: function () { return select('profiles', { order: 'created_at.desc', limit: 200 }).then(function (r) { return r || []; }); },
    privateMessagesFor: function (memberId) { return api.roomMessages({ room: 'private', memberId: memberId }); },
    isStaff: function () { return !!(state.profile && (state.profile.role === 'therapist' || state.profile.role === 'support')); }
  };

  /* ==========================================================================
     REALTIME — new messages, payments and bookings arrive without a refresh
     --------------------------------------------------------------------------
     Supabase Realtime speaks the Phoenix protocol over a WebSocket. This is a
     small, dependency-free client for it: join one channel, listen for
     postgres_changes, heartbeat, and reconnect with backoff if the connection
     drops. Your access token is passed so the database still applies row-level
     security — a member only ever receives their own rows.

     For this to deliver anything, the tables must be in the realtime
     publication (one line in schema.sql) and the connection must be allowed to
     open. If anything fails, callers keep their polling fallback: the pages
     never stop working just because realtime could not connect.
     ========================================================================== */
  var RT = { sock: null, joined: false, closed: true, ref: 0, hb: null, retry: null, delay: 1000, status: 'off' };

  function realtimeUrl() {
    var base = String(CFG.realtimeUrl || '').replace(/\/+$/, '');
    if (!base) base = BASE.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    var q = '?apikey=' + encodeURIComponent(KEY) + '&vsn=1.0.0';
    if (state.session && state.session.access_token) q += '&access_token=' + encodeURIComponent(state.session.access_token);
    return base + '/realtime/v1/websocket' + q;
  }

  function live(opts) {
    opts = opts || {};
    var tables = opts.tables || ['messages'];
    var onEvent = opts.onEvent || function () {};
    var onStatus = opts.onStatus || function () {};
    var channel = opts.channel || 'syl4luv';
    var handle = { stop: function () {} };

    if (!LIVE || typeof window.WebSocket === 'undefined') { onStatus('unsupported'); return handle; }

    RT.closed = false;

    function setStatus(st) { RT.status = st; try { onStatus(st); } catch (e) {} }
    function send(obj) {
      try { if (RT.sock && RT.sock.readyState === 1) RT.sock.send(JSON.stringify(obj)); } catch (e) {}
    }
    function schedule() {
      if (RT.closed) return;
      clearTimeout(RT.retry);
      RT.retry = setTimeout(function () { RT.delay = Math.min(RT.delay * 2, 30000); connect(); }, RT.delay);
    }
    function connect() {
      if (RT.closed) return;
      setStatus(RT.delay > 2000 ? 'offline' : 'connecting');
      var s;
      try { s = new WebSocket(realtimeUrl()); } catch (e) { setStatus('offline'); schedule(); return; }
      RT.sock = s;

      s.onopen = function () {
        RT.delay = 1000;
        RT.joined = false;
        setStatus('connecting');
        var joinRef = String(++RT.ref);
        send({
          topic: 'realtime:' + channel,
          event: 'phx_join',
          payload: {
            config: { postgres_changes: tables.map(function (t) { return { event: '*', schema: 'public', table: t }; }) },
            access_token: state.session && state.session.access_token
          },
          ref: joinRef,
          join_ref: joinRef
        });
        clearInterval(RT.hb);
        RT.hb = setInterval(function () { send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++RT.ref) }); }, 25000);
      };

      s.onmessage = function (ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.event === 'phx_reply' && /^realtime:/.test(msg.topic || '')) {
          var ok = msg.payload && msg.payload.status === 'ok';
          RT.joined = !!ok;
          setStatus(ok ? 'live' : 'error');
          return;
        }
        if (msg.event === 'postgres_changes') {
          var d = (msg.payload && msg.payload.data) || {};
          try { onEvent(d.table, d); } catch (e) {}
          return;
        }
        if (msg.event === 'phx_error' || msg.event === 'phx_close') {
          RT.joined = false; setStatus('offline'); schedule();
        }
      };

      s.onclose = function () {
        clearInterval(RT.hb);
        RT.joined = false;
        if (!RT.closed) { setStatus('offline'); schedule(); }
      };
      s.onerror = function () { /* onclose always follows */ };
    }

    connect();

    handle.stop = function () {
      if (RT.closed) return;                 /* already stopped */
      RT.closed = true;
      clearInterval(RT.hb); clearTimeout(RT.retry);
      var s = RT.sock;
      RT.sock = null;
      try {
        if (s) {                            /* detach first: a closing socket must not
                                               reschedule a connection for the next one */
          s.onopen = s.onmessage = s.onclose = s.onerror = null;
          s.close();
        }
      } catch (e) {}
      setStatus('off');
    };
    handle.status = function () { return RT.status; };
    return handle;
  }

  /* ------------------------------------------------------------------ init */
  var initPromise = null;

  function init() {
    if (initPromise) return initPromise;      /* safe to call from many places */
    initPromise = restore();
    return initPromise;
  }

  function restore() {
    if (!LIVE) { fire(); return Promise.resolve({ live: false }); }
    var raw = store(STORE_KEY);
    if (raw) {
      try {
        var saved = JSON.parse(raw);
        state.session = saved.session || null;
        state.user = saved.user || (state.session && state.session.user) || null;
      } catch (e) { state.session = null; state.user = null; }
    }
    if (!state.session && !state.user) { fire(); return Promise.resolve({ live: true, signedIn: false }); }
    return refreshIfNeeded()
      .then(function () {
        if (!state.session && !state.user) { fire(); return { live: true, signedIn: false }; }
        if (!state.session) { fire(); return { live: true, signedIn: true }; }   /* offline-stored user */
        return http('GET', '/auth/v1/user').then(function (u) {
          state.user = u; store(STORE_KEY, JSON.stringify({ session: state.session, user: u }));
          return loadProfile();
        }).then(function () { fire(); return { live: true, signedIn: !!state.user }; })
          .catch(function () { saveSession(null); return { live: true, signedIn: false }; });
      });
  }

  /* Restore any saved session as soon as the page is ready, so a member who
     logged in yesterday is still logged in today without the page doing
     anything. Pages may still call init() themselves — it is idempotent. */
  function autoInit() {
    if (!LIVE) { fire(); return; }
    init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }

  window.SYL4LUV_DB = {
    init: init,
    ready: function () { return init(); },
    isLive: function () { return LIVE; },
    mode: function () { return LIVE ? 'live' : 'demo'; },
    config: function () { return { url: BASE, hasKey: !!KEY }; },
    user: function () { return state.user; },
    profile: function () { return state.profile; },
    name: function () { return nameOf(state.user); },
    session: function () { return state.session; },
    isStaff: api.isStaff,
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    updateProfile: updateProfile,
    reloadProfile: loadProfile,
    onChange: function (fn) { state.listeners.push(fn); return state.listeners.length; },
    select: select,
    insert: insert,
    update: update,
    remove: remove,
    reference: makeReference,
    friendly: friendly,
    live: live,
    liveStatus: function () { return RT.status; },
    api: api
  };
})(window, document);
