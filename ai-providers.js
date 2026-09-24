// ─── Taskflo AI providers (multi-API + auto failover, MV3-safe) ───
// Shared engine for the popup (ai.js) and the floating chat (chat-float.js).
// Load BEFORE ai.js in popup.html and BEFORE chat-float.js in manifest
// content_scripts — all three share one JS world per context.
//
// SECURITY (same posture as the old single-key design): provider keys live in
// chrome.storage.local under 'aiProviders' ONLY. They are NOT inside
// `settings`, never sync to Firestore and never enter file/clipboard backups.
// Never logged, never toasted.
//
// Failover policy: providers are tried in the user's saved order. Any failure
// (network/timeout, 429/quota, 5xx/overload, even a bad key 401) moves to the
// NEXT provider in the same request. Only when ALL fail does the user see an
// error. Quota-hit providers cool down 120s (skipped, not retried).
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;

  var PROVIDERS = {
    gemini: { name: 'Gemini', icon: '✨', defaultModel: 'gemini-3.6-flash', keyHint: 'AIza...', keyUrl: 'aistudio.google.com', minGapMs: 5000 },
    grok: { name: 'Grok', icon: '⚡', defaultModel: 'grok-4', keyHint: 'xai-...', keyUrl: 'console.x.ai', minGapMs: 1000 }
  };
  var LIST_KEY = 'aiProviders';
  var ORDER_KEY = 'aiProviderOrder';
  var LAST_KEY = 'aiLastProvider';
  var TIMEOUT_MS = 25000;
  var COOLDOWN_MS = 120000;

  // Per-provider runtime state (cooldowns/gaps). Memory-only, never persisted.
  var rt = {};
  function rtOf(id) { if (!rt[id]) rt[id] = { coolUntil: 0, lastAt: 0 }; return rt[id]; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function hasChrome() { return typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local; }

  function storeGet(keys) {
    return new Promise(function (resolve) {
      try {
        if (!hasChrome()) return resolve({});
        chrome.storage.local.get(keys, function (r) { resolve(r || {}); });
      } catch (e) { resolve({}); }
    });
  }
  function storeSet(obj) {
    return new Promise(function (resolve) {
      try {
        if (!hasChrome()) return resolve();
        chrome.storage.local.set(obj, function () { resolve(); });
      } catch (e) { resolve(); }
    });
  }

  // One-time migration: legacy geminiKey/geminiModel → providers list.
  async function migrate() {
    var s = await storeGet([LIST_KEY, ORDER_KEY, 'geminiKey', 'geminiModel']);
    if (Array.isArray(s[LIST_KEY]) && s[LIST_KEY].length) return s[LIST_KEY];
    var list = [
      { id: 'gemini', key: s.geminiKey || '', model: s.geminiModel || PROVIDERS.gemini.defaultModel, on: true },
      { id: 'grok', key: '', model: PROVIDERS.grok.defaultModel, on: true }
    ];
    var order = (Array.isArray(s[ORDER_KEY]) && s[ORDER_KEY].length)
      ? s[ORDER_KEY].filter(function (id) { return !!PROVIDERS[id]; })
      : ['gemini', 'grok'];
    if (!order.length) order = ['gemini', 'grok'];
    await storeSet({ [LIST_KEY]: list, [ORDER_KEY]: order });
    return list;
  }

  // Ordered provider entries (with display meta merged in).
  async function getProviders() {
    var list = await migrate();
    var s = await storeGet([ORDER_KEY]);
    var order = (Array.isArray(s[ORDER_KEY]) && s[ORDER_KEY].length) ? s[ORDER_KEY] : ['gemini', 'grok'];
    var byId = {};
    list.forEach(function (p) { byId[p.id] = p; });
    return order.filter(function (id) { return !!byId[id]; }).map(function (id) {
      return { id: id, name: PROVIDERS[id].name, icon: PROVIDERS[id].icon, key: byId[id].key || '', model: byId[id].model || PROVIDERS[id].defaultModel, on: byId[id].on !== false };
    });
  }
  async function saveProvider(id, patch) {
    var list = await migrate();
    var p = list.find(function (x) { return x.id === id; });
    if (p) Object.assign(p, patch || {});
    await storeSet({ [LIST_KEY]: list });
  }
  async function setOrder(order) {
    order = (order || []).filter(function (id) { return !!PROVIDERS[id]; });
    if (!order.length) order = ['gemini', 'grok'];
    await storeSet({ [ORDER_KEY]: order });
  }
  async function getLastProvider() {
    var s = await storeGet([LAST_KEY]);
    return s[LAST_KEY] || '';
  }

  // ─── Message conversion ───
  // Internal format = Gemini parts style: [{role:'user'|'model', parts:[{text}]}]
  function partsText(parts) {
    return (parts || []).map(function (p) { return p.text || ''; }).join('').trim();
  }
  function toOpenAI(system, msgs) {
    var out = [];
    if (system) out.push({ role: 'system', content: system });
    (msgs || []).forEach(function (m) {
      out.push({ role: m.role === 'model' ? 'assistant' : 'user', content: partsText(m.parts) });
    });
    return out;
  }

  // ─── Error classification ───
  function kindOf(msg) {
    msg = String(msg || '');
    if (/COOLDOWN:/.test(msg)) return 'cooldown';
    if (/quota|RESOURCE_EXHAUSTED|rate.limit|too many/i.test(msg) || /\b429\b/.test(msg)) return 'quota';
    if (/overloaded|high demand|UNAVAILABLE/i.test(msg) || /\b50[023]\b/.test(msg)) return 'overload';
    if (/API_KEY_INVALID|API key not valid|invalid_api_key|Incorrect API key|invalid xai/i.test(msg) || /\b401\b/.test(msg)) return 'key';
    if (/not found/i.test(msg) || /\b404\b/.test(msg)) return 'model';
    if (/network|fetch|timeout|abort|Failed to fetch|Load failed/i.test(msg)) return 'network';
    return 'other';
  }
  function friendly(id, msg) {
    var P = PROVIDERS[id] || { name: id };
    var k = kindOf(msg);
    if (k === 'cooldown') { var cd = String(msg).match(/^COOLDOWN:(\d+)/); return '⏳ اهدى ' + (cd ? cd[1] : 60) + ' ثانية — الإرسال السريع هو اللي بيقفل الحصة'; }
    if (k === 'key') return 'مفتاح ' + P.name + ' غير صالح — راجعه من ' + P.keyUrl;
    if (k === 'model') return 'موديل ' + P.name + ' مش متاح — غيّره من تاب حسابي';
    if (k === 'quota') return '⚠️ حصة ' + P.name + ' خلصت مؤقتاً';
    if (k === 'overload') return '⏳ ضغط عالي على ' + P.name + ' دلوقتي';
    if (k === 'network') return '🌐 مشكلة اتصال مع ' + P.name;
    return P.name + ' رد بخطأ: ' + String(msg).slice(0, 100);
  }
  function friendlyAllFailed(notes) {
    var withKey = notes.filter(function (n) { return n.tried; });
    if (!withKey.length) return '⚠️ حط مفتاح API الأول (Gemini أو Grok) من تاب حسابي ← ذكاء اصطناعي';
    if (withKey.length === 1) return friendly(withKey[0].id, withKey[0].msg);
    return '❌ كل المزودين فشلوا: ' + withKey.map(function (n) {
      return (PROVIDERS[n.id] ? PROVIDERS[n.id].name : n.id) + ' (' + friendly(n.id, n.msg).replace(/^[⏳⚠️🌐❌]+\s*/, '').slice(0, 60) + ')';
    }).join('، ');
  }

  async function postJson(url, headers, body) {
    var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = null;
    if (ctl) timer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, TIMEOUT_MS);
    try {
      var res = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
      var j = await res.json().catch(function () { return {}; });
      if (res.ok) return j;
      var em = (j && j.error && (j.error.message || j.error.code)) || res.status;
      throw new Error('HTTP' + res.status + ':' + String(em));
    } catch (e) {
      if (e && (e.name === 'AbortError' || /abort/i.test(e.message || ''))) throw new Error('timeout: request timed out');
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function tryGemini(p, req) {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(p.model) + ':generateContent?key=' + encodeURIComponent(p.key);
    var body = {
      systemInstruction: { parts: [{ text: req.system || 'أنت مساعد إنتاجية داخل إضافة مهام. التزم بالتنسيق المطلوب حرفياً.' }] },
      contents: req.messages,
      generationConfig: { temperature: req.temperature == null ? 0.7 : req.temperature, maxOutputTokens: req.maxTokens || 800 }
    };
    if (req.json) body.generationConfig.responseMimeType = 'application/json';
    // 2 tries, only for transient network/overload. Quota/key/model → fail over immediately.
    var lastErr = 'unknown';
    for (var i = 0; i < 2; i++) {
      try {
        var j = await postJson(url, { 'Content-Type': 'application/json' }, body);
        var parts = ((((j.candidates || [])[0] || {}).content || {}).parts) || [];
        var txt = partsText(parts);
        if (!txt) throw new Error('empty response');
        return txt;
      } catch (e) {
        lastErr = String((e && e.message) || e);
        var k = kindOf(lastErr);
        if (k === 'network' || k === 'overload') { if (i === 0) await sleep(1000); else break; }
        else break;
      }
    }
    throw new Error(lastErr);
  }

  async function tryGrok(p, req) {
    var body = {
      model: p.model,
      messages: toOpenAI(req.system, req.messages),
      temperature: req.temperature == null ? 0.7 : req.temperature,
      max_tokens: req.maxTokens || 800
    };
    if (req.json) body.response_format = { type: 'json_object' };
    var lastErr = 'unknown';
    for (var i = 0; i < 2; i++) {
      try {
        var j = await postJson('https://api.x.ai/v1/chat/completions',
          { 'Content-Type': 'application/json', Authorization: 'Bearer ' + p.key }, body);
        var txt = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        txt = String(txt || '').trim();
        if (!txt) throw new Error('empty response');
        return txt;
      } catch (e) {
        lastErr = String((e && e.message) || e);
        var k = kindOf(lastErr);
        if (k === 'network' || k === 'overload') { if (i === 0) await sleep(1000); else break; }
        else break;
      }
    }
    throw new Error(lastErr);
  }

  function cleanJson(txt) {
    txt = String(txt || '').replace(/^```json/i, '').replace(/^```/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(txt);
  }

  // Main entry: try providers in order, return {text, provider}.
  // req = {system, messages(parts-style), maxTokens, temperature, json}
  async function callChat(req) {
    req = req || {};
    var providers = (await getProviders()).filter(function (p) { return p.on && p.key; });
    if (!providers.length) throw new Error(friendlyAllFailed([]));
    var notes = [];
    for (var i = 0; i < providers.length; i++) {
      var p = providers[i];
      var st = rtOf(p.id);
      if (Date.now() < st.coolUntil) {
        notes.push({ id: p.id, tried: false, msg: 'COOLDOWN:' + Math.ceil((st.coolUntil - Date.now()) / 1000) });
        continue;
      }
      var gap = Date.now() - st.lastAt, need = (PROVIDERS[p.id] && PROVIDERS[p.id].minGapMs) || 0;
      if (gap < need) await sleep(need - gap);
      st.lastAt = Date.now();
      try {
        var text = p.id === 'grok' ? await tryGrok(p, req) : await tryGemini(p, req);
        try { await storeSet({ [LAST_KEY]: p.id }); } catch (e) {}
        return { text: text, provider: p.id };
      } catch (e) {
        var msg = String((e && e.message) || e);
        if (kindOf(msg) === 'quota') st.coolUntil = Date.now() + COOLDOWN_MS;
        notes.push({ id: p.id, tried: true, msg: msg });
      }
    }
    // If the only usable provider is cooling down, say so instead of "all failed".
    var cooling = notes.filter(function (n) { return !n.tried; });
    if (cooling.length && !notes.some(function (n) { return n.tried; })) {
      throw new Error(friendly(cooling[0].id, cooling[0].msg));
    }
    throw new Error(friendlyAllFailed(notes));
  }

  async function callJson(opts) {
    var r = await callChat(Object.assign({}, opts, { json: true }));
    return { data: cleanJson(r.text), provider: r.provider };
  }

  async function testProvider(id, key, model) {
    var def = PROVIDERS[id];
    if (!def) throw new Error('مزود غير معروف');
    if (!key) throw new Error('اكتب المفتاح الأول');
    var t0 = Date.now();
    var p = { id: id, key: key, model: model || def.defaultModel };
    var text = id === 'grok'
      ? await tryGrok(p, { system: '', messages: [{ role: 'user', parts: [{ text: 'رد بكلمة واحدة فقط: تم' }] }], maxTokens: 20, temperature: 0 })
      : await tryGemini(p, { system: '', messages: [{ role: 'user', parts: [{ text: 'رد بكلمة واحدة فقط: تم' }] }], maxTokens: 20, temperature: 0 });
    if (!text) throw new Error('رد فارغ — حاول تاني');
    return { ok: true, ms: Date.now() - t0 };
  }

  root.TaskfloProviders = {
    PROVIDERS: PROVIDERS, getProviders: getProviders, saveProvider: saveProvider,
    setOrder: setOrder, getLastProvider: getLastProvider,
    callChat: callChat, callJson: callJson, testProvider: testProvider,
    kindOf: kindOf, friendly: friendly
  };
})();
