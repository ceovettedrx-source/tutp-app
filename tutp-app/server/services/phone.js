// One stored format for every phone number the app saves: "+91" followed
// by the last 10 digits, whatever was typed ("+91 99999 00003",
// "099999-00003", "9999900003"). findFamilyIdByPhone (server.js) narrows
// candidates by searching for the 10 digits as one unbroken run, which only
// works if the stored number has no spaces or dashes; migration 026 brought
// the existing rows into this format.
//
// normalizePhone returns null for fewer than 10 digits (including blank);
// hasPhoneInput tells blank (allowed where the phone is optional) from
// malformed (rejected). Unit-checked at the start of tests/e2e/login.spec.js.
export function normalizePhone(p) {
  const digits = String(p ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? '+91' + digits.slice(-10) : null;
}

export function hasPhoneInput(p) {
  return String(p ?? '').trim() !== '';
}
