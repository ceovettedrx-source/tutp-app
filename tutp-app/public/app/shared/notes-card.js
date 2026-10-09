// Structured study-notes card (notes-design-v2). Plain script; exposes
//   TutpNotesCard.render(data, { lang })  ->  an <article> element
// data is the validated JSON from POST /api/homework-notes (server/
// notes-schema.js): title, key_idea, method[], worked_example{problem, steps[],
// answer}, key_terms[{term, meaning}], common_mistakes[], remember,
// quick_check[{q, a}], tell_your_child. Every field is optional; a missing one
// simply leaves its section out. All text goes in with textContent (never
// innerHTML), so model text can never become markup.
// No dependency on the homework modal: round 4's exam prep can reuse it.
// Section headings: the same { en, te, hi } table pattern as
// auth-messages.js, English fallback per key; te and hi are DRAFTS.
window.TUTP_NOTES_MESSAGES = {
    en: {
        'nd.notes': 'Notes', 'nd.keyIdea': 'Key idea', 'nd.method': 'How to do it', 'nd.example': 'Worked example',
        'nd.answer': 'Answer', 'nd.terms': 'Key words', 'nd.mistakes': 'Watch out', 'nd.remember': 'Remember',
        'nd.quick': 'Quick check', 'nd.tapAnswer': 'Tap to see the answer', 'nd.sayIt': 'Say it to your child'
    },
    te: {
        'nd.notes': 'నోట్స్', 'nd.keyIdea': 'ముఖ్య ఆలోచన', 'nd.method': 'ఎలా చేయాలి', 'nd.example': 'ఉదాహరణ',
        'nd.answer': 'సమాధానం', 'nd.terms': 'ముఖ్య పదాలు', 'nd.mistakes': 'జాగ్రత్త', 'nd.remember': 'గుర్తుంచుకోండి',
        'nd.quick': 'త్వరిత పరీక్ష', 'nd.tapAnswer': 'సమాధానం చూడటానికి నొక్కండి', 'nd.sayIt': 'మీ బిడ్డకు ఇలా చెప్పండి'
    },
    hi: {
        'nd.notes': 'नोट्स', 'nd.keyIdea': 'मुख्य विचार', 'nd.method': 'कैसे करें', 'nd.example': 'हल किया उदाहरण',
        'nd.answer': 'उत्तर', 'nd.terms': 'मुख्य शब्द', 'nd.mistakes': 'ध्यान रखें', 'nd.remember': 'याद रखें',
        'nd.quick': 'जल्दी जाँच', 'nd.tapAnswer': 'उत्तर देखने के लिए छुएँ', 'nd.sayIt': 'अपने बच्चे से ऐसे कहें'
    },
    // TUT-19: the other languages the app offers. DRAFTS until a native speaker has read them (Linear TUT-24).
    ta: {
        'nd.notes': 'நோட்ஸ்', 'nd.keyIdea': 'முக்கிய கருத்து', 'nd.method': 'எப்படிச் செய்வது', 'nd.example': 'தீர்த்த எடுத்துக்காட்டு',
        'nd.answer': 'விடை', 'nd.terms': 'முக்கிய சொற்கள்', 'nd.mistakes': 'கவனம்', 'nd.remember': 'நினைவில் வையுங்கள்',
        'nd.quick': 'விரைவுச் சோதனை', 'nd.tapAnswer': 'விடையைப் பார்க்கத் தொடுங்கள்', 'nd.sayIt': 'உங்கள் குழந்தையிடம் இப்படிச் சொல்லுங்கள்'
    },
    mr: {
        'nd.notes': 'नोट्स', 'nd.keyIdea': 'मुख्य कल्पना', 'nd.method': 'कसे करावे', 'nd.example': 'सोडवलेले उदाहरण',
        'nd.answer': 'उत्तर', 'nd.terms': 'मुख्य शब्द', 'nd.mistakes': 'सावधान', 'nd.remember': 'लक्षात ठेवा',
        'nd.quick': 'झटपट तपासणी', 'nd.tapAnswer': 'उत्तर पाहण्यासाठी स्पर्श करा', 'nd.sayIt': 'तुमच्या मुलाला असे सांगा'
    },
    es: {
        'nd.notes': 'Apuntes', 'nd.keyIdea': 'Idea clave', 'nd.method': 'Cómo se hace', 'nd.example': 'Ejemplo resuelto',
        'nd.answer': 'Respuesta', 'nd.terms': 'Palabras clave', 'nd.mistakes': 'Ojo', 'nd.remember': 'Recuerda',
        'nd.quick': 'Repaso rápido', 'nd.tapAnswer': 'Toca para ver la respuesta', 'nd.sayIt': 'Díselo a tu hijo así'
    },
    fr: {
        'nd.notes': 'Notes', 'nd.keyIdea': 'Idée clé', 'nd.method': 'Comment faire', 'nd.example': 'Exemple résolu',
        'nd.answer': 'Réponse', 'nd.terms': 'Mots clés', 'nd.mistakes': 'Attention', 'nd.remember': 'À retenir',
        'nd.quick': 'Vérification rapide', 'nd.tapAnswer': 'Touchez pour voir la réponse', 'nd.sayIt': 'Dites-le ainsi à votre enfant'
    },
    de: {
        'nd.notes': 'Notizen', 'nd.keyIdea': 'Kernidee', 'nd.method': 'So geht’s', 'nd.example': 'Gelöstes Beispiel',
        'nd.answer': 'Antwort', 'nd.terms': 'Schlüsselwörter', 'nd.mistakes': 'Achtung', 'nd.remember': 'Merke',
        'nd.quick': 'Kurzer Check', 'nd.tapAnswer': 'Tippen, um die Antwort zu sehen', 'nd.sayIt': 'So sagst du es deinem Kind'
    },
    ar: {
        'nd.notes': 'ملاحظات', 'nd.keyIdea': 'الفكرة الرئيسية', 'nd.method': 'كيف تفعل ذلك', 'nd.example': 'مثال محلول',
        'nd.answer': 'الإجابة', 'nd.terms': 'كلمات مفتاحية', 'nd.mistakes': 'انتبه', 'nd.remember': 'تذكّر',
        'nd.quick': 'فحص سريع', 'nd.tapAnswer': 'المس لرؤية الإجابة', 'nd.sayIt': 'قل لطفلك هكذا'
    }
};

(function () {
    const MSG = window.TUTP_NOTES_MESSAGES;
    const STYLE = `
.nd{--nd-ink:#181c20;--nd-soft:#414754;--nd-paper:#fffaf2;--nd-line:#eadfc8;--nd-amber:#805600;--nd-hl:#ffd98a;--nd-blue:#005bbf;--nd-green:#006d2c;--nd-red:#ba1a1a;
  box-sizing:border-box;max-width:100%;margin:8px 0 0;padding:16px 14px 18px;background:var(--nd-paper);border:1px solid var(--nd-line);border-radius:20px;color:var(--nd-ink);
  font-family:Inter,'Noto Sans Telugu','Noto Sans Devanagari','Noto Sans Tamil','Noto Sans Arabic','Nirmala UI','Segoe UI',system-ui,sans-serif;font-size:15px;line-height:1.55;overflow-wrap:anywhere;word-break:normal}
.nd[lang=te],.nd[lang=hi],.nd[lang=ta],.nd[lang=mr],.nd[lang=ar]{line-height:1.8}
.nd[dir=rtl]{text-align:right}
.nd *{box-sizing:border-box;min-width:0}
.nd p,.nd ol,.nd ul,.nd dl,.nd dd,.nd h3,.nd h4{margin:0;padding:0}
.nd .material-symbols-outlined{font-size:20px;line-height:1;flex:none;vertical-align:middle}
.nd-sec{margin-top:16px}
.nd-label{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--nd-amber)}
.nd[lang=te] .nd-label,.nd[lang=hi] .nd-label{letter-spacing:0;text-transform:none;font-size:13px}
.nd-kicker{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 8px;border-radius:999px;background:#fdaf0a;color:#281800;font-size:12px;font-weight:700}
.nd-title{margin:10px 0 0;font-family:'Plus Jakarta Sans',Inter,'Noto Sans Telugu','Noto Sans Devanagari','Nirmala UI',system-ui,sans-serif;font-size:21px;line-height:1.3;font-weight:700;color:var(--nd-ink)}
.nd[lang=te] .nd-title,.nd[lang=hi] .nd-title{line-height:1.5}
.nd-idea{margin-top:14px;padding:12px 12px 12px 14px;border-left:5px solid #fdaf0a;border-radius:4px 14px 14px 4px;background:#fff3d6}
.nd-idea p{font-size:17px;line-height:1.55;font-weight:600}
.nd-idea mark{background:linear-gradient(transparent 58%,var(--nd-hl) 58%);color:inherit;padding:0 2px;-webkit-box-decoration-break:clone;box-decoration-break:clone}
.nd-steps{list-style:none;counter-reset:nd}
.nd-steps li{counter-increment:nd;position:relative;padding:0 0 12px 40px}
.nd-steps li:last-child{padding-bottom:0}
.nd-steps li::before{content:counter(nd);position:absolute;left:0;top:0;width:28px;height:28px;border-radius:50%;background:var(--nd-amber);color:#fff;font-weight:700;font-size:14px;line-height:28px;text-align:center}
.nd-steps li::after{content:"";position:absolute;left:13px;top:30px;bottom:2px;width:2px;background:#e3cf9f}
.nd-steps li:last-child::after{display:none}
.nd-ex{padding:12px;background:#fff;border:2px dashed #c9b78f;border-radius:14px}
.nd-ex .nd-problem{font-size:16px;font-weight:700}
.nd-ex ol{margin:8px 0 0 20px;color:var(--nd-soft)}
.nd-ex li{margin:0 0 4px}
.nd-ans{display:flex;width:fit-content;max-width:100%;align-items:flex-start;gap:6px;margin-top:10px;padding:6px 12px 6px 8px;border-radius:16px;background:#89fa9b;color:#002108;font-weight:700;overflow-wrap:break-word}
.nd-ans small{flex:none;font-size:12px;font-weight:600;opacity:.8;white-space:nowrap;overflow-wrap:normal;line-height:24px}
.nd-ans-v{flex:1 1 auto;min-width:0}
.nd-listen{margin-top:10px;min-height:40px;padding:6px 14px;border:1px solid var(--nd-line);border-radius:999px;background:#fff;color:var(--nd-ink);font:inherit;font-weight:600;cursor:pointer}
.nd-listen:focus-visible{outline:3px solid var(--nd-blue);outline-offset:2px}
.nd .tl-wrap{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.nd .tl-note{font-size:13px;color:var(--nd-soft)}
.nd-terms dl{display:grid;gap:8px}
.nd-term{padding:8px 10px;background:#fff;border:1px solid var(--nd-line);border-radius:12px}
.nd-term dt{display:inline-block;padding:1px 10px;border-radius:999px;background:#d8e2ff;color:#004493;font-weight:700;font-size:14px}
.nd-term dd{margin-top:4px;color:var(--nd-soft)}
.nd-caution{padding:12px;background:#fff1ee;border-left:5px solid var(--nd-red);border-radius:4px 14px 14px 4px}
.nd-caution .nd-label{color:#93000a}
.nd-caution ul{list-style:none}
.nd-caution li{position:relative;padding-left:22px;margin:0 0 6px}
.nd-caution li:last-child{margin:0}
.nd-caution li::before{content:"\\2715";position:absolute;left:0;top:0;color:var(--nd-red);font-weight:700}
.nd-rem{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:16px;background:var(--nd-blue);color:#fff}
.nd-rem .nd-label{color:#d8e2ff;margin-bottom:2px}
.nd-rem p{font-size:16px;font-weight:700}
.nd-quick details{margin:0 0 8px;background:#fff;border:1px solid var(--nd-line);border-radius:12px}
.nd-quick summary{display:flex;gap:8px;align-items:flex-start;justify-content:space-between;padding:10px 12px;cursor:pointer;list-style:none;font-weight:600;min-height:44px}
.nd-quick summary::-webkit-details-marker{display:none}
.nd-quick summary .nd-hint{display:block;margin-top:2px;font-size:12px;font-weight:500;color:var(--nd-soft)}
.nd-quick summary .material-symbols-outlined{color:var(--nd-amber);transition:transform .15s}
.nd-quick details[open] summary .material-symbols-outlined{transform:rotate(180deg)}
.nd-quick summary:focus-visible{outline:3px solid var(--nd-blue);outline-offset:2px;border-radius:12px}
.nd-quick .nd-a{padding:0 12px 10px;color:var(--nd-green);font-weight:700}
.nd-say{position:relative;margin-top:18px;padding:12px 14px 12px 12px;background:#e3f9e7;border:2px solid #6ddd81;border-radius:18px 18px 18px 4px;display:flex;gap:10px;align-items:flex-start}
.nd-say::after{content:"";position:absolute;left:14px;bottom:-12px;width:18px;height:12px;background:#e3f9e7;clip-path:polygon(0 0,100% 0,0 100%);filter:drop-shadow(-2px 1px 0 #6ddd81)}
.nd-say .nd-label{color:var(--nd-green);margin-bottom:2px}
.nd-say q{display:block;font-size:16px;line-height:1.6;quotes:"\\201C" "\\201D"}
@media print{
  .nd{background:#fff;border:0;border-radius:0;padding:0;color:#000;font-size:12pt}
  .nd .material-symbols-outlined,.nd-quick summary .material-symbols-outlined{display:none}
  .nd-sec,.nd-idea,.nd-ex,.nd-caution,.nd-rem,.nd-say,.nd-term,.nd-quick details{break-inside:avoid;page-break-inside:avoid}
  .nd-noprint{display:none!important}
  .nd-kicker{background:none;border:1px solid #000;color:#000}
  .nd-idea,.nd-caution,.nd-say,.nd-ex,.nd-term,.nd-quick details{background:#fff;border-color:#000}
  .nd-idea mark{background:none;font-weight:700}
  .nd-steps li::before{background:#fff;color:#000;border:1px solid #000;line-height:26px}
  .nd-steps li::after,.nd-say::after{display:none}
  .nd-rem{background:#fff;color:#000;border:2px solid #000}.nd-rem .nd-label{color:#000}
  .nd-ans{background:#fff;color:#000;border:1px solid #000}
  .nd-label,.nd-caution .nd-label,.nd-say .nd-label{color:#000}
  .nd-quick summary .nd-hint{display:none}.nd-quick .nd-a{color:#000}
}`;

    function uiLang(requested) {
        if (requested && MSG[requested]) return requested;
        try { const s = localStorage.getItem('tutp_ui_lang'); if (s && MSG[s]) return s; } catch (e) {}
        const prefs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en'];
        for (const p of prefs) { const b = String(p).toLowerCase().split('-')[0]; if (MSG[b]) return b; }
        return 'en';
    }

    function injectStyle() {
        if (document.getElementById('ndStyle')) return;
        const s = document.createElement('style');
        s.id = 'ndStyle';
        s.textContent = STYLE;
        document.head.appendChild(s);
    }

    function el(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function icon(name) {
        const s = el('span', 'material-symbols-outlined', name);
        s.setAttribute('aria-hidden', 'true');
        return s;
    }
    const arr = (v) => (Array.isArray(v) ? v : []);
    const str = (v) => (typeof v === 'string' ? v : (typeof v === 'number' ? String(v) : ''));

    function render(data, opts) {
        injectStyle();
        const lang = uiLang(opts && opts.lang);
        const t = (k) => (MSG[lang] && MSG[lang][k]) || MSG.en[k] || k;
        const d = data || {};
        const root = el('article', 'nd');
        root.setAttribute('lang', lang);
        if (lang === 'ar') root.setAttribute('dir', 'rtl');
        // Each element carries data-inv="notes.<element>" for the feature-inventory e2e (tests/e2e/inventory.spec.js).
        const inv = (node, name) => { node.setAttribute('data-inv', name); return node; };
        inv(root, 'notes.card');
        const section = (cls, label, iconName) => {
            const s = el('section', 'nd-sec ' + cls);
            if (label) { const h = el('h4', 'nd-label'); if (iconName) h.appendChild(icon(iconName)); h.appendChild(document.createTextNode(label)); s.appendChild(h); }
            return s;
        };

        // A div, not <header>: the pages' print CSS hides every <header>.
        const head = el('div', 'nd-head');
        const kicker = el('span', 'nd-kicker');
        kicker.append(icon('menu_book'), document.createTextNode(t('nd.notes')));
        head.appendChild(kicker);
        if (str(d.title)) head.appendChild(el('h3', 'nd-title', str(d.title)));
        root.appendChild(head);

        // TUT-7: Listen reads the card in the "Explain in" language; never hidden.
        if (window.TutpListen) {
            const say = [str(d.title), str(d.key_idea), arr(d.method).map(str).join('. '),
                d.worked_example ? [str(d.worked_example.problem), arr(d.worked_example.steps).map(str).join('. '), str(d.worked_example.answer)].join('. ') : '',
                str(d.remember)].filter(Boolean).join('. ');
            const lw = window.TutpListen.button(() => say, (opts && opts.speechLang) || lang, { className: 'nd-listen' });
            lw.className += ' nd-noprint';
            head.appendChild(inv(lw, 'notes.listen'));
        }

        // img1: the concept's picture (shared with Answer, Explain and Story). Nothing is shown
        // when the server sent none, or cannot make one.
        if (d.picture && window.TutpPicture) {
            const picHost = inv(el('div', 'nd-picture'), 'notes.picture');
            root.appendChild(picHost);
            window.TutpPicture.mount(picHost, d.picture, { studentId: sessionStorage.getItem('tutp_student_id'), surface: 'notes' }, { variant: 'hero', alt: str(d.title) });
        }

        if (str(d.key_idea)) {
            const s = el('section', 'nd-idea');
            const h = el('h4', 'nd-label'); h.append(icon('lightbulb'), document.createTextNode(t('nd.keyIdea')));
            const p = el('p'); p.appendChild(el('mark', null, str(d.key_idea)));
            s.append(h, p);
            root.appendChild(s);
        }
        const method = arr(d.method).map(str).filter(Boolean);
        if (method.length) {
            const s = inv(section('nd-method', t('nd.method'), 'format_list_numbered'), 'notes.steps');
            const ol = el('ol', 'nd-steps');
            method.forEach((m) => ol.appendChild(el('li', null, m)));
            s.appendChild(ol);
            root.appendChild(s);
        }
        const ex = d.worked_example;
        if (ex && str(ex.problem)) {
            const s = section('nd-example', t('nd.example'), 'edit_note');
            const box = el('div', 'nd-ex');
            box.appendChild(el('p', 'nd-problem', str(ex.problem)));
            const steps = arr(ex.steps).map(str).filter(Boolean);
            if (steps.length) { const ol = el('ol'); steps.forEach((x) => ol.appendChild(el('li', null, x))); box.appendChild(ol); }
            if (str(ex.answer)) {
                const chip = inv(el('div', 'nd-ans'), 'notes.answer');
                const small = el('small', null, t('nd.answer'));
                chip.append(icon('check_circle'), small, el('span', 'nd-ans-v', str(ex.answer)));
                box.appendChild(chip);
            }
            s.appendChild(box);
            root.appendChild(s);
        }
        const terms = arr(d.key_terms).filter((x) => x && str(x.term) && str(x.meaning));
        if (terms.length) {
            const s = section('nd-terms', t('nd.terms'), 'translate');
            const dl = el('dl');
            terms.forEach((x) => { const row = el('div', 'nd-term'); row.append(el('dt', null, str(x.term)), el('dd', null, str(x.meaning))); dl.appendChild(row); });
            s.appendChild(dl);
            root.appendChild(s);
        }
        const mistakes = arr(d.common_mistakes).map(str).filter(Boolean);
        if (mistakes.length) {
            const s = section('nd-caution', t('nd.mistakes'), 'warning');
            const ul = el('ul');
            mistakes.forEach((m) => ul.appendChild(el('li', null, m)));
            s.appendChild(ul);
            root.appendChild(s);
        }
        if (str(d.remember)) {
            const s = inv(section('nd-rem'), 'notes.tip');
            s.appendChild(icon('push_pin'));
            const box = el('div');
            box.append(el('h4', 'nd-label', t('nd.remember')), el('p', null, str(d.remember)));
            s.appendChild(box);
            root.appendChild(s);
        }
        const quick = arr(d.quick_check).filter((x) => x && str(x.q) && str(x.a));
        if (quick.length) {
            const s = section('nd-quick', t('nd.quick'), 'quiz');
            quick.forEach((x) => {
                const det = el('details');
                const sum = el('summary');
                const q = el('span');
                q.append(document.createTextNode(str(x.q)), el('span', 'nd-hint', t('nd.tapAnswer')));
                sum.append(q, icon('expand_more'));
                det.append(sum, el('div', 'nd-a', str(x.a)));
                s.appendChild(det);
            });
            root.appendChild(s);
        }
        if (str(d.tell_your_child)) {
            const s = el('section', 'nd-say');
            s.appendChild(icon('record_voice_over'));
            const box = el('div');
            const h = el('h4', 'nd-label', t('nd.sayIt'));
            const q = el('q', null, str(d.tell_your_child));
            box.append(h, q);
            s.appendChild(box);
            root.appendChild(s);
        }
        return root;
    }

    // Printing shows the quick-check answers: open every closed answer while
    // the print dialog is up and restore afterwards.
    let reopened = [];
    window.addEventListener('beforeprint', () => {
        reopened = Array.from(document.querySelectorAll('.nd-quick details:not([open])'));
        reopened.forEach((d) => { d.open = true; });
    });
    window.addEventListener('afterprint', () => { reopened.forEach((d) => { d.open = false; }); reopened = []; });

    window.TutpNotesCard = { render };
})();
