// ─── Taskflo admin panel (visible to admin only; enforcement is in firestore.rules)
// Lists users via collectionGroup('profile') heartbeat docs + edits subscriptions.
// NOTE: hiding the tab by email is UX convenience — real access control is request.auth.uid in rules.
(function () {
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function cfg() { return window.TASKFLO_FIREBASE || {}; }
  async function adminToken() {
    const S = window.TaskfloSync;
    const s = await S.getSession();
    if (!s || !s.idToken) throw new Error('سجل دخول الأدمن الأول');
    return s;
  }
  function uidFromDocName(name) {
    const parts = String(name || '').split('/');
    const i = parts.indexOf('users');
    return i >= 0 && parts[i + 1] ? parts[i + 1] : '';
  }
  function fval(v) {
    if (!v) return '';
    if (v.stringValue !== undefined) return v.stringValue;
    if (v.booleanValue !== undefined) return v.booleanValue;
    if (v.timestampValue !== undefined) return v.timestampValue;
    return '';
  }
  async function listUsers() {
    const c = cfg();
    const s = await adminToken();
    const res = await fetch('https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents:runQuery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.idToken },
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'profile', allDescendants: true }],
        orderBy: [{ field: { fieldPath: 'updatedAt' }, direction: 'DESCENDING' }],
        limit: 100
      } })
    });
    const j = await res.json().catch(() => ([]));
    if (!res.ok) throw new Error('فشل جلب المستخدمين: ' + res.status);
    return (Array.isArray(j) ? j : []).filter(x => x && x.document).map(x => {
      const f = (x.document.fields) || {};
      return { uid: uidFromDocName(x.document.name), email: fval(f.email), updatedAt: fval(f.updatedAt), v: fval(f.v) };
    }).filter(u => u.uid);
  }
  async function getUserSub(uid, token) {
    const c = cfg();
    const res = await fetch('https://firestore.googleapis.com/v1/projects/' + c.projectId +
      '/databases/(default)/documents/users/' + encodeURIComponent(uid) + '/meta/subscription', {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('sub read: ' + res.status);
    const j = await res.json();
    const f = (j && j.fields) || {};
    return { plan: fval(f.plan) || 'مجاني', expiresAt: fval(f.expiresAt) || '', active: f.active ? !!fval(f.active) : true };
  }
  async function setUserSub(uid, token, sub) {
    const c = cfg();
    const res = await fetch('https://firestore.googleapis.com/v1/projects/' + c.projectId +
      '/databases/(default)/documents/users/' + encodeURIComponent(uid) + '/meta/subscription', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ fields: {
        plan: { stringValue: String(sub.plan || 'مجاني') },
        expiresAt: { stringValue: String(sub.expiresAt || '') },
        active: { booleanValue: !!sub.active },
        updatedAt: { stringValue: new Date().toISOString() }
      } })
    });
    if (!res.ok) throw new Error('sub write: ' + res.status);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return String(iso).slice(0, 16); }
  }
  async function renderAdminUsers() {
    const list = $('adminUsersList'), status = $('adminStatus');
    if (!list) return;
    try {
      if (status) status.textContent = '⏳ جاري جلب المستخدمين...';
      const users = await listUsers();
      const s = await window.TaskfloSync.getSession();
      list.innerHTML = '';
      if (!users.length) {
        list.innerHTML = '<div class="empty-state"><p>لا مستخدمين بعد — القائمة تتملي لما حد يسجل دخول (heartbeat)</p></div>';
      }
      users.forEach(u => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.innerHTML = '<div class="project-header"><div>' +
          '<div class="project-name">👤 ' + esc(u.email || u.uid.slice(0, 8)) + '</div>' +
          '<div class="project-count" dir="ltr">' + esc(u.uid.slice(0, 12)) + '…</div>' +
          '<div class="project-count">آخر ظهور: ' + esc(fmtDate(u.updatedAt)) + '</div>' +
          '<div class="project-count sub-line">⏳ جاري جلب الاشتراك...</div>' +
          '</div></div>' +
          '<div class="adv-row" style="margin-top:8px">' +
          '<select class="adv-select sub-plan"><option>مجاني</option><option>شهري</option><option>سنوي</option><option>مدى الحياة</option></select>' +
          '<input class="adv-select sub-exp" type="datetime-local" title="ينتهي في (ميعاد الغلق)" />' +
          '</div>' +
          '<div style="display:flex;gap:6px;margin-top:6px;align-items:center">' +
          '<label class="check-line"><input type="checkbox" class="sub-active" checked /> مفعّل</label>' +
          '<button class="mini-btn go sub-save" style="flex:1">💾 حفظ الاشتراك</button>' +
          '</div>';
        const planSel = card.querySelector('.sub-plan');
        const expInp = card.querySelector('.sub-exp');
        const actChk = card.querySelector('.sub-active');
        const subLine = card.querySelector('.sub-line');
        getUserSub(u.uid, s.idToken).then(sub => {
          if (!sub) {
            if (subLine) subLine.textContent = 'اشتراك: كامل (قديم/بدون قيد)';
            return;
          }
          if (planSel) planSel.value = ['مجاني', 'شهري', 'سنوي', 'مدى الحياة'].includes(sub.plan) ? sub.plan : 'مجاني';
          if (expInp && sub.expiresAt) {
            try { expInp.value = new Date(sub.expiresAt).toISOString().slice(0, 16); } catch (e) {}
          }
          if (actChk) actChk.checked = sub.active !== false;
          const expired = sub.expiresAt && new Date(sub.expiresAt).getTime() <= Date.now();
          if (subLine) subLine.textContent = 'اشتراك: ' + sub.plan + ' · ' + (sub.active === false || expired ? '⛔ منتهي/موقوف' : '✅ نشط حتى ' + fmtDate(sub.expiresAt));
        }).catch(() => { if (subLine) subLine.textContent = 'تعذر قراءة الاشتراك'; });
        card.querySelector('.sub-save').addEventListener('click', async () => {
          try {
            let exp = expInp && expInp.value ? new Date(expInp.value).toISOString() : '';
            if (planSel && planSel.value === 'مدى الحياة') exp = '2099-12-31T00:00:00.000Z';
            await setUserSub(u.uid, s.idToken, { plan: planSel ? planSel.value : 'مجاني', expiresAt: exp, active: actChk ? actChk.checked : true });
            if (typeof toast === 'function') toast('💾 حُفظ اشتراك ' + (u.email || u.uid.slice(0, 8)));
            renderAdminUsers();
          } catch (e) { if (typeof toast === 'function') toast('❌ ' + e.message); }
        });
        list.appendChild(card);
      });
      if (status) status.textContent = '👥 المستخدمون: ' + users.length;
    } catch (e) {
      if (status) status.textContent = '❌ ' + e.message;
    }
  }

  window.renderAdminUsers = renderAdminUsers;
  window.TaskfloAdmin = { listUsers, getUserSub, setUserSub };
  // ─── Announcements (image / video / code) ────────────
  function adsCol() {
    const c = cfg();
    return 'https://firestore.googleapis.com/v1/projects/' + c.projectId + '/databases/(default)/documents/announcements';
  }
  async function listAds() {
    const res = await fetch(adsCol());
    if (!res.ok) throw new Error('ads list: ' + res.status);
    const j = await res.json().catch(() => ({}));
    return ((j && j.documents) || []).map(d => {
      const f = d.fields || {};
      return {
        id: String(d.name || '').split('/').pop(),
        title: fval(f.title), kind: fval(f.kind) || 'image',
        content: fval(f.content), active: f.active ? !!fval(f.active) : true,
        updatedAt: fval(f.updatedAt)
      };
    });
  }
  async function createAd(ad) {
    const s = await window.TaskfloSync.getSession();
    const res = await fetch(adsCol(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.idToken },
      body: JSON.stringify({ fields: {
        title: { stringValue: String(ad.title || '') },
        kind: { stringValue: String(ad.kind || 'image') },
        content: { stringValue: String(ad.content || '') },
        active: { booleanValue: true },
        updatedAt: { stringValue: new Date().toISOString() }
      } })
    });
    if (!res.ok) throw new Error('ads create: ' + res.status);
  }
  async function setAdActive(id, active) {
    const s = await window.TaskfloSync.getSession();
    const res = await fetch(adsCol() + '/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.idToken },
      body: JSON.stringify({ fields: { active: { booleanValue: !!active } } })
    });
    if (!res.ok) throw new Error('ads update: ' + res.status);
  }
  async function deleteAd(id) {
    const s = await window.TaskfloSync.getSession();
    const res = await fetch(adsCol() + '/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + s.idToken }
    });
    if (!res.ok) throw new Error('ads delete: ' + res.status);
  }
  async function renderAdminAds() {
    const list = $('adminAdsList');
    if (!list) return;
    try {
      const ads = await listAds();
      list.innerHTML = '';
      if (!ads.length) list.innerHTML = '<div class="empty-state"><p>لا إعلانات — انشر أول إعلان 📢</p></div>';
      ads.forEach(a => {
        const card = document.createElement('div');
        card.className = 'project-card' + (a.active ? '' : ' routine-off');
        card.innerHTML = '<div class="project-header"><div>' +
          '<div class="project-name">' + (a.kind === 'image' ? '🖼️' : a.kind === 'video' ? '🎬' : '🧩') + ' ' + esc(a.title || '(بدون عنوان)') + '</div>' +
          '<div class="project-count">' + esc(String(a.content || '').slice(0, 60)) + '</div></div>' +
          '<span style="font-size:11px;color:var(--muted)">' + (a.active ? '✅ ظاهر' : '⏸ مخفي') + '</span></div>' +
          '<div style="display:flex;gap:6px;margin-top:8px">' +
          '<button class="mini-btn ad-toggle">' + (a.active ? 'إخفاء' : 'إظهار') + '</button>' +
          '<button class="mini-btn ad-del">حذف</button></div>';
        card.querySelector('.ad-toggle').addEventListener('click', async () => {
          try { await setAdActive(a.id, !a.active); renderAdminAds(); } catch (e) { if (typeof toast === 'function') toast('❌ ' + e.message); }
        });
        card.querySelector('.ad-del').addEventListener('click', async () => {
          if (!confirm('حذف الإعلان؟')) return;
          try { await deleteAd(a.id); renderAdminAds(); } catch (e) { if (typeof toast === 'function') toast('❌ ' + e.message); }
        });
        list.appendChild(card);
      });
    } catch (e) {
      list.innerHTML = '<div class="empty-state"><p>تعذر الجلب: ' + esc(e.message) + '</p></div>';
    }
  }
  // Refresh button (bound once at load; list itself loads on tab open)
  try {
    const rb = document.getElementById('btnAdminRefresh');
    if (rb) rb.addEventListener('click', () => renderAdminUsers());
    const ab = document.getElementById('btnAdAdd');
    if (ab) ab.addEventListener('click', async () => {
      try {
        const title = ($('adTitle') && $('adTitle').value.trim()) || '';
        const kind = ($('adKind') && $('adKind').value) || 'image';
        const content = ($('adContent') && $('adContent').value.trim()) || '';
        if (!content) { if (typeof toast === 'function') toast('⚠️ اكتب الرابط أو الكود'); return; }
        if (kind !== 'code' && !/^\s*https:\/\//i.test(content)) { if (typeof toast === 'function') toast('⚠️ الرابط لازم يبدأ بـ https://'); return; }
        await createAd({ title, kind, content });
        if ($('adTitle')) $('adTitle').value = '';
        if ($('adContent')) $('adContent').value = '';
        if (typeof toast === 'function') toast('📢 اتنشر الإعلان');
        renderAdminAds();
      } catch (e) { if (typeof toast === 'function') toast('❌ ' + e.message); }
    });
    const ar = document.getElementById('btnAdsRefresh');
    if (ar) ar.addEventListener('click', () => renderAdminAds());
  } catch (e) {}
  window.renderAdminAds = renderAdminAds;
})();
