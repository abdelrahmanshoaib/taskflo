# TaskFlow Pro v2.4 — حساب سحابي + مزامنة + نسخ احتياطي

> Chrome Extension (Manifest V3) — عربي RTL — محلي أولاً، مع مزامنة سحابية اختيارية عبر Firebase.

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
- 🔤 خطوط عربية (كايرو/المراعي/تجوال/بلكس/Satoshi) + تحكم في حجم الخط — من صفحة التخصيص
- ☁️ حساب (إيميل/كلمة سر عبر Firebase) + مزامنة تلقائية بين الأجهزة (رفع/تنزيل + last-write-wins)
- 🪪 بطاقة حالة الحساب في الداشبورد (إيميل المسجل + اختصار لتاب حسابي)
- 📢 إعلانات من لوحة الإدارة للرئيسية: صورة/فيديو/يوتيوب/كود HTML مطهّر + إظهار/إخفاء/حذف (قواعد Firestore مشمولة)
- ✨ ذكاء Gemini: خانة API Key في تاب حسابي (محلي على جهازك فقط — لا سحابة ولا نسخ) + زرار ✨ في المودال يحسّن المهمة (عنوان/وصف/فرعية/أولوية) للمراجعة قبل الحفظ — هات المفتاح مجاناً من aistudio.google.com
- 🤖 مساعد عائم: زر 🤖 على أي موقع يفتح شات Gemini بمهامك الحية (تذكير/تشجيع/إضافة مهام بالأمر) + تشغيل/إيقاف من ⚙️ (يطلب إذن المواقع مرة واحدة، بدون تحذير تسطيب)
- 🕌 مواقيت الصلاة (Aladhan API بدون مفاتيح): تذكير قبل الأذان بـ 5 دقائق + عدّاد تنازلي ثابت لحد التعليم ✅ + تاريخ هجري + اختيار المدينة وطريقة الحساب
- 🕌 قسم ديني: كل المواقيت + أذكار صباح/مساء بمنبهات يومية + ورد قرآني بسلسلة التزام 🔥 + حكمة/حديث تتغير كل فتحة
- 🤲 أعمال بر مخصصة: صيام (أيام) + صدقات (أيام + إجمالي مبلغ) + عدّاد ذكر بهدف يومي + أي عمل (يومي/عدّاد/مبلغ) مع إحصائيات أسبوع/شهر/الكل
- 📿 وضع التسبيح الخارجي: اختصار `Ctrl+Shift+Space` يزوّد عدّاد الذكر من أي موقع والبوب أب مقفول + العدد ظاهر على شارة الأيقونة (يتغيّر من chrome://extensions/shortcuts)
- 🔔 تحكم كامل في الإشعارات من ⚙️: تذكير الصلاة (المدة + تنبيه ثانٍ وقت الأذان) + إشعارات المهام والمتأخرة + صوت ومستوى الصوت مع زر تجربة
- 💾 نسخة احتياطية: تحميل ملف JSON + نسخ/لصق + استيراد من ملف (شغالة بدون أي إعداد)

## التركيب | Structure

```
taskflo/
├── manifest.json      # MV3 — popup + service_worker + permissions + firebase hosts
├── popup.html         # UI (تاب حسابي + نسخ احتياطي)
├── popup.js           # منطق التطبيق (save يدفع مزامنة تلقائية)
├── firebase-config.js # إعداد Firebase (تحط مفاتيحك هنا مرة واحدة)
├── sync.js            # مزامنة Firebase REST بدون SDK (MV3-safe)
├── backup.js          # تجميع/تطبيق/تصدير/استيراد النسخة
├── account.js         # واجهة الحساب والنسخ الاحتياطي
├── background.js      # Service Worker — alarms + notifications
└── icons/             # icon16/32/48/128.png
```

## الحساب السحابي | Cloud setup (مرة واحدة، ~5 دقائق)

> بدون الخطوات دي: الاستيراد/التصدير شغال عادي، واللوجن هيعرض تنبيه الإعداد.

1. افتح https://console.firebase.google.com واعمل مشروع (مثال: `taskflo-app`)
2. `Build → Authentication → Sign-in method` وفعّل **Email/Password**
3. `Build → Firestore Database → Create database` ثم حط القواعد دي (داتا كل يوزر خاصة بيه فقط):
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /users/{userId}/{doc=**} {
         allow read, write: if request.auth != null && request.auth.uid == userId;
       }
     }
   }
   ```
4. `Project Settings → General → Your apps → </> Web` وانسخ `apiKey` و `authDomain` و `projectId`
5. حطهم في ملف `firebase-config.js` بدل القيم الـ placeholder
6. اعمل Reload للإكستنشن من `chrome://extensions` → افتح تاب **حسابي** → اعمل حساب جديد بنفس الإيميل على كل أجهزتك ✅

## لوحة الإدارة | Admin (لإيميلك فقط)

> تبويب **👑 الإدارة** يظهر فقط لحساب `abdelrahmanshoaib@gmail.com`. إخفاؤه بالإيميل للراحة فقط — **الحماية الحقيقية برقم الـ UID في `firestore.rules`** (لا يمكن تزويره).
>
> 🌐 **لوحة الإدارة الكاملة (ويب): https://abdelrahmanshoaib.github.io/taskflo-admin/** — ريبو مستقل `taskflo-admin` بنفس Firebase: إحصائيات + بحث + تعديل اشتراكات + إعلانات. الدخول بإيميل/كلمة سر الأدمن فقط. من تبويب الإدارة في الإكستنشن: زرار **🌐 اللوحة الكاملة** يفتحها.
>
> ⚠️ مع كل تحديث يمس `firestore.rules`: أعد النشر في **Firestore → Rules → Publish**.

1. هات الـ UID بتاعك: Firebase Console → **Authentication → Users** → انسخ **UID** (عمود User UID)
2. ✅ تم: الـ UID متثبت في `firebase-config.js` و `firestore.rules` — فاضل تنشر القواعد بس (الخطوة 3)
3. في الكونسول: **Firestore → Rules** → الصق محتوى `firestore.rules` كاملاً → **Publish**
4. اعمل Reload للإكستنشن وسجل دخول → تبويب **الإدارة** يعرض المستخدمين (بيظهروا بعد أول دخول لهم — heartbeat) مع: الإيميل + آخر ظهور + الخطة + **ميعاد الانتهاء** + تفعيل/إيقاف → **💾 حفظ الاشتراك**
5. الغلق بميعاد = حقل «ينتهي في»: بعد التاريخ (بتوقيت سيرفر جوجل) الرفع/السحب بيترفض برسالة `⛔ الاشتراك منتهي` والداتا المحلية محفوظة. اللي بدون وثيقة اشتراك شغال كامل (توافق قديم).
6. حالة اشتراكك ظاهرة في تاب **حسابي** تحت الإيميل.

## دخول جوجل مباشر | Google sign-in (خطوة إضافية واحدة منك)

> الزرار موجود في تاب **حسابي** (`🔵 دخول بجوجل مباشر`) — بس محتاج Client ID منك الأول:

1. في Firebase: `Authentication → Add new provider → Google → Enable` (اختار support email) → Save
2. افتح [Google Cloud Console](https://console.cloud.google.com) على نفس المشروع (`taskflow-ad5fe`) → `APIs & Services → Credentials → Create Credentials → OAuth client ID`
3. ⚠️ اختار النوع **Web application** حصراً (مش Chrome Extension) وسمّيه `taskflo-ext`
4. تحت **Authorized redirect URIs** ضيف الرابط ده **بالسلاش `/` في الآخر بالظبط** (انسخه من زرار 📋 رابط الجهاز في تاب حسابي — أو من صندوق الخطأ لو ظهر):
   ```
   https://<EXTENSION_ID>.chromiumapp.org/
   ```
   مثال: `https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/`
   ثم Save واستنى **دقيقة أو دقيقتين** قبل التجربة (الانتشار بياخد وقت)
5. دوس Create وانسخ الـ **Client ID** وابعتهولي — أحطه في `firebase-config.js` وأعمل push
6. على أي جهاز تاني: نفس الـ Client شغال، بس ضيف الـ redirect URI بتاع الـ extension ID بتاع الجهاز ده (Edit على نفس الـ client → Add URI → Save) — مرة واحدة لكل جهاز

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
- [x] حساب سحابي Firebase + مزامنة تلقائية + نسخ احتياطي (ملف + نسخ/لصق)
- [ ] Drag-and-drop للتقويم + Timeline للمشاريع
