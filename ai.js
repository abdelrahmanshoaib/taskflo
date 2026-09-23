// ─── Taskflo Gemini AI (local key, REST, MV3-safe, modular) ───
// SECURITY: the key lives in chrome.storage.local under 'geminiKey' ONLY.
// It is deliberately NOT inside `settings`, so it never syncs to Firestore
// and never enters file/clipboard backups. Never logged, never toasted.
(function () {
  const DEFAULT_MODEL = 'gemini-3.6-flash';
  function ep(key, model) {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' + (model || DEFAULT_MODEL) + ':generateContent?key=' + encodeURIComponent(key);
  }
  function $(id) { return document.getElementById(id); }
  function say(msg) { if (typeof toast === 'function') toast(msg); }

  async function getKey() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(['geminiKey'], (r) => resolve((r && r.geminiKey) || '')); }
      catch (e) { resolve(''); }
    });
  }
  async function setKey(k) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ geminiKey: k || '' }, () => resolve()); }
      catch (e) { resolve(); }
    });
  }
  async function getModel() {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(['geminiModel'], (r) => resolve((r && r.geminiModel) || DEFAULT_MODEL)); }
      catch (e) { resolve(DEFAULT_MODEL); }
    });
  }
  async function setModel(m) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ geminiModel: m || DEFAULT_MODEL }, () => resolve()); }
      catch (e) { resolve(); }
    });
  }
  // Smart throttling: cooldown after quota + min gap (free tier = few req/min)
  let quotaCooldownUntil = 0;
  let lastCallAt = 0;
  function isQuotaLike(em) {
    em = String(em || '');
    return (/quota|RESOURCE_EXHAUSTED|rate.limit|too many/i.test(em) || /\b429\b/.test(em)) &&
      !/overloaded|high demand|UNAVAILABLE/i.test(em) && !/\b503\b/.test(em);
  }
  function isOverloadLike(em) {
    em = String(em || '');
    return /overloaded|high demand|UNAVAILABLE/i.test(em) || /\b503\b/.test(em);
  }
  function friendlyGeminiError(em) {
    em = String(em || '');
    const cd = em.match(/^COOLDOWN:(\d+)/);
    if (cd) return '⏳ اهدى ' + cd[1] + ' ثانية وبعدين حاول — الإرسال السريع المتكرر هو اللي بيقفل الحصة';
    if (/API_KEY_INVALID|API key not valid/i.test(em)) return 'المفتاح غير صالح — انسخه تاني من AI Studio';
    if (/high demand|overloaded|UNAVAILABLE/i.test(em) || /\b503\b/.test(em)) return '⏳ ضغط عالي على سيرفرات جوجل دلوقتي — استنى دقيقة وحاول تاني';
    if (/quota|RESOURCE_EXHAUSTED/i.test(em) || /\b429\b/.test(em)) return '⚠️ خلصت حصة الاستخدام المجاني مؤقتاً — استنى شوية وحاول تاني';
    if (/not found/i.test(em) || /\b404\b/.test(em)) return 'الموديل مش متاح — غيّره من خانة الموديل في تاب حسابي';
    return 'Gemini رد بخطأ: ' + em.slice(0, 100);
  }
  // POST with auto-retry ONLY on transient overload/network.
  // Quota/rate errors: NO retry + 90s cooldown (retrying worsens the block).
  async function geminiFetch(url, body, tries) {
    tries = tries || 3;
    if (Date.now() < quotaCooldownUntil) {
      throw new Error(friendlyGeminiError('COOLDOWN:' + Math.ceil((quotaCooldownUntil - Date.now()) / 1000)));
    }
    const gap = Date.now() - lastCallAt;
    if (gap < 5000) await new Promise(r => setTimeout(r, 5000 - gap));
    lastCallAt = Date.now();
    let lastErr = 'unknown';
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => ({}));
        if (res.ok) return j;
        lastErr = String((j && j.error && j.error.message) || res.status);
        if (isQuotaLike(lastErr)) {
          quotaCooldownUntil = Date.now() + 120000;
          break;
        }
        if (!isOverloadLike(lastErr)) break; // 400/401/404...: retrying is pointless
      } catch (e) {
        // Network failure: transient → retry
        lastErr = String((e && e.message) || e);
      }
      if (i < tries - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
    throw new Error(friendlyGeminiError(lastErr));
  }
  async function callGemini(key, userText, wantJson) {
    const model = await getModel();
    const body = {
      systemInstruction: { parts: [{ text: 'أنت مساعد إنتاجية داخل إضافة مهام. التزم بالتنسيق المطلوب حرفياً.' }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    };
    if (wantJson) body.generationConfig.responseMimeType = 'application/json';
    const j = await geminiFetch(ep(key, model), body);
    const parts = ((((j.candidates || [])[0] || {}).content || {}).parts) || [];
    const txt = parts.map(p => p.text || '').join('').trim();
    if (!wantJson) return txt;
    const clean = txt.replace(/^```json/i, '').replace(/^```/, '').replace(/```\s*$/, '').trim();
    return JSON.parse(clean);
  }
  async function testKey(key) {
    const k = key !== undefined ? key : await getKey();
    if (!k) throw new Error('اكتب المفتاح الأول');
    const out = await callGemini(k, 'رد بكلمة واحدة فقط: تم', false);
    if (!out) throw new Error('رد فارغ — حاول تاني');
    return true;
  }
  async function enhanceTask(title) {
    const key = await getKey();
    if (!key) throw new Error('حط مفتاح Gemini الأول من تاب حسابي');
    const prompt = 'المهمة: "' + String(title).slice(0, 200) + '"\n' +
      'أخرج JSON بهذا الشكل بالضبط (قيم عربية، مفاتيح إنجليزية): ' +
      '{"title":"عنوان محسن قصير","description":"وصف عملي سطرين","subtasks":["خطوة 1","خطوة 2","خطوة 3"],"priority":"urgent|high|medium|low","estMinutes":30,"tags":["وسم"]}';
    return callGemini(key, prompt, true);
  }
  // Fills the open task modal for REVIEW — never auto-saves.
  async function enhanceModal() {
    const titleEl = $('modalTitle');
    const title = titleEl ? titleEl.value.trim() : '';
    if (!title) { say('⚠️ اكتب عنوان المهمة الأول'); if (titleEl) titleEl.focus(); return; }
    if (!(await getKey())) { say('⚠️ حط مفتاح Gemini الأول (تاب حسابي ← ذكاء اصطناعي)'); return; }
    say('✨ جاري التحسين...');
    try {
      const d = await enhanceTask(title);
      if (d.title) titleEl.value = String(d.title).slice(0, 120);
      const de = $('modalDesc');
      if (de && d.description) de.value = String(d.description).slice(0, 500);
      const pr = $('modalPriority');
      if (pr && ['urgent', 'high', 'medium', 'low'].includes(d.priority)) pr.value = d.priority;
      const es = $('modalEst');
      if (es && d.estMinutes) es.value = Math.max(0, parseInt(d.estMinutes, 10) || 0);
      const tg = $('modalTags');
      if (tg && Array.isArray(d.tags)) tg.value = d.tags.slice(0, 5).map(x => String(x).slice(0, 20)).join('، ');
      const sb = $('modalSubs');
      if (sb && Array.isArray(d.subtasks)) sb.value = d.subtasks.slice(0, 8).map(s => String(s).slice(0, 80)).join('\n');
      say('✨ اتحسنت — راجع واحفظ 💾');
    } catch (e) { const m = String((e && e.message) || e); say(/^[⏳⚠️✅❌]/.test(m) ? m.slice(0, 140) : '❌ ' + m.slice(0, 120)); }
  }
  async function refreshStatus() {
    try {
      const st = $('aiKeyStatus'), inp = $('aiKeyInput'), mdl = $('aiModelInput');
      if (!st) return;
      const k = await getKey();
      const m = await getModel();
      if (inp && document.activeElement !== inp) inp.value = k ? '••••••••' + String(k).slice(-4) : '';
      if (inp && !k) inp.value = '';
      if (mdl && document.activeElement !== mdl && !mdl.value) mdl.value = m;
      st.textContent = k ? '✅ المفتاح محفوظ على هذا الجهاز (' + m + ')' : 'مفيش مفتاح — هاته من aistudio.google.com';
    } catch (e) {}
  }
  function bindAI() {
    const sv = $('btnAiSave'), ts = $('btnAiTest'), dl = $('btnAiDel');
    if (sv) sv.addEventListener('click', async () => {
      const inp = $('aiKeyInput'), mdl = $('aiModelInput');
      const v = inp ? inp.value.trim() : '';
      const m = mdl ? mdl.value.trim() : '';
      if (m) await setModel(m);
      if (!v || v.startsWith('••••')) {
        if (m) { refreshStatus(); say('💾 اتحفظ الموديل'); }
        else say('⚠️ اكتب المفتاح كاملاً الأول');
        return;
      }
      await setKey(v);
      if (inp) inp.value = '';
      refreshStatus();
      say('💾 اتحفظ المفتاح على جهازك');
    });
    if (ts) ts.addEventListener('click', async () => {
      try {
        say('🔍 جاري تجربة المفتاح...');
        const inp = $('aiKeyInput'), mdl = $('aiModelInput');
        if (mdl && mdl.value.trim()) await setModel(mdl.value.trim());
        const typed = inp && inp.value.trim() && !inp.value.trim().startsWith('••••') ? inp.value.trim() : null;
        await testKey(typed !== null ? typed : undefined);
        refreshStatus();
        say('✅ المفتاح شغال');
      } catch (e) { const m = String((e && e.message) || e); say(/^[⏳⚠️✅❌]/.test(m) ? m.slice(0, 140) : '❌ ' + m.slice(0, 120)); }
    });
    if (dl) dl.addEventListener('click', async () => {
      if (!confirm('مسح مفتاح Gemini من هذا الجهاز؟')) return;
      await setKey('');
      refreshStatus();
      say('🗑️ اتمسح المفتاح');
    });
    refreshStatus();
  }

  window.TaskfloAI = { getKey, setKey, getModel, setModel, testKey, enhanceTask, enhanceModal, refreshStatus, DEFAULT_MODEL };
  try { bindAI(); } catch (e) {}
})();
