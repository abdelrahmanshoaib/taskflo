// ─── Taskflo backup: collect / apply / export / import ───────
// Pure logic + storage access. UI wiring lives in account.js.
(function () {
  const KEYS = ['dbVersion', 'tasks', 'projects', 'projectMeta', 'appointments',
    'goals', 'routines', 'focusSessions', 'settings', 'pomoStats', 'pomoTaskId', 'prayerCache', 'prayerDone'];

  function collectBackup() {
    return {
      app: 'taskflo',
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        dbVersion: typeof DB_VERSION !== 'undefined' ? DB_VERSION : 2,
        tasks: typeof tasks !== 'undefined' ? tasks : [],
        projects: typeof projects !== 'undefined' ? projects : ['عام'],
        projectMeta: typeof projectMeta !== 'undefined' ? projectMeta : {},
        appointments: typeof appointments !== 'undefined' ? appointments : [],
        goals: typeof goals !== 'undefined' ? goals : [],
        routines: typeof routines !== 'undefined' ? routines : [],
        focusSessions: typeof focusSessions !== 'undefined' ? focusSessions : [],
        settings: typeof settings !== 'undefined' ? settings : {},
        pomoStats: { today: typeof pomoSessionsToday !== 'undefined' ? pomoSessionsToday : 0, total: typeof pomoSessionsTotal !== 'undefined' ? pomoSessionsTotal : 0, day: new Date().toISOString().slice(0, 10) },
        pomoTaskId: typeof pomoTaskId !== 'undefined' ? pomoTaskId : '',
        prayerCache: typeof prayerCache !== 'undefined' ? prayerCache : null,
        prayerDone: typeof prayerDone !== 'undefined' ? prayerDone : {}
      }
    };
  }

  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') return 'ملف غير صالح';
    const d = obj.data || obj; // accept raw data object too
    if (!Array.isArray(d.tasks)) return 'النسخة لا تحتوي على مهام (tasks)';
    return null;
  }

  // Apply backup into memory + storage. opts: {silent:boolean}
  function applyBackup(obj, opts, cb) {
    const err = validateBackup(obj);
    if (err) { if (cb) cb(err); return; }
    const d = obj.data || obj;
    const apply = () => {
      try {
        tasks = Array.isArray(d.tasks) ? d.tasks : [];
        projects = Array.isArray(d.projects) && d.projects.length ? d.projects : ['عام'];
        projectMeta = d.projectMeta || {};
        appointments = d.appointments || [];
        goals = d.goals || [];
        routines = d.routines || [];
        focusSessions = d.focusSessions || [];
        if (d.settings) settings = d.settings;
        if (d.pomoStats) {
          pomoSessionsToday = d.pomoStats.today || 0;
          pomoSessionsTotal = d.pomoStats.total || 0;
        }
        if (d.pomoTaskId !== undefined) pomoTaskId = d.pomoTaskId || '';
        try { prayerCache = d.prayerCache || null; } catch (e) {}
        try { prayerDone = d.prayerDone || {}; } catch (e) {}
        if (typeof migrate === 'function') migrate();
        if (typeof save === 'function') save();
        if (typeof renderAll === 'function') renderAll();
        if (cb) cb(null);
      } catch (e) { if (cb) cb('فشل تطبيق النسخة: ' + e.message); }
    };
    if (opts && opts.silent) { apply(); return; }
    const n = (d.tasks || []).length;
    if (typeof confirm === 'function' && !confirm('استيراد نسخة فيها ' + n + ' مهمة؟\nهيستبدل الداتا الحالية.')) return;
    apply();
  }

  function downloadFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function exportToFile() {
    const b = collectBackup();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadFile('taskflo-backup-' + stamp + '.json', JSON.stringify(b, null, 2));
    return b;
  }

  function readFileAsText(file, cb) {
    const r = new FileReader();
    r.onload = () => cb(null, String(r.result || ''));
    r.onerror = () => cb('فشل قراءة الملف');
    r.readAsText(file);
  }

  window.TaskfloBackup = {
    KEYS, collectBackup, applyBackup, validateBackup, exportToFile, readFileAsText
  };
})();
