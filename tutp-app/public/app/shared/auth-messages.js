// All sign-in text (en, te, hi) and the language pick, in one place.
// A plain script with no import/export, so /app/login/ can load it before
// anything else and show its "Checking your login…" spinner in the right
// language at once; /app/shared/phone-auth.js imports it for error text.
//   window.TUTP_AUTH_MESSAGES[lang][key]
//   window.tutpAuthLang()  ->  "en" | "te" | "hi"

// All user-facing auth error text, in one place for review.
// en is the fallback for a missing language or a missing key.
// te: reviewed 2026-09-27 (all keys up to generic). en and hi follow the same
// meaning; hi is still a draft: have a native speaker check it before release.
// sessionEnded, numberNotLinked, familyLoadFailed, signInAgain (2026-09-28,
// a sign-in that no longer matches a family): te and hi are drafts.
window.TUTP_AUTH_MESSAGES = {
  en: {
    checkingLogin:   "Checking your login…",
    phone:           "That phone number doesn't look right. Please check the 10 digits and try again.",
    tooMany:         "Too many attempts from this phone. Please wait a while and try again.",
    quota:           "We can't send codes right now. Please try again in a little while.",
    captcha:         "The security check didn't finish. Please refresh the page and try again.",
    network:         "Your internet connection is weak. Please check your network and try again.",
    wrongCode:       "That code is incorrect. Please check the SMS and try again.",
    missingCode:     "Please enter the 6-digit code from the SMS.",
    expired:         "This code has expired. Tap Resend to get a new one.",
    disabled:        "This account has been turned off. For help, email contact@tutp.online.",
    noCodeRequested: "Please tap Continue first to get a code.",
    generic:         "Something went wrong. Please try again.",
    sessionEnded:    "Your earlier sign-in has ended. Please sign in again with your phone number.",
    numberNotLinked: "This number isn't linked to a Tut-P family any more. Please sign in with the number you registered with.",
    familyLoadFailed: "We couldn't load your family. Please sign in again.",
    signInAgain:     "Sign in again"
  },
  te: {
    checkingLogin:   "మీ లాగిన్ తనిఖీ చేస్తున్నాం…",
    phone:           "ఈ ఫోన్ నంబర్ సరిగ్గా లేదు. 10 అంకెలను సరిచూసి మళ్ళీ ప్రయత్నించండి.",
    tooMany:         "ఈ ఫోన్ నుండి చాలా ఎక్కువ ప్రయత్నాలు జరిగాయి. కొంత సమయం ఆగి మళ్ళీ ప్రయత్నించండి.",
    quota:           "ప్రస్తుతం కోడ్‌లు పంపలేకపోతున్నాం. కొద్దిసేపటి తర్వాత మళ్ళీ ప్రయత్నించండి.",
    captcha:         "భద్రతా తనిఖీ పూర్తి కాలేదు. పేజీని రీఫ్రెష్ చేసి మళ్ళీ ప్రయత్నించండి.",
    network:         "ఇంటర్నెట్ సరిగ్గా అందడం లేదు. నెట్‌వర్క్ చూసి మళ్ళీ ప్రయత్నించండి.",
    wrongCode:       "ఈ కోడ్ తప్పు. SMS ను సరిచూసి మళ్ళీ ప్రయత్నించండి.",
    missingCode:     "SMS లో వచ్చిన 6 అంకెల కోడ్ టైప్ చేయండి.",
    expired:         "ఈ కోడ్ గడువు ముగిసింది. కొత్త కోడ్ కోసం Resend నొక్కండి.",
    disabled:        "ఈ ఖాతా నిలిపివేయబడింది. సహాయం కోసం contact@tutp.online కు మెయిల్ చేయండి.",
    noCodeRequested: "ముందుగా Continue నొక్కి కోడ్ పొందండి.",
    generic:         "ఏదో పొరపాటు జరిగింది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
    sessionEnded:    "మీ పాత లాగిన్ ముగిసింది. దయచేసి మీ ఫోన్ నంబర్‌తో మళ్ళీ లాగిన్ అవ్వండి.",
    numberNotLinked: "ఈ నంబర్ ఇప్పుడు ఏ Tut-P కుటుంబానికీ లింక్ అయి లేదు. మీరు నమోదు చేసుకున్న నంబర్‌తో లాగిన్ అవ్వండి.",
    familyLoadFailed: "మీ కుటుంబ వివరాలు లోడ్ కాలేదు. దయచేసి మళ్ళీ లాగిన్ అవ్వండి.",
    signInAgain:     "మళ్ళీ లాగిన్ అవ్వండి"
  },
  hi: {
    checkingLogin:   "आपका लॉगिन जाँचा जा रहा है…",
    phone:           "यह फ़ोन नंबर सही नहीं लग रहा। कृपया 10 अंक जाँचकर फिर से कोशिश करें।",
    tooMany:         "इस फ़ोन से बहुत ज़्यादा कोशिशें हो चुकी हैं। कृपया कुछ देर रुककर फिर से कोशिश करें।",
    quota:           "अभी कोड नहीं भेजा जा सकता। कृपया थोड़ी देर बाद फिर से कोशिश करें।",
    captcha:         "सुरक्षा जाँच पूरी नहीं हुई। कृपया पेज रीफ़्रेश करके फिर से कोशिश करें।",
    network:         "इंटरनेट ठीक से नहीं चल रहा। कृपया नेटवर्क जाँचकर फिर से कोशिश करें।",
    wrongCode:       "यह कोड गलत है। कृपया SMS जाँचकर फिर से कोशिश करें।",
    missingCode:     "कृपया SMS में आया 6 अंकों का कोड डालें।",
    expired:         "इस कोड की समय-सीमा खत्म हो गई है। नया कोड पाने के लिए Resend दबाएँ।",
    disabled:        "यह खाता बंद कर दिया गया है। मदद के लिए contact@tutp.online पर ईमेल करें।",
    noCodeRequested: "कृपया पहले Continue दबाकर कोड पाएँ।",
    generic:         "कुछ गड़बड़ हो गई। कृपया फिर से कोशिश करें।",
    sessionEnded:    "आपका पिछला लॉगिन समाप्त हो गया है। कृपया अपने फ़ोन नंबर से फिर से लॉगिन करें।",
    numberNotLinked: "यह नंबर अब किसी Tut-P परिवार से जुड़ा नहीं है। कृपया उस नंबर से लॉगिन करें जिससे आपने पंजीकरण किया था।",
    familyLoadFailed: "आपके परिवार की जानकारी लोड नहीं हो सकी। कृपया फिर से लॉगिन करें।",
    signInAgain:     "फिर से लॉगिन करें"
  }
};

// No language setting exists before login, so: an explicit
// localStorage tutp_ui_lang if set, else the browser's languages, else en.
window.tutpAuthLang = function() {
  try {
    const saved = localStorage.getItem('tutp_ui_lang');
    if (saved && window.TUTP_AUTH_MESSAGES[saved]) return saved;
  } catch (e) {}
  const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
  for (const p of prefs) {
    const base = String(p).toLowerCase().split('-')[0];
    if (window.TUTP_AUTH_MESSAGES[base]) return base;
  }
  return 'en';
};
