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
// 5) ADMIN: Firebase Console → Authentication → Users → copy YOUR uid → paste below.
//    Then open firestore.rules (in this repo) → replace PASTE_ADMIN_UID with the same uid
//    → Firebase Console → Firestore → Rules → paste → Publish.
window.TASKFLO_FIREBASE = {
  apiKey: 'AIzaSyA_5zBF9vTJcgIN2HA7eJsobFz23a7BqUo',
  authDomain: 'taskflow-ad5fe.firebaseapp.com',
  projectId: 'taskflow-ad5fe',
  // Admin dashboard (email gate is UI-only; real enforcement is the UID in firestore.rules)
  ADMIN_EMAIL: 'abdelrahmanshoaib@gmail.com',
  ADMIN_UID: 'KGwRkTCRWtY7v4Bc5lFrLwBxmqE2',
  // Google sign-in (Web-type OAuth client from Google Cloud → Credentials).
  // Send the Client ID here and I'll wire it; redirect URI per device:
  //   https://<EXTENSION_ID>.chromiumapp.org/  (find ID at chrome://extensions)
  googleClientId: '24055935578-0hv7holkdff9iqov23cppfnh02802rvp.apps.googleusercontent.com'
};
