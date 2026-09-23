// ─── State (v2) ────────────────────────────────────────
const DB_VERSION = 2;
let tasks = [], projects = ['عام'], projectMeta = {};
let appointments = [], goals = [], focusSessions = [], routines = [];
let pomoDuration = 25 * 60;
let pomoRemaining = pomoDuration, pomoRunning = false, pomoInterval = null;
let pomoMode = 'work', pomoSessionsToday = 0, pomoSessionsTotal = 0;
let pomoTaskId = '', pomoState = null;
let currentFilter = 'all', isDark = false, editId = null, editApptId = null;
let searchQ = '', fStatusV = '', fPriorityV = '', fProjectV = '', sortV = 'created';
let calCursor = new Date(), calView = 'week';
let settings = { dark: false, work: 25, short: 5, long: 15, auto: false, sound: true, overdueNotify: true };
let prayerCache = null, prayerDone = {}, prayerData = null, prayerTimer = null, prayerScheduledKey = '';
let adsCache = { at: 0, items: [] };
const MODES = { work: 25*60, short: 5*60, long: 15*60 };
const MODE_LABELS = { work: 'وقت العمل', short: 'استراحة قصيرة', long: 'استراحة كبيرة' };
const PRI_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRI_AR = { urgent: 'عاجلة 🔥', high: 'عالية 🔴', medium: 'عادي 🟡', low: 'منخفضة 🟢' };
const STATUS_AR = { todo: 'To Do 📝', inprogress: 'In Progress 🚧', completed: 'Completed ✅', blocked: 'Blocked ⛔' };
const PLAN_AR = { must: 'Must 🔥', should: 'Should', could: 'Could', scheduled: 'Scheduled 📅' };
// Project templates (reusable & customizable)
const TEMPLATES = {
  marketing: { name: '🚀 حملة تسويقية', steps: ['أبحاث السوق', 'تطوير الاستراتيجية', 'تخطيط المحتوى', 'التصميم', 'المراجعة', 'النشر', 'التقرير'] },
  launch: { name: '📦 إطلاق منتج', steps: ['تحديد المتطلبات', 'التصميم', 'التطوير', 'الاختبار', 'الإطلاق التجريبي', 'الإطلاق الرسمي', 'المتابعة'] },
  study: { name: '📚 خطة مذاكرة', steps: ['جمع المصادر', 'جدولة الدروس', 'مذاكرة + تلخيص', 'حل تدريبات', 'مراجعة نهائية', 'اختبار تجريبي'] }
};
// ─── AI-ready stub (modular, no external calls, review-before-save) ───
const TF_AI = {
  // Heuristic NL parser: returns a draft task; caller MUST show modal for review.
  parseNaturalInput(text) {
    const t = { title: text.trim(), priority: 'medium', tags: [] };
    if (/عاجل|urgent|ضروري|مهم جداً/i.test(text)) t.priority = 'urgent';
    else if (/مهم|high|أولوية/i.test(text)) t.priority = 'high';
    const d = text.match(/(\d{4}-\d{2}-\d{2})|بكره|غداً|اليوم|today|tomorrow/i);
    if (d) {
      const now = new Date();
      if (/بكره|غداً|tomorrow/i.test(text)) { now.setDate(now.getDate() + 1); t.due = now.toISOString().slice(0, 10); }
      else if (/اليوم|today/i.test(text)) t.due = now.toISOString().slice(0, 10);
      else if (d[1]) t.due = d[1];
    }
    const tagm = text.match(/#(\S+)/g);
    if (tagm) t.tags = tagm.map(x => x.slice(1));
    return t;
  }
};

// ─── Storage (additive, never destructive) ─────────────────
function save() {
  try {
    chrome.storage.local.set({
      dbVersion: DB_VERSION, tasks, projects, projectMeta,
      appointments, goals, focusSessions, routines, settings,
      prayerCache, prayerDone, adsCache,
      pomoStats: { today: pomoSessionsToday, total: pomoSessionsTotal, day: new Date().toISOString().slice(0, 10) },
      pomoTaskId, pomoState
    });
  } catch(e) { /* dev fallback */ persistDev(); }
  // v2.4: schedule cloud push (debounced, silent if logged out)
  try { if (window.TaskfloSync) window.TaskfloSync.schedulePush(); } catch (_) {}
}
function persistDev() {
  try {
    localStorage.setItem('tf2_tasks', JSON.stringify(tasks));
    localStorage.setItem('tf2_projects', JSON.stringify(projects));
  } catch(e) {}
}
// Non-destructive migration: only ADDS missing fields/keys.
function migrate() {
  const priMap = { normal: 'medium', high: 'high', low: 'low', urgent: 'urgent', medium: 'medium' };
  tasks = (tasks || []).map(t => {
    const n = Object.assign({}, t);
    if (!n.id) n.id = uid();
    if (!n.priority || !PRI_ORDER.hasOwnProperty(n.priority)) n.priority = priMap[n.priority] || 'medium';
    if (!n.status) n.status = n.done ? 'completed' : 'todo';
    n.done = (n.status === 'completed') || !!n.done;
    if (n.description === undefined) n.description = '';
    if (!Array.isArray(n.tags)) n.tags = [];
    if (!Array.isArray(n.subtasks)) n.subtasks = [];
    if (n.estMinutes === undefined) n.estMinutes = 0;
    if (n.spentSeconds === undefined) n.spentSeconds = 0;
    if (n.startDate === undefined) n.startDate = '';
    if (!n.planCat) n.planCat = 'should';
    if (!n.repeat) n.repeat = 'none';
    if (n.archived === undefined) n.archived = false;
    if (!Array.isArray(n.activity)) n.activity = [];
    if (n.scheduledAt === undefined) n.scheduledAt = '';
    if (n.routineId === undefined) n.routineId = '';
    if (!n.createdAt) n.createdAt = new Date().toISOString();
    return n;
  });
  if (!Array.isArray(projects) || !projects.length) projects = ['عام'];
  if (typeof projectMeta !== 'object' || !projectMeta) projectMeta = {};
  if (!Array.isArray(appointments)) appointments = [];
  if (!Array.isArray(goals)) goals = [];
  if (!Array.isArray(routines)) routines = [];
  // v2.3 additive migration: routine stats history + tap mode + health settings
  routines = (routines || []).map(r => {
    const n = Object.assign({}, r);
    if (!n.id) n.id = uid();
    if (!Array.isArray(n.completions)) n.completions = []; // [YYYY-MM-DD]
    if (!Array.isArray(n.tapHistory)) n.tapHistory = [];   // [ISO]
    if (n.bestStreak === undefined) n.bestStreak = n.streak || 0;
    if (n.tapMode === undefined) n.tapMode = false;
    if (!n.kind) n.kind = n.tapMode ? 'tap' : 'auto';
    if (n.tapMode === true) n.kind = 'tap';
    if (n.tapCount === undefined) n.tapCount = (n.tapHistory || []).length;
    if (n.lastDoneAt === undefined) n.lastDoneAt = '';
    if (!Array.isArray(n.skipDates)) n.skipDates = [];
    if (n.active === undefined) n.active = true;
    return n;
  });
  if (!Array.isArray(focusSessions)) focusSessions = [];
  settings = Object.assign({ dark: false, work: 25, short: 5, long: 15, auto: false, sound: true, overdueNotify: true }, settings || {});
  settings.health = Object.assign({ enabled: false, every: 30 }, (settings && settings.health) || {});
  settings.ui = Object.assign({ accent: 'teal', mode: 'light', glass: 'on', density: 'comfortable', font: 'satoshi', fsize: 'md' }, settings.ui || {});
  settings.tasbih = Object.assign({ on: false, deedId: '' }, settings.tasbih || {});
  settings.notify = Object.assign({ prayer: true, prayerMins: 5, prayerExact: true, tasks: true, overdue: true, sound: true, volume: 80 }, settings.notify || {});
  if (settings.sound === undefined) settings.sound = settings.notify.sound !== false;
  if (settings.volume === undefined) settings.volume = settings.notify.volume;
  if (settings.overdueNotify === undefined) settings.overdueNotify = settings.notify.overdue !== false;
  settings.deen = Object.assign({ adhkarMorning: true, morningTime: '06:30', adhkarEvening: true, eveningTime: '17:30', wird: '', adhkarDone: {}, wirdDone: {}, opens: 0, deeds: [], deedLog: {}, deedPeriod: '30' }, settings.deen || {});
  settings.deen.adhkarDone = settings.deen.adhkarDone || {};
  settings.deen.wirdDone = settings.deen.wirdDone || {};
  settings.prayer = Object.assign({ city: 'Cairo', country: 'Egypt', method: 5 }, (settings || {}).prayer || {});
  if (typeof prayerDone !== 'object' || !prayerDone) prayerDone = {};
}
function load(cb) {
  try {
    chrome.storage.local.get(['dbVersion','tasks','projects','projectMeta','appointments','goals','routines','focusSessions','settings','prayerCache','prayerDone','adsCache','pomoStats','pomoTaskId','pomoState'], r => {
      tasks = r.tasks || [];
      projects = r.projects || ['عام'];
      projectMeta = r.projectMeta || {};
      appointments = r.appointments || [];
      goals = r.goals || [];
      routines = r.routines || [];
      focusSessions = r.focusSessions || [];
      prayerCache = r.prayerCache || null;
      prayerDone = r.prayerDone || {};
      adsCache = r.adsCache || { at: 0, items: [] };
      settings = r.settings || settings;
      const s = r.pomoStats || {};
      pomoSessionsToday = s.today || 0;
      pomoSessionsTotal = s.total || 0;
      pomoTaskId = r.pomoTaskId || '';
      pomoState = r.pomoState || null;
      // Day rollover for "today" counter
      const lastDay = (r.pomoStats && r.pomoStats.day) || '';
      const todayK = new Date().toISOString().slice(0, 10);
      if (lastDay && lastDay !== todayK) pomoSessionsToday = 0;
      migrate();
      isDark = !!settings.dark;
      cb();
    });
  } catch(e) {
    try {
      tasks = JSON.parse(localStorage.getItem('tf2_tasks') || localStorage.getItem('tf_tasks') || '[]');
      projects = JSON.parse(localStorage.getItem('tf2_projects') || localStorage.getItem('tf_projects') || '["عام"]');
    } catch(_) { tasks = []; projects = ['عام']; }
    migrate();
    cb();
  }
}

// ─── Tabs ────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'dashboard') renderDashboard();
    if (t.dataset.tab === 'tasks') renderTasks();
    if (t.dataset.tab === 'table') renderTable();
    if (t.dataset.tab === 'projects') renderProjects();
    if (t.dataset.tab === 'routines') renderRoutines();
    if (t.dataset.tab === 'deen') { renderPrayer(); renderDeenExtras(); renderDeeds(); renderTasbihCard(); }
    if (t.dataset.tab === 'calendar') renderCalendar();
    if (t.dataset.tab === 'goals') renderGoals();
    if (t.dataset.tab === 'pomodoro') renderPomoExtras();
    if (t.dataset.tab === 'account' && typeof renderAccount === 'function') renderAccount();
    if (t.dataset.tab === 'account' && window.TaskfloAI) { try { window.TaskfloAI.refreshStatus(); } catch (e) {} }
    if (t.dataset.tab === 'admin' && window.renderAdminUsers) { try { window.renderAdminUsers(); } catch (e) {} if (window.renderAdminAds) { try { window.renderAdminAds(); } catch (e) {} } }
  });
});
// Global keyboard shortcuts: / search, n new task, Esc close
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeModal(); closeApptModal(); closeSettings(); if (typeof closeRoutineDetail === 'function') closeRoutineDetail(); }
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === '/') { e.preventDefault(); switchTab('tasks'); const s = document.getElementById('searchInput'); if (s) s.focus(); }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openModal(); }
});
function switchTab(name) {
  const btn = document.querySelector('.tab[data-tab="' + name + '"]');
  if (btn) btn.click();
}
const dashAccBtn = document.getElementById('dashAccBtn');
if (dashAccBtn) dashAccBtn.addEventListener('click', () => switchTab('account'));
const btnAiEnhance = document.getElementById('btnAiEnhance');
if (btnAiEnhance) btnAiEnhance.addEventListener('click', () => {
  try { if (window.TaskfloAI) window.TaskfloAI.enhanceModal(); } catch (e) {}
});
// Prayer location settings
const prayerSaveBtn = document.getElementById('prayerSave');
if (prayerSaveBtn) prayerSaveBtn.addEventListener('click', async () => {
  settings.prayer = settings.prayer || {};
  const ci = document.getElementById('prayerCity'), co = document.getElementById('prayerCountry'), me = document.getElementById('prayerMethod');
  if (ci && ci.value.trim()) settings.prayer.city = ci.value.trim();
  if (co && co.value.trim()) settings.prayer.country = co.value.trim();
  if (me) settings.prayer.method = parseInt(me.value, 10) || 5;
  save();
  toast('🕌 حُفظت المدينة — جاري جلب المواقيت');
  try { await fetchPrayerTimings(true); schedulePrayerAlarms(); } catch (e) { toast('⚠️ تعذر الجلب — تحقق من اسم المدينة'); }
  renderPrayer(true);
});
// Deen buttons (adhkar + wird)
const adhkarMBtn = document.getElementById('adhkarMorningDone');
if (adhkarMBtn) adhkarMBtn.addEventListener('click', () => toggleAdhkarDone('morning'));
const adhkarEBtn = document.getElementById('adhkarEveningDone');
if (adhkarEBtn) adhkarEBtn.addEventListener('click', () => toggleAdhkarDone('evening'));
const adhkarMOn = document.getElementById('adhkarMorningOn');
if (adhkarMOn) adhkarMOn.addEventListener('change', () => { settings.deen.adhkarMorning = adhkarMOn.checked; save(); scheduleAdhkar(); renderDeenExtras(); });
const adhkarEOn = document.getElementById('adhkarEveningOn');
if (adhkarEOn) adhkarEOn.addEventListener('change', () => { settings.deen.adhkarEvening = adhkarEOn.checked; save(); scheduleAdhkar(); renderDeenExtras(); });
const adhkarMAt = document.getElementById('adhkarMorningAt');
if (adhkarMAt) adhkarMAt.addEventListener('change', () => { settings.deen.morningTime = adhkarMAt.value || '06:30'; save(); scheduleAdhkar(); renderDeenExtras(); });
const adhkarEAt = document.getElementById('adhkarEveningAt');
if (adhkarEAt) adhkarEAt.addEventListener('change', () => { settings.deen.eveningTime = adhkarEAt.value || '17:30'; save(); scheduleAdhkar(); renderDeenExtras(); });
const wirdSaveBtn = document.getElementById('wirdSave');
if (wirdSaveBtn) wirdSaveBtn.addEventListener('click', () => {
  const gi = document.getElementById('wirdGoal');
  settings.deen.wird = gi ? gi.value.trim() : '';
  save(); renderDeenExtras();
  toast('📖 حُفظ هدف الورد');
});
const wirdDoneBtn = document.getElementById('wirdDoneBtn');
if (wirdDoneBtn) wirdDoneBtn.addEventListener('click', () => {
  try {
    settings.deen.wirdDone = settings.deen.wirdDone || {};
    const k = prayerDateKey();
    settings.deen.wirdDone[k] = !settings.deen.wirdDone[k];
    save(); renderDeenExtras();
    if (settings.deen.wirdDone[k]) toast('📖 تقبل الله وردك 🤍');
  } catch (e) {}
});
// Deeds wiring (templates + add + period)
document.querySelectorAll('[data-deed-tpl]').forEach(b => {
  b.addEventListener('click', () => {
    const t = DEED_TPL[b.dataset.deedTpl];
    if (!t) return;
    if (getDeeds().some(d => d.name === t.name && d.kind === t.kind)) { toast('موجود بالفعل 🤲'); return; }
    addDeed(t.name, t.kind, t.goal, t.unit);
  });
});
const addDeedBtn = document.getElementById('addDeedBtn');
if (addDeedBtn) addDeedBtn.addEventListener('click', () => {
  const ni = document.getElementById('newDeedName');
  const ki = document.getElementById('newDeedKind');
  const gi = document.getElementById('newDeedGoal');
  const un = document.getElementById('newDeedUnit');
  if (addDeed(ni ? ni.value : '', ki ? ki.value : 'check', gi ? gi.value : 0, un ? un.value.trim() : '')) {
    if (ni) ni.value = '';
    if (gi) gi.value = '';
    if (un) un.value = '';
  }
});
const newDeedName = document.getElementById('newDeedName');
if (newDeedName) newDeedName.addEventListener('keydown', e => { if (e.key === 'Enter' && addDeedBtn) addDeedBtn.click(); });
const deedPeriodRow = document.getElementById('deedPeriodRow');
if (deedPeriodRow) deedPeriodRow.addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.deen.deedPeriod = b.dataset.period;
  save(); renderDeeds();
});
// External tasbih mode wiring
const tasbihOn = document.getElementById('tasbihOn');
if (tasbihOn) tasbihOn.addEventListener('change', () => {
  settings.tasbih = settings.tasbih || {};
  settings.tasbih.on = tasbihOn.checked;
  const d = tasbihDeed();
  if (tasbihOn.checked && d) settings.tasbih.deedId = d.id;
  save(); renderTasbihCard();
  toast(tasbihOn.checked ? '📿 وضع التسبيح شغال — سبّح من أي مكان' : '📿 وضع التسبيح متوقف');
});
const tasbihDeedSel = document.getElementById('tasbihDeed');
if (tasbihDeedSel) tasbihDeedSel.addEventListener('change', () => {
  settings.tasbih = settings.tasbih || {};
  settings.tasbih.deedId = tasbihDeedSel.value;
  save(); renderTasbihCard();
});

// ─── Toast ─────────────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ─── Theme + customization (persisted) ────────────────
function applyTheme() { document.body.toggleAttribute('data-dark', isDark); }
function applyUI() {
  const ui = settings.ui || {};
  isDark = ui.mode === 'dark';
  settings.dark = isDark;
  applyTheme();
  document.body.setAttribute('data-accent', ui.accent || 'teal');
  document.body.setAttribute('data-glass', ui.glass || 'on');
  document.body.setAttribute('data-density', ui.density || 'comfortable');
  document.querySelectorAll('#accentRow .swatch').forEach(s => s.classList.toggle('active', s.dataset.accent === (ui.accent || 'teal')));
  document.querySelectorAll('#modeRow .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === (ui.mode || 'light')));
  document.querySelectorAll('#glassRow .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.glass === (ui.glass || 'on')));
  document.querySelectorAll('#densityRow .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.density === (ui.density || 'comfortable')));
  document.body.setAttribute('data-font', ui.font || 'satoshi');
  document.body.setAttribute('data-fsize', ui.fsize || 'md');
  document.querySelectorAll('#fontRow .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.font === (ui.font || 'satoshi')));
  document.querySelectorAll('#sizeRow .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.fsize === (ui.fsize || 'md')));
  applyNotifyUI();
}
// ─── Notifications settings UI ─────────────────────────
function applyNotifyUI() {
  try {
    const n = (settings && settings.notify) || {};
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
    set('ntPrayer', n.prayer !== false);
    set('ntPrayerExact', n.prayerExact !== false);
    set('ntTasks', n.tasks !== false);
    set('ntOverdue', settings.overdueNotify !== false && n.overdue !== false);
    set('ntSound', settings.sound !== false && n.sound !== false);
    const mins = document.getElementById('ntPrayerMins');
    if (mins) mins.value = String([0, 5, 10, 15].includes(Number(n.prayerMins)) ? Number(n.prayerMins) : 5);
    const vol = document.getElementById('ntVolume');
    if (vol) vol.value = settings.volume !== undefined ? settings.volume : 80;
  } catch (e) {}
}
function bindNotifyUI() {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('change', () => { fn(el); save(); }); };
  on('ntPrayer', el => { settings.notify.prayer = el.checked; prayerScheduledKey = ''; schedulePrayerAlarms(); toast(el.checked ? '🔔 تذكير الصلاة شغال' : '🔕 تذكير الصلاة متوقف'); });
  on('ntPrayerExact', el => { settings.notify.prayerExact = el.checked; prayerScheduledKey = ''; schedulePrayerAlarms(); });
  on('ntTasks', el => { settings.notify.tasks = el.checked; toast(el.checked ? '🔔 تذكيرات المهام شغالة' : '🔕 تذكيرات المهام متوقفة'); });
  on('ntOverdue', el => { settings.notify.overdue = el.checked; settings.overdueNotify = el.checked; });
  on('ntSound', el => { settings.notify.sound = el.checked; settings.sound = el.checked; if (el.checked) playBeep(); });
  on('ntVolume', el => { settings.volume = Number(el.value) || 0; settings.notify.volume = settings.volume; });
  const mins = document.getElementById('ntPrayerMins');
  if (mins) mins.addEventListener('change', () => { settings.notify.prayerMins = Number(mins.value) || 0; prayerScheduledKey = ''; schedulePrayerAlarms(); save(); });
  const tst = document.getElementById('ntTestSound');
  if (tst) tst.addEventListener('click', () => playBeep());
}
document.getElementById('btnTheme').addEventListener('click', () => {
  settings.ui = settings.ui || {};
  settings.ui.mode = isDark ? 'light' : 'dark';
  applyUI(); save();
  toast(isDark ? '🌙 الوضع الداكن' : '☀️ الوضع الفاتح');
});
// Customization modal
function openSettings() {
  applyUI();
  document.getElementById('settingsModal').classList.add('open');
}
function closeSettings() { document.getElementById('settingsModal').classList.remove('open'); }
document.getElementById('btnSettings').addEventListener('click', openSettings);
document.getElementById('settingsClose').addEventListener('click', closeSettings);
document.getElementById('settingsModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeSettings(); });
document.getElementById('accentRow').addEventListener('click', e => {
  const b = e.target.closest('.swatch');
  if (!b) return;
  settings.ui.accent = b.dataset.accent;
  applyUI(); save();
});
document.getElementById('modeRow').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.ui.mode = b.dataset.mode;
  applyUI(); save();
});
document.getElementById('glassRow').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.ui.glass = b.dataset.glass;
  applyUI(); save();
});
document.getElementById('densityRow').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.ui.density = b.dataset.density;
  applyUI(); save();
});
document.getElementById('fontRow').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.ui.font = b.dataset.font;
  applyUI(); save();
  toast('🔤 خط ' + b.textContent.trim());
});
document.getElementById('sizeRow').addEventListener('click', e => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  settings.ui.fsize = b.dataset.fsize;
  applyUI(); save();
});

// ─── Filter chips (original behavior kept) ─────────────
document.getElementById('filterRow').addEventListener('click', e => {
  if (!e.target.dataset.filter) return;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  currentFilter = e.target.dataset.filter;
  renderTasks();
});
// ─── Search + advanced filters ─────────────────────────
const searchInput = document.getElementById('searchInput');
if (searchInput) searchInput.addEventListener('input', e => { searchQ = e.target.value.trim(); renderTasks(); });
[['fStatus','fStatusV'],['fPriority','fPriorityV'],['fProject','fProjectV'],['sortBy','sortV']].forEach(([id]) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', () => {
    fStatusV = document.getElementById('fStatus').value;
    fPriorityV = document.getElementById('fPriority').value;
    fProjectV = document.getElementById('fProject').value;
    sortV = document.getElementById('sortBy').value;
    renderTasks();
  });
});
function refreshFilterProjects() {
  const sel = document.getElementById('fProject');
  if (!sel) return;
  const cur = fProjectV;
  sel.innerHTML = '<option value="">المشروع: الكل</option>';
  projects.forEach(p => {
    const o = document.createElement('option'); o.value = p; o.textContent = p;
    sel.appendChild(o);
  });
  sel.value = cur || '';
}
// ─── AI draft (review-before-save: prefills modal) ─────
function aiDraftFrom(text) {
  const src = (text || '').trim();
  if (!src) { toast('اكتب نصاً أولاً ✨'); return; }
  const d = TF_AI.parseNaturalInput(src);
  openModal();
  document.getElementById('modalTitle').value = d.title.replace(/#\S+/g, '').trim() || d.title;
  document.getElementById('modalPriority').value = d.priority;
  if (d.due) document.getElementById('modalDue').value = d.due;
  if (d.tags.length) document.getElementById('modalTags').value = d.tags.join('، ');
  toast('✨ راجع المسودة قبل الحفظ');
}
const aiBtn = document.getElementById('aiDraftBtn');
if (aiBtn) aiBtn.addEventListener('click', () => aiDraftFrom(searchInput ? searchInput.value : ''));

// ─── Quick add ───────────────────────────────────────
document.getElementById('quickAdd').addEventListener('keydown', e => {
  if (e.key === 'Enter') quickAdd();
});
document.getElementById('quickAddBtn').addEventListener('click', quickAdd);

function quickAdd() {
  const inp = document.getElementById('quickAdd');
  const title = inp.value.trim();
  if (!title) return;
  addTask({ title, project: '', priority: 'medium', status: 'todo', due: '', reminder: '', note: '' });
  inp.value = '';
  toast('✅ تمت الإضافة');
}
// Dashboard quick add (+ global add button opens full modal)
const dashQ = document.getElementById('dashQuickAdd');
function dashAdd() {
  const title = dashQ.value.trim();
  if (!title) return;
  addTask({ title, project: '', priority: 'medium', status: 'todo', due: todayStr(), reminder: '', note: '' });
  dashQ.value = '';
  toast('✅ أُضيفت لمهام اليوم');
}
if (dashQ) {
  dashQ.addEventListener('keydown', e => { if (e.key === 'Enter') dashAdd(); });
  document.getElementById('dashQuickAddBtn').addEventListener('click', dashAdd);
}

// ─── Modal ───────────────────────────────────────────
document.getElementById('btnAddTask').addEventListener('click', openModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('taskModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});
document.getElementById('modalSave').addEventListener('click', saveModal);

function openModal(taskData) {
  editId = taskData && taskData.id ? taskData.id : null;
  populateProjectSelect();
  document.getElementById('taskModalTitle').textContent = editId ? '✏️ تعديل المهمة' : '➕ إضافة مهمة جديدة';
  const g = id => document.getElementById(id);
  g('modalTitle').value = taskData && taskData.title ? taskData.title : '';
  g('modalDesc').value = taskData && taskData.description ? taskData.description : '';
  g('modalProject').value = taskData && taskData.project ? taskData.project : '';
  g('modalPriority').value = taskData && taskData.priority ? taskData.priority : 'medium';
  g('modalStatus').value = taskData && taskData.status ? taskData.status : (taskData && taskData.done ? 'completed' : 'todo');
  g('modalPlan').value = taskData && taskData.planCat ? taskData.planCat : 'should';
  g('modalStart').value = taskData && taskData.startDate ? taskData.startDate : '';
  g('modalDue').value = taskData && taskData.due ? taskData.due : '';
  g('modalReminder').value = taskData && taskData.reminder ? taskData.reminder : '';
  g('modalRepeat').value = taskData && taskData.repeat ? taskData.repeat : 'none';
  g('modalEst').value = taskData && taskData.estMinutes ? taskData.estMinutes : '';
  g('modalTags').value = taskData && taskData.tags ? taskData.tags.join('، ') : '';
  g('modalSubs').value = taskData && taskData.subtasks ? taskData.subtasks.map(s => (s.done ? '[x] ' : '') + s.title).join('\n') : '';
  g('modalNote').value = taskData && taskData.note ? taskData.note : '';
  document.getElementById('taskModal').classList.add('open');
  setTimeout(() => g('modalTitle').focus(), 50);
}

function closeModal() {
  document.getElementById('taskModal').classList.remove('open');
  editId = null;
}

function saveModal() {
  const g = id => document.getElementById(id);
  const title = g('modalTitle').value.trim();
  if (!title) { g('modalTitle').focus(); toast('⚠️ العنوان مطلوب'); return; }
  // Merge subtasks: preserve done-state where title matches
  const oldSubs = editId ? ((tasks.find(x => x.id === editId) || {}).subtasks || []) : [];
  const subs = g('modalSubs').value.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
    const m = line.match(/^\[x\]\s*(.*)$/i);
    const titleS = m ? m[1] : line;
    const prev = oldSubs.find(s => s.title === titleS);
    return { id: prev ? prev.id : uid(), title: titleS, done: m ? true : (prev ? !!prev.done : false) };
  });
  const data = {
    title,
    description: g('modalDesc').value.trim(),
    project: g('modalProject').value,
    priority: g('modalPriority').value,
    status: g('modalStatus').value,
    planCat: g('modalPlan').value,
    startDate: g('modalStart').value,
    due: g('modalDue').value,
    reminder: g('modalReminder').value,
    repeat: g('modalRepeat').value,
    estMinutes: Math.max(0, parseInt(g('modalEst').value, 10) || 0),
    tags: g('modalTags').value.split(/[،,]/).map(s => s.trim()).filter(Boolean),
    subtasks: subs,
    note: g('modalNote').value
  };
  data.done = (data.status === 'completed');
  if (editId) {
    // FIX: previously edit never saved / rendered / rescheduled. Now it does.
    const t = tasks.find(x => x.id === editId);
    if (t) {
      const oldRem = t.reminder;
      Object.assign(t, data);
      logActivity(t, 'تعديل المهمة');
      clearReminder(t.id);
      if (t.reminder) setReminder(t);
      else if (oldRem) clearReminder(t.id);
    }
    save(); renderAll();
    toast('💾 تم حفظ التعديل');
  } else {
    addTask(data);
    toast('✅ تمت إضافة المهمة');
  }
  closeModal();
}

function populateProjectSelect() {
  const sel = document.getElementById('modalProject');
  sel.innerHTML = '<option value="">— بدون مشروع —</option>';
  projects.forEach(p => {
    const o = document.createElement('option');
    o.value = p; o.textContent = p;
    sel.appendChild(o);
  });
}

// ─── Tasks CRUD (extended, backward-compatible) ────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function logActivity(t, action) {
  t.activity = t.activity || [];
  t.activity.unshift({ at: new Date().toISOString(), action: String(action).slice(0, 120) });
  if (t.activity.length > 20) t.activity.length = 20;
}
function addTask(data) {
  const task = Object.assign(
    { id: uid(), done: false, status: 'todo', description: '', tags: [], subtasks: [], estMinutes: 0, spentSeconds: 0, startDate: '', planCat: 'should', repeat: 'none', archived: false, activity: [], scheduledAt: '', createdAt: new Date().toISOString() },
    data || {}
  );
  task.done = (task.status === 'completed') || !!task.done;
  logActivity(task, 'إنشاء المهمة');
  tasks.unshift(task);
  if (task.reminder) setReminder(task);
  save();
  renderAll();
  return task;
}

function setTaskDone(t, done) {
  t.done = done;
  t.status = done ? 'completed' : (t.status === 'completed' ? 'todo' : t.status);
  logActivity(t, done ? 'إنجاز المهمة' : 'إعادة فتح المهمة');
  if (done && t.routineId) updateRoutineStreak(t);
  if (done && t.repeat && t.repeat !== 'none' && t.due) {
    // Recurring: spawn next occurrence (no duplicates of the same one)
    const nxt = new Date(t.due + 'T12:00:00');
    if (t.repeat === 'daily') nxt.setDate(nxt.getDate() + 1);
    if (t.repeat === 'weekly') nxt.setDate(nxt.getDate() + 7);
    if (t.repeat === 'monthly') nxt.setMonth(nxt.getMonth() + 1);
    const copy = Object.assign({}, t, {
      id: uid(), done: false, status: 'todo',
      due: nxt.toISOString().slice(0, 10), reminder: '',
      subtasks: (t.subtasks || []).map(s => ({ id: uid(), title: s.title, done: false })),
      activity: [], createdAt: new Date().toISOString()
    });
    logActivity(copy, 'تكرار تلقائي من مهمة سابقة');
    tasks.unshift(copy);
  }
  save(); renderAll();
}
function toggleTask(id) {
  const t = tasks.find(x => x.id === id);
  if (t) setTaskDone(t, !t.done);
}
function setTaskStatus(id, status) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.status = status;
  t.done = (status === 'completed');
  logActivity(t, 'الحالة → ' + (STATUS_AR[status] || status));
  save(); renderAll();
}

function deleteTask(id) {
  clearReminder(id);
  tasks = tasks.filter(x => x.id !== id);
  save(); renderAll();
}
function duplicateTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  const copy = Object.assign({}, JSON.parse(JSON.stringify(t)), {
    id: uid(), title: t.title + ' (نسخة)', done: false, status: 'todo',
    reminder: '', activity: [], createdAt: new Date().toISOString()
  });
  logActivity(copy, 'نسخة مكررة');
  tasks.unshift(copy);
  save(); renderAll();
  toast('📄 تم تكرار المهمة');
}
function archiveTask(id, arch) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.archived = !!arch;
  logActivity(t, arch ? 'أرشفة' : 'استعادة من الأرشيف');
  if (arch) clearReminder(id);
  save(); renderAll();
  toast(arch ? '🗄️ أُرشفت المهمة' : '♻️ استُعيدت المهمة');
}
function logTime(id, minutes) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.spentSeconds = (t.spentSeconds || 0) + Math.max(1, minutes) * 60;
  logActivity(t, 'تسجيل وقت +' + minutes + 'د');
  save(); renderAll();
}

function setReminder(task) {
  if (!task.reminder) return;
  try { if (settings.notify && settings.notify.tasks === false) return; } catch (e) {}
  const when = new Date(task.reminder).getTime();
  if (when > Date.now()) {
    try {
      chrome.runtime.sendMessage({ type: 'SET_ALARM', name: 'reminder_' + task.id, when });
    } catch(e) {}
  }
}
function clearReminder(id) {
  try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'reminder_' + id }); } catch(e) {}
}
// Clear BOTH pomo alarms (FIX: break_end was never cleared)
function clearPomoAlarms() {
  try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'pomodoro_end' }); } catch(e) {}
  try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'break_end' }); } catch(e) {}
}
function snoozeReminder(id, minutes) {
  try { chrome.runtime.sendMessage({ type: 'SNOOZE', name: 'reminder_' + id, minutes: minutes || 10 }); } catch(e) {}
  toast('😴 غفوة ' + (minutes || 10) + ' دقائق');
}
function renderAll() {
  renderDashboard(); renderTasks(); renderTable(); renderProjects(); renderRoutines(); renderDeenExtras(); renderDeeds(); renderTasbihCard(); renderCalendar(); renderGoals(); renderPomoExtras();
  refreshAdminVisibility();
}
// Admin tab visibility: shown only for the admin account (UI convenience;
// real access control is request.auth.uid in firestore.rules).
async function refreshAdminVisibility() {
  try {
    let show = false;
    if (window.TaskfloSync && window.TaskfloSync.isAdmin) show = await window.TaskfloSync.isAdmin();
    const btn = document.getElementById('tabAdmin');
    const panel = document.getElementById('panel-admin');
    if (btn) btn.style.display = show ? '' : 'none';
    if (panel && !show && panel.classList.contains('active')) {
      panel.classList.remove('active');
      switchTab('dashboard');
    }
    // NOTE: user list fetches only on tab open / refresh button (not here) to save quota.
  } catch (e) {}
}

// ─── Task filter helpers (v2) ──────────────────────────
function todayStr(off) {
  const d = new Date();
  if (off) d.setDate(d.getDate() + off);
  return d.toISOString().slice(0, 10);
}
function isOverdue(t) { return !t.done && !t.archived && t.due && t.due < todayStr(); }
function isToday(t) { return !t.archived && (t.due === todayStr() || (t.scheduledAt && t.scheduledAt.slice(0, 10) === todayStr())); }
function fmtMins(mins) {
  mins = Math.round(mins);
  if (mins < 60) return mins + 'د';
  return Math.floor(mins / 60) + 'س ' + (mins % 60 ? (mins % 60) + 'د' : '');
}
function applyTaskFilters(list) {
  let out = list.slice();
  if (currentFilter === 'active') out = out.filter(t => !t.done && !t.archived);
  else if (currentFilter === 'done') out = out.filter(t => t.done && !t.archived);
  else if (currentFilter === 'high') out = out.filter(t => (t.priority === 'high' || t.priority === 'urgent') && !t.archived);
  else if (currentFilter === 'overdue') out = out.filter(isOverdue);
  else if (currentFilter === 'archived') out = out.filter(t => t.archived);
  else out = out.filter(t => !t.archived);
  if (fStatusV) out = out.filter(t => t.status === fStatusV);
  if (fPriorityV) out = out.filter(t => t.priority === fPriorityV);
  if (fProjectV) out = out.filter(t => t.project === fProjectV);
  if (searchQ) {
    const q = searchQ.toLowerCase();
    out = out.filter(t => (t.title + ' ' + (t.description || '') + ' ' + (t.note || '') + ' ' + (t.tags || []).join(' ')).toLowerCase().includes(q));
  }
  out.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    if (sortV === 'due') {
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
    }
    if (sortV === 'priority') return ((PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2)) || String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  return out;
}
function statusBadge(t) {
  if (t.done || t.status === 'completed') return '<span class="badge badge-done-ok">✅ منجزة</span>';
  if (t.status === 'inprogress') return '<span class="badge badge-progress">🚧 جارية</span>';
  if (t.status === 'blocked') return '<span class="badge badge-blocked">⛔ معلقة</span>';
  return '<span class="badge badge-todo">📝 To Do</span>';
}
function priBadge(t) {
  if (t.priority === 'urgent') return '<span class="badge badge-urgent">🔥 عاجلة</span>';
  if (t.priority === 'high') return '<span class="badge badge-high">🔴 عالية</span>';
  if (t.priority === 'low') return '<span class="badge" style="background:var(--surface);border:1px solid var(--border);color:var(--muted)">🟢 منخفضة</span>';
  return '';
}
// ─── Render Tasks ────────────────────────────────────
function renderTasks() {
  const list = document.getElementById('tasksList');
  const filtered = applyTaskFilters(tasks);

  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <p>${searchQ ? 'لا نتائج مطابقة للبحث' : 'لا توجد مهام هنا — أضف أول مهمة ✨'}</p>
    </div>`;
    return;
  }

  list.innerHTML = '';
  // Group: active first, done last
  const active = filtered.filter(t => !t.done);
  const done = filtered.filter(t => t.done);

  if (active.length) {
    if (done.length) {
      const lbl = document.createElement('div');
      lbl.className = 'section-label'; lbl.textContent = 'قيد التنفيذ (' + active.length + ')';
      list.appendChild(lbl);
    }
    active.forEach(t => list.appendChild(makeTaskEl(t)));
  }
  if (done.length) {
    const lbl = document.createElement('div');
    lbl.className = 'section-label'; lbl.textContent = 'منجزة (' + done.length + ')';
    list.appendChild(lbl);
    done.forEach(t => list.appendChild(makeTaskEl(t)));
  }
}

function makeTaskEl(t) {
  const div = document.createElement('div');
  div.className = 'task-item' + (t.done ? ' done' : '');
  div.innerHTML = `
    <div class="task-check" data-id="${t.id}">
      ${t.done ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
    </div>
    <div class="task-body">
      <div class="task-title">${escHtml(t.title)}</div>
      ${t.description ? `<div style="font-size:11px;color:var(--muted);margin-top:2px">${escHtml(t.description)}</div>` : ''}
      <div class="task-meta">
        ${statusBadge(t)}
        ${priBadge(t)}
        ${t.project ? `<span class="badge badge-project">📁 ${escHtml(t.project)}</span>` : ''}
        ${t.due ? `<span class="badge badge-due">📅 ${t.due}${isOverdue(t) ? ' ⚠️' : ''}</span>` : ''}
        ${t.scheduledAt ? `<span class="badge" style="background:#e8eaf6;color:#3949ab">🧱 ${formatDT(t.scheduledAt)}</span>` : ''}
        ${t.reminder ? `<span class="badge rem-badge" data-id="${t.id}" title="اضغط للغفوة 10د" style="background:var(--primary-hi);color:var(--primary);cursor:pointer">⏰ ${formatDT(t.reminder)}</span>` : ''}
        ${(t.tags || []).map(tag => `<span class="tag-chip">#${escHtml(tag)}</span>`).join('')}
        ${t.estMinutes ? `<span class="tag-chip">⏳ ${fmtMins(t.estMinutes)}${(t.spentSeconds ? ' / ⏱ ' + fmtMins(Math.round(t.spentSeconds / 60)) : '')}</span>` : ((t.spentSeconds) ? `<span class="tag-chip">⏱ ${fmtMins(Math.round(t.spentSeconds / 60))}</span>` : '')}
        ${(t.subtasks || []).length ? `<span class="tag-chip">☑ ${(t.subtasks || []).filter(s => s.done).length}/${(t.subtasks || []).length}</span>` : ''}
        ${t.repeat && t.repeat !== 'none' ? '<span class="tag-chip">🔁</span>' : ''}
        ${t.routineId ? '<span class="tag-chip">🔁 روتين</span>' : ''}
        ${t.archived ? '<span class="badge badge-arch">🗄 مؤرشفة</span>' : ''}
      </div>
      ${(t.subtasks || []).length ? `<div class="sub-list">${(t.subtasks || []).map(s => `<label class="sub-row${s.done ? ' done' : ''}"><input type="checkbox" data-sub="${s.id}" ${s.done ? 'checked' : ''} /><span>${escHtml(s.title)}</span></label>`).join('')}</div>` : ''}
    </div>
    <div class="task-actions">
      <button class="task-act-btn pomo-link" data-id="${t.id}" title="🍅 بومودورو لهذه المهمة">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg>
      </button>
      <button class="task-act-btn sched-link" data-id="${t.id}" title="🧱 جدولة (Time Block)">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      </button>
      <button class="task-act-btn edit-btn" data-id="${t.id}" title="تعديل">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="task-act-btn dup-btn" data-id="${t.id}" title="تكرار المهمة">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      </button>
      <button class="task-act-btn arch-btn" data-id="${t.id}" title="أرشفة/استعادة">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
      </button>
      <button class="task-act-btn del del-btn" data-id="${t.id}" title="حذف">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
      </button>
    </div>`;

  div.querySelector('.task-check').addEventListener('click', () => toggleTask(t.id));
  div.querySelector('.edit-btn').addEventListener('click', () => openModal(t));
  div.querySelector('.dup-btn').addEventListener('click', () => duplicateTask(t.id));
  div.querySelector('.arch-btn').addEventListener('click', () => archiveTask(t.id, !t.archived));
  const pomoBtn = div.querySelector('.pomo-link');
  if (pomoBtn) pomoBtn.addEventListener('click', () => startPomoForTask(t.id));
  const schedBtn = div.querySelector('.sched-link');
  if (schedBtn) schedBtn.addEventListener('click', () => openApptModal(null, t.id));
  div.querySelector('.del-btn').addEventListener('click', () => {
    if (confirm('حذف هذه المهمة؟')) deleteTask(t.id);
  });
  const rem = div.querySelector('.rem-badge');
  if (rem) rem.addEventListener('click', () => snoozeReminder(t.id, 10));
  div.querySelectorAll('[data-sub]').forEach(cb => {
    cb.addEventListener('change', () => {
      const s = (t.subtasks || []).find(x => x.id === cb.dataset.sub);
      if (s) { s.done = cb.checked; logActivity(t, 'تشيك فرعي: ' + s.title); save(); renderAll(); }
    });
  });
  return div;
}

// ─── Render Table ─────────────────────────────────────
function renderTable() {
  const body = document.getElementById('tableBody');
  if (!tasks.length) {
    body.innerHTML = '<div class="empty-state" style="padding:20px"><p>لا توجد مهام بعد</p></div>';
    return;
  }
  body.innerHTML = '';
  [...tasks].sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    return 0;
  }).forEach(t => {
    const row = document.createElement('div');
    row.className = 'table-row' + (t.done ? ' done-row' : '');
    const dotColor = t.done ? 'var(--success)' : t.priority === 'urgent' ? '#d92d20' : t.priority === 'high' ? 'var(--error)' : 'var(--primary)';
    row.innerHTML = `
      <span class="tr-title">
        <span class="status-dot" style="background:${dotColor}"></span>
        ${escHtml(t.title)}${t.status === 'blocked' ? ' ⛔' : ''}${t.status === 'inprogress' ? ' 🚧' : ''}
      </span>
      <span style="color:var(--muted);font-size:11px">${escHtml(t.project || '—')}</span>
      <span style="color:var(--muted);font-size:11px">${t.due || '—'}</span>
      <button class="task-act-btn del-btn" data-id="${t.id}" style="opacity:0.6">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
      </button>`;
    row.querySelector('.del-btn').addEventListener('click', () => {
      if (confirm('حذف؟')) { deleteTask(t.id); renderTable(); }
    });
    body.appendChild(row);
  });
}

// ─── Render Projects ──────────────────────────────────
function renderProjects() {
  const list = document.getElementById('projectsList');
  if (!projects.length) {
    list.innerHTML = '<div class="empty-state"><p>لا توجد مشاريع</p></div>';
    return;
  }
  list.innerHTML = '';
  projects.forEach(p => {
    const pTasks = tasks.filter(t => t.project === p && !t.archived);
    const doneCnt = pTasks.filter(t => t.done).length;
    const pct = pTasks.length ? Math.round(doneCnt / pTasks.length * 100) : 0;
    const meta = projectMeta[p] || {};
    const cTodo = pTasks.filter(t => t.status === 'todo' && !t.done).length;
    const cProg = pTasks.filter(t => t.status === 'inprogress').length;
    const cBlock = pTasks.filter(t => t.status === 'blocked').length;
    const focusMin = Math.round(focusSessions.filter(s => s.project === p).reduce((a, s) => a + (s.minutes || 0), 0));
    const card = document.createElement('div');
    card.className = 'project-card';
    card.innerHTML = `
      <div class="project-header">
        <div>
          <div class="project-name">📁 ${escHtml(p)}</div>
          <div class="project-count">${pTasks.length} مهمة · ${doneCnt} منجزة${focusMin ? ' · ⏱ ' + fmtMins(focusMin) : ''}</div>
          ${meta.desc ? `<div class="project-count">${escHtml(meta.desc)}</div>` : ''}
          ${meta.deadline ? `<div class="project-count">🎯 ${meta.deadline}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;font-weight:700;color:var(--primary)">${pct}%</span>
          ${p !== 'عام' ? `<button class="task-act-btn del-proj" title="حذف المشروع" style="opacity:0.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
        </div>
      </div>
      <div class="project-bar-bg">
        <div class="project-bar-fill" style="width:${pct}%"></div>
      </div>
      <div class="kanban-mini" title="todo / progress / blocked / done">
        <div style="flex:${cTodo};background:var(--faint)"></div>
        <div style="flex:${cProg};background:var(--warning)"></div>
        <div style="flex:${cBlock};background:var(--error)"></div>
        <div style="flex:${doneCnt};background:var(--success)"></div>
      </div>
      <div style="display:flex;gap:6px;margin-top:8px">
        <button class="mini-btn view-proj">عرض المهام</button>
        <button class="mini-btn meta-proj">⚙️ بيانات</button>
      </div>`;
    const delBtn = card.querySelector('.del-proj');
    if (delBtn) {
      delBtn.addEventListener('click', () => {
        if (confirm('حذف المشروع "' + p + '"؟\nسيتم إزالته من المهام أيضاً.')) {
          projects = projects.filter(x => x !== p);
          delete projectMeta[p];
          tasks.forEach(t => { if (t.project === p) t.project = ''; });
          save(); renderAll();
        }
      });
    }
    card.querySelector('.view-proj').addEventListener('click', () => {
      fProjectV = p;
      const sel = document.getElementById('fProject');
      if (sel) sel.value = p;
      switchTab('tasks');
    });
    card.querySelector('.meta-proj').addEventListener('click', () => {
      const desc = prompt('وصف المشروع "' + p + '":', (projectMeta[p] || {}).desc || '');
      if (desc === null) return;
      const dl = prompt('الموعد النهائي (YYYY-MM-DD):', (projectMeta[p] || {}).deadline || '');
      if (dl === null) return;
      projectMeta[p] = Object.assign({}, projectMeta[p], { desc: desc.trim(), deadline: (dl || '').trim() });
      save(); renderAll();
      toast('⚙️ حُفظت بيانات المشروع');
    });
    list.appendChild(card);
  });
}

// ─── Add Project (+ meta + templates) ────────────────
function refreshTemplateSelect() {
  const sel = document.getElementById('templateSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">📦 قالب جاهز...</option>';
  Object.keys(TEMPLATES).forEach(k => {
    const o = document.createElement('option');
    o.value = k; o.textContent = TEMPLATES[k].name;
    sel.appendChild(o);
  });
  const gp = document.getElementById('newGoalProject');
  if (gp) {
    const cur = gp.value;
    gp.innerHTML = '<option value="">ربط بمشروع...</option>';
    projects.forEach(p => {
      const o = document.createElement('option'); o.value = p; o.textContent = p;
      gp.appendChild(o);
    });
    gp.value = cur || '';
  }
  const ap = document.getElementById('apptProject');
  if (ap) {
    const cur2 = ap.value;
    ap.innerHTML = '<option value="">—</option>';
    projects.forEach(p => {
      const o = document.createElement('option'); o.value = p; o.textContent = p;
      ap.appendChild(o);
    });
    ap.value = cur2 || '';
  }
}
document.getElementById('addProjectBtn').addEventListener('click', () => {
  const inp = document.getElementById('newProjectName');
  const name = inp.value.trim();
  if (!name) return;
  if (!projects.includes(name)) {
    projects.push(name);
    projectMeta[name] = {
      desc: document.getElementById('projDesc').value.trim(),
      deadline: document.getElementById('projDeadline').value
    };
    save();
    toast('📁 تم إنشاء المشروع');
  }
  inp.value = '';
  document.getElementById('projDesc').value = '';
  document.getElementById('projDeadline').value = '';
  renderAll();
});
document.getElementById('newProjectName').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('addProjectBtn').click();
});
document.getElementById('applyTemplateBtn').addEventListener('click', () => {
  const key = document.getElementById('templateSelect').value;
  if (!key || !TEMPLATES[key]) { toast('اختر قالباً أولاً 📦'); return; }
  let name = prompt('اسم المشروع الجديد من القالب "' + TEMPLATES[key].name + '":', TEMPLATES[key].name.replace(/^[^\s]+\s/, ''));
  if (!name) return;
  name = name.trim();
  if (!projects.includes(name)) { projects.push(name); projectMeta[name] = { desc: 'من قالب: ' + TEMPLATES[key].name, deadline: '' }; }
  TEMPLATES[key].steps.forEach((s, i) => {
    tasks.unshift({
      id: uid(), title: s, description: '', project: name, priority: i < 2 ? 'high' : 'medium',
      status: 'todo', done: false, startDate: '', due: '', reminder: '', repeat: 'none',
      estMinutes: 0, spentSeconds: 0, tags: [], subtasks: [], planCat: 'should',
      archived: false, scheduledAt: '', note: '', activity: [{ at: new Date().toISOString(), action: 'من قالب جاهز' }],
      createdAt: new Date().toISOString()
    });
  });
  save(); renderAll();
  toast('📦 طُبّق القالب (' + TEMPLATES[key].steps.length + ' مهام)');
});

// ─── Pomodoro (v2: custom durations + task link + recovery)
const circumference = 2 * Math.PI * 68; // r=68
function currentModeSecs() {
  if (pomoMode === 'work') return Math.max(1, settings.work || 25) * 60;
  if (pomoMode === 'short') return Math.max(1, settings.short || 5) * 60;
  return Math.max(1, settings.long || 15) * 60;
}
function setPomoModeUI() {
  document.querySelectorAll('.pomo-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === pomoMode));
  document.getElementById('pomoLabel').textContent = MODE_LABELS[pomoMode];
  const w = settings.work || 25, s = settings.short || 5, l = settings.long || 15;
  const btns = document.querySelectorAll('.pomo-mode-btn');
  if (btns[0]) btns[0].textContent = '🍅 عمل (' + w + 'د)';
  if (btns[1]) btns[1].textContent = '☕ استراحة (' + s + 'د)';
  if (btns[2]) btns[2].textContent = '🛌 كبيرة (' + l + 'د)';
}
document.querySelectorAll('.pomo-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (pomoRunning) return;
    document.querySelectorAll('.pomo-mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    pomoMode = btn.dataset.mode;
    pomoRemaining = currentModeSecs();
    pomoDuration = pomoRemaining;
    pomoState = null;
    clearInterval(pomoInterval);
    pomoRunning = false;
    document.getElementById('pomoStart').textContent = '▶ ابدأ';
    document.getElementById('pomoLabel').textContent = MODE_LABELS[pomoMode];
    updatePomoDisplay(); save();
  });
});
function persistPomoState() {
  if (pomoRunning && pomoMode === 'work') {
    pomoState = { mode: pomoMode, endsAt: Date.now() + pomoRemaining * 1000, total: pomoDuration, taskId: pomoTaskId };
  } else if (pomoRunning) {
    pomoState = { mode: pomoMode, endsAt: Date.now() + pomoRemaining * 1000, total: pomoDuration, taskId: '' };
  } else pomoState = null;
  save();
}
function playBeep(volOverride) {
  if (!settings.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const vol = Math.min(100, Math.max(0, (volOverride !== undefined ? volOverride : (settings.volume !== undefined ? settings.volume : 80)))) / 100;
    if (vol <= 0) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; o.type = 'sine';
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.05 + vol * 0.5, ctx.currentTime + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start(); o.stop(ctx.currentTime + 0.65);
  } catch(e) {}
}

document.getElementById('pomoStart').addEventListener('click', () => {
  if (!pomoRunning) {
    pomoRunning = true;
    document.getElementById('pomoStart').textContent = '⏸ إيقاف';
    pomoInterval = setInterval(tick, 1000);
    // Set alarm (survives popup close)
    try {
      chrome.runtime.sendMessage({
        type: 'SET_ALARM',
        name: pomoMode === 'work' ? 'pomodoro_end' : 'break_end',
        when: Date.now() + pomoRemaining * 1000
      });
    } catch(e) {}
    persistPomoState();
  } else {
    pomoRunning = false;
    clearInterval(pomoInterval);
    document.getElementById('pomoStart').textContent = '▶ استأنف';
    clearPomoAlarms();
    persistPomoState();
  }
});

document.getElementById('pomoReset').addEventListener('click', () => {
  clearInterval(pomoInterval);
  pomoRunning = false;
  pomoRemaining = currentModeSecs();
  pomoDuration = pomoRemaining;
  pomoState = null;
  document.getElementById('pomoStart').textContent = '▶ ابدأ';
  updatePomoDisplay();
  clearPomoAlarms();
  save();
});
// Link pomodoro to a task (time auto-attributed on work completion)
function startPomoForTask(taskId) {
  const t = tasks.find(x => x.id === taskId);
  if (!t) return;
  pomoTaskId = taskId;
  pomoMode = 'work';
  pomoRemaining = currentModeSecs();
  pomoDuration = pomoRemaining;
  pomoState = null;
  clearInterval(pomoInterval);
  pomoRunning = false;
  document.getElementById('pomoStart').textContent = '▶ ابدأ';
  setPomoModeUI(); updatePomoDisplay(); renderPomoExtras(); save();
  switchTab('pomodoro');
  toast('🍅 البومودورو مربوط: ' + t.title.slice(0, 30));
}
function completeWorkSession() {
  const mins = Math.max(1, Math.round(pomoDuration / 60));
  pomoSessionsToday++; pomoSessionsTotal++;
  const linked = tasks.find(x => x.id === pomoTaskId);
  focusSessions.unshift({
    id: uid(), at: new Date().toISOString(), minutes: mins,
    taskId: pomoTaskId || '', project: linked ? (linked.project || '') : '',
    mode: 'work'
  });
  if (focusSessions.length > 100) focusSessions.length = 100;
  if (linked) {
    linked.spentSeconds = (linked.spentSeconds || 0) + pomoDuration;
    logActivity(linked, 'بومودورو +' + mins + 'د');
  }
  playBeep();
  updateSessionDots(); updateStats(); renderPomoExtras(); save();
  if (settings.auto) {
    // Auto-transition to break
    pomoMode = (pomoSessionsToday % 4 === 0) ? 'long' : 'short';
    pomoRemaining = currentModeSecs();
    pomoDuration = pomoRemaining;
    setPomoModeUI(); updatePomoDisplay();
    document.getElementById('pomoStart').click();
    toast('☕ انتقال تلقائي للاستراحة');
  }
}
function tick() {
  if (pomoRemaining <= 0) {
    clearInterval(pomoInterval);
    pomoRunning = false;
    pomoState = null;
    document.getElementById('pomoStart').textContent = '▶ ابدأ';
    if (pomoMode === 'work') completeWorkSession();
    else { playBeep(); updateStats(); save(); }
    pomoRemaining = 0;
    updatePomoDisplay();
    return;
  }
  pomoRemaining--;
  updatePomoDisplay();
}

function updatePomoDisplay() {
  const m = Math.floor(pomoRemaining / 60);
  const s = pomoRemaining % 60;
  document.getElementById('pomoTime').textContent =
    String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  // FIX: ring starts FULL and depletes (was inverted)
  const frac = pomoDuration > 0 ? (pomoRemaining / pomoDuration) : 0;
  const offset = circumference - frac * circumference;
  document.getElementById('pomoProgress').style.strokeDashoffset = offset;
  document.getElementById('pomoProgress').setAttribute('stroke-dasharray', circumference);
}

function updateSessionDots() {
  const cont = document.getElementById('pomoSessions');
  const dots = cont.querySelectorAll('.session-dot');
  // FIX: 0 sessions shows 0 dots (was: 0 → 4 done)
  const count = pomoSessionsToday === 0 ? 0 : (pomoSessionsToday % 4 || 4);
  if (dots.length !== 4) {
    const lbl = cont.querySelector('span');
    cont.innerHTML = '';
    cont.appendChild(lbl || Object.assign(document.createElement('span'), { style:'font-size:11px;color:var(--muted);margin-left:8px', textContent:'الجلسات:' }));
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'session-dot' + (i < count ? ' done' : '');
      cont.appendChild(d);
    }
  } else {
    dots.forEach((d, i) => d.classList.toggle('done', i < count));
  }
}

function updateStats() {
  document.getElementById('statToday').textContent = pomoSessionsToday;
  document.getElementById('statTotal').textContent = pomoSessionsTotal;
}

// ─── Dashboard + Daily Planning ────────────────────────
function dashRow(html, btns) {
  const d = document.createElement('div');
  d.className = 'dash-row';
  d.innerHTML = '<div class="grow">' + html + '</div>';
  (btns || []).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'mini-btn' + (b.go ? ' go' : '');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    d.appendChild(btn);
  });
  return d;
}
// ─── Dashboard account status card (reads TaskfloSync session, no dup auth)
async function renderDashAccount() {
  try {
    if (!document.getElementById('dashAccCard')) return;
    const txt = document.getElementById('dashAccText');
    const sub = document.getElementById('dashAccSub');
    let sess = null;
    try { if (window.TaskfloSync) sess = await window.TaskfloSync.getSession(); } catch (e) {}
    if (sess && sess.email) {
      txt.textContent = '☁️ ' + sess.email;
      sub.textContent = 'مسجل — المزامنة التلقائية شغالة';
    } else {
      txt.textContent = '☁️ الحساب السحابي';
      sub.textContent = 'غير مسجل — الداتا محلية فقط';
    }
  } catch (e) {}
}
function renderDashboard() {
  renderDashAccount();
  renderPrayer();
  renderAds();
  const t = todayStr();
  const open = tasks.filter(x => !x.archived);
  const todays = open.filter(isToday);
  const overdue = open.filter(isOverdue);
  const doneToday = tasks.filter(x => x.done && !x.archived && (x.activity || []).some(a => a.action.indexOf('إنجاز') === 0 && (a.at || '').slice(0, 10) === t));
  const focusMin = Math.round(focusSessions.filter(s => (s.at || '').slice(0, 10) === t).reduce((a, s) => a + (s.minutes || 0), 0));
  const allOpen = open.filter(x => !x.done);
  const pct = open.length ? Math.round(open.filter(x => x.done).length / open.length * 100) : 0;
  document.getElementById('dashDateLabel').textContent =
    'ملخص اليوم — ' + new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('dashProgressFill').style.width = pct + '%';
  const stats = document.getElementById('dashStats');
  stats.innerHTML = '';
  [['📌 مهام اليوم', todays.filter(x => !x.done).length], ['⚠️ متأخرة', overdue.length],
   ['✅ أُنجزت اليوم', doneToday.length], ['⏱ تركيز اليوم', fmtMins(focusMin)]].forEach(([l, v]) => {
    const c = document.createElement('div');
    c.className = 'dash-card';
    c.innerHTML = '<div class="dash-num">' + v + '</div><div class="dash-lbl">' + l + '</div>';
    stats.appendChild(c);
  });
  // Overdue
  const od = document.getElementById('dashOverdue');
  od.innerHTML = '';
  if (!overdue.length) od.appendChild(dashRow('✨ لا مهام متأخرة — يومك نظيف!'));
  overdue.slice(0, 5).forEach(x => {
    od.appendChild(dashRow('⚠️ <b>' + escHtml(x.title) + '</b> <span style="color:var(--muted)">· ' + (x.due || '') + '</span>', [
      { label: 'إنجاز', go: true, onClick: () => setTaskDone(x, true) },
      { label: 'غداً', onClick: () => { x.due = todayStr(1); logActivity(x, 'تأجيل للغد'); save(); renderAll(); } }
    ]));
  });
  // Plan by category
  const plan = document.getElementById('dashPlan');
  plan.innerHTML = '';
  const cats = ['must', 'should', 'could', 'scheduled'];
  let anyPlan = false;
  cats.forEach(c => {
    const items = todays.filter(x => !x.done && (x.planCat || 'should') === c);
    if (!items.length) return;
    anyPlan = true;
    const lbl = document.createElement('div');
    lbl.className = 'section-label';
    lbl.textContent = PLAN_AR[c] + ' (' + items.length + ')';
    plan.appendChild(lbl);
    items.slice(0, 6).forEach(x => {
      const r = dashRow('<b>' + escHtml(x.title) + '</b>' + (x.scheduledAt ? ' <span style="color:var(--muted)">· ' + formatDT(x.scheduledAt) + '</span>' : ''), [
        { label: '✔', go: true, onClick: () => setTaskDone(x, true) }
      ]);
      r.classList.add('plan-cat-' + c);
      plan.appendChild(r);
    });
  });
  if (!anyPlan) plan.appendChild(dashRow('لا خطة بعد — أضف مهمة بتاريخ اليوم 📌'));
  // Upcoming appointments
  const ap = document.getElementById('dashAppts');
  ap.innerHTML = '';
  const upcoming = appointments.filter(a => a.start && a.start.slice(0, 16) >= new Date().toISOString().slice(0, 16)).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 4);
  if (!upcoming.length) ap.appendChild(dashRow('لا مواعيد قادمة 📅'));
  upcoming.forEach(a => {
    ap.appendChild(dashRow('📅 <b>' + escHtml(a.title) + '</b> <span style="color:var(--muted)">· ' + formatDT(a.start) + '</span>', [
      { label: 'عرض', onClick: () => switchTab('calendar') }
    ]));
  });
  // Active projects
  const dp = document.getElementById('dashProjects');
  dp.innerHTML = '';
  const act = projects.filter(p => tasks.some(x => x.project === p && !x.done && !x.archived)).slice(0, 4);
  if (!act.length) dp.appendChild(dashRow('لا مشاريع نشطة 📁'));
  act.forEach(p => {
    const pt = tasks.filter(x => x.project === p && !x.archived);
    const dc = pt.filter(x => x.done).length;
    dp.appendChild(dashRow('📁 <b>' + escHtml(p) + '</b> <span style="color:var(--muted)">· ' + dc + '/' + pt.length + '</span>', [
      { label: 'فتح', onClick: () => { fProjectV = p; const s = document.getElementById('fProject'); if (s) s.value = p; switchTab('tasks'); } }
    ]));
  });
  void allOpen; void doneToday;
}

// ─── Calendar + Appointments ───────────────────────────
function apptEnd(a) { return a.end || a.start; }
function scheduleApptAlarm(a) {
  if (!a.start) return;
  const mins = (a.reminderMin === undefined || a.reminderMin === null) ? 15 : Number(a.reminderMin);
  if (!mins) return;
  const when = new Date(a.start).getTime() - mins * 60000;
  if (when > Date.now()) {
    try { chrome.runtime.sendMessage({ type: 'SET_ALARM', name: 'appt_' + a.id, when }); } catch(e) {}
  }
}
function clearApptAlarm(id) {
  try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'appt_' + id }); } catch(e) {}
}
function openApptModal(appt, linkTaskId) {
  editApptId = appt && appt.id ? appt.id : null;
  const g = id => document.getElementById(id);
  document.getElementById('apptModalTitle').textContent = editApptId ? '✏️ تعديل الموعد' : (linkTaskId ? '🧱 جدولة مهمة (Time Block)' : '📅 موعد جديد');
  g('apptTitle').value = appt ? appt.title : (linkTaskId ? ((tasks.find(x => x.id === linkTaskId) || {}).title || '') : '');
  g('apptDesc').value = appt ? (appt.desc || '') : '';
  g('apptStart').value = appt ? (appt.start || '') : '';
  g('apptEnd').value = appt ? (appt.end || '') : '';
  g('apptLoc').value = appt ? (appt.location || '') : '';
  g('apptRemind').value = appt ? String(appt.reminderMin ?? 15) : '15';
  refreshTemplateSelect();
  const linked = tasks.find(x => x.id === linkTaskId);
  g('apptProject').value = appt ? (appt.project || '') : (linked ? (linked.project || '') : '');
  // task options
  const sel = g('apptTask');
  const cur = appt ? (appt.taskId || '') : (linkTaskId || '');
  sel.innerHTML = '<option value="">— بدون ربط —</option>';
  tasks.filter(x => !x.done && !x.archived).forEach(x => {
    const o = document.createElement('option');
    o.value = x.id; o.textContent = x.title.slice(0, 40);
    sel.appendChild(o);
  });
  sel.value = cur;
  document.getElementById('apptModal').classList.add('open');
  setTimeout(() => g('apptTitle').focus(), 50);
}
function closeApptModal() {
  document.getElementById('apptModal').classList.remove('open');
  editApptId = null;
}
document.getElementById('apptCancel').addEventListener('click', closeApptModal);
document.getElementById('apptModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeApptModal(); });
const btnAddAppt = document.getElementById('btnAddAppt');
if (btnAddAppt) btnAddAppt.addEventListener('click', () => openApptModal(null, ''));
document.getElementById('apptSave').addEventListener('click', () => {
  const g = id => document.getElementById(id);
  const title = g('apptTitle').value.trim();
  const start = g('apptStart').value;
  if (!title) { g('apptTitle').focus(); toast('⚠️ عنوان الموعد مطلوب'); return; }
  if (!start) { g('apptStart').focus(); toast('⚠️ وقت البداية مطلوب'); return; }
  const data = {
    title, desc: g('apptDesc').value.trim(), start,
    end: g('apptEnd').value || start, location: g('apptLoc').value.trim(),
    reminderMin: Number(g('apptRemind').value), project: g('apptProject').value,
    taskId: g('apptTask').value
  };
  if (editApptId) {
    const a = appointments.find(x => x.id === editApptId);
    if (a) { clearApptAlarm(a.id); Object.assign(a, data); scheduleApptAlarm(a); }
    toast('💾 حُفظ الموعد');
  } else {
    const a = Object.assign({ id: uid(), createdAt: new Date().toISOString() }, data);
    appointments.push(a);
    scheduleApptAlarm(a);
    // Time-block link: mark the task scheduled WITHOUT duplicating it
    if (a.taskId) {
      const t = tasks.find(x => x.id === a.taskId);
      if (t) { t.scheduledAt = a.start; t.planCat = 'scheduled'; logActivity(t, 'جدولة time-block: ' + formatDT(a.start)); }
    }
    toast('📅 تم إنشاء الموعد');
  }
  save(); renderAll();
  closeApptModal();
});
function deleteAppt(id) {
  clearApptAlarm(id);
  appointments = appointments.filter(x => x.id !== id);
  save(); renderAll();
  toast('🗑️ حُذف الموعد');
}
document.getElementById('calViewRow').addEventListener('click', e => {
  if (!e.target.dataset.calview) return;
  document.querySelectorAll('#calViewRow .filter-chip').forEach(c => c.classList.remove('active'));
  e.target.classList.add('active');
  calView = e.target.dataset.calview;
  renderCalendar();
});
document.getElementById('calPrev').addEventListener('click', () => { shiftCal(-1); });
document.getElementById('calNext').addEventListener('click', () => { shiftCal(1); });
function shiftCal(dir) {
  if (calView === 'day') calCursor.setDate(calCursor.getDate() + dir);
  else if (calView === 'week') calCursor.setDate(calCursor.getDate() + dir * 7);
  else calCursor.setMonth(calCursor.getMonth() + dir);
  renderCalendar();
}
function dayKey(d) { return d.toISOString().slice(0, 10); }
function eventsOn(dateK) {
  const ev = [];
  tasks.filter(t => !t.archived && !t.done && t.due === dateK).forEach(t => ev.push({ kind: 'task', id: t.id, title: t.title, over: isOverdue(t) }));
  tasks.filter(t => !t.archived && t.scheduledAt && t.scheduledAt.slice(0, 10) === dateK).forEach(t => ev.push({ kind: 'block', id: t.id, title: '🧱 ' + t.title }));
  appointments.filter(a => a.start && a.start.slice(0, 10) === dateK).forEach(a => ev.push({ kind: 'appt', id: a.id, title: '📅 ' + a.title }));
  return ev;
}
function renderCalendar() {
  const grid = document.getElementById('calGrid');
  const title = document.getElementById('calTitle');
  const t = todayStr();
  if (calView === 'day') {
    const k = dayKey(calCursor);
    title.textContent = calCursor.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
    const ev = eventsOn(k);
    grid.innerHTML = '';
    if (!ev.length) grid.innerHTML = '<div class="empty-state"><p>يوم فارغ — جدوِل مهمة 🧱</p></div>';
    ev.forEach(e => {
      const row = document.createElement('div');
      row.className = 'dash-row';
      row.innerHTML = '<div class="grow">' + escHtml(e.title) + '</div>';
      const b = document.createElement('button');
      b.className = 'mini-btn'; b.textContent = 'فتح';
      b.addEventListener('click', () => {
        if (e.kind === 'appt') openApptModal(appointments.find(x => x.id === e.id));
        else { const task = tasks.find(x => x.id === e.id); if (task) openModal(task); }
      });
      row.appendChild(b);
      grid.appendChild(row);
    });
  } else if (calView === 'week') {
    const start = new Date(calCursor);
    start.setDate(start.getDate() - ((start.getDay() + 7 - 6) % 7)); // week starts Saturday (ar-EG)
    title.textContent = 'أسبوع ' + start.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
    grid.innerHTML = '<div class="cal-grid"></div>';
    const g = grid.firstChild;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const k = dayKey(d);
      const cell = document.createElement('div');
      cell.className = 'cal-cell' + (k === t ? ' today' : '');
      cell.innerHTML = '<div class="dnum">' + d.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric' }) + '</div>';
      eventsOn(k).slice(0, 3).forEach(e => {
        const ev = document.createElement('div');
        ev.className = 'cal-event' + (e.kind === 'appt' ? ' appt' : '') + (e.over ? ' over' : '');
        ev.textContent = e.title;
        cell.appendChild(ev);
      });
      cell.addEventListener('click', () => { calCursor = new Date(d); calView = 'day'; syncCalViewChips(); renderCalendar(); });
      g.appendChild(cell);
    }
  } else {
    const y = calCursor.getFullYear(), m = calCursor.getMonth();
    title.textContent = calCursor.toLocaleDateString('ar-EG', { month: 'long', year: 'numeric' });
    const first = new Date(y, m, 1);
    let startIdx = (first.getDay() + 7 - 6) % 7; // Saturday-first
    grid.innerHTML = '<div class="cal-grid"></div>';
    const g = grid.firstChild;
    const base = new Date(y, m, 1 - startIdx);
    for (let i = 0; i < 42; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      const k = dayKey(d);
      const cell = document.createElement('div');
      cell.className = 'cal-cell' + (k === t ? ' today' : '') + (d.getMonth() !== m ? ' dim' : '');
      cell.innerHTML = '<div class="dnum">' + d.getDate() + '</div>';
      const evs = eventsOn(k);
      if (evs.length) {
        const ev = document.createElement('div');
        ev.className = 'cal-event' + (evs.some(e => e.over) ? ' over' : '');
        ev.textContent = evs.length === 1 ? evs[0].title : evs.length + ' عناصر';
        cell.appendChild(ev);
      }
      cell.addEventListener('click', () => { calCursor = new Date(d); calView = 'day'; syncCalViewChips(); renderCalendar(); });
      g.appendChild(cell);
    }
  }
  // Appointments list
  const al = document.getElementById('apptList');
  al.innerHTML = '';
  const sorted = appointments.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
  if (!sorted.length) al.appendChild(dashRow('لا مواعيد — أنشئ أول موعد 📅'));
  sorted.slice(0, 8).forEach(a => {
    const linked = a.taskId ? tasks.find(x => x.id === a.taskId) : null;
    const row = dashRow('📅 <b>' + escHtml(a.title) + '</b><br><span style="color:var(--muted);font-size:11px">' + formatDT(a.start) + (a.location ? ' · ' + escHtml(a.location) : '') + (linked ? ' · 🧱 ' + escHtml(linked.title.slice(0, 20)) : '') + '</span>');
    const eb = document.createElement('button');
    eb.className = 'mini-btn'; eb.textContent = 'تعديل';
    eb.addEventListener('click', () => openApptModal(a));
    const db = document.createElement('button');
    db.className = 'mini-btn'; db.textContent = 'حذف';
    db.addEventListener('click', () => { if (confirm('حذف الموعد؟')) deleteAppt(a.id); });
    row.appendChild(eb); row.appendChild(db);
    al.appendChild(row);
  });
  // Time blocks
  const bl = document.getElementById('blockList');
  bl.innerHTML = '';
  const blocks = tasks.filter(x => !x.archived && x.scheduledAt).sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))).slice(0, 6);
  if (!blocks.length) bl.appendChild(dashRow('لا time blocks — من أي مهمة اضغط 🧱'));
  blocks.forEach(x => {
    bl.appendChild(dashRow('🧱 <b>' + escHtml(x.title) + '</b> <span style="color:var(--muted)">· ' + formatDT(x.scheduledAt) + '</span>', [
      { label: '✔', go: true, onClick: () => setTaskDone(x, true) },
      { label: 'إلغاء الجدولة', onClick: () => { x.scheduledAt = ''; if (x.planCat === 'scheduled') x.planCat = 'should'; save(); renderAll(); } }
    ]));
  });
}
function syncCalViewChips() {
  document.querySelectorAll('#calViewRow .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.calview === calView));
}

// ─── Routines (daily / weekly / monthly / custom) ─────
const REPEAT_AR = { daily: 'يومي 📆', weekly: 'أسبوعي 🗓️', monthly: 'شهري 📅', custom: 'مخصص ⏳' };
function routineLabel(r) {
  if (r.repeat === 'daily') return 'يومي 📆';
  if (r.repeat === 'weekly') return 'أسبوعي 🗓️';
  if (r.repeat === 'monthly') return 'شهري 📅';
  return 'كل ' + (r.intervalDays || 3) + ' أيام ⏳';
}
function addDaysK(dateK, n) {
  const d = new Date(dateK + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function diffDays(aK, bK) {
  return Math.round((new Date(bK + 'T12:00:00') - new Date(aK + 'T12:00:00')) / 86400000);
}
function routineDueOn(r, dateK) {
  const anchor = r.anchor || (r.createdAt || '').slice(0, 10) || todayStr();
  const diff = diffDays(anchor, dateK);
  if (diff < 0) return false;
  if (r.repeat === 'daily') return true;
  if (r.repeat === 'weekly') return diff % 7 === 0;
  if (r.repeat === 'monthly') {
    const a = new Date(anchor + 'T12:00:00'), d = new Date(dateK + 'T12:00:00');
    if (d < a) return false;
    const dayA = a.getDate();
    const lastOfM = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return d.getDate() === Math.min(dayA, lastOfM);
  }
  const every = Math.max(2, Number(r.intervalDays) || 3);
  return diff % every === 0;
}
// Generate missing occurrences (no duplicates): active routines, up to today.
function ensureRoutines() {
  const t = todayStr();
  let changed = false, spawned = 0;
  routines.forEach(r => {
    if (!r.active) return;
    if (r.tapMode || r.kind === 'tap') return; // Tap routines: no auto tasks, manual tap only
    const skipped = r.skipDates || [];
    let from = r.lastGenerated ? addDaysK(r.lastGenerated, 1) : null;
    if (!from) {
      const anchor = r.anchor || (r.createdAt || '').slice(0, 10) || t;
      from = addDaysK(anchor, -7) > t ? t : (addDaysK(anchor, -7) < anchor ? anchor : addDaysK(anchor, -7));
      if (from < anchor) from = anchor;
      if (diffDays(from, t) > 7) from = addDaysK(t, -7);
    }
    if (from > t) { r.lastGenerated = t; changed = true; return; }
    let cur = from, guard = 0;
    while (cur <= t && guard < 32) {
      guard++;
      const key = cur;
      cur = addDaysK(cur, 1);
      if (!routineDueOn(r, key)) continue;
      if (skipped.includes(key)) continue;
      if (tasks.some(x => x.routineId === r.id && x.due === key && !x.archived)) continue;
      const occ = {
        id: uid(), title: r.title, description: r.description || '', project: r.project || '',
        priority: r.priority || 'medium', status: 'todo', done: false, startDate: '', due: key,
        reminder: r.time ? key + 'T' + r.time : '', repeat: 'none',
        estMinutes: r.estMinutes || 0, spentSeconds: 0, tags: (r.tags || []).slice(),
        subtasks: [], planCat: 'should', archived: false, scheduledAt: '',
        routineId: r.id, note: '', activity: [{ at: new Date().toISOString(), action: 'توليد من روتين 🔁' }],
        createdAt: new Date().toISOString()
      };
      tasks.unshift(occ);
      if (occ.reminder) setReminder(occ);
      spawned++;
      changed = true;
    }
    r.lastGenerated = t;
    changed = true;
  });
  if (changed) { save(); renderAll(); }
  return spawned;
}
function updateRoutineStreak(t) {
  const r = routines.find(x => x.id === t.routineId);
  if (!r || !t.due) return;
  const due = t.due;
  if (r.lastCompleted === due) return;
  const yest = addDaysK(due, -1);
  // consecutive-day streak (legacy kept) + history for stats
  r.streak = (r.lastCompleted === yest || r.lastCompleted === due) ? (r.streak || 0) + 1 : 1;
  r.lastCompleted = due;
  r.completions = r.completions || [];
  if (!r.completions.includes(due)) {
    r.completions.push(due);
    if (r.completions.length > 180) r.completions = r.completions.slice(-180);
  }
  r.bestStreak = Math.max(r.bestStreak || 0, r.streak || 0);
  r.lastDoneAt = new Date().toISOString();
  save();
}

// ─── v2.3: fun stats + tap + health helpers ─────────────────
function timeAgoAr(iso) {
  if (!iso) return 'لسه معملتهاش 😅';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'الآن ⚡';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'من ثواني ⚡';
  if (m < 60) return 'من ' + m + ' دقيقة ⏳';
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? 'من ساعة 🕐' : h === 2 ? 'من ساعتين 🕑' : 'من ' + h + ' ساعات 🕐';
  const d = Math.floor(h / 24);
  if (d === 1) return 'من امبارح 📆';
  if (d === 2) return 'من يومين 📆';
  if (d < 30) return 'من ' + d + ' أيام 📆';
  const mo = Math.floor(d / 30);
  return mo === 1 ? 'من شهر 🌙' : 'من ' + mo + ' شهور 🌙';
}
function routineLevel(streak) {
  const s = streak || 0;
  if (s >= 30) return { e: '🏆', t: 'أسطوري!', next: 60, cur: s };
  if (s >= 14) return { e: '⚡', t: 'بطل الالتزام', next: 30, cur: s };
  if (s >= 7) return { e: '🔥', t: 'ملتزم نار', next: 14, cur: s };
  if (s >= 3) return { e: '🌱', t: 'بيكبر كل يوم', next: 7, cur: s };
  return { e: '🐣', t: 'بداية جميلة', next: 3, cur: s };
}
function routineMotivation(r, pct7) {
  if ((r.streak || 0) >= 7) return '🔥 وحش! ' + (r.streak || 0) + ' أيام ورا بعض — حافظ على السلسلة!';
  if ((r.streak || 0) >= 3) return '💪 عاش! 3 أيام التزام — انت على الطريق الصح';
  if (pct7 >= 70) return '✨ التزامك عالي الأسبوع ده — كمل يا بطل!';
  if ((r.tapCount || (r.tapHistory || []).length || (r.completions || []).length) > 0) return '🌱 بداية حلوة! كل دوسة بتقربك لنسخة أحسن منك';
  return '🚀 أول خطوة أهم خطوة — دوس وسجل أول إنجاز!';
}
function routineStats(r) {
  const comp = r.tapMode || r.kind === 'tap'
    ? (r.tapHistory || []).map(x => (x || '').slice(0, 10))
    : (r.completions || []);
  const set = new Set(comp);
  let hit7 = 0, hit30 = 0;
  for (let i = 0; i < 7; i++) if (set.has(todayStr(-i))) hit7++;
  for (let i = 0; i < 30; i++) if (set.has(todayStr(-i))) hit30++;
  const total = r.tapMode || r.kind === 'tap' ? (r.tapHistory || []).length : comp.length;
  return { hit7, hit30, pct7: Math.round(hit7 / 7 * 100), pct30: Math.round(hit30 / 30 * 100), total };
}
function lastDoneOf(r) {
  if (r.tapMode || r.kind === 'tap') return r.lastDoneAt || ((r.tapHistory || []).slice(-1)[0] || '');
  if (r.lastDoneAt) return r.lastDoneAt;
  if (r.lastCompleted) return r.lastCompleted + 'T12:00:00';
  const c = (r.completions || []).slice(-1)[0];
  return c ? c + 'T12:00:00' : '';
}
// Tap-to-log: one press = done now (no task generation)
function logTapRoutine(id) {
  const r = routines.find(x => x.id === id);
  if (!r) return;
  const now = new Date().toISOString();
  const todayK = todayStr();
  r.tapHistory = r.tapHistory || [];
  r.tapHistory.push(now);
  if (r.tapHistory.length > 300) r.tapHistory = r.tapHistory.slice(-300);
  r.tapCount = r.tapHistory.length;
  r.lastDoneAt = now;
  // day streak from tap days
  const days = [...new Set(r.tapHistory.map(x => (x || '').slice(0, 10)))].sort();
  const last = days[days.length - 1];
  if (last === todayK) {
    const prev = days[days.length - 2];
    r.streak = (prev === addDaysK(todayK, -1)) ? (r.streak || 0) + (r._tapStreakDay === todayK ? 0 : 1) : (r._tapStreakDay === todayK ? (r.streak || 1) : 1);
    r._tapStreakDay = todayK;
  }
  r.bestStreak = Math.max(r.bestStreak || 0, r.streak || 0);
  save(); renderRoutines();
  if (selectedRoutineId === id) renderRoutineDetail(id);
  toast('👆 عاش! اتسجلت ✅ (' + timeAgoAr(now) + ')');
}
function refreshRoutineProjects() {
  const sel = document.getElementById('routineProject');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">المشروع: بدون</option>';
  projects.forEach(p => {
    const o = document.createElement('option'); o.value = p; o.textContent = p;
    sel.appendChild(o);
  });
  sel.value = cur || '';
}
document.getElementById('routineRepeat').addEventListener('change', e => {
  document.getElementById('routineInterval').style.display = e.target.value === 'custom' ? '' : 'none';
});
document.getElementById('addRoutineBtn').addEventListener('click', () => {
  const inp = document.getElementById('routineTitle');
  const title = inp.value.trim();
  if (!title) { inp.focus(); toast('⚠️ اسم الروتين مطلوب'); return; }
  const repeat = document.getElementById('routineRepeat').value;
  const kindSel = document.getElementById('routineKind');
  const kind = kindSel ? kindSel.value : 'auto';
  const isTap = kind === 'tap';
  const r = {
    id: uid(), title, description: '', project: document.getElementById('routineProject').value,
    priority: document.getElementById('routinePriority').value, repeat,
    intervalDays: repeat === 'custom' ? Math.min(365, Math.max(2, parseInt(document.getElementById('routineInterval').value, 10) || 3)) : 0,
    time: document.getElementById('routineTime').value, estMinutes: 0, tags: [],
    active: true, anchor: todayStr(), lastGenerated: '', lastCompleted: '', streak: 0,
    skipDates: [], createdAt: new Date().toISOString(),
    kind: isTap ? 'tap' : 'auto', tapMode: isTap,
    completions: [], tapHistory: [], tapCount: 0, lastDoneAt: '', bestStreak: 0
  };
  routines.unshift(r);
  inp.value = '';
  save();
  let n = 0;
  if (!isTap) n = ensureRoutines();
  renderRoutines(); refreshRoutineProjects();
  toast(isTap ? '👆 روتين سريع جاهز — دوس عليه كل ما تعمله!' : ('🔁 تم إنشاء الروتين' + (n ? ' وتوليد ' + n + ' مهمة' : ' (' + routineLabel(r) + ')')));
});
let selectedRoutineId = null;
function renderRoutines() {
  refreshRoutineProjects();
  bindHealthUI();
  const list = document.getElementById('routinesList');
  list.innerHTML = '';
  if (!routines.length) {
    list.innerHTML = '<div class="empty-state"><p>لا روتين بعد — أنشئ عادة يومية أو أسبوعية 🔁</p></div>';
    return;
  }
  routines.forEach(r => {
    const isTap = r.tapMode || r.kind === 'tap';
    const occs = isTap ? [] : tasks.filter(x => x.routineId === r.id && !x.archived);
    const pending = occs.filter(x => !x.done).length;
    const doneN = occs.filter(x => x.done).length;
    const lastIso = lastDoneOf(r);
    const agoTxt = timeAgoAr(lastIso);
    const isOver = lastIso ? (Date.now() - new Date(lastIso).getTime() > 24 * 3600000) : true;
    const tapToday = isTap ? (r.tapHistory || []).filter(x => (x || '').slice(0, 10) === todayStr()).length : 0;
    const card = document.createElement('div');
    card.className = 'project-card routine-card-click' + (r.active ? '' : ' routine-off');
    card.innerHTML = `
      <div class="project-header">
        <div style="flex:1;min-width:0">
          <div class="project-name">${isTap ? '👆' : '🔁'} ${escHtml(r.title)}${r.active ? '' : ' ⏸'}</div>
          <div class="project-count">${isTap ? 'زر سريع Tap' : routineLabel(r)}${r.project ? ' · 📁 ' + escHtml(r.project) : ''}${r.time && !isTap ? ' · ⏰ ' + r.time : ''}</div>
          <div class="project-count">${isTap ? ('👆 ' + (r.tapCount || 0) + ' مرة · اليوم ' + tapToday) : (pending + ' معلقة · ' + doneN + ' منجزة')}</div>
          <div style="margin-top:5px"><span class="lastdone-chip${isOver ? ' over' : ''}">⏱ آخر مرة: ${escHtml(agoTxt)}</span></div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-direction:column">
          <span class="streak-fire" title="أيام متتالية">🔥 ${r.streak || 0}</span>
          <button class="task-act-btn del-routine" title="حذف الروتين" style="opacity:0.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      ${isTap ? `<div style="display:flex;gap:6px;margin-top:8px"><button class="tap-btn rt-tap">👆 عملتها! سجل الآن</button></div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn go rt-open">📊 التفاصيل والإحصائيات</button>
        ${isTap ? '' : `<button class="mini-btn rt-toggle">${r.active ? '⏸ إيقاف' : '▶ استئناف'}</button>
        <button class="mini-btn rt-skip">تخطي اليوم</button>
        <button class="mini-btn rt-view">عرض المهام</button>`}
      </div>`;
    // Click card → detail (except on buttons)
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openRoutineDetail(r.id);
    });
    card.querySelector('.rt-open').addEventListener('click', (ev) => { ev.stopPropagation(); openRoutineDetail(r.id); });
    const tapBtn = card.querySelector('.rt-tap');
    if (tapBtn) tapBtn.addEventListener('click', (ev) => { ev.stopPropagation(); logTapRoutine(r.id); });
    if (!isTap) {
      card.querySelector('.rt-toggle').addEventListener('click', () => {
        r.active = !r.active;
        save();
        if (r.active) ensureRoutines();
        renderAll();
        toast(r.active ? '▶ استُؤنف الروتين' : '⏸ أُوقف الروتين مؤقتاً');
      });
      card.querySelector('.rt-skip').addEventListener('click', () => {
        const t = todayStr();
        r.skipDates = r.skipDates || [];
        if (!r.skipDates.includes(t)) r.skipDates.push(t);
        r.lastGenerated = t;
        save(); renderAll();
        toast('⏭ تُخطي روتين اليوم');
      });
      card.querySelector('.rt-view').addEventListener('click', () => {
        searchQ = r.title;
        const s = document.getElementById('searchInput');
        if (s) s.value = r.title;
        currentFilter = 'all';
        document.querySelectorAll('#filterRow .filter-chip').forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
        switchTab('tasks');
      });
    }
    card.querySelector('.del-routine').addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (!confirm('حذف الروتين "' + r.title + '"؟\nمهامه الحالية ستبقى كمهام عادية.')) return;
      routines = routines.filter(x => x.id !== r.id);
      tasks.forEach(x => { if (x.routineId === r.id) { x.routineId = ''; logActivity(x, 'انفصال عن روتين محذوف'); } });
      save(); renderAll();
      toast('🗑️ حُذف الروتين وبقيت مهامه');
    });
    list.appendChild(card);
  });
}

// ─── Routine detail page (modal) — fun motivational stats ───
function openRoutineDetail(id) {
  selectedRoutineId = id;
  renderRoutineDetail(id);
  document.getElementById('routineDetailModal').classList.add('open');
}
function closeRoutineDetail() {
  document.getElementById('routineDetailModal').classList.remove('open');
  selectedRoutineId = null;
}
function renderRoutineDetail(id) {
  const r = routines.find(x => x.id === id);
  const body = document.getElementById('routineDetailBody');
  if (!r) { body.innerHTML = '<div class="empty-state"><p>الروتين مش موجود</p></div>'; return; }
  const isTap = r.tapMode || r.kind === 'tap';
  document.getElementById('rdTitle').textContent = (isTap ? '👆 ' : '🔁 ') + r.title;
  const st = routineStats(r);
  const lvl = routineLevel(r.streak || 0);
  const lastIso = lastDoneOf(r);
  const toNext = Math.max(1, lvl.next - lvl.cur);
  const pctNext = Math.min(100, Math.round(lvl.cur / lvl.next * 100));
  // last 14 days bars
  let bars = '';
  for (let i = 13; i >= 0; i--) {
    const k = todayStr(-i);
    const isT = i === 0;
    const has = isTap
      ? (r.tapHistory || []).some(x => (x || '').slice(0, 10) === k)
      : (r.completions || []).includes(k);
    bars += `<div class="${has ? 'hit' : ''}${isT ? ' today' : ''}" title="${k}: ${has ? '✅' : '—'}" style="height:${has ? 52 : 10}px"></div>`;
  }
  const hist = isTap
    ? (r.tapHistory || []).slice(-5).reverse()
    : (r.completions || []).slice(-5).reverse();
  const histHtml = hist.length
    ? hist.map(h => `<div class="rd-list-row"><span>✅</span><span>${escHtml(isTap ? formatDT(h) : h)}</span></div>`).join('')
    : '<div style="color:var(--faint)">لسه مفيش سجل — ابدأ النهاردة 🚀</div>';
  body.innerHTML = `
    <div class="rd-hero">
      <div class="lvl">${lvl.e}</div>
      <div class="t">${escHtml(lvl.t)} — 🔥 ${r.streak || 0} أيام</div>
      <div class="s">الأفضل: 🏅 ${r.bestStreak || 0} · باقي ${toNext} للفل الجاي</div>
      <div class="level-track" style="margin-top:8px;background:rgba(255,255,255,.3)"><div class="level-fill" style="width:${pctNext}%;background:#fff"></div></div>
    </div>
    <div class="rd-mot">${escHtml(routineMotivation(r, st.pct7))}</div>
    <div class="rd-stats">
      <div class="rd-stat"><div class="rd-stat-val">${st.hit7}/7</div><div class="rd-stat-lbl">آخر 7 أيام</div></div>
      <div class="rd-stat"><div class="rd-stat-val">${st.pct7}%</div><div class="rd-stat-lbl">الالتزام الأسبوعي</div></div>
      <div class="rd-stat"><div class="rd-stat-val">${st.total}</div><div class="rd-stat-lbl">${isTap ? 'إجمالي الدوسات' : 'إجمالي المرات'}</div></div>
    </div>
    <div>
      <div class="section-label">📊 آخر 14 يوم (دوس على أي يوم)</div>
      <div class="rd-bars">${bars}</div>
    </div>
    <div>
      <span class="lastdone-chip">⏱ آخر مرة: ${escHtml(timeAgoAr(lastIso))}</span>
      <span class="tag-chip">📅 30 يوم: ${st.hit30}/30 (${st.pct30}%)</span>
    </div>
    <div>
      <div class="section-label">🕘 آخر الإنجازات</div>
      <div class="rd-list">${histHtml}</div>
    </div>
    <div style="display:flex;gap:6px">
      ${isTap
        ? '<button class="tap-btn" id="rdTap">👆 عملتها دلوقتي!</button>'
        : '<button class="tap-btn" id="rdDone">✅ سجل إنجاز النهاردة</button>'}
    </div>`;
  const bTap = document.getElementById('rdTap');
  if (bTap) bTap.addEventListener('click', () => logTapRoutine(r.id));
  const bDone = document.getElementById('rdDone');
  if (bDone) bDone.addEventListener('click', () => {
    const t = todayStr();
    r.completions = r.completions || [];
    if (!r.completions.includes(t)) {
      const yest = addDaysK(t, -1);
      r.streak = (r.lastCompleted === yest || r.lastCompleted === t) ? (r.streak || 0) + 1 : ((r.completions.length ? 1 : 1));
      r.lastCompleted = t;
      r.completions.push(t);
      r.bestStreak = Math.max(r.bestStreak || 0, r.streak || 0);
      r.lastDoneAt = new Date().toISOString();
      save(); renderRoutines(); renderRoutineDetail(r.id);
      toast('🎉 عاش يا بطل! اتسجل إنجاز النهاردة 🔥');
    } else toast('✅ متسجلة already النهاردة — كمل بكرة 🔥');
  });
}

// ─── Health breaks wiring ───
let _healthBound = false;
function bindHealthUI() {
  if (_healthBound) return;
  const en = document.getElementById('healthEnabled');
  const ev = document.getElementById('healthEvery');
  if (!en || !ev) return;
  _healthBound = true;
  en.checked = !!(settings.health && settings.health.enabled);
  ev.value = String((settings.health && settings.health.every) || 30);
  en.addEventListener('change', () => {
    settings.health = settings.health || {};
    settings.health.enabled = en.checked;
    save(); applyHealthAlarm();
    toast(en.checked ? '🧘 تنبيهات الصحة اشتغلت كل ' + settings.health.every + ' دقيقة' : '🧘 تنبيهات الصحة وقفت');
  });
  ev.addEventListener('change', () => {
    settings.health = settings.health || {};
    settings.health.every = Math.max(5, parseInt(ev.value, 10) || 30);
    save(); applyHealthAlarm();
    if (settings.health.enabled) toast('⏰ هيجيلك تنبيه كل ' + settings.health.every + ' دقيقة');
  });
  const tst = document.getElementById('healthTest');
  if (tst) tst.addEventListener('click', () => {
    try { chrome.notifications.create('health_test', { type: 'basic', iconUrl: 'icons/icon48.png', title: '👁️ ريح عينيك', message: 'غمض عينيك 20 ثانية وقوم اتمشى دقيقتين 🧘' }); } catch (e) {}
    toast('🔔 ده شكل التنبيه اللي هيجيلك');
  });
  const back = document.getElementById('rdBack');
  if (back) back.addEventListener('click', closeRoutineDetail);
  const cls = document.getElementById('rdClose');
  if (cls) cls.addEventListener('click', closeRoutineDetail);
  const ov = document.getElementById('routineDetailModal');
  if (ov) ov.addEventListener('click', (e) => { if (e.target === ov) closeRoutineDetail(); });
}
function applyHealthAlarm() {
  try {
    if (settings.health && settings.health.enabled) {
      chrome.runtime.sendMessage({ type: 'SET_PERIODIC', name: 'health_break', minutes: settings.health.every || 30 });
    } else {
      chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'health_break' });
    }
  } catch (e) {}
  // keep checkbox in sync if called from init
  const en = document.getElementById('healthEnabled');
  if (en) en.checked = !!(settings.health && settings.health.enabled);
  const ev = document.getElementById('healthEvery');
  if (ev && settings.health) ev.value = String(settings.health.every || 30);
}

// ─── Prayer times (Aladhan API, no key needed) ─────────
// Reminder 5 min before adhan (via background alarms) + persistent
// countdown that stays until the prayer is marked done.
const PRAYER_ORDER = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const PRAYER_AR = { Fajr: 'الفجر', Sunrise: 'الشروق', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' };
function prayerToMin(hhmm) {
  const m = String(hhmm || '').slice(0, 5).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return (parseInt(m[1], 10) % 24) * 60 + parseInt(m[2], 10);
}
function prayerPad(n) { return String(n).padStart(2, '0'); }
function prayerFmtDur(totalSec) {
  totalSec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(totalSec / 3600), m = Math.floor((totalSec % 3600) / 60), s = totalSec % 60;
  return prayerPad(h) + ':' + prayerPad(m) + ':' + prayerPad(s);
}
// Pure: pick hero prayer given timings (HH:MM), done map, now minutes.
function prayerPickHero(timings, done, nowMin) {
  const needles = PRAYER_ORDER.map(n => ({ name: n, min: prayerToMin(timings[n]) })).filter(x => x.min !== null);
  if (!needles.length) return null;
  // 1) overdue & not done → stays visible until marked
  for (const p of needles) {
    if (nowMin >= p.min && !done[p.name]) return { name: p.name, state: 'due', atMin: p.min };
  }
  // 2) next upcoming
  for (const p of needles) {
    if (nowMin < p.min) return { name: p.name, state: 'wait', atMin: p.min, done: !!done[p.name] };
  }
  // 3) all passed: first not-done (missed) or all-done
  const missed = needles.find(p => !done[p.name]);
  if (missed) return { name: missed.name, state: 'missed', atMin: missed.min };
  return { name: needles[needles.length - 1].name, state: 'alldone', atMin: needles[needles.length - 1].min };
}
function prayerDateKey(d) {
  d = d || new Date();
  return prayerPad(d.getDate()) + '-' + prayerPad(d.getMonth() + 1) + '-' + d.getFullYear();
}
async function fetchPrayerTimings(force) {
  const cfg = (settings && settings.prayer) || {};
  const city = (cfg.city || 'Cairo').trim(), country = (cfg.country || 'Egypt').trim(), method = cfg.method || 5;
  const dateK = prayerDateKey();
  if (!force && prayerCache && prayerCache.date === dateK && prayerCache.city === city && prayerCache.country === country && prayerCache.method === method && prayerCache.timings) {
    return prayerCache;
  }
  const url = 'https://api.aladhan.com/v1/timingsByCity/' + dateK +
    '?city=' + encodeURIComponent(city) + '&country=' + encodeURIComponent(country) + '&method=' + method;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!j || j.code !== 200 || !j.data || !j.data.timings) throw new Error('bad payload');
  prayerCache = {
    date: dateK, city, country, method,
    timings: j.data.timings,
    hijri: j.data.date && j.data.date.hijri ? (j.data.date.hijri.day + ' ' + j.data.date.hijri.month.ar + ' ' + j.data.date.hijri.year) : ''
  };
  save();
  return prayerCache;
}
function prayerNotifyCfg() {
  const n = (settings && settings.notify) || {};
  return {
    on: n.prayer !== false,
    mins: [0, 5, 10, 15].includes(Number(n.prayerMins)) ? Number(n.prayerMins) : 5,
    exact: n.prayerExact !== false,
    sound: n.sound !== false && settings.sound !== false
  };
}
function schedulePrayerAlarms() {
  try {
    if (!prayerCache || !prayerCache.timings) return;
    const cfgN = prayerNotifyCfg();
    const done = prayerDoneMap();
    const key = prayerCache.date + '|' + PRAYER_ORDER.map(n => String(prayerCache.timings[n]).slice(0, 5)).join(',') + '|' + PRAYER_ORDER.map(n => done[n] ? '1' : '0').join('') + '|' + (cfgN.on ? '1' : '0') + cfgN.mins + (cfgN.exact ? '1' : '0');
    if (key === prayerScheduledKey) return; // already scheduled for this state (no dup alarms)
    const nowMs = Date.now();
    const now = new Date();
    PRAYER_ORDER.forEach(name => {
      // Clear stale alarms for this prayer first
      try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'prayer_' + name + '_' + prayerCache.date }); } catch (e) {}
      try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'prayerExact_' + name + '_' + prayerCache.date }); } catch (e) {}
      if (!cfgN.on || done[name]) return; // off globally or prayer completed
      const mm = prayerToMin(prayerCache.timings[name]);
      if (mm === null) return;
      const at = new Date(now);
      at.setHours(Math.floor(mm / 60), mm % 60, 0, 0);
      const atMs = at.getTime();
      if (cfgN.mins > 0 && atMs - cfgN.mins * 60000 > nowMs) {
        try { chrome.runtime.sendMessage({ type: 'SET_ALARM', name: 'prayer_' + name + '_' + prayerCache.date, when: atMs - cfgN.mins * 60000 }); } catch (e) {}
      }
      if (cfgN.exact && atMs > nowMs) {
        try { chrome.runtime.sendMessage({ type: 'SET_ALARM', name: 'prayerExact_' + name + '_' + prayerCache.date, when: atMs }); } catch (e) {}
      }
    });
    prayerScheduledKey = key;
  } catch (e) {}
}
function prayerDoneMap() {
  const k = prayerDateKey();
  if (!prayerDone[k]) prayerDone[k] = {};
  return prayerDone[k];
}
function togglePrayerDone(name) {
  const done = prayerDoneMap();
  done[name] = !done[name];
  save();
  renderPrayer(true);
  if (done[name]) toast('🕌 تقبل الله — تمت صلاة ' + (PRAYER_AR[name] || name));
}
async function renderPrayer(skipFetch) {
  const listEl = document.getElementById('prayerList');
  if (!listEl) return;
  // Fill location inputs once
  try {
    const cfg = (settings && settings.prayer) || {};
    const ci = document.getElementById('prayerCity'), co = document.getElementById('prayerCountry'), me = document.getElementById('prayerMethod');
    if (ci && !ci.value) ci.value = cfg.city || 'Cairo';
    if (co && !co.value) co.value = cfg.country || 'Egypt';
    if (me) me.value = String(cfg.method || 5);
  } catch (e) {}
  if (!skipFetch) {
    try { await fetchPrayerTimings(false); }
    catch (e) {
      listEl.innerHTML = '<div class="empty-state"><p>تعذر جلب المواقيت — تحقق من الإنترنت والمدينة</p></div>';
      document.getElementById('prayerNextName').textContent = '—';
      document.getElementById('prayerCountdown').textContent = '--:--:--';
      return;
    }
    schedulePrayerAlarms();
  }
  if (!prayerCache || !prayerCache.timings) return;
  const T = prayerCache.timings;
  try {
    const hj = document.getElementById('prayerHijri');
    if (hj && prayerCache.hijri) hj.textContent = '· ' + prayerCache.hijri;
    if (T.Sunrise && !document.getElementById('prayerSunriseChip')) {
      const chip = document.createElement('div');
      chip.id = 'prayerSunriseChip';
      chip.className = 'tag-chip';
      chip.style.cssText = 'align-self:flex-start';
      listEl.parentElement.insertBefore(chip, listEl);
    }
    const sc = document.getElementById('prayerSunriseChip');
    if (sc) sc.textContent = '🌅 الشروق ' + String(T.Sunrise).slice(0, 5);
  } catch (e) {}
  const done = prayerDoneMap();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const hero = prayerPickHero(T, done, nowMin);
  const doneCount = PRAYER_ORDER.filter(n => done[n]).length;
  prayerData = { hero, timings: T };
  // Hero (dashboard + deen)
  const nameEl = document.getElementById('prayerNextName');
  const progEl = document.getElementById('prayerProgress');
  const deenLine = document.getElementById('deenNextLine');
  const deenProg = document.getElementById('deenProgress');
  if (progEl) progEl.textContent = doneCount + '/5 اليوم';
  if (deenProg) deenProg.textContent = doneCount + '/5 اليوم';
  let heroTxt = '...';
  if (hero) {
    if (hero.state === 'alldone') heroTxt = '✅ خلصت صلوات اليوم — تقبل الله';
    else if (hero.state === 'due') heroTxt = '🕌 حان الآن: صلاة ' + PRAYER_AR[hero.name] + ' — علّم ✅';
    else if (hero.state === 'missed') heroTxt = '⚠️ فاتت صلاة ' + PRAYER_AR[hero.name] + ' — علّمها ✅';
    else heroTxt = 'صلاة ' + PRAYER_AR[hero.name] + (hero.done ? ' (تمت ✅)' : '');
  }
  if (nameEl) nameEl.textContent = heroTxt;
  if (deenLine) deenLine.textContent = heroTxt;
  updatePrayerCountdown();
  if (!prayerTimer) prayerTimer = setInterval(updatePrayerCountdown, 1000);
  // List rows (stay visible; overdue rows highlighted until marked done)
  listEl.innerHTML = '';
  PRAYER_ORDER.forEach(name => {
    const mm = prayerToMin(T[name]);
    const isDone = !!done[name];
    const overdue = mm !== null && (nowMin >= mm) && !isDone;
    const row = document.createElement('div');
    row.className = 'dash-row' + (overdue ? ' plan-cat-must' : '');
    row.innerHTML = '<div class="grow">' +
      (isDone ? '✅ ' : overdue ? '🕌 ' : '· ') +
      '<b>' + PRAYER_AR[name] + '</b> <span style="color:var(--muted)">· ' +
      (mm !== null ? prayerPad(Math.floor(mm / 60)) + ':' + prayerPad(mm % 60) : '—') + '</span></div>';
    const b = document.createElement('button');
    b.className = 'mini-btn' + (isDone ? '' : ' go');
    b.textContent = isDone ? 'تمت ✅' : 'علّم ✅';
    b.addEventListener('click', () => togglePrayerDone(name));
    row.appendChild(b);
    listEl.appendChild(row);
  });
}
let lastPrayerKey = '';
function updatePrayerCountdown() {
  try {
    if (!prayerData || !prayerData.hero) return;
    const hero = prayerData.hero;
    // Beep once when a prayer becomes due while popup is open (if sound on)
    try {
      const k = prayerDateKey() + '|' + hero.name + '|' + hero.state;
      if (k !== lastPrayerKey) {
        lastPrayerKey = k;
        if (hero.state === 'due' && prayerNotifyCfg().sound) playBeep();
      }
    } catch (e) {}
    const now = new Date();
    const target = new Date(now);
    if (hero.state === 'wait') {
      target.setHours(Math.floor(hero.atMin / 60), hero.atMin % 60, 0, 0);
    } else if (hero.state === 'alldone') {
      document.querySelectorAll('.prayer-countdown-live').forEach(el => { el.textContent = '00:00:00'; });
      return;
    } else {
      // due/missed: count UP since adhan (stays visible until marked done)
      target.setHours(Math.floor(hero.atMin / 60), hero.atMin % 60, 0, 0);
    }
    const diffSec = Math.round((target.getTime() - now.getTime()) / 1000);
    const txt = (diffSec < 0 ? '+' : '') + prayerFmtDur(Math.abs(diffSec));
    document.querySelectorAll('.prayer-countdown-live').forEach(el => { el.textContent = txt; });
  } catch (e) {}
}

// ─── Deen: quotes, adhkar, wird ────────────────────────
const DEEN_QUOTES = [
  { t: '«خَيْرُكُمْ مَنْ تَعَلَّمَ الْقُرْآنَ وَعَلَّمَهُ»', s: 'حديث شريف — البخاري' },
  { t: '«الطُّهُورُ شَطْرُ الْإِيمَانِ، وَالْحَمْدُ لِلَّهِ تَمْلَأُ الْمِيزَانَ»', s: 'حديث شريف — مسلم' },
  { t: '«مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ» (الفجر والعصر)', s: 'حديث شريف — متفق عليه' },
  { t: '«أَحَبُّ الْأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ»', s: 'حديث شريف — متفق عليه' },
  { t: '«إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ، وَإِنَّمَا لِكُلِّ امْرِئٍ مَا نَوَى»', s: 'حديث شريف — متفق عليه' },
  { t: '«لَا تَحْقِرَنَّ مِنَ الْمَعْرُوفِ شَيْئًا، وَلَوْ أَنْ تَلْقَى أَخَاكَ بِوَجْهٍ طَلْقٍ»', s: 'حديث شريف — مسلم' },
  { t: '«الْكَلِمَةُ الطَّيِّبَةُ صَدَقَةٌ»', s: 'حديث شريف — متفق عليه' },
  { t: '﴿فَاذْكُرُونِي أَذْكُرْكُمْ وَاشْكُرُوا لِي وَلَا تَكْفُرُونِ﴾', s: 'البقرة 152' },
  { t: '﴿أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ﴾', s: 'الرعد 28' },
  { t: '﴿وَقُل رَّبِّ زِدْنِي عِلْمًا﴾', s: 'طه 114' },
  { t: '«مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ طَرِيقًا إِلَى الْجَنَّةِ»', s: 'حديث شريف — مسلم' },
  { t: '«مَا نَقَصَتْ صَدَقَةٌ مِنْ مَالٍ»', s: 'حديث شريف — مسلم' },
  { t: 'استغفر الله — «مَنْ لَزِمَ الِاسْتِغْفَارَ جَعَلَ اللَّهُ لَهُ مِنْ كُلِّ هَمٍّ فَرَجًا»', s: 'حديث شريف — أبو داود' },
  { t: '﴿إِنَّ اللَّهَ وَمَلَائِكَتَهُ يُصَلُّونَ عَلَى النَّبِيِّ﴾ — أكثِر من الصلاة عليه ﷺ', s: 'الأحزاب 56' }
];
function deenQuote(idx) {
  const q = DEEN_QUOTES[(idx || 0) % DEEN_QUOTES.length];
  return q;
}
function wirdStreak() {
  try {
    const wd = (settings.deen && settings.deen.wirdDone) || {};
    let s = 0, d = new Date();
    if (!wd[prayerDateKey(d)]) d.setDate(d.getDate() - 1);
    while (wd[prayerDateKey(d)]) { s++; d.setDate(d.getDate() - 1); }
    return s;
  } catch (e) { return 0; }
}
function renderDeenExtras() {
  try {
    const dn = (settings && settings.deen) || {};
    // Quote of the open (rotates every popup open)
    const q = deenQuote(dn.opens || 0);
    const qEl = document.getElementById('deenQuote');
    if (qEl) qEl.innerHTML = escHtml(q.t) + '<span class="q-src">' + escHtml(q.s) + '</span>';
    const dq = document.getElementById('dashQuote');
    if (dq) dq.textContent = '💡 ' + q.t.slice(0, 90);
    // Adhkar toggles + times + done state
    const k = prayerDateKey();
    const ad = dn.adhkarDone || {};
    const mDone = !!(ad[k] && ad[k].morning), eDone = !!(ad[k] && ad[k].evening);
    const setRow = (rowId, btnId, done, label) => {
      const row = document.getElementById(rowId), btn = document.getElementById(btnId);
      if (row) row.classList.toggle('deen-done', done);
      if (btn) { btn.textContent = done ? 'تم ✅' : 'تم ✅'; btn.classList.toggle('go', !done); }
      void label;
    };
    setRow('adhkarMorningRow', 'adhkarMorningDone', mDone);
    setRow('adhkarEveningRow', 'adhkarEveningDone', eDone);
    const mt = document.getElementById('adhkarMorningTime'), et = document.getElementById('adhkarEveningTime');
    if (mt) mt.textContent = dn.adhkarMorning ? ('· ⏰ ' + (dn.morningTime || '')) : '· التذكير متوقف';
    if (et) et.textContent = dn.adhkarEvening ? ('· ⏰ ' + (dn.eveningTime || '')) : '· التذكير متوقف';
    const mo = document.getElementById('adhkarMorningOn'), eo = document.getElementById('adhkarEveningOn');
    const ma = document.getElementById('adhkarMorningAt'), ea = document.getElementById('adhkarEveningAt');
    if (mo && mo.checked !== !!dn.adhkarMorning) mo.checked = !!dn.adhkarMorning;
    if (eo && eo.checked !== !!dn.adhkarEvening) eo.checked = !!dn.adhkarEvening;
    if (ma && dn.morningTime) ma.value = dn.morningTime;
    if (ea && dn.eveningTime) ea.value = dn.eveningTime;
    // Wird
    const wg = document.getElementById('wirdGoal'), wt = document.getElementById('wirdGoalText');
    if (wg && dn.wird) wg.value = dn.wird;
    if (wt) wt.textContent = dn.wird ? ('📖 وردك: ' + dn.wird) : '📖 وردك اليومي';
    const ws = document.getElementById('wirdStreak');
    if (ws) {
      const st = wirdStreak();
      const doneToday = !!((dn.wirdDone || {})[k]);
      ws.textContent = doneToday ? 'تم ورد اليوم ✅' + (st > 1 ? ' · 🔥 ' + st + ' أيام' : '') : (st ? '🔥 سلسلة ' + st + ' أيام — واصل!' : 'ابدأ سلسلتك النهاردة 🌱');
    }
    const wb = document.getElementById('wirdDoneBtn');
    if (wb) wb.classList.toggle('go', !((dn.wirdDone || {})[k]));
  } catch (e) {}
}
function toggleAdhkarDone(which) {
  try {
    settings.deen = settings.deen || {};
    settings.deen.adhkarDone = settings.deen.adhkarDone || {};
    const k = prayerDateKey();
    settings.deen.adhkarDone[k] = settings.deen.adhkarDone[k] || {};
    settings.deen.adhkarDone[k][which] = !settings.deen.adhkarDone[k][which];
    save(); renderDeenExtras();
    if (settings.deen.adhkarDone[k][which]) toast(which === 'morning' ? '🌅 تقبل الله أذكار الصباح' : '🌙 تقبل الله أذكار المساء');
  } catch (e) {}
}
function nextDailyAt(timeStr) {
  const m = String(timeStr || '').match(/(\d{1,2}):(\d{2})/);
  const now = new Date();
  const at = new Date(now);
  if (m) at.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  else at.setHours(6, 30, 0, 0);
  if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
  return at.getTime();
}
function scheduleAdhkar() {
  try {
    const dn = (settings && settings.deen) || {};
    const jobs = [
      { on: dn.adhkarMorning, at: dn.morningTime, name: 'adhkar_morning' },
      { on: dn.adhkarEvening, at: dn.eveningTime, name: 'adhkar_evening' }
    ];
    jobs.forEach(j => {
      try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: j.name }); } catch (e) {}
      if (!j.on) return;
      try { chrome.runtime.sendMessage({ type: 'SET_ALARM', name: j.name, when: nextDailyAt(j.at) }); } catch (e) {}
    });
  } catch (e) {}
}

// ─── Deeds (custom Birr acts: check / counter / amount + period stats)
const DEED_KIND_AR = { check: 'إنجاز يومي ✅', counter: 'عدّاد 🔢', amount: 'مبلغ 💰' };
const DEED_TPL = {
  fasting: { name: 'صيام', kind: 'check', goal: 0, unit: '' },
  charity: { name: 'صدقة', kind: 'amount', goal: 0, unit: 'جنيه' },
  dhikr: { name: 'استغفار', kind: 'counter', goal: 1000, unit: '' }
};
function getDeeds() {
  try {
    settings.deen = settings.deen || {};
    if (!Array.isArray(settings.deen.deeds)) settings.deen.deeds = [];
    if (!settings.deen.deedLog || typeof settings.deen.deedLog !== 'object') settings.deen.deedLog = {};
    return settings.deen.deeds;
  } catch (e) { return []; }
}
function deedDayVal(id, dateK) {
  try {
    const log = (settings.deen && settings.deen.deedLog) || {};
    const d = log[id] || {};
    return d[dateK || prayerDateKey()] || 0;
  } catch (e) { return 0; }
}
function setDeedDayVal(id, dateK, val) {
  settings.deen = settings.deen || {};
  settings.deen.deedLog = settings.deen.deedLog || {};
  settings.deen.deedLog[id] = settings.deen.deedLog[id] || {};
  if (!val) delete settings.deen.deedLog[id][dateK];
  else settings.deen.deedLog[id][dateK] = val;
}
// Pure stats: {days, total} over last N days ('all' = everything logged)
function deedStats(logDates, period) {
  const keys = Object.keys(logDates || {}).filter(k => /^\d{2}-\d{2}-\d{4}$/.test(k) && Number(logDates[k]) > 0);
  let inRange = keys;
  if (period !== 'all') {
    const n = Number(period) || 30;
    // keys are DD-MM-YYYY; compare via normalized YYYYMMDD
    const norm = s => s.slice(6) + s.slice(3, 5) + s.slice(0, 2);
    const cutN = norm(prayerDateKey(new Date(Date.now() - (n - 1) * 86400000)));
    inRange = keys.filter(k => norm(k) >= cutN);
  }
  return { days: inRange.length, total: inRange.reduce((a, k) => a + Number(logDates[k] || 0), 0) };
}
function addDeed(name, kind, goal, unit) {
  name = String(name || '').trim();
  if (!name) { toast('⚠️ اسم العمل مطلوب'); return null; }
  if (!DEED_KIND_AR[kind]) kind = 'check';
  const d = { id: uid(), name: name.slice(0, 40), kind, goal: Math.max(0, parseInt(goal, 10) || 0), unit: String(unit || '').slice(0, 12), createdAt: new Date().toISOString() };
  getDeeds().unshift(d);
  save(); renderDeeds();
  toast('🤲 تمت إضافة: ' + d.name);
  return d;
}
function deleteDeed(id) {
  const ds = getDeeds();
  const d = ds.find(x => x.id === id);
  if (!d) return;
  if (!confirm('حذف "' + d.name + '" مع سجله؟')) return;
  settings.deen.deeds = ds.filter(x => x.id !== id);
  if (settings.deen.deedLog) delete settings.deen.deedLog[id];
  save(); renderDeeds();
}
function renderDeeds() {
  try {
    const list = document.getElementById('deedsList');
    if (!list) return;
    const period = (settings.deen && settings.deen.deedPeriod) || '30';
    document.querySelectorAll('#deedPeriodRow .seg-btn').forEach(b => b.classList.toggle('active', String(b.dataset.period) === String(period)));
    const ds = getDeeds();
    list.innerHTML = '';
    if (!ds.length) {
      list.innerHTML = '<div class="empty-state"><p>لا أعمال بعد — ضف صيام/صدقة/ذكر من الأزرار فوق 🤲</p></div>';
      return;
    }
    const k = prayerDateKey();
    ds.forEach(d => {
      const log = ((settings.deen || {}).deedLog || {})[d.id] || {};
      const st = deedStats(log, period);
      const today = Number(deedDayVal(d.id, k)) || 0;
      const card = document.createElement('div');
      card.className = 'project-card';
      const kindLbl = DEED_KIND_AR[d.kind] || d.kind;
      let ctrl = '';
      if (d.kind === 'check') {
        ctrl = '<button class="mini-btn ' + (today ? '' : 'go') + '" data-act="toggle">' + (today ? 'تم اليوم ✅' : 'علّم اليوم ✅') + '</button>';
      } else if (d.kind === 'counter') {
        const pct = d.goal > 0 ? Math.min(100, Math.round(today / d.goal * 100)) : 0;
        ctrl = '<div style="display:flex;gap:8px;align-items:center">' +
          '<button class="deed-tap" data-act="plus1" title="+1">+1</button>' +
          '<div style="flex:1"><div class="deed-num">' + today + (d.goal > 0 ? ' / ' + d.goal : '') + '</div>' +
          (d.goal > 0 ? '<div class="progress-line" style="margin-top:4px"><div style="width:' + pct + '%"></div></div>' : '') +
          '<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">' +
          '<button class="mini-btn" data-act="plus10">+10</button>' +
          '<button class="mini-btn" data-act="plus100">+100</button>' +
          '<input class="mini-select" data-goal style="width:80px" type="number" min="0" value="' + (d.goal || '') + '" placeholder="هدف" title="الهدف اليومي" />' +
          '</div></div></div>';
      } else {
        ctrl = '<div style="font-size:12px">اليوم: <b>' + today + '</b> ' + escHtml(d.unit || '') + '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<input class="form-input" data-amt type="number" min="0" placeholder="المبلغ" style="flex:1" />' +
          '<button class="mini-btn go" data-act="addAmt">+ إضافة</button></div>';
      }
      const statTxt = d.kind === 'check'
        ? '📅 أيام الإنجاز: <b>' + st.days + '</b>'
        : '📅 الأيام: <b>' + st.days + '</b> · الإجمالي: <b>' + st.total + '</b> ' + escHtml(d.unit || '');
      card.innerHTML = '<div class="project-header"><div>' +
        '<div class="project-name">🤲 ' + escHtml(d.name) + '</div>' +
        '<div class="project-count">' + kindLbl + ' · ' + statTxt + '</div></div>' +
        '<button class="task-act-btn" data-act="del" title="حذف" style="opacity:0.5">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button></div>' +
        '<div style="margin-top:8px">' + ctrl + '</div>';
      card.querySelector('[data-act="del"]').addEventListener('click', () => deleteDeed(d.id));
      const tg = card.querySelector('[data-act="toggle"]');
      if (tg) tg.addEventListener('click', () => {
        setDeedDayVal(d.id, k, today ? 0 : 1);
        save(); renderDeeds();
        if (!today) toast('🤲 تقبل الله: ' + d.name);
      });
      const p1 = card.querySelector('[data-act="plus1"]');
      if (p1) p1.addEventListener('click', () => { setDeedDayVal(d.id, k, today + 1); save(); renderDeeds(); });
      const p10 = card.querySelector('[data-act="plus10"]');
      if (p10) p10.addEventListener('click', () => { setDeedDayVal(d.id, k, today + 10); save(); renderDeeds(); });
      const p100 = card.querySelector('[data-act="plus100"]');
      if (p100) p100.addEventListener('click', () => { setDeedDayVal(d.id, k, today + 100); save(); renderDeeds(); });
      const gi = card.querySelector('[data-goal]');
      if (gi) gi.addEventListener('change', () => { d.goal = Math.max(0, parseInt(gi.value, 10) || 0); save(); renderDeeds(); });
      const ab = card.querySelector('[data-act="addAmt"]');
      if (ab) ab.addEventListener('click', () => {
        const inp = card.querySelector('[data-amt]');
        const v = Math.max(0, parseFloat(inp ? inp.value : 0) || 0);
        if (!v) { toast('⚠️ اكتب المبلغ'); return; }
        setDeedDayVal(d.id, k, today + v);
        save(); renderDeeds();
        toast('💰 اتسجلت صدقة ' + v + ' ' + (d.unit || ''));
      });
      list.appendChild(card);
    });
  } catch (e) {}
}

// ─── External tasbih mode (shortcut works with popup closed)
function tasbihDeed() {
  try {
    const tb = (settings && settings.tasbih) || {};
    const counters = getDeeds().filter(d => d.kind === 'counter');
    return counters.find(d => d.id === tb.deedId) || counters[0] || null;
  } catch (e) { return null; }
}
function updateTasbihBadge() {
  try {
    const tb = (settings && settings.tasbih) || {};
    const setTx = (t) => { try { if (chrome.action && chrome.action.setBadgeText) chrome.action.setBadgeText({ text: t }); } catch (e) {} };
    if (!tb.on) { setTx(''); return; }
    try { if (chrome.action && chrome.action.setBadgeBackgroundColor) chrome.action.setBadgeBackgroundColor({ color: '#01696f' }); } catch (e) {}
    const d = tasbihDeed();
    const total = d ? (Number(deedDayVal(d.id, prayerDateKey())) || 0) : 0;
    setTx(total > 0 ? (total > 9999 ? '9999+' : String(total)) : '');
  } catch (e) {}
}
function renderTasbihCard() {
  try {
    const on = document.getElementById('tasbihOn');
    const sel = document.getElementById('tasbihDeed');
    const today = document.getElementById('tasbihToday');
    if (!on || !sel) return;
    const tb = (settings && settings.tasbih) || {};
    if (on.checked !== !!tb.on) on.checked = !!tb.on;
    const counters = getDeeds().filter(d => d.kind === 'counter');
    const cur = sel.value;
    sel.innerHTML = '<option value="">— عدّاد الذكر —</option>';
    counters.forEach(d => {
      const o = document.createElement('option');
      o.value = d.id;
      o.textContent = d.name + (d.goal > 0 ? ' (' + d.goal + ')' : '');
      sel.appendChild(o);
    });
    sel.value = tb.deedId || (counters[0] && counters[0].id) || cur || '';
    const d = tasbihDeed();
    if (today) today.textContent = d ? String(Number(deedDayVal(d.id, prayerDateKey())) || 0) : '0';
    updateTasbihBadge();
  } catch (e) {}
}

// ─── Public announcements (published by admin, shown on dashboard)
function sanitizeAdHtml(html) {
  try {
    const tpl = document.createElement('template');
    tpl.innerHTML = String(html || '');
    tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, form, input, button, textarea, select').forEach(n => n.remove());
    // NOTE: <style> is intentionally KEPT (removed from the strip list above) so
    // published ad code keeps its CSS. Safe: <style> can't run JS, scripts /
    // event handlers / javascript: URLs are still stripped, and announcements
    // are admin-write-only (see firestore.rules).
    tpl.content.querySelectorAll('*').forEach(el => {
      Array.from(el.attributes).forEach(a => {
        const n = a.name.toLowerCase();
        if (n.startsWith('on') || ((n === 'href' || n === 'src' || n === 'action' || n === 'xlink:href') && /^\s*javascript:/i.test(a.value))) {
          el.removeAttribute(a.name);
        }
      });
    });
    return tpl.innerHTML;
  } catch (e) { return ''; }
}
function adField(v) {
  if (!v) return '';
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  return '';
}
async function fetchAds(force) {
  try {
    if (!force && adsCache && adsCache.at && Date.now() - adsCache.at < 30 * 60 * 1000) return adsCache.items || [];
    const c = window.TASKFLO_FIREBASE || {};
    if (!c.projectId) return adsCache.items || [];
    const res = await fetch('https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents/announcements');
    if (!res.ok) return adsCache.items || [];
    const j = await res.json().catch(() => ({}));
    let items = ((j && j.documents) || []).map(d => {
      const f = d.fields || {};
      return {
        id: String(d.name || '').split('/').pop(),
        title: adField(f.title), kind: adField(f.kind) || 'image',
        content: adField(f.content), active: f.active ? !!adField(f.active) : true,
        updatedAt: adField(f.updatedAt)
      };
    }).filter(a => a.active && a.content);
    items.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    items = items.slice(0, 3);
    adsCache = { at: Date.now(), items };
    try { chrome.storage.local.set({ adsCache }); } catch (e) {}
    return items;
  } catch (e) { return (adsCache && adsCache.items) || []; }
}
function youtubeId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i);
  return m ? m[1] : '';
}
async function renderAds() {
  const slot = document.getElementById('adsSlot');
  if (!slot) return;
  const items = await fetchAds(false);
  slot.innerHTML = '';
  items.forEach(a => {
    const card = document.createElement('div');
    card.className = 'dash-card ad-card';
    let body = '';
    if (a.kind === 'video') {
      const yid = youtubeId(a.content);
      if (yid) body = '<iframe src="https://www.youtube-nocookie.com/embed/' + yid + '" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
      else if (/^\s*https:\/\//i.test(a.content)) body = '<video controls preload="none" src="' + escHtml(a.content.trim()) + '"></video>';
      else return;
    } else if (a.kind === 'code') {
      const clean = sanitizeAdHtml(a.content);
      if (!clean.trim()) return;
      if (a.title) {
        const t = document.createElement('div');
        t.className = 'ad-title';
        t.textContent = a.title;
        card.appendChild(t);
      }
      // Scoped rendering: <style> inside Shadow DOM styles ONLY the ad and can
      // never leak into (or break) the extension UI. Scripts/event-handlers are
      // already stripped by sanitizeAdHtml; we strip scripts again for depth.
      const host = document.createElement('div');
      host.className = 'ad-html';
      try {
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = clean;
        shadow.querySelectorAll('script').forEach(n => n.remove());
      } catch (e) {
        host.innerHTML = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
        host.querySelectorAll('script').forEach(n => n.remove());
      }
      card.appendChild(host);
      slot.appendChild(card);
      return;
    } else {
      if (!/^\s*https:\/\//i.test(a.content)) return;
      const img = document.createElement('img');
      img.src = a.content.trim();
      img.alt = a.title || 'إعلان';
      img.loading = 'lazy';
      img.addEventListener('error', () => card.remove());
      body = '';
      if (a.title) {
        const t = document.createElement('div');
        t.className = 'ad-title';
        t.textContent = a.title;
        card.appendChild(t);
      }
      card.appendChild(img);
      slot.appendChild(card);
      return;
    }
    if (a.title) {
      const t = document.createElement('div');
      t.className = 'ad-title';
      t.textContent = a.title;
      card.appendChild(t);
    }
    const wrap = document.createElement('div');
    wrap.innerHTML = body;
    // Strip any script that slipped in (defense in depth; code already sanitized)
    wrap.querySelectorAll('script').forEach(n => n.remove());
    card.appendChild(wrap);
    slot.appendChild(card);
  });
}

// ─── Helpers ──────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDT(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleDateString('ar-EG',{month:'short',day:'numeric'}) + ' ' +
    d.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
}

// ─── Goals & Milestones ────────────────────────────────
function goalProgress(g) {
  const ms = g.milestones || [];
  if (ms.length) return Math.round(ms.filter(m => m.done).length / ms.length * 100);
  if (g.project) {
    const pt = tasks.filter(t => t.project === g.project && !t.archived);
    if (pt.length) return Math.round(pt.filter(t => t.done).length / pt.length * 100);
  }
  return g.done ? 100 : 0;
}
document.getElementById('addGoalBtn').addEventListener('click', () => {
  const inp = document.getElementById('newGoalTitle');
  const title = inp.value.trim();
  if (!title) return;
  const g = {
    id: uid(), title, project: document.getElementById('newGoalProject').value,
    targetDate: document.getElementById('newGoalDate').value, done: false,
    milestones: [], createdAt: new Date().toISOString()
  };
  goals.unshift(g);
  if (g.targetDate) {
    try { chrome.runtime.sendMessage({ type: 'SET_ALARM', name: 'goal_' + g.id, when: new Date(g.targetDate + 'T09:00:00').getTime() }); } catch(e) {}
  }
  inp.value = '';
  save(); renderGoals(); renderDashboard();
  toast('🎯 تم إنشاء الهدف');
});
function renderGoals() {
  const list = document.getElementById('goalsList');
  list.innerHTML = '';
  if (!goals.length) {
    list.innerHTML = '<div class="empty-state"><p>لا أهداف بعد — حوّل أهدافك لمهام قابلة للتنفيذ 🎯</p></div>';
    return;
  }
  goals.forEach(g => {
    const pct = goalProgress(g);
    const card = document.createElement('div');
    card.className = 'goal-card';
    card.innerHTML = `
      <div class="project-header">
        <div>
          <div class="project-name">🎯 ${escHtml(g.title)}${g.done ? ' ✅' : ''}</div>
          <div class="project-count">${g.project ? '📁 ' + escHtml(g.project) + ' · ' : ''}${g.targetDate ? '🎯 ' + g.targetDate : 'بدون موعد'}</div>
        </div>
        <span style="font-size:12px;font-weight:700;color:var(--primary)">${pct}%</span>
      </div>
      <div class="project-bar-bg"><div class="project-bar-fill" style="width:${pct}%"></div></div>
      <div class="sub-list">${(g.milestones || []).map(m => `<label class="sub-row${m.done ? ' done' : ''}"><input type="checkbox" data-ms="${m.id}" ${m.done ? 'checked' : ''} /><span>${escHtml(m.title)}</span></label>`).join('')}</div>
      <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
        <button class="mini-btn ms-add">+ مرحلة</button>
        <button class="mini-btn ms-done">${g.done ? 'إعادة فتح' : 'إنجاز الهدف'}</button>
        <button class="mini-btn ms-del">حذف</button>
      </div>`;
    card.querySelectorAll('[data-ms]').forEach(cb => {
      cb.addEventListener('change', () => {
        const m = (g.milestones || []).find(x => x.id === cb.dataset.ms);
        if (m) { m.done = cb.checked; save(); renderGoals(); renderDashboard(); }
      });
    });
    card.querySelector('.ms-add').addEventListener('click', () => {
      const name = prompt('اسم المرحلة الجديدة:');
      if (!name || !name.trim()) return;
      g.milestones = g.milestones || [];
      g.milestones.push({ id: uid(), title: name.trim(), done: false });
      save(); renderGoals();
    });
    card.querySelector('.ms-done').addEventListener('click', () => {
      g.done = !g.done;
      save(); renderGoals(); renderDashboard();
      toast(g.done ? '🎉 أحسنت! هدف مكتمل' : '🎯 أُعيد فتح الهدف');
    });
    card.querySelector('.ms-del').addEventListener('click', () => {
      if (!confirm('حذف الهدف؟')) return;
      try { chrome.runtime.sendMessage({ type: 'CLEAR_ALARM', name: 'goal_' + g.id }); } catch(e) {}
      goals = goals.filter(x => x.id !== g.id);
      save(); renderGoals(); renderDashboard();
    });
    list.appendChild(card);
  });
}

// ─── Pomodoro extras: task select, settings, history ───
function refreshPomoTaskSelect() {
  const sel = document.getElementById('pomoTask');
  if (!sel) return;
  const cur = pomoTaskId;
  sel.innerHTML = '<option value="">— بدون ربط —</option>';
  tasks.filter(t => !t.done && !t.archived).forEach(t => {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = (t.project ? '[' + t.project + '] ' : '') + t.title.slice(0, 45);
    sel.appendChild(o);
  });
  sel.value = cur || '';
}
const pomoTaskSel = document.getElementById('pomoTask');
if (pomoTaskSel) pomoTaskSel.addEventListener('change', () => { pomoTaskId = pomoTaskSel.value; save(); });
function bindPomoSettings() {
  const w = document.getElementById('setWork'), s = document.getElementById('setShort'), l = document.getElementById('setLong');
  if (w) w.value = settings.work;
  if (s) s.value = settings.short;
  if (l) l.value = settings.long;
  const au = document.getElementById('setAuto'), so = document.getElementById('setSound');
  if (au) au.checked = !!settings.auto;
  if (so) so.checked = settings.sound !== false;
  if (w) w.addEventListener('change', () => { settings.work = Math.min(180, Math.max(1, parseInt(w.value, 10) || 25)); if (!pomoRunning && pomoMode === 'work') { pomoRemaining = currentModeSecs(); pomoDuration = pomoRemaining; updatePomoDisplay(); } save(); setPomoModeUI(); });
  if (s) s.addEventListener('change', () => { settings.short = Math.min(60, Math.max(1, parseInt(s.value, 10) || 5)); if (!pomoRunning && pomoMode === 'short') { pomoRemaining = currentModeSecs(); pomoDuration = pomoRemaining; updatePomoDisplay(); } save(); setPomoModeUI(); });
  if (l) l.addEventListener('change', () => { settings.long = Math.min(90, Math.max(1, parseInt(l.value, 10) || 15)); if (!pomoRunning && pomoMode === 'long') { pomoRemaining = currentModeSecs(); pomoDuration = pomoRemaining; updatePomoDisplay(); } save(); setPomoModeUI(); });
  if (au) au.addEventListener('change', () => { settings.auto = au.checked; save(); });
  if (so) so.addEventListener('change', () => { settings.sound = so.checked; settings.notify.sound = so.checked; save(); applyNotifyUI(); });
}
function renderPomoExtras() {
  refreshPomoTaskSelect();
  // History
  const h = document.getElementById('pomoHistory');
  h.innerHTML = '';
  if (!focusSessions.length) h.innerHTML = '<div style="color:var(--faint)">لا جلسات مسجلة بعد 🍅</div>';
  focusSessions.slice(0, 8).forEach(s => {
    const t = s.taskId ? tasks.find(x => x.id === s.taskId) : null;
    const row = document.createElement('div');
    row.className = 'pomo-hist-row';
    row.innerHTML = '<span>🍅 ' + s.minutes + 'د</span><span>' + formatDT(s.at) + '</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + (t ? escHtml(t.title.slice(0, 25)) : escHtml(s.project || 'تركيز حر')) + '</span>';
    h.appendChild(row);
  });
  // Analytics: focus time per project (last 7d) + trend
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = focusSessions.filter(s => new Date(s.at).getTime() >= weekAgo);
  const byProj = {};
  recent.forEach(s => { const k = s.project || 'بدون مشروع'; byProj[k] = (byProj[k] || 0) + (s.minutes || 0); });
  const st = document.getElementById('focusStats');
  st.innerHTML = '';
  const totalW = recent.reduce((a, s) => a + (s.minutes || 0), 0);
  const top = Object.keys(byProj).sort((a, b) => byProj[b] - byProj[a]).slice(0, 4);
  const sumRow = document.createElement('div');
  sumRow.className = 'pomo-hist-row';
  sumRow.innerHTML = '<span>⏱ إجمالي 7 أيام: <b>' + fmtMins(totalW) + '</b></span><span>· ' + recent.length + ' جلسة</span>';
  st.appendChild(sumRow);
  top.forEach(p => {
    const r = document.createElement('div');
    r.className = 'pomo-hist-row';
    r.innerHTML = '<span>📁 ' + escHtml(p.slice(0, 18)) + '</span><span><b>' + fmtMins(byProj[p]) + '</b></span>';
    st.appendChild(r);
  });
  // Trend bars
  const tr = document.getElementById('focusTrend');
  tr.innerHTML = '';
  let mx = 1;
  const perDay = [];
  for (let i = 6; i >= 0; i--) {
    const k = todayStr(-i);
    const m = focusSessions.filter(s => (s.at || '').slice(0, 10) === k).reduce((a, s) => a + (s.minutes || 0), 0);
    perDay.push(m);
    if (m > mx) mx = m;
  }
  perDay.forEach(m => {
    const b = document.createElement('div');
    b.style.height = Math.max(6, Math.round(m / mx * 46)) + 'px';
    b.title = m + ' دقيقة';
    tr.appendChild(b);
  });
}

// ─── Init ─────────────────────────────────────────────
function init() {
  applyUI();
  bindPomoSettings();
  bindNotifyUI();
  refreshTemplateSelect();
  refreshFilterProjects();
  refreshRoutineProjects();
  bindHealthUI();
  ensureRoutines();
  applyHealthAlarm();
  // Deen: quote rotation per open + adhkar alarms
  try {
    settings.deen = settings.deen || {};
    settings.deen.opens = (settings.deen.opens || 0) + 1;
    save();
  } catch (e) {}
  try { scheduleAdhkar(); } catch (e) {}
  // Pomodoro durations from settings + recovery after accidental close
  pomoDuration = currentModeSecs();
  pomoRemaining = pomoDuration;
  if (pomoState && pomoState.endsAt && pomoState.endsAt > Date.now()) {
    pomoMode = pomoState.mode || 'work';
    pomoDuration = pomoState.total || currentModeSecs();
    pomoRemaining = Math.max(1, Math.round((pomoState.endsAt - Date.now()) / 1000));
    pomoTaskId = pomoState.taskId || pomoTaskId;
    pomoRunning = true;
    clearInterval(pomoInterval);
    pomoInterval = setInterval(tick, 1000);
    document.getElementById('pomoStart').textContent = '⏸ إيقاف';
    toast('🔄 استُعيدت جلسة التركيز');
  }
  setPomoModeUI();
  updatePomoDisplay();
  updateSessionDots();
  updateStats();
  renderDashboard();
  renderTasks();
  try { updateTasbihBadge(); } catch (e) {}
  // v2.4: account panel + cloud auto-sync (after local data ready)
  try { if (typeof TaskfloAccountInit === 'function') TaskfloAccountInit(); else if (window.TaskfloAccountInit) window.TaskfloAccountInit(); } catch (_) {}
  try { refreshAdminVisibility(); } catch (_) {}
}
load(init);
