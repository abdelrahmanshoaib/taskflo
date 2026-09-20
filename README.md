# TaskFlow Pro — منظم مهام + مشاريع + تذكيرات + بومودورو

> Chrome Extension (Manifest V3) — عربي RTL — يعمل 100% محلياً بدون سيرفر.

> Task manager + projects + reminders + pomodoro — Arabic RTL Chrome Extension, fully local, no backend.

## المميزات | Features

- ✅ مهام: إضافة سريعة + مودال كامل (مشروع / أولوية / تاريخ / تذكير / ملاحظة) + فلترة + تنجيز + تعديل + حذف
- 📋 جدول مضغوط مرتب (غير المنجز أولاً ثم حسب التاريخ)
- 📁 مشاريع مع نسبة إنجاز و Progress Bar
- 🍅 بومودورو (عمل 25د / استراحة 5د / كبيرة 15د) مع حلقة SVG وإحصائيات وإشعارات حتى بعد قفل الـ popup
- 🌙 دارك مود + تخزين `chrome.storage.local` + حماية XSS عبر `escHtml`

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

- لا تشغّل سيرفر — Extension纯 أمامي، عدّل `popup.html` / `background.js` ثم `Reload` من صفحة الإكستنشن.
- البيانات محفوظة في `chrome.storage.local`: `tasks / projects / pomoStats`.
- الـ fallback لـ `localStorage` للتجربة كصفحة ويب عادية فقط.

## خارطة الطريق | Roadmap

- [ ] إصلاح حفظ التعديل (edit لا يعمل `save()` ولا يحدّث الـ alarm)
- [ ] إصلاح مسح `break_end` عند الإيقاف/إعادة البومودورو
- [ ] إصلاح عدّاد جلسات البداية (0 يعرض 4 dots)
- [ ] بحث في المهام + حفظ الثيم + مزامنة `chrome.storage.sync`
