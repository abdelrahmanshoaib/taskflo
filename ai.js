// ─── Taskflo AI settings UI (multi-provider) + task enhance ───
// Keys UI for Gemini + Grok lives in the account tab. Actual requests +
// failover live in ai-providers.js (window.TaskfloProviders).
// SECURITY: keys stay in chrome.storage.local ('aiProviders') ONLY — never
// sync, never backup, never logged, never toasted.
(function () {
  function $(id) { return document.getElementById(id); }
  function say(msg) { if (typeof toast === 'function') toast(msg); }
  function shortErr(e) {
    var m = String((e && e.message) || e);
    return /^[⏳⚠️✅❌🌐]/.test(m) ? m.slice(0, 140) : '❌ ' + m.slice(0, 120);
  }
  function P() { return window.TaskfloProviders; }
  var UI = {
    gemini: { key: 'aiKeyInput', model: 'aiModelInput', save: 'btnAiSave', test: 'btnAiTest', del: 'btnAiDel', status: 'aiKeyStatus', delConfirm: 'مسح مفتاح Gemini من هذا الجهاز؟' },
    groq: { key: 'aiKeyInputGroq', model: 'aiModelInputGroq', save: 'btnAiSaveGroq', test: 'btnAiTestGroq', del: 'btnAiDelGroq', status: 'aiKeyStatusGroq', delConfirm: 'مسح مفتاح Groq من هذا الجهاز؟' }
  };

  // ── Legacy-compatible accessors (Gemini entry) ──
  async function prov(id) {
    var ps = await P().getProviders();
    return ps.find(function (p) { return p.id === id; });
  }
  async function getKey() { var p = await prov('gemini'); return p ? p.key : ''; }
  async function setKey(k) { await P().saveProvider('gemini', { key: k || '' }); }
  async function getModel() { var p = await prov('gemini'); return (p && p.model) || P().PROVIDERS.gemini.defaultModel; }
  async function setModel(m) { await P().saveProvider('gemini', { model: m || P().PROVIDERS.gemini.defaultModel }); }
  var DEFAULT_MODEL = 'gemini-3.6-flash';

  async function testKey(key) {
    var k = key !== undefined ? key : await getKey();
    if (!k) throw new Error('اكتب المفتاح الأول');
    await P().testProvider('gemini', k, await getModel());
    return true;
  }
  async function enhanceTask(title) {
    var ps = await P().getProviders();
    if (!ps.some(function (p) { return p.on && p.key; })) throw new Error('حط مفتاح AI الأول من تاب حسابي (Gemini أو Groq)');
    var prompt = 'المهمة: "' + String(title).slice(0, 200) + '"\n' +
      'أخرج JSON بهذا الشكل بالضبط (قيم عربية، مفاتيح إنجليزية): ' +
      '{"title":"عنوان محسن قصير","description":"وصف عملي سطرين","subtasks":["خطوة 1","خطوة 2","خطوة 3"],"priority":"urgent|high|medium|low","estMinutes":30,"tags":["وسم"]}';
    var r = await P().callJson({
      system: 'أنت مساعد إنتاجية داخل إضافة مهام. التزم بالتنسيق المطلوب حرفياً.',
      messages: [{ role: 'user', parts: [{ text: prompt }] }],
      maxTokens: 800, temperature: 0.7
    });
    return r.data;
  }
  // Fills the open task modal for REVIEW — never auto-saves.
  async function enhanceModal() {
    var titleEl = $('modalTitle');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) { say('⚠️ اكتب عنوان المهمة الأول'); if (titleEl) titleEl.focus(); return; }
    var ps = await P().getProviders();
    if (!ps.some(function (p) { return p.on && p.key; })) { say('⚠️ حط مفتاح AI الأول (تاب حسابي ← ذكاء اصطناعي)'); return; }
    say('✨ جاري التحسين...');
    try {
      var d = await enhanceTask(title);
      if (d.title) titleEl.value = String(d.title).slice(0, 120);
      var de = $('modalDesc');
      if (de && d.description) de.value = String(d.description).slice(0, 500);
      var pr = $('modalPriority');
      if (pr && ['urgent', 'high', 'medium', 'low'].includes(d.priority)) pr.value = d.priority;
      var es = $('modalEst');
      if (es && d.estMinutes) es.value = Math.max(0, parseInt(d.estMinutes, 10) || 0);
      var tg = $('modalTags');
      if (tg && Array.isArray(d.tags)) tg.value = d.tags.slice(0, 5).map(function (x) { return String(x).slice(0, 20); }).join('، ');
      var sb = $('modalSubs');
      if (sb && Array.isArray(d.subtasks)) sb.value = d.subtasks.slice(0, 8).map(function (s) { return String(s).slice(0, 80); }).join('\n');
      say('✨ اتحسنت — راجع واحفظ 💾');
    } catch (e) { say(shortErr(e)); }
  }

  function mask(k) { return k ? '••••••••' + String(k).slice(-4) : ''; }
  async function refreshStatus() {
    try {
      var ps = await P().getProviders();
      ps.forEach(function (p) {
        var u = UI[p.id];
        if (!u) return;
        var inp = $(u.key), mdl = $(u.model), st = $(u.status);
        if (inp && document.activeElement !== inp) inp.value = p.key ? mask(p.key) : '';
        if (mdl && document.activeElement !== mdl && !mdl.value) mdl.value = p.model;
        if (st) {
          var bits = [];
          bits.push(p.key ? '✅ محفوظ (' + p.model + ')' : 'مفيش مفتاح');
          if (!p.on) bits.push('⏸ متوقف');
          st.textContent = bits.join(' · ');
        }
      });
      var ord = $( 'aiOrderSelect');
      if (ord) {
        var cur = ps.map(function (p) { return p.id; });
        ord.value = (cur[0] === 'groq') ? 'groq-first' : 'gemini-first';
      }
      var last = $('aiLastUsed');
      if (last) {
        var lp = await P().getLastProvider();
        last.textContent = lp && P().PROVIDERS[lp] ? ('آخر رد كان عبر: ' + P().PROVIDERS[lp].icon + ' ' + P().PROVIDERS[lp].name) : 'لسه مفيش رد — أول مزود شغال هيرد عليك';
      }
    } catch (e) {}
  }

  function bindOne(id) {
    var u = UI[id];
    if (!u) return;
    var sv = $(u.save), ts = $(u.test), dl = $(u.del);
    var def = P().PROVIDERS[id];
    if (sv) sv.addEventListener('click', async function () {
      var inp = $(u.key), mdl = $(u.model);
      var v = inp ? inp.value.trim() : '';
      var m = mdl ? mdl.value.trim() : '';
      if (m) await P().saveProvider(id, { model: m, on: true });
      if (!v || v.startsWith('••••')) {
        if (m) { refreshStatus(); say('💾 اتحفظ الموديل (' + def.name + ')'); }
        else say('⚠️ اكتب المفتاح كاملاً الأول');
        return;
      }
      await P().saveProvider(id, { key: v, on: true });
      if (inp) inp.value = '';
      refreshStatus();
      say('💾 اتحفظ مفتاح ' + def.name + ' على جهازك');
    });
    if (ts) ts.addEventListener('click', async function () {
      try {
        say('🔍 جاري تجربة ' + def.name + '...');
        var inp = $(u.key), mdl = $(u.model);
        if (mdl && mdl.value.trim()) await P().saveProvider(id, { model: mdl.value.trim() });
        var typed = inp && inp.value.trim() && !inp.value.trim().startsWith('••••') ? inp.value.trim() : null;
        var key = typed !== null ? typed : (await prov(id)).key;
        var model = mdl && mdl.value.trim() ? mdl.value.trim() : (await prov(id)).model;
        await P().testProvider(id, key, model);
        refreshStatus();
        say('✅ ' + def.name + ' شغال');
      } catch (e) { say(shortErr(e)); }
    });
    if (dl) dl.addEventListener('click', async function () {
      if (!confirm(u.delConfirm)) return;
      await P().saveProvider(id, { key: '' });
      refreshStatus();
      say('🗑️ اتمسح المفتاح');
    });
  }
  function bindAI() {
    bindOne('gemini');
    bindOne('groq');
    var ord = $('aiOrderSelect');
    if (ord) ord.addEventListener('change', async function () {
      await P().setOrder(ord.value === 'groq-first' ? ['groq', 'gemini'] : ['gemini', 'groq']);
      refreshStatus();
      say('🔀 ترتيب التجربة: ' + (ord.value === 'groq-first' ? '⚡ Groq أولاً ثم ✨ Gemini' : '✨ Gemini أولاً ثم ⚡ Groq'));
    });
    refreshStatus();
  }

  window.TaskfloAI = { getKey, setKey, getModel, setModel, testKey, enhanceTask, enhanceModal, refreshStatus, DEFAULT_MODEL };
  try { bindAI(); } catch (e) {}
})();
