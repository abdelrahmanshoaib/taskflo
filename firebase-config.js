// ─── Taskflo Firebase config (user fills once) ─────────────────
// 1) Go to https://console.firebase.google.com → Create project (e.g. taskflo-app)
// 2) Build → Authentication → Sign-in method → Enable "Email/Password"
// 3) Build → Firestore Database → Create database (production mode is fine)
//    Rules (basic, per-user only):
//      rules_version = '2';
//      service cloud.firestore {
//        match /databases/{db}/documents {
//          match /users/{userId}/{doc=**} {
//            allow read, write: if request.auth != null && request.auth.uid == userId;
//          }
//        }
//      }
// 4) Project Settings → General → Your apps → Web app (</>) → copy apiKey/authDomain/projectId here.
window.TASKFLO_FIREBASE = {
  apiKey: 'PASTE_YOUR_API_KEY_HERE',
  authDomain: 'YOUR_PROJECT.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID'
};
