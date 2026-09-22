// TaskFlow Pro v2 — background service worker
// Backward-compatible: keeps reminder_/pomodoro_end/break_end protocol.
// Adds: appt_ alarms, goal_ alarms, overdue_sweep, SNOOZE.

function notify(id, title, message) {
  try {
    chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title, message, priority: 2
    });
  } catch (e) { /* icons missing in dev */ }
}

// ─── Health breaks (eye + move) — rotating motivational messages ───
const HEALTH_MSGS = [
  { title: '👁️ ريح عينيك', message: 'غمض عينيك 20 ثانية وبص على حاجة بعيدة (قاعدة 20-20-20) 👀' },
  { title: '🧍 قوم اتحرك', message: 'قوم من على الكمبيوتر، افرد ضهرك واتمشى دقيقتين 🧘' },
  { title: '💧 اشرب مياه', message: 'اشرب كوباية مياه وخد 3 أنفاس عميقة 💧' },
  { title: '🤸 فك جسمك', message: 'لف رقبتك وكتافك 10 مرات — جسمك هيشكرك 🙆' },
  { title: '👁️ عينيك أمانة', message: 'ارمش كتير وقلل سطوع الشاشة دقيقة 😌' },
  { title: '🚶 خطوات سريعة', message: 'اتمشى لحد الشباك وارجع — الدم يتحرك والتركيز يرجع ⚡' }
];

function fireHealthBreak() {
  try {
    chrome.storage.local.get(['healthIdx'], (r) => {
      const i = Number(r.healthIdx) || 0;
      const m = HEALTH_MSGS[i % HEALTH_MSGS.length];
      notify('health_' + Date.now(), m.title, m.message);
      try { chrome.storage.local.set({ healthIdx: i + 1 }); } catch (_) {}
    });
  } catch (_) {
    const m = HEALTH_MSGS[Math.floor(Math.random() * HEALTH_MSGS.length)];
    notify('health_' + Date.now(), m.title, m.message);
  }
}

// ─── Adhkar rotating messages ───
const ADHKAR_MORNING = [
  'أصبحنا وأصبح الملك لله، والحمد لله — ابدأ يومك بذكر الله 🌅',
  'اللهم بك أصبحنا وبك أمسينا وبك نحيا وبك نموت وإليك النشور ☀️',
  'سبحان الله وبحمده (100 مرة) — حُطت خطاياه ولو كانت مثل زبد البحر 🤍',
  'آية الكرسي — من قالها حين يصبح أُجير من الجن حتى يمسي 🛡️'
];
const ADHKAR_EVENING = [
  'أمسينا وأمسى الملك لله، والحمد لله — اختم يومك بذكر الله 🌙',
  'اللهم بك أمسينا وبك أصبحنا وبك نحيا وبك نموت وإليك المصير 🌌',
  'المعوذات (3 مرات) — تكفيك من كل شيء 🤲',
  'سبحان الله وبحمده، سبحان الله العظيم — كلمتان خفيفتان على اللسان 🌙'
];

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('prayer_')) {
    const parts = alarm.name.split('_');
    const en = parts[1] || '';
    const ar = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' }[en] || en;
    notify('prayer_' + Date.now(), '🕌 اقتربت صلاة ' + ar, 'استعد للصلاة — تقبل الله 🕌');
  } else if (alarm.name.startsWith('reminder_')) {
    const taskId = alarm.name.replace('reminder_', '');
    chrome.storage.local.get(['tasks'], (result) => {
      const tasks = result.tasks || [];
      const task = tasks.find(t => String(t.id) === String(taskId));
      if (task && !task.done && !task.archived) {
        notify('reminder_' + taskId,
          '⏰ تذكير: ' + task.title,
          task.project ? 'المشروع: ' + task.project : 'حان وقت المهمة!');
      }
    });
  } else if (alarm.name.startsWith('appt_')) {
    const apptId = alarm.name.replace('appt_', '');
    chrome.storage.local.get(['appointments'], (result) => {
      const appts = result.appointments || [];
      const a = appts.find(x => String(x.id) === String(apptId));
      if (a) {
        const when = a.start ? new Date(a.start).toLocaleString('ar-EG', { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        notify('appt_' + apptId,
          '📅 موعد: ' + a.title,
          (when ? when + ' — ' : '') + (a.location || a.project || 'حان الموعد!'));
      }
    });
  } else if (alarm.name.startsWith('goal_')) {
    const goalId = alarm.name.replace('goal_', '');
    chrome.storage.local.get(['goals'], (result) => {
      const goals = result.goals || [];
      const g = goals.find(x => String(x.id) === String(goalId));
      if (g && !g.done) notify('goal_' + goalId, '🎯 تذكير بالهدف: ' + g.title, 'الموعد المستهدف: ' + (g.targetDate || '—'));
    });
  } else if (alarm.name === 'pomodoro_end') {
    notify('pomo', '🍅 انتهت جلسة التركيز!', 'أحسنت! سُجّل وقتك، وخذ استراحة.');
  } else if (alarm.name === 'break_end') {
    notify('brk', '⚡ انتهت الاستراحة!', 'هيا نعمل مجددًا!');
  } else if (alarm.name === 'health_break') {
    fireHealthBreak();
  } else if (alarm.name.startsWith('prayerExact_')) {
    const parts = alarm.name.split('_');
    const en = parts[1] || '';
    const ar = { Fajr: 'الفجر', Dhuhr: 'الظهر', Asr: 'العصر', Maghrib: 'المغرب', Isha: 'العشاء' }[en] || en;
    notify('prayerx_' + Date.now(), '🕌 حان الآن: صلاة ' + ar, 'تقبل الله منا ومنكم 🕌');
  } else if (alarm.name === 'adhkar_morning' || alarm.name === 'adhkar_evening') {
    const morning = alarm.name === 'adhkar_morning';
    const pool = morning ? ADHKAR_MORNING : ADHKAR_EVENING;
    try {
      chrome.storage.local.get(['adhkarIdx'], (r) => {
        const i = Number((r && r.adhkarIdx) || 0);
        notify(alarm.name + '_' + Date.now(),
          morning ? '🌅 أذكار الصباح' : '🌙 أذكار المساء',
          pool[i % pool.length]);
        try { chrome.storage.local.set({ adhkarIdx: i + 1 }); } catch (_) {}
      });
    } catch (_) {
      notify(alarm.name + '_' + Date.now(), morning ? '🌅 أذكار الصباح' : '🌙 أذكار المساء', pool[0]);
    }
    // Self-sustaining daily: reschedule same alarm +24h
    try { chrome.alarms.create(alarm.name, { when: Date.now() + 24 * 60 * 60000 }); } catch (_) {}
  } else if (alarm.name === 'overdue_sweep') {
    chrome.storage.local.get(['tasks', 'settings'], (result) => {
      const tasks = result.tasks || [];
      const settings = result.settings || {};
      if (settings.overdueNotify === false) return;
      const today = new Date().toISOString().slice(0, 10);
      const n = tasks.filter(t => !t.done && !t.archived && t.due && t.due < today).length;
      if (n > 0) notify('overdue', '⚠️ مهام متأخرة (' + n + ')', 'راجع لوحة اليوم لتخطيط مهامك.');
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  try {
    if (msg.type === 'SET_ALARM') {
      chrome.alarms.create(msg.name, { when: msg.when });
      sendResponse({ ok: true });
    } else if (msg.type === 'CLEAR_ALARM') {
      chrome.alarms.clear(msg.name);
      sendResponse({ ok: true });
    } else if (msg.type === 'SET_PERIODIC') {
      // Repeating alarm every N minutes (health breaks)
      const mins = Math.max(1, Number(msg.minutes) || 30);
      chrome.alarms.create(msg.name, { periodInMinutes: mins });
      sendResponse({ ok: true });
    } else if (msg.type === 'SNOOZE') {
      // Re-schedule an existing alarm N minutes later
      const mins = Math.max(1, Number(msg.minutes) || 10);
      chrome.alarms.create(msg.name, { when: Date.now() + mins * 60000 });
      sendResponse({ ok: true });
    }
  } catch (e) { try { sendResponse({ ok: false }); } catch (_) {} }
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  // Daily overdue check at ~09:00 local: use periodInMinutes fallback (MV3 SW has no daily exact)
  try {
    chrome.alarms.create('overdue_sweep', { periodInMinutes: 12 * 60 });
  } catch (e) {}
});

// ─── Global tasbih tap (works with popup closed, on any site) ───
// Shortcut defined in manifest (Ctrl+Shift+Space, remappable at
// chrome://extensions/shortcuts). Chrome requires Ctrl/Alt/Shift combos —
// a bare single letter is not allowed for extension shortcuts.
function tasbihDateKey(d) {
  d = d || new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear();
}
function handleTasbihTap() {
  try {
    chrome.storage.local.get(['settings'], (r) => {
      try {
        const settings = r.settings || {};
        const tb = settings.tasbih || {};
        if (!tb.on) return;
        const deen = settings.deen || {};
        const deeds = Array.isArray(deen.deeds) ? deen.deeds : [];
        let deed = deeds.find(d => d.id === tb.deedId && d.kind === 'counter');
        if (!deed) deed = deeds.find(d => d.kind === 'counter');
        if (!deed) {
          // Auto-create a default tasbih counter so the shortcut just works
          deed = { id: 'tasbih_' + Date.now().toString(36), name: 'تسبيح', kind: 'counter', goal: 1000, unit: '', createdAt: new Date().toISOString() };
          deeds.unshift(deed);
        }
        deen.deedLog = deen.deedLog || {};
        const k = tasbihDateKey();
        deen.deedLog[deed.id] = deen.deedLog[deed.id] || {};
        deen.deedLog[deed.id][k] = (Number(deen.deedLog[deed.id][k]) || 0) + 1;
        settings.deen = deen;
        settings.tasbih = Object.assign({}, tb, { deedId: deed.id });
        chrome.storage.local.set({ settings }, () => {
          try {
            const total = deen.deedLog[deed.id][k];
            chrome.action.setBadgeBackgroundColor({ color: '#01696f' });
            chrome.action.setBadgeText({ text: total > 9999 ? '9999+' : String(total) });
          } catch (_) {}
        });
      } catch (_) {}
    });
  } catch (_) {}
}
try {
  if (chrome.commands && chrome.commands.onCommand) {
    chrome.commands.onCommand.addListener((cmd) => {
      if (cmd === 'tasbih-tap') handleTasbihTap();
    });
  }
} catch (_) {}
