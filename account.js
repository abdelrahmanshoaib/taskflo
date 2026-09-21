// ─── Taskflo account panel UI (login + sync + backup) ─────
(function () {
  function $(id) { return document.getElementById(id); }
  function say(msg) {
    if (typeof toast === 'function') toast(msg);
    const el = $('syncResult');
    if (el) el.textContent = msg;
  }

  async function renderAccount() {
    const S = window.TaskfloSync;
    if (!S) return;
    const configured = S.isConfigured();
    const hint = $('firebaseHint');
    if (hint) hint.style.display = configured ? 'none' : '';
    const sess = await S.getSession();
    const prefs = await S.getPrefs();
    const formW = $('accFormWrap'), userW = $('accUserWrap');
    if (formW) formW.style.display = sess ? 'none' : '';
    if (userW) userW.style.display = sess ? '' : 'none';
    if (sess && $('accUserEmail')) $('accUserEmail').textContent = sess.email || sess.uid;
    if ($('accStatus')) {
      $('accStatus').innerHTML = sess
        ? '✅ مسجل دخول: <b>' + esc(sess.email || sess.uid) + '</b>'
        : (configured ? '☁️ مش مسجل — سجل دخول للمزامنة بين الأجهزة' : '⚠️ كمّل إعداد Firebase عشان اللوجن يشتغل');
    }
    if ($('syncAuto')) $('syncAuto').checked = prefs.auto !== false;
    if ($('lastSyncLabel')) {
      $('lastSyncLabel').textContent = prefs.lastSyncAt
        ? ('آخر مزامنة: ' + prefs.lastSyncAt.slice(0, 16).replace('T', ' ') + (prefs.lastDir === 'up' ? ' ⬆️' : prefs.lastDir === 'down' ? ' ⬇️' : ''))
        : 'لسه مفيش مزامنة';
    }
    // Show this device's exact redirect URI (copy-paste into Google Cloud)
    if ($('redirectUriLabel')) $('redirectUriLabel').textContent = deviceRedirect();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function deviceRedirect() {
    try { return 'https://' + chrome.runtime.id + '.chromiumapp.org/'; }
    catch (_) { return ''; }
  }
  function showGoogleErr() {
    const box = $('googleErrBox'), uri = $('googleErrUri');
    if (uri) uri.textContent = deviceRedirect();
    if (box) box.classList.add('show');
  }
  function hideGoogleErr() {
    const box = $('googleErrBox');
    if (box) box.classList.remove('show');
  }

  function bindOnce() {
    if (bindOnce._done) return;
    bindOnce._done = true;
    const S = window.TaskfloSync, B = window.TaskfloBackup;
    const email = () => ($('accEmail') && $('accEmail').value.trim()) || '';
    const pass = () => ($('accPass') && $('accPass').value) || '';

    if ($('btnLogin')) $('btnLogin').addEventListener('click', async () => {
      try {
        if (!email() || !pass()) { say('⚠️ اكتب الإيميل وكلمة السر'); return; }
        say('⏳ جاري تسجيل الدخول...');
        await S.signIn(email(), pass());
        say('✅ نورت! جاري جلب نسختك ☁️⬇️');
        try { await S.syncOnStart(); } catch (_) {}
        if (typeof renderAll === 'function') renderAll();
        renderAccount();
      } catch (e) { say('❌ ' + e.message); }
    });
    if ($('btnSignup')) $('btnSignup').addEventListener('click', async () => {
      try {
        if (!email() || !pass()) { say('⚠️ اكتب الإيميل وكلمة السر'); return; }
        say('⏳ جاري إنشاء الحساب...');
        await S.signUp(email(), pass());
        say('🎉 اتعمل الحساب! جاري رفع داتاك ☁️⬆️');
        try { await S.pushNow(); } catch (e) { say('✅ الحساب جاهز لكن الرفع فشل: ' + e.message); }
        renderAccount();
      } catch (e) { say('❌ ' + e.message); }
    });
    if ($('btnLogout')) $('btnLogout').addEventListener('click', async () => {
      await S.signOut();
      say('👋 خرجت — الداتا المحلية محفوظة على الجهاز');
      renderAccount();
    });
    if ($('btnGoogle')) $('btnGoogle').addEventListener('click', async () => {
      try {
        hideGoogleErr();
        say('⏳ جاري فتح دخول جوجل...');
        await S.signInWithGoogle();
        say('✅ نورت! جاري جلب نسختك ☁️⬇️');
        try { await S.syncOnStart(); } catch (_) {}
        if (typeof renderAll === 'function') renderAll();
        renderAccount();
      } catch (e) {
        const msg = e.message || '';
        say('❌ ' + msg);
        if (/redirect/i.test(msg)) showGoogleErr();
      }
    });
    if ($('btnCopyErrUri')) $('btnCopyErrUri').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(deviceRedirect());
        say('📋 اتنسخ رابط الـ redirect — الصقه في Google Cloud واضغط Save');
      } catch (e) { say('❌ فشل النسخ: ' + e.message); }
    });
    if ($('btnGoogleRetry')) $('btnGoogleRetry').addEventListener('click', () => {
      hideGoogleErr();
      if ($('btnGoogle')) $('btnGoogle').click();
    });
    if ($('syncAuto')) $('syncAuto').addEventListener('change', async () => {
      const p = await S.getPrefs();
      p.auto = $('syncAuto').checked;
      await S.setPrefs(p);
      say(p.auto ? '🔄 المزامنة التلقائية شغالة' : '⏸ المزامنة التلقائية وقفت');
      renderAccount();
    });
    if ($('btnPush')) $('btnPush').addEventListener('click', async () => {
      try { say('⏳ جاري الرفع ☁️⬆️...'); await S.pushNow(); say('✅ اترفعت نسختك للسحابة'); }
      catch (e) { say('❌ ' + e.message); }
      renderAccount();
    });
    if ($('btnPull')) $('btnPull').addEventListener('click', async () => {
      try {
        say('⏳ جاري التنزيل ☁️⬇️...');
        await S.pullNow();
        if (typeof renderAll === 'function') renderAll();
        say('✅ نزلت أحدث نسخة من السحابة');
      } catch (e) { say('❌ ' + e.message); }
      renderAccount();
    });

    // ── Backup: file + clipboard ──
    if ($('btnExportFile')) $('btnExportFile').addEventListener('click', () => {
      try {
        B.exportToFile();
        say('💾 اتحمّل ملف النسخة الاحتياطية');
      } catch (e) { say('❌ فشل التصدير: ' + e.message); }
    });
    if ($('btnCopyBackup')) $('btnCopyBackup').addEventListener('click', async () => {
      try {
        const txt = JSON.stringify(B.collectBackup());
        await navigator.clipboard.writeText(txt);
        say('📋 اتنسخت النسخة — الصقها في الجهاز التاني');
      } catch (e) { say('❌ فشل النسخ: ' + e.message); }
    });
    if ($('btnImportFile')) $('btnImportFile').addEventListener('click', () => {
      const f = $('importFileInput');
      if (f) f.click();
    });
    if ($('importFileInput')) $('importFileInput').addEventListener('change', () => {
      const f = $('importFileInput').files && $('importFileInput').files[0];
      if (!f) return;
      B.readFileAsText(f, (err, txt) => {
        if (err) { say('❌ ' + err); return; }
        try {
          const obj = JSON.parse(txt);
          B.applyBackup(obj, {}, (e2) => say(e2 ? '❌ ' + e2 : '✅ اتستوردت النسخة من الملف 🎉'));
        } catch (e) { say('❌ الملف مش JSON صالح'); }
        $('importFileInput').value = '';
      });
    });
    if ($('btnImportPaste')) $('btnImportPaste').addEventListener('click', () => {
      const t = ($('pasteArea') && $('pasteArea').value.trim()) || '';
      if (!t) { say('⚠️ الصق نص النسخة الأول'); return; }
      try {
        const obj = JSON.parse(t);
        B.applyBackup(obj, {}, (e2) => say(e2 ? '❌ ' + e2 : '✅ اتستوردت النسخة الملصوقة 🎉'));
      } catch (e) { say('❌ النص مش JSON صالح'); }
    });
    if ($('btnCopyRedirect')) $('btnCopyRedirect').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(deviceRedirect());
        say('📋 اتنسخ رابط الجهاز — الصقه في Google Cloud بدل السطر القديم');
      } catch (e) { say('❌ فشل النسخ: ' + e.message); }
    });
    if ($('btnDiagnose')) $('btnDiagnose').addEventListener('click', async () => {
      try {
        say('🩺 جاري فحص الإعداد...');
        const steps = await S.diagnoseCloud();
        const bad = steps.filter(s => !s.ok).length;
        say((bad ? '⚠️ ' : '✅ ') + steps.map(s => (s.ok ? '✔ ' : '✘ ') + s.text).join(' — '));
        renderAccount();
      } catch (e) { say('❌ فشل الفحص: ' + e.message); }
    });
  }

  // Called from popup.js init() after data load (decoupled).
  function accountInit() {
    bindOnce();
    renderAccount();
    try {
      if (window.TaskfloSync) {
        window.TaskfloSync.syncOnStart().then(() => {
          renderAccount();
          if (typeof renderAll === 'function') { try { renderAll(); } catch (_) {} }
        });
      }
    } catch (_) {}
  }

  window.renderAccount = renderAccount;
  window.TaskfloAccountInit = accountInit;
  // Fallback: if popup.js init doesn't call us, bind on DOM ready anyway.
  if (document.readyState !== 'loading') bindOnce();
  else document.addEventListener('DOMContentLoaded', bindOnce);
})();
