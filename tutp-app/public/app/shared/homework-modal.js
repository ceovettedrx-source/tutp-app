// Homework Help / Quiz modal, plus the attach and parse helpers the other
// learning-model modals share. Moved out of the mother/father/
// family-member/child dashboards (identical copies) on 2026-09-27.
//
// Load as a plain script right before the page's main inline <script>,
// after the modal markup: its top-level functions, classes and consts are
// used by the page script (FreeLimitError, showFreeLimitModal,
// hwEscapeHtml, attachFilePicker/attachFilePickerMulti, callHomeworkApi,
// openHomeworkModal, ...), and the page script calls some of them while it
// loads. It uses page functions (startStagedLoading, showFeedbackPrompt)
// only from click handlers, after the page script has run.
//
// The prompts are built on the server (server/prompts/homework-prompts.js).
// Requests send only what the parent typed and attached, the child and the
// language: { feature, text, language, studentId, attachments }.

        // ---------------- Ask Tut-P AI Tutor modal (inline homework-explain) ----------------
        // Reuses /api/upload's sibling /api/homework exactly as the homepage
        // and Teacher Module do — real Claude call, real attached file. Unlike
        // /demo/, child context comes from this session's real family/student
        // records, and there's no post-quiz dashboard reveal (this page's own
        // bonding-score/homework-completion sections already show real data).
        const hwAttachState = { items: [] };
        const hwModalAttachInput = document.getElementById('hwModalAttachInput');

        // Bumped on every open — an in-flight /api/homework request from a
        // prior session compares its captured value against this before
        // touching the DOM, so a late response after close+reopen (found in
        // manual testing: submit -> close early -> reopen -> attach a
        // different file) gets discarded instead of overwriting fresh state.
        let hwSessionToken = 0;

        // Homework Help and Quiz are the same underlying explain+quiz modal
        // (see CLAUDE.md backlog — splitting them for real is a separate
        // task), but each chip's promise is different, so this drives the
        // title/label/placeholder/button/result-layout differences between
        // the two without duplicating the modal.
        let hwCurrentMode = 'homework';
        const HW_MODE_COPY = {
            homework: {
                title: 'Homework Help',
                label: 'Homework question / topic (optional if attaching a file)',
                placeholder: 'Describe the homework you need explained, or just attach a photo/PDF below.',
                idleBtn: 'Explain My Homework',
                loadingStages: ['Reading the homework…', 'Thinking it through…', 'Almost done…'],
                retryBtn: '↺ Try another homework'
            },
            quiz: {
                title: 'Quiz',
                label: 'What should the quiz cover? (optional if attaching a file)',
                placeholder: 'Describe what to quiz your child on, or just attach a photo/PDF below.',
                idleBtn: 'Start My Quiz',
                loadingStages: ['Preparing your quiz…', 'Thinking it through…', 'Almost done…'],
                retryBtn: '↺ Try another quiz'
            }
        };
        function applyHwModeChrome(mode){
            const copy = HW_MODE_COPY[mode];
            document.getElementById('hwModalTitle').textContent = copy.title;
            document.getElementById('hwModalTextLabel').textContent = copy.label;
            document.getElementById('hwModalText').placeholder = copy.placeholder;
            document.getElementById('hwModalSubmitBtn').textContent = copy.idleBtn;
            document.getElementById('hwModalRetryBtn').textContent = copy.retryBtn;
        }
        // Homework Help's result shows only the explanation (quiz section
        // hidden) since that chip never promised a quiz; Quiz's result leads
        // with the quiz it promised, with the explanation still generated
        // by the same API call but demoted to a collapsed, secondary <details>
        // rather than removed outright.
        function applyHwResultLayout(mode){
            const resultsEl = document.getElementById('hwModalResults');
            const explBlock = document.getElementById('hwModalExplanationBlock');
            const quizBlock = document.getElementById('hwModalQuizBlock');
            const explDetails = document.getElementById('hwModalExplanationDetails');
            if (mode === 'quiz') {
                quizBlock.classList.remove('hidden');
                explDetails.open = false;
                resultsEl.insertBefore(quizBlock, explBlock);
            } else {
                quizBlock.classList.add('hidden');
                explDetails.open = true;
                resultsEl.insertBefore(explBlock, quizBlock);
            }
        }

        function openHomeworkModal(mode){
            hwCurrentMode = (mode === 'quiz') ? 'quiz' : 'homework';
            hwSessionToken++;
            resetHomeworkModal();
            document.getElementById('homeworkExplainModal').classList.remove('hidden');
            loadHomeworkModalChildContext();
        }
        function closeHomeworkModal(){
            clearHwPointer();
            document.getElementById('homeworkExplainModal').classList.add('hidden');
        }

        async function loadHomeworkModalChildContext(){
            const el = document.getElementById('hwModalChildContext');
            const studentId = await window.tutpChildReady;
            const familyId = sessionStorage.getItem('tutp_family_id');
            el.textContent = 'Helping your child';
            try {
                if (studentId) {
                    const res = await fetch('/api/student/' + encodeURIComponent(studentId));
                    if (res.ok) {
                        const data = await res.json();
                        if (data.name) { el.textContent = 'Helping ' + data.name + (data.class ? ' · ' + data.class : ''); return; }
                    }
                }
                if (familyId) {
                    const res = await fetch('/api/family/' + encodeURIComponent(familyId) + '/students');
                    if (res.ok) {
                        const data = await res.json();
                        const first = (data.students || [])[0];
                        if (first && first.name) { el.textContent = 'Helping ' + first.name + (first.class ? ' · ' + first.class : ''); return; }
                    }
                }
            } catch (err) {
                console.error('[hwModal] Could not load child context:', err);
            }
        }

        // Claude's vision API only accepts these 4 image types — a phone
        // camera photo (esp. iPhone) is very commonly HEIC, which isn't in
        // this list, passes our own accept="image/*" filter and file-type
        // check unchanged, and previously reached Claude's API only to be
        // rejected there with an opaque 502 the parent couldn't act on.
        const HW_SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        // Re-encodes an unsupported image (or one with no/blank reported
        // type) to JPEG via canvas before it ever reaches Claude. Relies on
        // the browser's own <img> decoder — notably, Safari/iOS (the
        // platform most likely to hand us HEIC in the first place) decodes
        // HEIC natively, so this fixes the common case with no backend
        // change. Rejects if the browser can't decode the file as an image.
        function reencodeImageToJpeg(file){
            return new Promise((resolve, reject) => {
                const objectUrl = URL.createObjectURL(file);
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg', 0.92));
                    } catch (err) {
                        reject(err);
                    } finally {
                        URL.revokeObjectURL(objectUrl);
                    }
                };
                img.onerror = () => {
                    URL.revokeObjectURL(objectUrl);
                    reject(new Error('Could not decode file as an image'));
                };
                img.src = objectUrl;
            });
        }

        const resetHwAttach = attachFilePickerMulti(
            hwModalAttachInput,
            [
                { thumbEl: document.getElementById('hwModalThumb'), pdfLabelEl: document.getElementById('hwModalPdfLabel'), clearBtnEl: document.getElementById('hwModalClearAttach') },
                { thumbEl: document.getElementById('hwModalThumb2'), pdfLabelEl: document.getElementById('hwModalPdfLabel2'), clearBtnEl: document.getElementById('hwModalClearAttach2') }
            ],
            document.getElementById('hwModalAttachTrigger'),
            { first: '📎 Attach a photo or PDF (optional)', more: '+ Add another photo or PDF' },
            hwAttachState,
            document.getElementById('hwModalErrBox'),
            2
        );

        // Claude is instructed to respond with ONLY a JSON object, but isn't
        // 100% reliable about it — e.g. given a vague question like "make a
        // quiz" with nothing concrete to quiz on, it sometimes prepends a
        // clarifying sentence before the JSON instead of omitting it. Thrown
        // instead of a plain Error so the catch block below can show a
        // specific, honest message for this failure mode instead of the
        // generic one, and log the raw text for debugging.
        class HwParseError extends Error {
            constructor(message, rawText) {
                super(message);
                this.name = 'HwParseError';
                this.rawText = rawText;
            }
        }

        // Thrown when the server blocks a request with 402 (free_limit_reached
        // — see server.js's checkFreeLimit / /api/game-sessions' family-level
        // check). Carries the friendly message + bucket the server already
        // computed, so callers show showFreeLimitModal() instead of a plain
        // error string.
        class FreeLimitError extends Error {
            constructor(message, bucket) {
                super(message);
                this.name = 'FreeLimitError';
                this.bucket = bucket;
            }
        }

        // No self-serve "upgrade an existing child" flow exists yet (the only
        // plan-selection UI is embedded in the brand-new-family registration
        // wizard, and would create a duplicate family/student if reused here)
        // — so this links to contact instead of a plan-selection step.
        function showFreeLimitModal(message, bucket) {
            const familyId = sessionStorage.getItem('tutp_family_id') || '';
            const studentId = sessionStorage.getItem('tutp_student_id') || '';
            const bodyLines = [
                message,
                '',
                'Account details (for support):',
                'Family ID: ' + familyId,
                studentId ? 'Child ID: ' + studentId : null,
                'Limit type: ' + (bucket || '')
            ].filter(Boolean);
            const mailtoUrl = 'mailto:contact@tutp.online?subject=' + encodeURIComponent('Upgrade request') + '&body=' + encodeURIComponent(bodyLines.join('\n'));
            const box = document.createElement('div');
            box.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:#fff;border:1px solid #ccc;border-radius:8px;padding:12px 14px;box-shadow:0 2px 10px rgba(0,0,0,.15);font-size:14px;max-width:280px;';
            box.innerHTML = `
                <p style="margin:0 0 8px;">${message}</p>
                <a href="${mailtoUrl}" style="display:inline-block;background:#005bbf;color:#fff;text-decoration:none;padding:8px 12px;border-radius:6px;font-weight:600;">Contact us to upgrade</a>
                <button type="button" id="freeLimitDismiss" style="display:block;margin-top:8px;background:none;border:none;color:#666;font-size:12px;cursor:pointer;padding:0;">Not now</button>
            `;
            // Where this viewer can pay (mother/father), lead with the plans
            // themselves; the email link stays as the fallback.
            if (window.TutpBilling && window.TutpBilling.canPay && studentId) {
                const payBtn = document.createElement('button');
                payBtn.type = 'button';
                payBtn.textContent = 'See Pro plans';
                payBtn.style.cssText = 'display:block;width:100%;margin:0 0 8px;background:#005bbf;color:#fff;border:none;padding:8px 12px;border-radius:6px;font-weight:600;cursor:pointer;';
                payBtn.addEventListener('click', () => { box.remove(); window.TutpBilling.choosePlan(studentId); });
                box.insertBefore(payBtn, box.querySelector('a'));
            }
            document.body.appendChild(box);
            box.querySelector('#freeLimitDismiss').addEventListener('click', () => box.remove());
        }

        document.getElementById('hwModalSubmitBtn').addEventListener('click', async () => {
            const hwText = document.getElementById('hwModalText').value.trim();
            const lang = document.getElementById('hwModalLang').value;
            const errBox = document.getElementById('hwModalErrBox');
            const submitBtn = document.getElementById('hwModalSubmitBtn');
            if (!hwText && !hwAttachState.items.length) {
                errBox.textContent = 'Please type the question or attach a photo/PDF first.';
                errBox.classList.remove('hidden');
                return;
            }
            errBox.classList.add('hidden');
            submitBtn.disabled = true;
            const stopLoading = startStagedLoading(submitBtn, HW_MODE_COPY[hwCurrentMode].loadingStages, 7000);
            // Captured now so the response handlers below can tell whether
            // this is still the current modal session by the time the
            // request resolves — see hwSessionToken above.
            const requestToken = hwSessionToken;

            try {
                await window.tutpChildReady;
                // The server builds the prompt (Homework Help or Quiz) from
                // these; see server/prompts/homework-prompts.js.
                let attachments = hwAttachState.items.map(item => ({ mediaType: item.mediaType, base64: item.base64 }));
                // Homework Help: photos go up at HW_PHOTO_MAX_EDGE as JPEG, the
                // size the server's "Show on photo" boxes refer to; the same
                // images are kept to show those boxes on (see below).
                let sentPhotos = [];
                if (hwCurrentMode === 'homework') {
                    const prepared = await Promise.all(attachments.map(a => a.mediaType === 'application/pdf'
                        ? null
                        : hwDownscaleToJpeg('data:' + a.mediaType + ';base64,' + a.base64, HW_PHOTO_MAX_EDGE).catch(err => {
                            console.error('[hwModal] Could not resize photo, sending it as is:', err);
                            return null;
                        })));
                    attachments = attachments.map((a, i) => prepared[i] ? { mediaType: prepared[i].mediaType, base64: prepared[i].base64 } : a);
                    sentPhotos = prepared.map(p => p ? p.dataUrl : null);
                    if (sentPhotos.some(Boolean)) loadTutPointer().catch(() => {});
                }
                const res = await fetch('/api/homework', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        feature: hwCurrentMode === 'quiz' ? 'quiz' : 'homework_help',
                        text: hwText,
                        language: lang,
                        studentId: sessionStorage.getItem('tutp_student_id'),
                        attachments
                    })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    if (res.status === 402) throw new FreeLimitError(errData.message || "You've used all your free sessions for this child.", errData.bucket);
                    throw new Error(errData.error || `Server returned ${res.status}`);
                }
                const data = await res.json();
                const textBlock = (data.content || []).find(b => b.type === 'text');
                if (!textBlock) throw new HwParseError('No response content', '');

                // Extract the JSON object itself rather than assuming the
                // whole string is JSON — Claude occasionally prepends a
                // clarifying sentence before it (see HwParseError above).
                const firstBrace = textBlock.text.indexOf('{');
                const lastBrace = textBlock.text.lastIndexOf('}');
                if (firstBrace === -1 || lastBrace < firstBrace) {
                    throw new HwParseError('No JSON object found in response', textBlock.text);
                }
                let parsed;
                try {
                    parsed = JSON.parse(textBlock.text.slice(firstBrace, lastBrace + 1));
                } catch (parseErr) {
                    throw new HwParseError(parseErr.message, textBlock.text);
                }

                // A newer session (modal closed and reopened) has started
                // since this request went out — its own fresh state must
                // not be clobbered by this now-stale response.
                if (requestToken !== hwSessionToken) return;
                hwSentPhotos = sentPhotos;

                document.getElementById('hwModalForm').classList.add('hidden');
                document.getElementById('hwModalResults').classList.remove('hidden');
                if (hwCurrentMode === 'quiz') {
                    // Explicitly restored here (not by applyHwResultLayout,
                    // which is untouched) — the Homework Help branch below
                    // now hides this element, so a parent switching from
                    // Homework Help to Quiz within the same page session
                    // needs it un-hidden again; applyHwResultLayout was
                    // never written to do this since nothing hid it before.
                    document.getElementById('hwModalExplanationBlock').classList.remove('hidden');
                    document.getElementById('hwModalHomeworkResultBlock').classList.add('hidden');
                    document.getElementById('hwModalLangTag').textContent = lang;
                    document.getElementById('hwModalExplanationText').textContent = parsed.explanation;
                    renderHwModalQuiz(parsed.quiz || []);
                    applyHwResultLayout(hwCurrentMode);
                } else {
                    document.getElementById('hwModalExplanationBlock').classList.add('hidden');
                    document.getElementById('hwModalQuizBlock').classList.add('hidden');
                    renderHwModalHomeworkResult(parsed);
                }
                const hwFeedbackExplanation = hwCurrentMode === 'quiz'
                    ? parsed.explanation
                    : (parsed.concept_explanation || (parsed.extracted_questions || []).map(q => q.reasoning).join(' '));
                showFeedbackPrompt(hwCurrentMode === 'quiz' ? 'quiz' : 'homework_help', hwFeedbackExplanation);
            } catch (err) {
                if (requestToken !== hwSessionToken) return;
                console.error('[hwModal] Explain request failed:', err);
                if (err.name === 'FreeLimitError') {
                    showFreeLimitModal(err.message, err.bucket);
                } else if (err.name === 'HwParseError') {
                    console.error('[hwModal] Raw AI response that failed to parse:', err.rawText);
                    errBox.textContent = "The AI couldn't generate a quiz from this — try describing the actual homework question instead of just asking for a quiz.";
                    errBox.classList.remove('hidden');
                } else {
                    errBox.textContent = 'Something went wrong reaching the AI. Please try again in a moment.';
                    errBox.classList.remove('hidden');
                }
            } finally {
                stopLoading();
                if (requestToken === hwSessionToken) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = HW_MODE_COPY[hwCurrentMode].idleBtn;
                }
            }
        });

        const HW_OPT_BASE = 'text-left font-body-md text-sm rounded-lg px-3.5 py-2.5 flex items-center justify-between gap-2.5 transition-colors border-2';
        const HW_OPT_DEFAULT = HW_OPT_BASE + ' text-on-surface bg-surface-container-lowest border-outline-variant cursor-pointer hover:border-on-surface-variant disabled:cursor-default disabled:pointer-events-none';
        const HW_OPT_CORRECT = HW_OPT_BASE + ' bg-tertiary-container/40 border-tertiary text-on-tertiary-container';
        const HW_OPT_WRONG = HW_OPT_BASE + ' bg-error-container/40 border-error text-error';
        function hwEscapeHtml(str){ const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
        const HW_QUIZ_CATEGORY_LABELS = {
            logical_reasoning: 'Logical Reasoning',
            understanding: 'Understanding · Bodha',
            application: 'Application · Prayoga',
            skill_based: 'Skill-based · Abhyasa'
        };
        function renderHwModalQuiz(quiz){
            const area = document.getElementById('hwModalQuizArea');
            area.innerHTML = '';
            let answered = 0;
            document.getElementById('hwModalScorePill').textContent = `0 / ${quiz.length} answered`;
            quiz.forEach((q, qi) => {
                const card = document.createElement('div');
                card.className = 'bg-surface-container-lowest border-2 border-outline-variant rounded-lg p-5 mb-3.5';
                card.innerHTML = `
                    <div class="flex items-center justify-between gap-2 mb-1.5">
                        <div class="font-label-md text-[11px] text-on-surface-variant">Question ${qi + 1} of ${quiz.length}</div>
                        <span class="font-label-md text-[10px] uppercase tracking-wide bg-tertiary-container/50 text-on-tertiary-container px-2 py-0.5 rounded-full">${hwEscapeHtml(HW_QUIZ_CATEGORY_LABELS[q.category] || q.category || '')}</span>
                    </div>
                    <div class="text-[15.5px] font-semibold text-on-surface mb-3.5 leading-snug">${hwEscapeHtml(q.question)}</div>
                    <div class="grid gap-2" data-role="opts"></div>
                    <div class="mt-3 pt-3 border-t border-dashed border-outline-variant text-[13.5px] text-on-surface-variant leading-relaxed hidden" data-role="explain"></div>
                `;
                const optsWrap = card.querySelector('[data-role="opts"]');
                q.options.forEach((opt, oi) => {
                    const btn = document.createElement('button');
                    btn.className = HW_OPT_DEFAULT;
                    btn.innerHTML = `<span>${hwEscapeHtml(opt)}</span><span class="text-base" data-role="mark"></span>`;
                    btn.addEventListener('click', () => {
                        const allBtns = optsWrap.querySelectorAll('button');
                        allBtns.forEach(b => b.disabled = true);
                        if (oi === q.correct) {
                            btn.className = HW_OPT_CORRECT;
                            btn.querySelector('[data-role="mark"]').textContent = '✓';
                        } else {
                            btn.className = HW_OPT_WRONG;
                            btn.querySelector('[data-role="mark"]').textContent = '✗';
                            const correctBtn = allBtns[q.correct];
                            correctBtn.className = HW_OPT_CORRECT;
                            correctBtn.querySelector('[data-role="mark"]').textContent = '✓';
                        }
                        const explainBox = card.querySelector('[data-role="explain"]');
                        explainBox.innerHTML = `<b class="text-on-surface">Why:</b> ${hwEscapeHtml(q.explain)}`;
                        explainBox.classList.remove('hidden');
                        answered++;
                        document.getElementById('hwModalScorePill').textContent = `${answered} / ${quiz.length} answered`;
                    });
                    optsWrap.appendChild(btn);
                });
                area.appendChild(card);
            });
        }
        // Homework Help's result view — genuinely different shape from
        // Quiz's, so it gets its own render function rather than reusing
        // renderHwModalQuiz. "questions" mode: one card per extracted
        // question with the direct answer inline and the guided-discovery
        // reasoning line collapsed behind a <details> toggle (matching
        // Experiential Learning's hook pattern) so the parent isn't forced
        // to read it, but can always get to it. "concept" mode: a single
        // paragraph, no toggle needed.
        function renderHwModalHomeworkResult(parsed){
            const conceptBlock = document.getElementById('hwModalConceptBlock');
            const questionsArea = document.getElementById('hwModalQuestionsArea');
            hidePhotoPanel();
            if (parsed.mode === 'questions') {
                conceptBlock.classList.add('hidden');
                questionsArea.classList.remove('hidden');
                questionsArea.innerHTML = '';
                (parsed.extracted_questions || []).forEach((q, qi) => {
                    const card = document.createElement('div');
                    card.className = 'bg-surface-container-lowest border-2 border-outline-variant rounded-lg p-5';
                    card.innerHTML = `
                        <div class="font-label-md text-[11px] text-on-surface-variant mb-1.5">Question ${qi + 1}</div>
                        <div class="text-[15.5px] font-semibold text-on-surface mb-2 leading-snug">${hwEscapeHtml(q.question || '')}</div>
                        <div class="text-[15px] text-on-surface mb-2 leading-relaxed"><b>Answer:</b> ${hwEscapeHtml(q.answer || '')}</div>
                        <details>
                            <summary class="font-label-md text-xs text-primary cursor-pointer">Why? (a hint to guide your child)</summary>
                            <p class="text-[13.5px] text-on-surface-variant mt-1.5 leading-relaxed">${hwEscapeHtml(q.reasoning || '')}</p>
                        </details>
                    `;
                    // The server sends photo/box only after checking them
                    // (server/homework-boxes.js); the photo must be one this
                    // page sent, so there is something to draw on.
                    if (Number.isInteger(q.photo) && Array.isArray(q.box) && q.box.length === 4 && hwSentPhotos[q.photo]) {
                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.dataset.role = 'show-photo';
                        btn.dataset.photo = String(q.photo);
                        btn.dataset.box = q.box.join(',');
                        btn.className = 'font-label-md text-xs text-primary border-2 border-outline-variant hover:border-primary rounded-lg px-3 py-1.5 mt-2 transition-colors';
                        btn.textContent = '📍 Show on photo';
                        btn.addEventListener('click', () => showHwPhotoBox(q.photo, q.box, 'Q' + (qi + 1)));
                        card.appendChild(btn);
                    }
                    questionsArea.appendChild(card);
                });
            } else {
                questionsArea.classList.add('hidden');
                questionsArea.innerHTML = '';
                conceptBlock.classList.remove('hidden');
                document.getElementById('hwModalConceptLangTag').textContent = document.getElementById('hwModalLang').value;
                document.getElementById('hwModalConceptText').textContent = parsed.concept_explanation || '';
                const aditiBlock = document.getElementById('hwModalAditiHookBlock');
                if (parsed.aditiApplicable && parsed.aditiHook) {
                    document.getElementById('hwModalAditiHookText').textContent = parsed.aditiHook;
                    aditiBlock.classList.remove('hidden');
                } else {
                    aditiBlock.classList.add('hidden');
                }
            }
            document.getElementById('hwModalHomeworkResultBlock').classList.remove('hidden');
        }
        // ---------------- "Show on photo" and "Check mistakes" (2026-09-28) ----------------
        // Homework Help answers carry, per question, the photo it was read
        // from and a box around it (0..1000 of that photo, checked by the
        // server). "Show on photo" opens the photo above the answers and
        // draws the box with /js/tutp-pointer.js (the visual tutor's
        // overlay); "Check mistakes" sends the shown photo to the visual
        // tutor's image mode, which marks up to 2 mistakes (red) and one
        // correct answer (green). The page's Tailwind build only sees the
        // HTML files, so the new elements reuse classes the pages already
        // have and set anything else inline.
        const HW_PHOTO_MAX_EDGE = 1568;   // = BOX_MAX_EDGE in server/homework-boxes.js
        const HW_CHECK_MAX_EDGE = 1280;   // the size the visual tutor reads
        let hwSentPhotos = [];            // data URL per sent attachment (null for PDFs)
        let hwShownPhoto = null;
        let hwPointerLoad = null;

        function loadTutPointer(){
            if (window.TutPointer) return Promise.resolve(window.TutPointer);
            if (!hwPointerLoad) {
                hwPointerLoad = new Promise((resolve, reject) => {
                    const s = document.createElement('script');
                    s.src = '/js/tutp-pointer.js';
                    s.onload = () => resolve(window.TutPointer);
                    s.onerror = () => { hwPointerLoad = null; reject(new Error('Could not load tutp-pointer.js')); };
                    document.head.appendChild(s);
                });
            }
            return hwPointerLoad;
        }
        function clearHwPointer(){
            if (window.TutPointer) window.TutPointer.clear();
        }

        // Any image data URL -> JPEG no larger than maxEdge on its longest
        // side: { mediaType, base64, dataUrl }.
        function hwDownscaleToJpeg(dataUrl, maxEdge){
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const s = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
                        const canvas = document.createElement('canvas');
                        canvas.width = Math.round(img.naturalWidth * s);
                        canvas.height = Math.round(img.naturalHeight * s);
                        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                        const out = canvas.toDataURL('image/jpeg', 0.9);
                        resolve({ mediaType: 'image/jpeg', base64: out.split(',')[1], dataUrl: out });
                    } catch (err) {
                        reject(err);
                    }
                };
                img.onerror = () => reject(new Error('Could not decode the photo'));
                img.src = dataUrl;
            });
        }

        // The photo panel sits above the answer cards; built on first use.
        function hwPhotoPanel(){
            let panel = document.getElementById('hwPhotoPanel');
            if (panel) return panel;
            panel = document.createElement('div');
            panel.id = 'hwPhotoPanel';
            panel.className = 'hidden bg-surface-container-lowest border-2 border-outline-variant rounded-lg p-3 mt-2';
            panel.innerHTML = `
                <div class="flex items-center justify-between gap-2 mb-1.5">
                    <div class="font-label-md text-[11px] text-on-surface-variant">Your photo</div>
                    <button type="button" id="hwPhotoHideBtn" class="font-label-md text-xs text-on-surface-variant hover:text-on-surface">Hide photo</button>
                </div>
                <img id="hwPhotoImg" alt="The homework photo you attached" class="rounded-lg" style="display:block;width:100%;max-height:60vh;object-fit:contain;background:#f1f3f8;">
                <button type="button" id="hwCheckMistakesBtn" class="font-label-md text-xs border-2 border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary px-5 py-2.5 rounded-lg transition-colors mt-2" style="width:100%;">🔍 Check mistakes</button>
                <p id="hwCheckMistakesMsg" class="hidden text-[13.5px] text-on-surface leading-relaxed mt-2 mb-0"></p>
            `;
            const questionsArea = document.getElementById('hwModalQuestionsArea');
            questionsArea.parentNode.insertBefore(panel, questionsArea);
            panel.querySelector('#hwPhotoHideBtn').addEventListener('click', hidePhotoPanel);
            panel.querySelector('#hwCheckMistakesBtn').addEventListener('click', checkHwMistakes);
            return panel;
        }
        function hidePhotoPanel(){
            clearHwPointer();
            const panel = document.getElementById('hwPhotoPanel');
            if (!panel) return;
            panel.classList.add('hidden');
            const msg = panel.querySelector('#hwCheckMistakesMsg');
            msg.textContent = '';
            msg.classList.add('hidden');
            hwShownPhoto = null;
        }

        async function showHwPhoto(photo){
            const panel = hwPhotoPanel();
            const img = panel.querySelector('#hwPhotoImg');
            if (hwShownPhoto !== photo) {
                hidePhotoPanel();
                img.src = hwSentPhotos[photo];
                hwShownPhoto = photo;
            }
            panel.classList.remove('hidden');
            try { await img.decode(); } catch (e) {}
            img.scrollIntoView({ block: 'center' });
            return img;
        }

        async function showHwPhotoBox(photo, box, label){
            const token = hwSessionToken;
            const img = await showHwPhoto(photo);
            let pointer;
            try { pointer = await loadTutPointer(); } catch (err) { console.error('[hwModal] Show on photo:', err); return; }
            if (token !== hwSessionToken) return;
            pointer.play({ steps: [{ type: 'box', target: { kind: 'image', box }, tone: 'info', label }] }, { imageEl: img });
        }

        async function checkHwMistakes(){
            const token = hwSessionToken;
            const btn = document.getElementById('hwCheckMistakesBtn');
            const msg = document.getElementById('hwCheckMistakesMsg');
            const img = document.getElementById('hwPhotoImg');
            btn.disabled = true;
            btn.textContent = 'Checking…';
            msg.classList.add('hidden');
            clearHwPointer();
            try {
                const pointer = await loadTutPointer();
                try { await img.decode(); } catch (e) {}
                const image = pointer.prepareImage(img, HW_CHECK_MAX_EDGE);
                const lang = document.getElementById('hwModalLang').value;
                const res = await fetch('/api/visual-tutor', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: 'image', question: `Check my child's answers on this page. Reply in ${lang}.`, image })
                });
                if (token !== hwSessionToken) return;
                if (!res.ok) throw Object.assign(new Error('visual-tutor returned ' + res.status), { status: res.status });
                const data = await res.json();
                msg.textContent = data.speech || '';
                msg.classList.toggle('hidden', !data.speech);
                img.scrollIntoView({ block: 'center' });
                pointer.play(data, { imageEl: img });
            } catch (err) {
                if (token !== hwSessionToken) return;
                console.error('[hwModal] Check mistakes failed:', err);
                msg.textContent = err.status === 429
                    ? 'Too many checks in a short time. Please wait a few minutes and try again.'
                    : "Couldn't check this photo right now. Please try again.";
                msg.classList.remove('hidden');
            } finally {
                if (token === hwSessionToken) {
                    btn.disabled = false;
                    btn.textContent = '🔍 Check mistakes';
                }
            }
        }

        function resetHomeworkModal(){
            hidePhotoPanel();
            hwSentPhotos = [];
            document.getElementById('hwModalForm').classList.remove('hidden');
            document.getElementById('hwModalResults').classList.add('hidden');
            document.getElementById('hwModalText').value = '';
            resetHwAttach();
            document.getElementById('hwModalErrBox').classList.add('hidden');
            document.getElementById('hwModalSubmitBtn').disabled = false;
            applyHwModeChrome(hwCurrentMode);
        }
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('searchAttachMenu');
            const btn = e.target.closest('[aria-label="Attach a file"]');
            if (menu && !menu.contains(e.target) && !btn) menu.classList.add('hidden');
        });

        // ---------------- Shared helpers for the 3 learning-model modals ----------------
        // Reuses loadHomeworkModalChildContext()/#hwModalChildContext (defined above for
        // the AI Tutor modal) as a shared child-name cache rather than re-fetching per modal.
        async function getSharedChildContext(){
            await loadHomeworkModalChildContext();
            return document.getElementById('hwModalChildContext').textContent.replace(/^Helping /, '') || 'your child';
        }

        function attachFilePicker(inputEl, thumbEl, pdfLabelEl, clearBtnEl, state, errBoxEl){
            inputEl.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                errBoxEl.classList.add('hidden');
                if (file.type === 'application/pdf' || HW_SUPPORTED_IMAGE_TYPES.includes(file.type)) {
                    state.mediaType = file.type;
                    const reader = new FileReader();
                    reader.onload = () => {
                        state.base64 = reader.result.split(',')[1];
                        if (file.type === 'application/pdf') {
                            thumbEl.classList.add('hidden');
                            pdfLabelEl.textContent = '📄 ' + (file.name || 'document.pdf');
                            pdfLabelEl.classList.remove('hidden');
                        } else {
                            pdfLabelEl.classList.add('hidden');
                            thumbEl.src = reader.result;
                            thumbEl.classList.remove('hidden');
                        }
                        clearBtnEl.classList.remove('hidden');
                    };
                    reader.readAsDataURL(file);
                    return;
                }
                try {
                    const jpegDataUrl = await reencodeImageToJpeg(file);
                    state.mediaType = 'image/jpeg';
                    state.base64 = jpegDataUrl.split(',')[1];
                    pdfLabelEl.classList.add('hidden');
                    thumbEl.src = jpegDataUrl;
                    thumbEl.classList.remove('hidden');
                    clearBtnEl.classList.remove('hidden');
                } catch (err) {
                    console.error('[attachFilePicker] Could not convert unsupported file format:', err);
                    inputEl.value = '';
                    errBoxEl.textContent = "This file isn't in a format Tut-P can read yet — please attach a photo (JPG/PNG) or a PDF instead.";
                    errBoxEl.classList.remove('hidden');
                }
            });
            clearBtnEl.addEventListener('click', () => {
                state.base64 = null;
                state.mediaType = null;
                inputEl.value = '';
                thumbEl.classList.add('hidden');
                pdfLabelEl.classList.add('hidden');
                clearBtnEl.classList.add('hidden');
            });
        }

        // Same idea as attachFilePicker but supports up to `max` attachments
        // (2, for multi-page homework) instead of exactly one — used by
        // Homework Help/Quiz, Storytelling and Experiential Learning. Not
        // used by Play-Based Learning, which stays on the single-attachment
        // attachFilePicker above — not asked to change and no reason to.
        // Returns a reset() function callers use to clear both slots (e.g.
        // from each modal's own resetXModal()).
        function attachFilePickerMulti(inputEl, slots, triggerEl, triggerText, state, errBoxEl, max){
            function render(){
                slots.forEach((slot, i) => {
                    const item = state.items[i];
                    if (item) {
                        if (item.mediaType === 'application/pdf') {
                            slot.thumbEl.classList.add('hidden');
                            slot.pdfLabelEl.textContent = '📄 ' + (item.name || 'document.pdf');
                            slot.pdfLabelEl.classList.remove('hidden');
                        } else {
                            slot.pdfLabelEl.classList.add('hidden');
                            slot.thumbEl.src = 'data:' + item.mediaType + ';base64,' + item.base64;
                            slot.thumbEl.classList.remove('hidden');
                        }
                        slot.clearBtnEl.classList.remove('hidden');
                    } else {
                        slot.thumbEl.classList.add('hidden');
                        slot.pdfLabelEl.classList.add('hidden');
                        slot.clearBtnEl.classList.add('hidden');
                    }
                });
                triggerEl.textContent = state.items.length === 0 ? triggerText.first : triggerText.more;
                triggerEl.classList.toggle('hidden', state.items.length >= max);
            }
            inputEl.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                inputEl.value = '';
                if (!file) return;
                errBoxEl.classList.add('hidden');
                try {
                    let base64, mediaType;
                    if (file.type === 'application/pdf' || HW_SUPPORTED_IMAGE_TYPES.includes(file.type)) {
                        const dataUrl = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve(reader.result);
                            reader.onerror = () => reject(new Error('Could not read file'));
                            reader.readAsDataURL(file);
                        });
                        base64 = dataUrl.split(',')[1];
                        mediaType = file.type;
                    } else {
                        const jpegDataUrl = await reencodeImageToJpeg(file);
                        base64 = jpegDataUrl.split(',')[1];
                        mediaType = 'image/jpeg';
                    }
                    state.items.push({ base64, mediaType, name: file.name });
                } catch (err) {
                    console.error('[attachFilePickerMulti] Could not read file:', err);
                    errBoxEl.textContent = "This file isn't in a format Tut-P can read yet — please attach a photo (JPG/PNG) or a PDF instead.";
                    errBoxEl.classList.remove('hidden');
                }
                render();
            });
            slots.forEach((slot, i) => {
                slot.clearBtnEl.addEventListener('click', () => {
                    state.items.splice(i, 1);
                    render();
                });
            });
            render();
            return function resetAttach(){ state.items = []; render(); };
        }

        class ModalParseError extends Error {
            constructor(message, rawText) {
                super(message);
                this.name = 'ModalParseError';
                this.rawText = rawText;
            }
        }

        // Extracts a JSON object from Claude's response text (see HwParseError above
        // for why this can't just be JSON.parse(text) — Claude occasionally prepends
        // a clarifying sentence instead of pure JSON).
        function extractJsonFromClaudeText(text){
            const firstBrace = text.indexOf('{');
            const lastBrace = text.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace < firstBrace) {
                throw new ModalParseError('No JSON object found in response', text);
            }
            try {
                return JSON.parse(text.slice(firstBrace, lastBrace + 1));
            } catch (parseErr) {
                throw new ModalParseError(parseErr.message, text);
            }
        }

        // Storytelling and Experiential Learning: { feature, text, language,
        // attachments } in, parsed JSON out. The server builds the prompt.
        async function callHomeworkApi({ feature, text, language, attachments }){
            await window.tutpChildReady;
            const res = await fetch('/api/homework', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    feature,
                    text,
                    language,
                    studentId: sessionStorage.getItem('tutp_student_id'),
                    attachments: (attachments || []).map(item => ({ mediaType: item.mediaType, base64: item.base64 }))
                })
            });
            if (!res.ok) {
                // A 413 (oversized attachment) comes back as an HTML error page,
                // not JSON — res.json() below would throw and get swallowed by
                // the .catch(), losing the real cause. Handle it explicitly so
                // the user gets an actionable message instead of a generic one.
                if (res.status === 413) {
                    throw new Error('These files are too large for Tut-P to process together — try a smaller PDF, a clearer/smaller photo, or just one attachment.');
                }
                const errData = await res.json().catch(() => ({}));
                if (res.status === 402) throw new FreeLimitError(errData.message || "You've used all your free sessions for this child.", errData.bucket);
                throw new Error(errData.error || `Something went wrong reaching the AI (server returned ${res.status}). Please try again in a moment.`);
            }
            const data = await res.json();
            const textBlock = (data.content || []).find(b => b.type === 'text');
            if (!textBlock) throw new ModalParseError('No response content', '');
            return extractJsonFromClaudeText(textBlock.text);
        }
