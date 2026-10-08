/* Listen everywhere (TUT-7). One shared voice path for Answer, Explain, Notes, Story and EL.
 *   TutpListen.button(getText, lang, opts)  -> a <span class="tl-wrap"> with the Listen button and a status line
 *   TutpListen.speak(text, lang, cb)        -> plays; cb = { onstart, onend, onfail }
 *   TutpListen.stop()
 * Order: server voice (POST /api/tts, Google today) -> the browser's own voice -> a visible
 * "Audio not available" line. The button is never hidden, whatever the device has.
 * `lang` is a BCP-47 tag ('te-IN') or a short code ('te'). */
(function () {
    'use strict';
    var SERVER = { en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', mr: 'mr-IN', kn: 'kn-IN', ml: 'ml-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', ar: 'ar-XA' };
    var MAX = 3800;
    var current = null;   // { stop: fn }
    var clips = {};       // text+lang -> object URL, so a second tap does not fetch again

    var NAMES = { English: 'en', Hindi: 'hi', Telugu: 'te', Tamil: 'ta', Marathi: 'mr', Kannada: 'kn', Malayalam: 'ml', Bengali: 'bn', Gujarati: 'gu', Punjabi: 'pa', Spanish: 'es', French: 'fr', German: 'de', Arabic: 'ar' };
    // A language name ('Telugu'), a short code ('te') or a BCP tag ('te-IN') all work.
    function short(lang) { return NAMES[lang] || String(lang || 'en').slice(0, 2).toLowerCase(); }
    function serverLang(lang) { return SERVER[short(lang)] || null; }
    function trim(text) { text = String(text || '').replace(/\s+/g, ' ').trim(); return text.length > MAX ? text.slice(0, MAX) : text; }

    function stop() {
        var c = current; current = null;
        if (c) c.stop();
        try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
    }

    function browserVoice(lang) {
        if (!('speechSynthesis' in window)) return null;
        var p = short(lang), list = window.speechSynthesis.getVoices() || [];
        for (var i = 0; i < list.length; i++) if ((list[i].lang || '').slice(0, 2).toLowerCase() === p) return list[i];
        return null;
    }

    function viaBrowser(text, lang, cb, token) {
        var v = browserVoice(lang);
        if (!v) return false;
        var u = new SpeechSynthesisUtterance(text);
        u.lang = v.lang; u.voice = v;
        u.onend = u.onerror = function () { if (current === token) { current = null; cb.onend && cb.onend(); } };
        token.stop = function () { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } cb.onend && cb.onend(); };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        cb.onstart && cb.onstart();
        return true;
    }

    function fetchClip(text, tag) {
        var key = tag + '|' + text;
        if (clips[key]) return Promise.resolve(clips[key]);
        return fetch('/api/tts', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text, lang: tag })
        }).then(function (r) {
            if (!r.ok) throw new Error('tts ' + r.status);
            return r.blob();
        }).then(function (b) { clips[key] = URL.createObjectURL(b); return clips[key]; });
    }

    function speak(text, lang, cb) {
        cb = cb || {};
        text = trim(text);
        stop();
        var token = { stop: function () {} };
        current = token;
        if (!text) { current = null; cb.onfail && cb.onfail(); return; }
        var tag = serverLang(lang);
        function fallback() {
            if (current !== token) return;
            if (!viaBrowser(text, lang, cb, token)) { current = null; cb.onfail && cb.onfail(); }
        }
        if (!tag) { fallback(); return; }
        cb.onloading && cb.onloading();
        fetchClip(text, tag).then(function (url) {
            if (current !== token) return;
            var a = new Audio(url);
            token.stop = function () { try { a.pause(); } catch (e) { /* ignore */ } cb.onend && cb.onend(); };
            a.onended = function () { if (current === token) { current = null; cb.onend && cb.onend(); } };
            a.onerror = function () { token.stop = function () {}; fallback(); };
            return a.play().then(function () { cb.onstart && cb.onstart(); });
        }).catch(function () { fallback(); });
    }

    function button(getText, lang, opts) {
        opts = opts || {};
        var wrap = document.createElement('span');
        wrap.className = 'tl-wrap' + (opts.wrapClass ? ' ' + opts.wrapClass : '');
        var b = document.createElement('button');
        b.type = 'button';
        b.className = opts.className || 'ae-btn';
        b.textContent = opts.label || 'Listen';
        b.setAttribute('data-listen', '1');
        var note = document.createElement('span');
        note.className = 'tl-note';
        note.setAttribute('role', 'status');
        note.setAttribute('aria-live', 'polite');
        note.hidden = true;
        var playing = false;
        function reset() { playing = false; b.textContent = opts.label || 'Listen'; b.disabled = false; }
        b.addEventListener('click', function () {
            if (playing) { stop(); reset(); return; }
            var text = typeof getText === 'function' ? getText() : getText;
            note.hidden = true;
            playing = true;
            b.textContent = 'Stop';
            speak(text, typeof lang === 'function' ? lang() : lang, {
                onloading: function () { b.textContent = 'Loading…'; },
                onstart: function () { b.textContent = 'Stop'; },
                onend: reset,
                onfail: function () { reset(); note.textContent = 'Audio is not available right now.'; note.hidden = false; }
            });
        });
        wrap.appendChild(b);
        wrap.appendChild(note);
        return wrap;
    }

    window.TutpListen = { button: button, speak: speak, stop: stop, serverLang: serverLang };
})();
