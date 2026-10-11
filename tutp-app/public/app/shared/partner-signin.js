// Phone OTP step for the partner pages (/partners/ and /p/join/<token>).
// Uses the shared Firebase module, then exchanges the ID token for the app's
// own session cookie. Calls onSignedIn() when the cookie is set.
//   import { mountPartnerSignIn } from '/app/shared/partner-signin.js';
//   mountPartnerSignIn(element, { lang: 'en', onSignedIn: fn });
import { initPhoneAuth } from '/app/shared/phone-auth.js';

const TEXT = {
  en: { phone: 'Mobile number (10 digits)', send: 'Send code', code: 'Code from the SMS', verify: 'Verify', busy: 'Please wait...', bad: 'Enter a 10-digit mobile number.', fail: 'Could not sign in. Try again.' },
  te: { phone: 'మొబైల్ నంబర్ (10 అంకెలు)', send: 'కోడ్ పంపండి', code: 'SMS లో వచ్చిన కోడ్', verify: 'ధృవీకరించండి', busy: 'దయచేసి వేచి ఉండండి...', bad: '10 అంకెల మొబైల్ నంబర్ ఇవ్వండి.', fail: 'సైన్ ఇన్ కాలేదు. మళ్ళీ ప్రయత్నించండి.' },
  hi: { phone: 'मोबाइल नंबर (10 अंक)', send: 'कोड भेजें', code: 'SMS में आया कोड', verify: 'जाँचें', busy: 'कृपया प्रतीक्षा करें...', bad: '10 अंकों का मोबाइल नंबर डालें।', fail: 'साइन इन नहीं हो सका। फिर कोशिश करें।' },
};

function el(tag, attrs, text) {
  const e = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
  if (text) e.textContent = text;
  return e;
}

export function mountPartnerSignIn(root, opts) {
  const t = TEXT[opts && opts.lang] || TEXT.en;
  const onSignedIn = (opts && opts.onSignedIn) || function () {};
  const holder = el('div', { id: 'recaptcha-container-partner' });
  const phone = el('input', { type: 'tel', inputmode: 'numeric', maxlength: '10', placeholder: t.phone, 'aria-label': t.phone, id: 'partnerPhone' });
  const send = el('button', { type: 'button', id: 'partnerSend' }, t.send);
  const code = el('input', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: t.code, 'aria-label': t.code, id: 'partnerCode' });
  const verify = el('button', { type: 'button', id: 'partnerVerify' }, t.verify);
  const msg = el('p', { role: 'alert', id: 'partnerMsg' });
  code.hidden = true; verify.hidden = true;
  [holder, phone, send, code, verify, msg].forEach((n) => root.appendChild(n));
  initPhoneAuth('recaptcha-container-partner');

  send.addEventListener('click', async () => {
    msg.textContent = '';
    const digits = phone.value.replace(/\D/g, '');
    if (digits.length !== 10) { msg.textContent = t.bad; return; }
    send.disabled = true; send.textContent = t.busy;
    try {
      await window.tutpSendOTP('+91' + digits);
      phone.disabled = true; send.hidden = true; code.hidden = false; verify.hidden = false; code.focus();
    } catch (err) {
      msg.textContent = window.tutpAuthErrorMessage(err);
      send.disabled = false; send.textContent = t.send;
    }
  });
  verify.addEventListener('click', async () => {
    msg.textContent = '';
    verify.disabled = true; verify.textContent = t.busy;
    try {
      const idToken = await window.tutpVerifyOTP(code.value.trim());
      const r = await fetch('/api/session', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken }) });
      if (!r.ok) throw new Error('session');
      onSignedIn();
    } catch (err) {
      msg.textContent = err && err.code ? window.tutpAuthErrorMessage(err) : t.fail;
      verify.disabled = false; verify.textContent = t.verify;
    }
  });
}
