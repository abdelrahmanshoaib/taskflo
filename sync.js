// ─── Taskflo cloud sync via Firebase REST (no SDK, MV3-safe) ───
// Auth: Email/Password (Identity Toolkit). Data: one Firestore doc per user.
// Doc: users/{uid}/data/main  { payload: <backup JSON string>, updatedAt: <ISO> }
// Conflict: last-write-wins by updatedAt.
(function () {
  const SESS_KEY = 'tfSession';
  const PREF_KEY = 'tfSyncPrefs';
  let pushTimer = null;

  function cfg() {
    return window.TASKFLO_FIREBASE || {};
  }
  function isConfigured() {
    const c = cfg();
    return !!(c.apiKey && c.projectId &&
      c.apiKey !== 'PASTE_YOUR_API_KEY_HERE' &&
      c.projectId !== 'YOUR_PROJECT_ID');
  }
  function docPath(uid) {
    const c = cfg();
    return 'https://firestore.googleapis.com/v1/projects/' + c.projectId +
      '/databases/(default)/documents/users/' + encodeURIComponent(uid) + '/data/main';
  }
  function getSession() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([SESS_KEY], (r) => resolve(r[SESS_KEY] || null));
      } catch (e) { resolve(null); }
    });
  }
  function setSession(s) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [SESS_KEY]: s }, () => resolve()); }
      catch (e) { resolve(); }
    });
  }
  function getPrefs() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([PREF_KEY], (r) => resolve(Object.assign({ auto: true }, r[PREF_KEY] || {})));
      } catch (e) { resolve({ auto: true }); }
    });
  }
  function setPrefs(p) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set({ [PREF_KEY]: p }, () => resolve()); }
      catch (e) { resolve(); }
    });
  }

  async function authCall(mode, email, password) {
    const c = cfg();
    const url = mode === 'signup'
      ? 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + c.apiKey
      : 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + c.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(authMsg(j && j.error && j.error.message));
    return j;
  }
  function authMsg(code) {
    const m = {
      EMAIL_EXISTS: 'الإيميل مسجل قبل كده — اعمل تسجيل دخول',
      EMAIL_NOT_FOUND: 'مفيش حساب بالإيميل ده — اعمل حساب جديد',
      INVALID_PASSWORD: 'كلمة السر غلط',
      INVALID_EMAIL: 'الإيميل مش صالح',
      WEAK_PASSWORD: 'كلمة السر ضعيفة (6 حروف على الأقل)',
      MISSING_PASSWORD: 'اكتب كلمة السر',
      USER_DISABLED: 'الحساب موقوف'
    };
    return m[code] || ('خطأ تسجيل الدخول: ' + (code || 'غير معروف'));
  }
  async function persistAuth(j, email) {
    const s = {
      uid: j.localId, email: email || j.email || '',
      idToken: j.idToken, refreshToken: j.refreshToken,
      expiresAt: Date.now() + (Number(j.expiresIn) || 3600) * 1000
    };
    await setSession(s);
    return s;
  }
  async function signUp(email, password) {
    if (!isConfigured()) throw new Error('كمل إعداد Firebase الأول (firebase-config.js)');
    const j = await authCall('signup', email, password);
    return persistAuth(j, email);
  }
  async function signIn(email, password) {
    if (!isConfigured()) throw new Error('كمل إعداد Firebase الأول (firebase-config.js)');
    const j = await authCall('signin', email, password);
    return persistAuth(j, email);
  }
  async function signOut() {
    await setSession(null);
  }
  async function refreshIdToken(sess) {
    const c = cfg();
    const res = await fetch('https://securetoken.googleapis.com/v1/token?key=' + c.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: sess.refreshToken })
    });
    const j = await res.json();
    if (!res.ok) throw new Error('انتهت الجلسة — سجل دخول تاني');
    sess.idToken = j.id_token;
    sess.refreshToken = j.refresh_token || sess.refreshToken;
    sess.expiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000;
    await setSession(sess);
    return sess;
  }
  async function validSession() {
    const s = await getSession();
    if (!s || !s.idToken) throw new Error('سجل دخول الأول');
    if (s.expiresAt && s.expiresAt - Date.now() > 5 * 60 * 1000) return s;
    if (!s.refreshToken) throw new Error('انتهت الجلسة — سجل دخول تاني');
    return refreshIdToken(s);
  }

  function collectLocal() {
    if (window.TaskfloBackup) return window.TaskfloBackup.collectBackup();
    return { app: 'taskflo', version: 1, exportedAt: new Date().toISOString(), data: {} };
  }

  // ─── Google sign-in (direct, via chrome.identity) ─────
  // Needs in firebase-config.js: googleClientId (Web-type OAuth client),
  // and in Google Cloud console: redirect URI https://<EXT_ID>.chromiumapp.org/
  function googleErr(msg, redirect) {
    msg = String(msg || '');
    if (/redirect_uri_mismatch|redirect|400/i.test(msg)) {
      return 'خطوة ناقصة: ضيف الرابط ده في Google Cloud → OAuth client → Authorized redirect URIs: ' + redirect;
    }
    if (/cancel|closed|abort/i.test(msg)) return 'اتلغى دخول جوجل';
    return 'فشل دخول جوجل: ' + msg;
  }
  async function signInWithGoogle() {
    const c = cfg();
    if (!isConfigured()) throw new Error('كمل إعداد Firebase الأول (firebase-config.js)');
    if (!c.googleClientId || c.googleClientId.indexOf('PASTE') === 0) {
      throw new Error('حط الـ googleClientId في firebase-config.js الأول (ابعتهولي وأنا أحطه)');
    }
    const redirect = 'https://' + chrome.runtime.id + '.chromiumapp.org/';
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth' +
      '?client_id=' + encodeURIComponent(c.googleClientId) +
      '&response_type=id_token' +
      '&redirect_uri=' + encodeURIComponent(redirect) +
      '&scope=' + encodeURIComponent('openid email profile') +
      '&nonce=' + encodeURIComponent(nonce) +
      '&prompt=select_account';
    let redirectUrl;
    try {
      redirectUrl = await new Promise((resolve, reject) => {
        try {
          chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (u) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(u);
          });
        } catch (e) { reject(e); }
      });
    } catch (e) { throw new Error(googleErr(e.message, redirect)); }
    const frag = String(redirectUrl || '').split('#')[1] || '';
    const params = new URLSearchParams(frag);
    if (params.get('error')) throw new Error(googleErr(params.get('error'), redirect));
    const idToken = params.get('id_token');
    if (!idToken) throw new Error('جوجل مرجعتش توكن — حاول تاني');
    // Exchange Google ID token for a Firebase credential
    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' + c.apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postBody: 'id_token=' + idToken + '&providerId=google.com',
        requestUri: redirect,
        returnSecureToken: true,
        returnIdpCredential: true
      })
    });
    const j = await res.json();
    if (!res.ok) {
      const em = (j && j.error && j.error.message) || res.status;
      if (/OPERATION_NOT_ALLOWED|provider.*disabled|not.*enabled/i.test(String(em))) {
        throw new Error('فعّل Google provider في Firebase → Authentication → Add new provider → Google');
      }
      throw new Error('فشل ربط جوجل: ' + em);
    }
    return persistAuth(j, j.email);
  }

  async function pushNow() {
    const s = await validSession();
    const b = collectLocal();
    const updatedAt = new Date().toISOString();
    b.exportedAt = updatedAt;
    const body = {
      fields: {
        payload: { stringValue: JSON.stringify(b).slice(0, 1000000) },
        updatedAt: { stringValue: updatedAt }
      }
    };
    const res = await fetch(docPath(s.uid), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.idToken },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error('فشل الرفع: ' + ((j && j.error && j.error.message) || res.status));
    }
    const p = await getPrefs();
    p.lastSyncAt = updatedAt;
    p.lastDir = 'up';
    await setPrefs(p);
    return updatedAt;
  }

  async function pullNow() {
    const s = await validSession();
    const res = await fetch(docPath(s.uid), {
      headers: { Authorization: 'Bearer ' + s.idToken }
    });
    if (res.status === 404) throw new Error('مفيش نسخة سحابية لسه — اعمل رفع الأول ☁️⬆️');
    if (!res.ok) throw new Error('فشل التنزيل: ' + res.status);
    const j = await res.json();
    const fields = (j && j.fields) || {};
    const payload = fields.payload && fields.payload.stringValue;
    const updatedAt = fields.updatedAt && fields.updatedAt.stringValue;
    if (!payload) throw new Error('النسخة السحابية فاضية');
    const obj = JSON.parse(payload);
    await new Promise((resolve, reject) => {
      window.TaskfloBackup.applyBackup(obj, { silent: true }, (err) => err ? reject(new Error(err)) : resolve());
    });
    const p = await getPrefs();
    p.lastSyncAt = updatedAt || new Date().toISOString();
    p.lastDir = 'down';
    await setPrefs(p);
    return p.lastSyncAt;
  }

  // Auto: pull-if-cloud-newer on login/init; push debounced after local save.
  async function syncOnStart() {
    try {
      const s = await getSession();
      if (!s) return 'no-session';
      const prefs = await getPrefs();
      if (prefs.auto === false) return 'auto-off';
      const sess = await validSession();
      const res = await fetch(docPath(sess.uid), {
        headers: { Authorization: 'Bearer ' + sess.idToken }
      });
      if (res.status === 404) { await pushNow(); return 'pushed-first'; }
      if (!res.ok) return 'pull-failed';
      const j = await res.json();
      const cloudAt = (j.fields && j.fields.updatedAt && j.fields.updatedAt.stringValue) || '';
      const lastSync = prefs.lastSyncAt || '';
      if (cloudAt && cloudAt > lastSync) {
        await pullNow();
        return 'pulled';
      }
      return 'up-to-date';
    } catch (e) { return 'error:' + e.message; }
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(async () => {
      try {
        const prefs = await getPrefs();
        if (prefs.auto === false) return;
        const s = await getSession();
        if (!s) return;
        await pushNow();
        if (typeof renderAccount === 'function') { try { renderAccount(); } catch (_) {} }
      } catch (e) { /* silent: user can sync manually */ }
    }, 2500);
  }

  // ─── Self-diagnostics (read-only, no side effects) ───
  // Returns [{ok, text}]: config present → apiKey valid? → Firestore reachable? → Google client present?
  async function diagnoseCloud() {
    const steps = [];
    const c = cfg();
    if (!isConfigured()) {
      steps.push({ ok: false, text: 'ملف firebase-config.js لسه بالقيم التجريبية — حط مفاتيحك الأول' });
      return steps;
    }
    steps.push({ ok: true, text: 'ملف الإعداد موجود (project: ' + c.projectId + ')' });
    try {
      const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + c.apiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      });
      const j = await res.json().catch(() => ({}));
      const msg = (j && j.error && j.error.message) || '';
      if (/API_KEY_INVALID|API key not valid/i.test(msg)) steps.push({ ok: false, text: 'الـ apiKey غير صالح — انسخه تاني من Project Settings' });
      else steps.push({ ok: true, text: 'الـ apiKey سليم' });
    } catch (e) { steps.push({ ok: false, text: 'تعذر الوصول لسيرفرات جوجل — اتأكد من الإنترنت' }); return steps; }
    try {
      const res = await fetch('https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents/users/__ping__/data/main');
      if (res.status === 200) {
        let leaked = false;
        try { const j = await res.json(); leaked = !!(j && j.fields && j.fields.payload); } catch (e) {}
        steps.push(leaked
          ? { ok: false, text: '⚠️ خطر: قراءة بدون دخول رجعت داتا! اقفل الـ Rules فوراً (per-user فقط)' }
          : { ok: true, text: 'Firestore متاح (الصلاحيات بتتحدد بالقواعد)' });
      }
      else if (res.status === 401 || res.status === 403 || res.status === 404 || res.status === 400) steps.push({ ok: true, text: 'Firestore متاح ومقفول بدون دخول (الصلاحيات بتتحدد بالقواعد)' });
      else steps.push({ ok: true, text: 'Firestore رد (status ' + res.status + ')' });
    } catch (e) { steps.push({ ok: false, text: 'تعذر الوصول لـ Firestore — اتأكد من إنشاء الداتابيز' }); }
    // Email/Password provider probe (harmless failed login with fake address — no side effects)
    try {
      const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + c.apiKey, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '__probe__@invalid.test', password: 'Probe12345678', returnSecureToken: true })
      });
      const j = await res.json().catch(() => ({}));
      const msg = String((j && j.error && j.error.message) || '');
      if (/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/i.test(msg)) steps.push({ ok: false, text: 'دخول الإيميل مقفول — فعّله من Authentication → Sign-in method → Email/Password' });
      else if (/EMAIL_NOT_FOUND|INVALID_PASSWORD|INVALID_EMAIL|USER_DISABLED/i.test(msg)) steps.push({ ok: true, text: 'دخول الإيميل مفعّل — تقدر تعمل حساب وتسجل دخول فوراً' });
      else steps.push({ ok: true, text: 'دخول الإيميل رد (' + (msg || res.status) + ')' });
    } catch (e) { steps.push({ ok: false, text: 'تعذر فحص دخول الإيميل' }); }
    if (c.googleClientId && c.googleClientId.indexOf('PASTE') !== 0 && /apps\.googleusercontent\.com/.test(c.googleClientId)) steps.push({ ok: true, text: 'Google Client ID موجود (فاضل تفعيل الـ provider + redirect URI)' });
    else steps.push({ ok: false, text: 'حط الـ googleClientId (نوع Web) في firebase-config.js لدخول جوجل' });
    return steps;
  }

  window.TaskfloSync = {
    isConfigured, getSession, getPrefs, setPrefs,
    signUp, signIn, signInWithGoogle, signOut, pushNow, pullNow, schedulePush, syncOnStart, diagnoseCloud
  };
})();
