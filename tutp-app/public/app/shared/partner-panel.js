// Partner panel (TUT-49): the partner's page inside the Teacher Dashboard tab
// ("Partner programme") and at /app/partner/. Shows counts and amounts only,
// the partner link / WhatsApp share / QR / poster, payout details, and for a
// school its teachers. Every value from the server goes in with textContent.
//   window.TutpPartnerPanel.mount(element)
(function () {
  var T = {
    en: {
      loading: 'Loading...', notPartner: 'You are not a Tut-P partner yet.', join: 'Join the partner programme',
      signups: 'Families who signed up', paid: 'Families who paid', pending: 'Waiting for the 7-day refund period', approved: 'Approved, paid out on the 1st',
      paidOut: 'Paid to you', below: 'Payouts start at Rs {min}; this amount carries forward.', link: 'Your link', copy: 'Copy', copied: 'Copied',
      share: 'Share on WhatsApp', poster: 'Print poster', posterLang: 'Poster language', qr: 'Your QR',
      payout: 'Payout details', upi: 'UPI ID (the PAN holder\'s own)', holder: 'Name of the UPI / PAN holder', confirm: 'This UPI ID belongs to the PAN holder.',
      pan: 'PAN (needed before Rs 20,000 a year)', panSaved: 'PAN saved', save: 'Save', saved: 'Saved', error: 'Something went wrong. Try again.',
      milestones: 'Milestones', joinings: 'paid joinings', teachers: 'Teachers', addTeacher: 'Add teacher', tName: 'Teacher name', tWa: 'WhatsApp number (10 digits)',
      sendWa: 'Send invite on WhatsApp', status: { invited: 'Invited', registered: 'Joined', expired: 'Expired', revoked: 'Revoked' }, schoolQr: 'School QR (families without a teacher)',
      reissue: 'New link', nobody: 'Joining Tut-P is always the family\'s own choice. Never pressure anyone.',
    },
    te: {
      loading: 'లోడ్ అవుతోంది...', notPartner: 'మీరు ఇంకా Tut-P పార్టనర్ కాదు.', join: 'పార్టనర్ ప్రోగ్రామ్‌లో చేరండి',
      signups: 'సైన్ అప్ అయిన కుటుంబాలు', paid: 'చెల్లించిన కుటుంబాలు', pending: '7 రోజుల రీఫండ్ కాలం కోసం వేచి ఉన్నవి', approved: 'ఆమోదించబడింది, 1వ తేదీన చెల్లింపు',
      paidOut: 'మీకు చెల్లించినది', below: 'చెల్లింపులు Rs {min} నుండి మొదలవుతాయి; ఈ మొత్తం తరువాతికి వెళ్తుంది.', link: 'మీ లింక్', copy: 'కాపీ', copied: 'కాపీ అయింది',
      share: 'WhatsApp లో షేర్ చేయండి', poster: 'పోస్టర్ ప్రింట్', posterLang: 'పోస్టర్ భాష', qr: 'మీ QR',
      payout: 'చెల్లింపు వివరాలు', upi: 'UPI ID (PAN ఉన్నవారిదే)', holder: 'UPI / PAN ఉన్నవారి పేరు', confirm: 'ఈ UPI ID PAN ఉన్నవారిదే.',
      pan: 'PAN (సంవత్సరానికి Rs 20,000 ముందు అవసరం)', panSaved: 'PAN సేవ్ అయింది', save: 'సేవ్', saved: 'సేవ్ అయింది', error: 'ఏదో తప్పు జరిగింది. మళ్ళీ ప్రయత్నించండి.',
      milestones: 'మైలురాళ్ళు', joinings: 'చెల్లింపు చేరికలు', teachers: 'ఉపాధ్యాయులు', addTeacher: 'ఉపాధ్యాయుని చేర్చండి', tName: 'ఉపాధ్యాయుని పేరు', tWa: 'WhatsApp నంబర్ (10 అంకెలు)',
      sendWa: 'WhatsApp లో ఆహ్వానం పంపండి', status: { invited: 'ఆహ్వానించారు', registered: 'చేరారు', expired: 'గడువు ముగిసింది', revoked: 'రద్దు' }, schoolQr: 'పాఠశాల QR (ఉపాధ్యాయుడు లేని కుటుంబాలు)',
      reissue: 'కొత్త లింక్', nobody: 'Tut-P లో చేరడం ఎప్పుడూ కుటుంబం స్వంత నిర్ణయమే. ఎవరినీ ఒత్తిడి చేయకండి.',
    },
    hi: {
      loading: 'लोड हो रहा है...', notPartner: 'आप अभी Tut-P पार्टनर नहीं हैं।', join: 'पार्टनर प्रोग्राम से जुड़ें',
      signups: 'साइन अप करने वाले परिवार', paid: 'भुगतान करने वाले परिवार', pending: '7 दिन की रिफ़ंड अवधि का इंतज़ार', approved: 'मंज़ूर, 1 तारीख़ को भुगतान',
      paidOut: 'आपको दिया गया', below: 'भुगतान Rs {min} से शुरू होते हैं; यह राशि आगे बढ़ेगी।', link: 'आपका लिंक', copy: 'कॉपी', copied: 'कॉपी हो गया',
      share: 'WhatsApp पर शेयर करें', poster: 'पोस्टर प्रिंट करें', posterLang: 'पोस्टर की भाषा', qr: 'आपका QR',
      payout: 'भुगतान का विवरण', upi: 'UPI ID (PAN धारक की अपनी)', holder: 'UPI / PAN धारक का नाम', confirm: 'यह UPI ID PAN धारक की है।',
      pan: 'PAN (साल में Rs 20,000 से पहले ज़रूरी)', panSaved: 'PAN सेव हो गया', save: 'सेव', saved: 'सेव हो गया', error: 'कुछ गड़बड़ हुई। फिर कोशिश करें।',
      milestones: 'पड़ाव', joinings: 'भुगतान वाले जुड़ाव', teachers: 'शिक्षक', addTeacher: 'शिक्षक जोड़ें', tName: 'शिक्षक का नाम', tWa: 'WhatsApp नंबर (10 अंक)',
      sendWa: 'WhatsApp पर निमंत्रण भेजें', status: { invited: 'आमंत्रित', registered: 'जुड़ गए', expired: 'समाप्त', revoked: 'रद्द' }, schoolQr: 'स्कूल QR (बिना शिक्षक वाले परिवार)',
      reissue: 'नया लिंक', nobody: 'Tut-P से जुड़ना हमेशा परिवार की अपनी मर्ज़ी है। किसी पर दबाव न डालें।',
    },
  };
  var rupees = function (paise) { return 'Rs ' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, json: j }; }); });
  }

  function mount(root) {
    var lang = 'en';
    try { lang = localStorage.getItem('tutp_partner_lang') || 'en'; } catch (e) {}
    if (!T[lang]) lang = 'en';
    var t = T[lang];
    root.textContent = '';
    root.appendChild(h('p', { text: t.loading }));

    api('GET', '/api/partner/dashboard').then(function (r) {
      root.textContent = '';
      if (r.status === 404) {
        root.appendChild(h('p', { text: t.notPartner }));
        root.appendChild(h('a', { href: '/partners/', class: 'partner-cta', text: t.join }));
        return;
      }
      if (!r.ok) { root.appendChild(h('p', { text: t.error, role: 'alert' })); return; }
      render(root, r.json.partner, r.json.dashboard, t, lang);
    });
  }

  function stat(label, value, id) {
    return h('div', { class: 'partner-stat', 'data-stat': id }, [h('div', { class: 'partner-stat-v', text: String(value) }), h('div', { class: 'partner-stat-l', text: label })]);
  }

  function render(root, partner, d, t, lang) {
    var wrap = h('div', { class: 'partner-panel' });
    var sw = h('div', { class: 'partner-lang' }, ['en', 'te', 'hi'].map(function (code) {
      return h('button', { type: 'button', text: { en: 'English', te: 'తెలుగు', hi: 'हिन्दी' }[code], 'aria-pressed': String(code === lang), onclick: function () { try { localStorage.setItem('tutp_partner_lang', code); } catch (e) {} mount(root); } });
    }));
    wrap.appendChild(sw);
    wrap.appendChild(h('h2', { text: partner.name + (partner.schoolName ? ' · ' + partner.schoolName : '') }));
    wrap.appendChild(h('div', { class: 'partner-stats' }, [
      stat(t.signups, d.signups, 'signups'), stat(t.paid, d.paidJoinings, 'paid'),
      stat(t.pending, rupees(d.pendingPaise), 'pending'), stat(t.approved, rupees(d.approvedPaise + d.dueInPayoutPaise), 'approved'), stat(t.paidOut, rupees(d.paidPaise), 'paidOut'),
    ]));
    if (d.belowMinimum) wrap.appendChild(h('p', { class: 'partner-note', text: t.below.replace('{min}', String(d.minPayoutPaise / 100)) }));

    // links, share, QR, poster
    var links = h('section', { class: 'partner-section' });
    wrap.appendChild(links);
    api('GET', '/api/partner/links?lang=' + lang).then(function (r) {
      if (!r.ok) return;
      function linkBlock(title, o) {
        var input = h('input', { type: 'text', readonly: 'readonly', value: o.url, 'aria-label': title });
        var copy = h('button', { type: 'button', text: t.copy, onclick: function () {
          var done = function () { copy.textContent = t.copied; setTimeout(function () { copy.textContent = t.copy; }, 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(o.url).then(done, function () { input.select(); });
          else input.select();
        } });
        var sel = h('select', { 'aria-label': t.posterLang }, ['te', 'en', 'hi'].map(function (c) { return h('option', { value: c, text: { en: 'English', te: 'తెలుగు', hi: 'हिन्दी' }[c] }); }));
        sel.value = lang;
        var posterBase = o.posterUrl.replace(/lang=\w+/, '');
        var posterBtn = h('a', { class: 'partner-btn', target: '_blank', rel: 'noopener', href: o.posterUrl, text: t.poster });
        sel.addEventListener('change', function () { posterBtn.setAttribute('href', posterBase + 'lang=' + sel.value); });
        return h('div', { class: 'partner-link' }, [
          h('h3', { text: title }), h('div', { class: 'partner-row' }, [input, copy]),
          h('div', { class: 'partner-row' }, [h('a', { class: 'partner-btn', target: '_blank', rel: 'noopener', href: o.whatsappShare, text: t.share }), sel, posterBtn]),
          h('img', { src: o.qrUrl, alt: t.qr, width: '160', height: '160', class: 'partner-qr' }),
        ]);
      }
      links.appendChild(linkBlock(t.link + ' (' + r.json.code + ')', r.json));
      if (r.json.school) links.appendChild(linkBlock(t.schoolQr + ' (' + r.json.school.code + ')', r.json.school));
    });

    // milestones
    var ms = d.milestones.map(function (m) { return m.threshold + ' ' + t.joinings + (m.reached ? ' ✓' : ''); }).join(' · ');
    wrap.appendChild(h('p', { class: 'partner-note', text: t.milestones + ': ' + ms }));

    // school: teachers
    if (d.school) wrap.appendChild(schoolBlock(d.school, t, root));

    // payout details
    var upi = h('input', { type: 'text', id: 'pUpi', autocomplete: 'off', placeholder: 'name@bank', 'aria-label': t.upi });
    var holder = h('input', { type: 'text', id: 'pHolder', autocomplete: 'off', 'aria-label': t.holder });
    var conf = h('input', { type: 'checkbox', id: 'pConfirm' });
    var pan = h('input', { type: 'text', id: 'pPan', autocomplete: 'off', maxlength: '10', placeholder: partner.hasPan ? t.panSaved : 'ABCDE1234F', 'aria-label': t.pan });
    var msg = h('p', { class: 'partner-note', role: 'status' });
    var form = h('form', { class: 'partner-form', onsubmit: function (e) {
      e.preventDefault();
      api('PUT', '/api/partner/payout-details', { upi: upi.value, holderName: holder.value, holderConfirmed: conf.checked, pan: pan.value || undefined }).then(function (r) {
        msg.textContent = r.ok ? t.saved : (t.error + ' (' + (r.json.error || r.status) + ')');
      });
    } }, [
      h('label', {}, [t.upi, upi]), h('label', {}, [t.holder, holder]), h('label', { class: 'partner-check' }, [conf, ' ' + t.confirm]),
      h('label', {}, [t.pan, pan]), h('button', { type: 'submit', class: 'partner-btn', text: t.save }), msg,
    ]);
    wrap.appendChild(h('section', { class: 'partner-section' }, [h('h3', { text: t.payout }), form]));
    wrap.appendChild(h('p', { class: 'partner-note', text: t.nobody }));
    wrap.appendChild(style());
    root.appendChild(wrap);
  }

  function schoolBlock(school, t, root) {
    var box = h('section', { class: 'partner-section', 'data-section': 'teachers' }, [h('h3', { text: t.teachers })]);
    var list = h('ul', { class: 'partner-teachers' });
    school.teachers.forEach(function (x) {
      var li = h('li', {}, [h('span', { text: x.name + ' — ' + (t.status[x.status] || x.status) + ' — ' + x.signups + ' / ' + x.paidJoinings }),
        x.status === 'invited' || x.status === 'expired' ? h('button', { type: 'button', text: t.reissue, onclick: function () {
          api('POST', '/api/school/teachers/' + x.id + '/reissue').then(function (r) { if (r.ok) window.open(r.json.whatsappUrl, '_blank', 'noopener'); });
        } }) : null]);
      list.appendChild(li);
    });
    box.appendChild(list);
    box.appendChild(h('p', { class: 'partner-note', text: t.schoolQr + ': ' + school.schoolQr.signups + ' / ' + school.schoolQr.paidJoinings }));
    var name = h('input', { type: 'text', id: 'tName', 'aria-label': t.tName, placeholder: t.tName });
    var wa = h('input', { type: 'tel', id: 'tWa', 'aria-label': t.tWa, placeholder: t.tWa, inputmode: 'numeric', maxlength: '10' });
    var out = h('p', { class: 'partner-note', role: 'status' });
    var add = h('button', { type: 'button', class: 'partner-btn', text: t.addTeacher, onclick: function () {
      api('POST', '/api/school/teachers', { name: name.value, whatsapp: wa.value }).then(function (r) {
        if (!r.ok) { out.textContent = t.error + ' (' + (r.json.error || r.status) + ')'; return; }
        out.textContent = '';
        out.appendChild(h('a', { class: 'partner-btn', target: '_blank', rel: 'noopener', href: r.json.whatsappUrl, text: t.sendWa }));
        out.appendChild(h('code', { class: 'partner-join', text: r.json.joinUrl }));
      });
    } });
    box.appendChild(h('div', { class: 'partner-row' }, [name, wa, add]));
    box.appendChild(out);
    return box;
  }

  function style() {
    var s = document.createElement('style');
    s.textContent = '.partner-panel{display:grid;gap:16px;max-width:760px}.partner-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}' +
      '.partner-stat{border:1px solid #c7d0e6;border-radius:12px;padding:10px 12px}.partner-stat-v{font-size:22px;font-weight:700}.partner-stat-l{font-size:13px;color:#46506b}' +
      '.partner-section{display:grid;gap:10px}.partner-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.partner-row input[type=text],.partner-row input[type=tel]{flex:1;min-width:140px}' +
      '.partner-panel input[type=text],.partner-panel input[type=tel],.partner-panel select{padding:9px 10px;border:1px solid #9aa6c4;border-radius:8px;font-size:15px;max-width:100%}' +
      '.partner-btn,.partner-cta,.partner-panel button{padding:9px 14px;border-radius:999px;border:1px solid #005bbf;background:#fff;color:#005bbf;font-size:15px;text-decoration:none;cursor:pointer}' +
      '.partner-btn[type=submit],.partner-cta{background:#005bbf;color:#fff}.partner-note{font-size:14px;color:#46506b}.partner-form{display:grid;gap:10px}.partner-form label{display:grid;gap:4px;font-size:14px}' +
      '.partner-check{display:flex!important;gap:8px;align-items:center}.partner-lang{display:flex;gap:6px}.partner-lang button[aria-pressed=true]{background:#005bbf;color:#fff}' +
      '.partner-qr{border:1px solid #c7d0e6;border-radius:8px;background:#fff}.partner-join{word-break:break-all;font-size:12px}.partner-teachers{padding-left:18px;display:grid;gap:6px}';
    return s;
  }

  window.TutpPartnerPanel = { mount: mount };
})();
