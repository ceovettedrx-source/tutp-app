// Firebase phone-OTP step shared by /app/login/, /app/register/,
// /app/register-teacher/ (and the old /app/teacher-register/ address, which
// now only redirects). Each page used to carry its own copy of this module.
//
// A page calls initPhoneAuth('<its recaptcha container id>'), which sets:
//   window.tutpSendOTP(fullPhoneNumber)  sends the SMS code
//   window.tutpVerifyOTP(code)           checks it, resolves to a Firebase ID token
//   window.tutpAuthErrorMessage(err)     plain-language text for any error
//                                        either of those throws
// The page keeps its own window.tutpEstablishSession, since what happens
// after the OTP differs per page.
//
// Error text: users never see err.message (Firebase's reads like
// "Firebase: Error (auth/too-many-requests)."). Every Firebase code is mapped
// to one key of AUTH_MESSAGES (kept in /app/shared/auth-messages.js), in
// the user's language.
//
// reCAPTCHA: the invisible verifier's token is single-use. After any failed
// send or confirm, the verifier is cleared and a fresh one is created on the
// next send; reusing the spent one is why a retry used to fail again.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getAuth, setPersistence, browserLocalPersistence, RecaptchaVerifier, signInWithPhoneNumber } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDkG5BoDtR-RutVu98saq4q06qhKdrtXo4", // secret-scan:allow (Firebase web API key, public by design)
  authDomain: "tut-p-98978.firebaseapp.com",
  projectId: "tut-p-98978",
  storageBucket: "tut-p-98978.firebasestorage.app",
  messagingSenderId: "706069048441",
  appId: "1:706069048441:web:da5dd699fe431e48fe78a8",
  measurementId: "G-02PZ2EFZVY"
};

import "/app/shared/auth-messages.js";

export const AUTH_MESSAGES = window.TUTP_AUTH_MESSAGES;

// Firebase error code -> AUTH_MESSAGES key. Anything unlisted is "generic",
// so the verify step only ever says the code is wrong when Firebase says so.
const CODE_TO_KEY = {
  'auth/invalid-phone-number':      'phone',
  'auth/missing-phone-number':      'phone',
  'auth/too-many-requests':         'tooMany',
  'auth/quota-exceeded':            'quota',
  'auth/captcha-check-failed':      'captcha',
  'auth/invalid-app-credential':    'captcha',
  'auth/network-request-failed':    'network',
  'auth/invalid-verification-code': 'wrongCode',
  'auth/missing-verification-code': 'missingCode',
  'auth/code-expired':              'expired',
  'auth/session-expired':           'expired',
  'auth/user-disabled':             'disabled',
  'auth/internal-error':            'generic',
  'tutp/no-code-requested':         'noCodeRequested'
};

export function authLang() {
  return window.tutpAuthLang();
}

export function authErrorMessage(err, lang) {
  const key = CODE_TO_KEY[err && err.code] || 'generic';
  const table = AUTH_MESSAGES[lang || authLang()] || AUTH_MESSAGES.en;
  return table[key] || AUTH_MESSAGES.en[key] || AUTH_MESSAGES.en.generic;
}

export function initPhoneAuth(containerId) {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  // Explicit, not relying on the SDK's undocumented-in-this-code default —
  // keeps the Firebase session alive across browser restarts, not just tabs.
  const persistenceReady = setPersistence(auth, browserLocalPersistence);

  let confirmationResult = null;
  let recaptchaVerifier = null;

  function resetRecaptcha() {
    if (recaptchaVerifier) {
      try { recaptchaVerifier.clear(); } catch (e) {}
      recaptchaVerifier = null;
    }
    // clear() can leave the widget's markup behind, and a new verifier
    // refuses a container that already holds one.
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '';
  }

  window.tutpSendOTP = async function(fullPhoneNumber){
    await persistenceReady;
    try {
      if (!recaptchaVerifier) {
        recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
      }
      confirmationResult = await signInWithPhoneNumber(auth, fullPhoneNumber, recaptchaVerifier);
    } catch (err) {
      resetRecaptcha();
      throw err;
    }
  };

  window.tutpVerifyOTP = async function(code){
    if (!confirmationResult) {
      const err = new Error('No code requested');
      err.code = 'tutp/no-code-requested';
      throw err;
    }
    try {
      const result = await confirmationResult.confirm(code);
      return result.user.getIdToken();
    } catch (err) {
      resetRecaptcha();
      throw err;
    }
  };

  window.tutpAuthErrorMessage = (err) => authErrorMessage(err);
}
