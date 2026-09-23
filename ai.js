// ─── Taskflo Gemini AI (local key, REST, MV3-safe, modular) ───
// SECURITY: the key lives in chrome.storage.local under 'geminiKey' ONLY.
// It is deliberately NOT inside `settings`, so it never syncs to Firestore
// and never enters file/clipboard backups. Never logged, never toasted.
(function () {
  const MODEL = 'gemini-2.0-flash';
  function ep(key) {
    return 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(key);
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
  async function callGemini(key, userText, wantJson) {
    const body = {
      systemInstruction: { parts: [{ text: 'أنت مساعد إنتاجية داخل إضافة مهام. التزم بالتنسيق المطلوب حرفياً.' }] },
      contents: [{ parts: [{ text: userText }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 800 }
    };
    if (wantJson) body.generationConfig.responseMimeType = 'application/json';
    const res = await fetch(ep(key), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      const em = String((j && j.error && j.error.message) || res.status);
      if (/API_KEY_INVALID|API key not valid/i.test(em)) throw new Error('المفتاح غير صالح — انسخه تاني من AI Studio');
      throw new Error('Gemini رد بخطأ: ' + em.slice(0, 100));
    }
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
    } catch (e) { say('❌ ' + String((e && e.message) || e).slice(0, 120)); }
  }
  async function refreshStatus() {
    try {
      const st = $('aiKeyStatus'), inp = $('aiKeyInput');
      if (!st) return;
      const k = await getKey();
      if (inp && document.activeElement !== inp) inp.value = k ? '••••••••' + String(k).slice(-4) : '';
      if (inp && !k) inp.value = '';
      st.textContent = k ? '✅ المفتاح محفوظ على هذا الجهاز' : 'مفيش مفتاح — هاته من aistudio.google.com';
    } catch (e) {}
  }
  function bindAI() {
    const sv = $('btnAiSave'), ts = $('btnAiTest'), dl = $('btnAiDel');
    if (sv) sv.addEventListener('click', async () => {
      const inp = $('aiKeyInput');
      const v = inp ? inp.value.trim() : '';
      if (!v || v.startsWith('••••')) { say('⚠️ اكتب المفتاح كاملاً الأول'); return; }
      await setKey(v);
      if (inp) inp.value = '';
      refreshStatus();
      say('💾 اتحفظ المفتاح على جهازك');
    });
    if (ts) ts.addEventListener('click', async () => {
      try {
        say('🔍 جاري تجربة المفتاح...');
        const inp = $('aiKeyInput');
        const typed = inp && inp.value.trim() && !inp.value.trim().startsWith('••••') ? inp.value.trim() : null;
        await testKey(typed !== null ? typed : undefined);
        say('✅ المفتاح شغال');
      } catch (e) { say('❌ ' + String((e && e.message) || e).slice(0, 120)); }
    });
    if (dl) dl.addEventListener('click', async () => {
      if (!confirm('مسح مفتاح Gemini من هذا الجهاز؟')) return;
      await setKey('');
      refreshStatus();
      say('🗑️ اتمسح المفتاح');
    });
    refreshStatus();
  }

  window.TaskfloAI = { getKey, setKey, testKey, enhanceTask, enhanceModal, refreshStatus };
  try { bindAI(); } catch (e) {}
})();
