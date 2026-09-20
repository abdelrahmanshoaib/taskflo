# TaskFlow Pro v2.2 — تصميم زجاجي + تخصيص كامل + إنتاجية متكاملة

> Chrome Extension (Manifest V3) — عربي RTL — يعمل 100% محلياً بدون سيرفر.

> Tasks + projects + routines + calendar + goals + pomodoro — Arabic RTL Chrome Extension, fully local, no backend.

> ⚠️ ملاحظة: صفحة GitHub تعرض الكود فقط ولا تشغّل التطبيق — للتشغيل ثبّته كإكستنشن من `chrome://extensions` عبر `Load unpacked`.

## المميزات | Features

- 🏠 داشبورد اليوم: مهام اليوم + متأخرة + خطة Must/Should/Could/Scheduled + مواعيد + مشاريع نشطة
- ✅ مهام: وصف + حالة (4) + أولوية (4) + وسوم + مهام فرعية + مدة مقدرة/فعلية + تكرار + سجل نشاط + بحث + فلاتر + تكرار نسخ + أرشفة + غفوة
- 🔁 روتين: يومي/أسبوعي/شهري/كل N يوم + توليد تلقائي بدون duplicate + إيقاف/تخطي + streak 🔥
- 📋 جدول مضغوط مرتب + 📁 مشاريع (وصف/deadline + kanban-mini + قوالب جاهزة)
- 📅 تقويم (يوم/أسبوع/شهر) + مواعيد + Time Blocking بدون مهام مكررة
- 🎯 أهداف بمراحل وتقدم تلقائي + ✨ مسودة ذكية (محلية، مراجعة قبل الحفظ)
- 🍅 بومودورو: مدد مخصصة + ربط بمهمة + سجل + تحليل 7 أيام + تعافي بعد القفل + انتقال تلقائي
- 🌙 دارك مود محفوظ + تخزين `chrome.storage.local` + ترحيل غير مُتلف للداتا القديمة + حماية XSS عبر `escHtml`
- ✨ هوية زجاجية Glassmorphism + تخصيص كامل: 6 ألوان تمييز + فاتح/داكن + زجاجي/مسطّح + كثافة مريحة/مضغوطة (⚙️ من الهيدر)

## التركيب | Structure

```
taskflo/
├── manifest.json      # MV3 — popup + service_worker + permissions
├── popup.html         # UI + CSS + JS (الواجهة كاملة inline)
├── background.js      # Service Worker — alarms + notifications
└── icons/             # icon16/32/48/128.png
```

## التشغيل محلياً | Run locally

1. افتح `chrome://extensions` وفعّل `Developer mode`
2. `Load unpacked` واختار مجلد المشروع
3. دوس على أيقونة TaskFlow Pro في التولبار

## التطوير | Development

- البيانات محفوظة في `chrome.storage.local`: `tasks / projects / routines / appointments / goals / focusSessions / settings`.
- الـ fallback لـ `localStorage` للتجربة كصفحة ويب عادية فقط (بدون منبهات).
- الترحيل additive فقط: `migrate()` يضيف الحقول الناقصة ولا يحذف أي داتا قديمة.

## خارطة الطريق | Roadmap (تم ✅ / قادم ⏳)

- [x] إصلاح حفظ التعديل + مسح `break_end` + عدّاد الجلسات + اتجاه الرينج + حفظ الثيم
- [x] بحث + فلاتر متقدمة + أرشفة + تكرار المهام
- [x] داشبورد + تقويم + أهداف + روتين + بومودورو مطوّر
- [ ] Drag-and-drop للتقويم + Timeline للمشاريع
- [ ] مزامنة `chrome.storage.sync`
