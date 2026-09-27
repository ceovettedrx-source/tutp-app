// Dashboard guard, loaded as a plain (blocking) script at the top of <body>:
//   <script src="/app/shared/session-guard.js" data-need="family"></script>
//   data-need="teacher" on /app/teacher/.
//
// The pages keep their ids (tutp_family_id, tutp_teacher_id, ...) in
// sessionStorage, which is per tab and is wiped when the browser closes. The
// tutp_session cookie outlives that (30-day sliding expiry), so a missing id
// doesn't mean a missing login. Only when the id is missing, this asks
// GET /api/session/me who the cookie belongs to:
//   200 with the id    -> restore sessionStorage and reload the page, so
//                         every script on it starts with the id in place;
//   401 / no id / error -> /app/login/.
// The page stays hidden meanwhile, so nothing half-loaded shows.
//
// Reload-loop guard: tutp_guard_reloaded is set just before that reload. If
// the ids are still missing after it (storage not sticking), a second pass
// finds the flag and goes to login instead of reloading again. The flag is
// cleared once a page with its ids has finished loading.
(function(){
    var need = (document.currentScript && document.currentScript.getAttribute('data-need')) || 'family';
    var key = need === 'teacher' ? 'tutp_teacher_id' : 'tutp_family_id';
    var have = null;
    try { have = sessionStorage.getItem(key); } catch (e) {}
    if (have) {
        window.addEventListener('load', function(){
            try { sessionStorage.removeItem('tutp_guard_reloaded'); } catch (e) {}
        });
        return;
    }

    document.documentElement.style.visibility = 'hidden';
    function toLogin(){ window.location.replace('/app/login/'); }
    function reloadOnce(){
        var already = null;
        try { already = sessionStorage.getItem('tutp_guard_reloaded'); } catch (e) {}
        if (already) { toLogin(); return; }
        sessionStorage.setItem('tutp_guard_reloaded', '1');
        window.location.reload();
    }

    fetch('/api/session/me', { credentials: 'same-origin', cache: 'no-store' }).then(function(res){
        if (!res.ok) { toLogin(); return; }
        return res.json().then(function(me){
            var id = need === 'teacher' ? me.teacherId : me.familyId;
            if (!id) { toLogin(); return; }
            if (need === 'teacher') {
                // The session carries a teacherId before approval too; only
                // /app/login/ used to check it, so check it here as well.
                return fetch('/api/teacher/' + encodeURIComponent(id), { cache: 'no-store' })
                    .then(function(r){ return r.ok ? r.json() : null; })
                    .then(function(t){
                        if (!t || !t.is_approved) { toLogin(); return; }
                        sessionStorage.setItem(key, String(id));
                        reloadOnce();
                    });
            }
            sessionStorage.setItem(key, String(id));
            // Which family member: only the one the server matched to this
            // session (its viewerKey, else the member whose phone is the
            // session's phone; see /api/session/me), and only when exactly
            // one role matched. Never a guess such as the first member; with
            // no single match, /app/family-member/ asks as before.
            var roles = me.roleMatches || [];
            if (need === 'family' && roles.length === 1 && roles[0].role === 'family_member' && roles[0].memberId) {
                sessionStorage.setItem('tutp_family_member_id', String(roles[0].memberId));
                if (roles[0].name) sessionStorage.setItem('tutp_family_member_name', roles[0].name);
            }
            reloadOnce();
        });
    }).catch(toLogin);
})();
