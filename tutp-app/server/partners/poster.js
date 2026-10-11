// Printable A4 poster with the partner's QR (TUT-49), in Telugu, English or Hindi.
// Plain HTML with a print stylesheet; the partner opens it and prints.
// The wording is a first draft: the founder reviews the Telugu and Hindi text.
import { qrSvg } from './qr.js';

const TEXT = {
  en: {
    title: 'Learn with Tut-P',
    line1: 'Homework help for your child, in your language.',
    line2: 'Scan to join Tut-P',
    code: 'Partner code',
    foot: 'Joining is your choice. Nobody has to join Tut-P.',
    print: 'Print',
  },
  te: {
    title: 'Tut-P తో నేర్చుకోండి',
    line1: 'మీ పిల్లల హోంవర్క్‌కు మీ భాషలోనే సహాయం.',
    line2: 'Tut-P లో చేరడానికి స్కాన్ చేయండి',
    code: 'పార్టనర్ కోడ్',
    foot: 'చేరడం మీ ఇష్టం. ఎవరూ తప్పనిసరిగా చేరాల్సిన అవసరం లేదు.',
    print: 'ప్రింట్',
  },
  hi: {
    title: 'Tut-P के साथ सीखें',
    line1: 'आपके बच्चे के होमवर्क में आपकी भाषा में मदद।',
    line2: 'Tut-P से जुड़ने के लिए स्कैन करें',
    code: 'पार्टनर कोड',
    foot: 'जुड़ना आपकी मर्ज़ी है। किसी को भी जुड़ना ज़रूरी नहीं है।',
    print: 'प्रिंट करें',
  },
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function posterHtml({ lang, code, url, displayName }) {
  const t = TEXT[lang] || TEXT.en;
  return `<!doctype html>
<html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Telugu:wght@400;700&family=Noto+Sans+Devanagari:wght@400;700&family=Inter:wght@400;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4; margin: 14mm; }
  body { margin: 0; font-family: 'Inter','Noto Sans Telugu','Noto Sans Devanagari',sans-serif; color: #0f1b3d; text-align: center; }
  .sheet { max-width: 182mm; margin: 0 auto; padding: 16px; }
  h1 { font-size: 44px; margin: 18px 0 8px; }
  p.line { font-size: 22px; margin: 6px 0; }
  .qr { width: 110mm; max-width: 80vw; margin: 18px auto; }
  .qr svg { width: 100%; height: auto; }
  .code { font-size: 28px; font-weight: 700; letter-spacing: 3px; margin-top: 4px; }
  .who { font-size: 18px; margin-top: 10px; color: #3a4a78; }
  .foot { font-size: 15px; margin-top: 22px; color: #3a4a78; }
  button { font-size: 16px; padding: 10px 22px; margin: 14px; }
  @media print { button { display: none; } }
</style></head>
<body><div class="sheet">
  <h1>${esc(t.title)}</h1>
  <p class="line">${esc(t.line1)}</p>
  <p class="line"><b>${esc(t.line2)}</b></p>
  <div class="qr" role="img" aria-label="QR">${qrSvg(url)}</div>
  <div>${esc(t.code)}</div>
  <div class="code">${esc(code)}</div>
  <div class="who">${esc(displayName || '')}</div>
  <div class="foot">${esc(t.foot)}</div>
  <button onclick="window.print()">${esc(t.print)}</button>
</div></body></html>`;
}

// Prewritten WhatsApp message for the share button.
export function shareMessage(lang, url) {
  const m = {
    en: `Tut-P helps children with homework in their own language. You can try it here: ${url}`,
    te: `Tut-P పిల్లల హోంవర్క్‌కు వారి భాషలోనే సహాయం చేస్తుంది. ఇక్కడ చూడండి: ${url}`,
    hi: `Tut-P बच्चों के होमवर्क में उनकी भाषा में मदद करता है। यहाँ देखें: ${url}`,
  };
  return m[lang] || m.en;
}
