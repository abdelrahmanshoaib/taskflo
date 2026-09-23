// ─── TaskFlo floating assistant (content script, isolated world) ───
// Shows a floating button on any site (when enabled in extension settings).
// Chat uses the locally-stored Gemini key + live tasks from chrome.storage.
// Enable/disable anytime from the extension (⚙️ → المساعد العائم).
(function () {
  'use strict';
  if (window.top !== window.self) return; // top frame only
  if (document.getElementById('taskflo-float-root')) return;

  const MODEL_FALLBACK = 'gemini-3.6-flash';
  const FLOAT_THEMES = {
    grape: 'linear-gradient(135deg,#01939b,#6d28d9)',
    ocean: 'linear-gradient(135deg,#3b82f6,#1565d8)',
    sunset: 'linear-gradient(135deg,#fb923c,#c25100)',
    candy: 'linear-gradient(135deg,#f472b6,#be185d)',
    forest: 'linear-gradient(135deg,#34d399,#1c7a3d)',
    night: 'linear-gradient(135deg,#334155,#0f172a)'
  };
  const FLOAT_ICONS = ['🤖', '✨', '📿', '🚀', '💬', '⭐', '🌙', '🕌'];
  let state = { open: false, busy: false, history: [] };
  let lastFloatCfg = { icon: '🤖', shape: 'circle', theme: 'grape', pos: null };
  let shadow = null, els = {};

  function storeGet(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (r) => resolve(r || {})); }
      catch (e) { resolve({}); }
    });
  }
  function storeSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve()); }
      catch (e) { resolve(); }
    });
  }
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function todayKey(d) {
    d = d || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
  }

  // ─── Context: live data for the AI ───
  function buildContext(data) {
    const tasks = Array.isArray(data.tasks) ? data.tasks.filter(t => !t.archived) : [];
    const k = todayKey();
    const iso = new Date().toISOString().slice(0, 10);
    const open = tasks.filter(t => !t.done);
    const today = open.filter(t => t.due === k || (t.scheduledAt || '').slice(0, 10) === k).slice(0, 10);
    const overdue = open.filter(t => t.due && t.due < k).slice(0, 10);
    const lines = [];
    lines.push('مهام اليوم (' + today.length + '): ' + (today.map(t => t.title).join('، ') || 'لا يوجد'));
    lines.push('متأخرة (' + overdue.length + '): ' + (overdue.map(t => t.title).join('، ') || 'لا يوجد'));
    lines.push('إجمالي المفتوحة: ' + open.length);
    try {
      const dn = ((data.settings || {}).deen) || {};
      const deeds = Array.isArray(dn.deeds) ? dn.deeds : [];
      if (deeds.length) {
        const log = dn.deedLog || {};
        const parts = deeds.slice(0, 6).map(d => {
          const v = ((log[d.id] || {})[k]) || 0;
          return d.name + '=' + (d.kind === 'check' ? (v ? 'تم' : 'لم يتم') : v);
        });
        lines.push('أعمال البر اليوم: ' + parts.join('، '));
      }
      const pd = data.prayerDone || {};
      const ptk = pd[k] || {};
      const doneP = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].filter(n => ptk[n]);
      lines.push('صلوات اليوم المنجزة: ' + doneP.length + '/5');
    } catch (e) {}
    void iso;
    return lines.join('\n');
  }
  function systemPrompt(ctx) {
    return 'أنت «مساعد TaskFlow» — صديق مصري خفيف الظل ومشجع، تتكلم عامية مصرية مهذبة باختصار.\n' +
      'مهامك: تذكير المستخدم بمهامه، تشجيعه بحماس، والهزار الخفيف أحياناً.\n' +
      'بيانات المستخدم الحية:\n' + ctx + '\n' +
      'قواعد صارمة:\n' +
      '1) الرد قصير (سطرين max) إلا لو طلب تفصيل.\n' +
      '2) لو طلب إضافة مهمة/مهام: اكتب ردك عادي، ثم أضف كتلة JSON في سطر منفصل لكل مهمة بهذا الشكل بالضبط:\n' +
      '```task {"title":"العنوان","due":"YYYY-MM-DD أو فارغ","priority":"urgent|high|medium|low"}\n' +
      '3) لا تدّعي أفعالاً خارج إضافة المهام (لا إيميلات ولا حجز).\n' +
      '4) لو سأل عن مهامه استخدم البيانات فوق ولا تخترع مهاماً.';
  }

  // ─── Task protocol: ```task {...} blocks → saved into the system ───
  function parseTaskBlocks(text) {
    const out = [];
    const re = /```task\s*([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      try {
        const o = JSON.parse(m[1]);
        if (o && o.title) {
          out.push({
            title: String(o.title).slice(0, 120),
            due: /^\d{4}-\d{2}-\d{2}$/.test(o.due || '') ? o.due : '',
            priority: ['urgent', 'high', 'medium', 'low'].includes(o.priority) ? o.priority : 'medium'
          });
        }
      } catch (e) { /* skip malformed block */ }
    }
    return out;
  }
  async function addTaskToSystem(t) {
    const r = await storeGet(['tasks']);
    const tasks = Array.isArray(r.tasks) ? r.tasks : [];
    tasks.unshift({
      id: uid(), title: t.title, description: '', project: '', priority: t.priority,
      status: 'todo', done: false, startDate: '', due: t.due, reminder: '', repeat: 'none',
      estMinutes: 0, spentSeconds: 0, tags: [], subtasks: [], planCat: t.due ? 'should' : 'should',
      archived: false, scheduledAt: '', routineId: '', note: 'من المساعد العائم 🤖',
      activity: [{ at: new Date().toISOString(), action: 'إضافة عبر الشات العائم' }],
      createdAt: new Date().toISOString()
    });
    await storeSet({ tasks });
    return true;
  }

  function friendlyGeminiError(em) {
    em = String(em || '');
    if (/high demand|overloaded|UNAVAILABLE/i.test(em) || /\b503\b/.test(em)) return '⏳ ضغط عالي على جوجل دلوقتي — استنى دقيقة وحاول تاني ⏳';
    if (/quota|RESOURCE_EXHAUSTED/i.test(em) || /\b429\b/.test(em)) return '⚠️ حصة الاستخدام خلصت مؤقتاً — استنى شوية وحاول تاني';
    return '❌ ' + em.slice(0, 100);
  }
  async function geminiFetch(url, body, tries) {
    tries = tries || 3;
    let lastErr = 'unknown';
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await res.json().catch(() => ({}));
        if (res.ok) return j;
        lastErr = String((j && j.error && j.error.message) || res.status);
        if (!/overloaded|high demand|UNAVAILABLE|503|429|RESOURCE_EXHAUSTED|rate|quota/i.test(lastErr)) break;
      } catch (e) {
        lastErr = String((e && e.message) || e);
      }
      if (i < tries - 1) await new Promise(r => setTimeout(r, 1500 * (i + 1)));
    }
    throw new Error(friendlyGeminiError(lastErr));
  }
  async function callGemini(key, model, messages) {
    const j = await geminiFetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + (model || MODEL_FALLBACK) + ':generateContent?key=' + encodeURIComponent(key),
      {
        systemInstruction: { parts: [{ text: systemPrompt(messages._ctx || '') }] },
        contents: messages.list,
        generationConfig: { temperature: 0.8, maxOutputTokens: 500 }
      }
    );
    const parts = ((((j.candidates || [])[0] || {}).content || {}).parts) || [];
    return parts.map(p => p.text || '').join('').trim();
  }

  // ─── UI (Shadow DOM — isolated from page styles) ───
  const CSS = [
    ':host{all:initial}',
    '.tf-bubble{position:fixed;bottom:20px;left:20px;width:56px;height:56px;border-radius:50%;border:none;cursor:grab;touch-action:none;z-index:2147483647;',
    'background:linear-gradient(135deg,#01939b,#6d28d9);color:#fff;font-size:26px;',
    'box-shadow:0 8px 24px rgba(1,105,111,.45);display:flex;align-items:center;justify-content:center;}',
    '.tf-bubble:hover{transform:scale(1.08)}',
    '.tf-bubble.dragging{cursor:grabbing;transform:scale(1.05);opacity:.92}',
    '.tf-panel{position:fixed;bottom:88px;left:20px;width:320px;max-height:440px;z-index:2147483647;',
    'background:#fff;color:#1d2733;border-radius:16px;box-shadow:0 16px 48px rgba(0,0,0,.3);',
    'display:none;flex-direction:column;overflow:hidden;font-family:sans-serif;}',
    '.tf-panel.open{display:flex}',
    '.tf-head{background:linear-gradient(135deg,#01939b,#6d28d9);color:#fff;padding:10px 12px;font-weight:700;font-size:13px;display:flex;align-items:center;gap:8px}',
    '.tf-head button{margin-right:auto;background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:8px;width:24px;height:24px;cursor:pointer}',
    '.tf-msgs{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:8px;min-height:180px;max-height:280px}',
    '.tf-msg{padding:8px 10px;border-radius:12px;font-size:12.5px;line-height:1.7;max-width:88%}',
    '.tf-bot{background:#eef2f7;color:#1d2733;align-self:flex-start}',
    '.tf-user{background:linear-gradient(135deg,#01939b,#01696f);color:#fff;align-self:flex-end}',
    '.tf-chips{display:flex;gap:6px;padding:0 10px 8px;flex-wrap:wrap}',
    '.tf-chip{border:1px solid #cbd5e1;background:#f8fafc;border-radius:99px;padding:4px 10px;font-size:11px;cursor:pointer}',
    '.tf-chip:hover{background:#e0f2f1}',
    '.tf-input{display:flex;gap:6px;padding:10px;border-top:1px solid #e5e7eb}',
    '.tf-input input{flex:1;border:1px solid #cbd5e1;border-radius:10px;padding:8px;font-size:12.5px;outline:none;font-family:inherit}',
    '.tf-input button{background:linear-gradient(135deg,#01939b,#01696f);color:#fff;border:none;border-radius:10px;padding:8px 14px;cursor:pointer;font-weight:700}',
    '.tf-typing{font-size:11px;color:#888;padding:0 10px 6px}'
  ].join('\n');

  function inject() {
    if (document.getElementById('taskflo-float-root')) return;
    const host = document.createElement('div');
    host.id = 'taskflo-float-root';
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = CSS;
    shadow.appendChild(st);
    const bubble = document.createElement('button');
    bubble.className = 'tf-bubble';
    bubble.textContent = '🤖';
    bubble.title = 'مساعد TaskFlow';
    const panel = document.createElement('div');
    panel.className = 'tf-panel';
    panel.innerHTML =
      '<div class="tf-head"><span>🤖 مساعد TaskFlow</span><button data-x>✕</button></div>' +
      '<div class="tf-msgs"></div><div class="tf-typing" style="display:none">بيكتب...</div>' +
      '<div class="tf-chips">' +
      '<button class="tf-chip" data-q="tasks">📋 مهامي النهاردة؟</button>' +
      '<button class="tf-chip" data-q="cheer">💪 شجعني</button>' +
      '<button class="tf-chip" data-q="add">➕ مهمة جديدة</button></div>' +
      '<div class="tf-input"><input placeholder="اكتب هنا..." /><button data-send>إرسال</button></div>';
    shadow.appendChild(bubble);
    shadow.appendChild(panel);
    els = {
      bubble, panel,
      msgs: panel.querySelector('.tf-msgs'),
      typing: panel.querySelector('.tf-typing'),
      input: panel.querySelector('.tf-input input')
    };
    bubble.addEventListener('click', (e) => { e.preventDefault(); });
    // Drag-to-move (click without move toggles the panel)
    let drag = null;
    bubble.addEventListener('pointerdown', (e) => {
      const r = bubble.getBoundingClientRect();
      drag = { x0: e.clientX, y0: e.clientY, l: r.left, t: r.top, moved: false };
      bubble.classList.add('dragging');
      try { bubble.setPointerCapture(e.pointerId); } catch (_) {}
    });
    bubble.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
      if (!drag.moved) return;
      bubble.style.left = Math.max(0, Math.min(window.innerWidth - 60, drag.l + dx)) + 'px';
      bubble.style.top = Math.max(0, Math.min(window.innerHeight - 60, drag.t + dy)) + 'px';
      bubble.style.bottom = 'auto';
    });
    const endDrag = (e) => {
      if (!drag) return;
      const wasDrag = drag.moved;
      // Final position from drag delta (deterministic; doesn't depend on layout reads)
      let fx = null, fy = null;
      if (wasDrag && e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        fx = Math.max(0, Math.min(window.innerWidth - 60, drag.l + (e.clientX - drag.x0)));
        fy = Math.max(0, Math.min(window.innerHeight - 60, drag.t + (e.clientY - drag.y0)));
      }
      drag = null;
      bubble.classList.remove('dragging');
      if (!wasDrag) togglePanel();
      else { positionPanel(); saveFloatPos(fx, fy); }
    };
    bubble.addEventListener('pointerup', endDrag);
    bubble.addEventListener('pointercancel', () => { drag = null; bubble.classList.remove('dragging'); });
    applyFloatStyle();
    panel.querySelector('[data-x]').addEventListener('click', () => {
      state.open = false;
      panel.classList.remove('open');
    });
    panel.querySelector('[data-send]').addEventListener('click', sendInput);
    els.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendInput(); });
    panel.querySelectorAll('[data-q]').forEach(c => c.addEventListener('click', () => {
      const q = c.dataset.q;
      if (q === 'tasks') askAI('فكرني بمهام النهاردة والمتأخرة باختصار');
      else if (q === 'cheer') askAI('شجعني أكمل يومي بحماس');
      else { userSay('عايز أضيف مهمة جديدة'); askAI('عايز أضيف مهمة جديدة — اسألني عن تفاصيلها سؤال واحد مختصر'); }
    }));
  }
  // ─── Appearance + position (customizable from extension settings)
  function applyFloatStyle() {
    if (!els.bubble) return;
    els.bubble.textContent = lastFloatCfg.icon;
    els.bubble.style.background = FLOAT_THEMES[lastFloatCfg.theme] || FLOAT_THEMES.grape;
    els.bubble.style.borderRadius = lastFloatCfg.shape === 'square' ? '18px' : '50%';
    const p = lastFloatCfg.pos;
    if (p && typeof p.left === 'number' && typeof p.top === 'number') {
      els.bubble.style.left = Math.max(0, Math.min(window.innerWidth - 60, p.left)) + 'px';
      els.bubble.style.top = Math.max(0, Math.min(window.innerHeight - 60, p.top)) + 'px';
      els.bubble.style.bottom = 'auto';
    } else {
      els.bubble.style.left = '';
      els.bubble.style.top = '';
      els.bubble.style.bottom = '';
    }
  }
  function positionPanel() {
    if (!els.panel || !els.bubble) return;
    try {
      const r = els.bubble.getBoundingClientRect();
      const pw = 320, ph = Math.min(440, window.innerHeight - 40);
      let left = r.left + r.width / 2 - pw / 2;
      left = Math.max(8, Math.min(window.innerWidth - pw - 8, left));
      let top = r.top - ph - 12;
      if (top < 8) top = r.bottom + 12;
      els.panel.style.left = left + 'px';
      els.panel.style.right = 'auto';
      els.panel.style.top = top + 'px';
      els.panel.style.bottom = 'auto';
      els.panel.style.maxHeight = ph + 'px';
    } catch (e) {}
  }
  function togglePanel() {
    if (!els.panel) return;
    state.open = !state.open;
    els.panel.classList.toggle('open', state.open);
    if (state.open) {
      positionPanel();
      if (!els.msgs.children.length) {
        botSay('أهلاً بيك يا بطل! 👋 أنا معاك — عايز تفتكر مهامك، تتشجع، ولا نضيف مهمة جديدة؟');
      }
      loadHistory();
    }
  }
  async function saveFloatPos(fx, fy) {
    try {
      const r = await storeGet(['settings']);
      const s = r.settings || {};
      s.chatFloat = s.chatFloat || {};
      let left = fx, top = fy;
      if (left === null || left === undefined || top === null || top === undefined) {
        const b = els.bubble.getBoundingClientRect();
        left = Math.round(b.left); top = Math.round(b.top);
      }
      s.chatFloat.pos = { left: Math.round(left), top: Math.round(top) };
      await storeSet({ settings: s });
    } catch (e) {}
  }
  function removeUI() {
    const host = document.getElementById('taskflo-float-root');
    if (host) host.remove();
    shadow = null;
    els = {};
  }
  function botSay(html) {
    if (!els.msgs) return;
    const d = document.createElement('div');
    d.className = 'tf-msg tf-bot';
    d.textContent = html;
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    pushHist('bot', html);
  }
  function userSay(text) {
    const d = document.createElement('div');
    d.className = 'tf-msg tf-user';
    d.textContent = text;
    els.msgs.appendChild(d);
    els.msgs.scrollTop = els.msgs.scrollHeight;
    pushHist('user', text);
  }
  function pushHist(role, text) {
    state.history.push({ role, text: String(text).slice(0, 500), at: Date.now() });
    if (state.history.length > 30) state.history = state.history.slice(-30);
    storeSet({ chatHistory: state.history });
  }
  async function loadHistory() {
    try {
      const r = await storeGet(['chatHistory']);
      const h = Array.isArray(r.chatHistory) ? r.chatHistory.slice(-6) : [];
      h.forEach(m => {
        const d = document.createElement('div');
        d.className = 'tf-msg ' + (m.role === 'user' ? 'tf-user' : 'tf-bot');
        d.textContent = m.text;
        els.msgs.appendChild(d);
      });
      if (h.length) els.msgs.scrollTop = els.msgs.scrollHeight;
    } catch (e) {}
  }
  function sendInput() {
    const v = els.input.value.trim();
    if (!v || state.busy) return;
    els.input.value = '';
    userSay(v);
    askAI(v);
  }
  async function askAI(text) {
    if (state.busy) return;
    state.busy = true;
    if (els.typing) els.typing.style.display = '';
    try {
      const data = await storeGet(['geminiKey', 'geminiModel', 'tasks', 'settings', 'prayerDone']);
      if (!data.geminiKey) {
        botSay('⚠️ حط مفتاح Gemini الأول من الإكستنشن (تاب حسابي ← ذكاء اصطناعي) وأنا جاهز.');
        return;
      }
      const ctx = buildContext(data);
      const hist = state.history.slice(-8).map(m => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
      const reply = await callGemini(data.geminiKey, data.geminiModel || MODEL_FALLBACK, { _ctx: ctx, list: hist.concat([{ role: 'user', parts: [{ text }] }]) });
      const visible = String(reply || '').replace(/```task[\s\S]*?```/g, '').trim() || 'تمام 👍';
      botSay(visible);
      const blocks = parseTaskBlocks(reply || '');
      for (const b of blocks.slice(0, 3)) {
        await addTaskToSystem(b);
        botSay('✅ اتسجلت: ' + b.title);
      }
    } catch (e) {
      const m = String((e && e.message) || e);
      botSay(/^[⏳⚠️✅❌]/.test(m) ? m.slice(0, 140) : '❌ ' + m.slice(0, 120));
    } finally {
      state.busy = false;
      if (els.typing) els.typing.style.display = 'none';
    }
  }

  // ─── Boot: respect the extension toggle (live via storage listener) ───
  // Test hook (isolated world only, invisible to pages): window.__tfFloat
  try { window.__tfFloat = { ask: askAI, sync: syncVisibility, state, ui: () => els, cfg: () => lastFloatCfg }; } catch (e) {}
  async function syncVisibility() {
    try {
      const r = await storeGet(['settings']);
      const cf = (r.settings && r.settings.chatFloat) || {};
      lastFloatCfg = {
        icon: FLOAT_ICONS.includes(cf.icon) ? cf.icon : '🤖',
        shape: cf.shape === 'square' ? 'square' : 'circle',
        theme: FLOAT_THEMES[cf.theme] ? cf.theme : 'grape',
        pos: cf.pos || null
      };
      const on = !!cf.on;
      const exists = !!document.getElementById('taskflo-float-root');
      if (on && !exists) inject();
      else if (!on && exists) removeUI();
      else if (on && exists) applyFloatStyle();
    } catch (e) {}
  }
  try {
    syncVisibility();
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((chg, area) => {
        if (area === 'local' && chg.settings) syncVisibility();
      });
    }
  } catch (e) {}
})();
