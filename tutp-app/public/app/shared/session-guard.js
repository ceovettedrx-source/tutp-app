// Dashboard guard, loaded as a plain (blocking) script at the top of <body>:
//   <script src="/app/shared/session-guard.js" data-need="family" data-role="mother"></script>
//   data-need="teacher" on /app/teacher/.
//   data-role (mother | father | family_member) on the three role dashboards.
//
// 1. Session restore. The pages keep their ids (tutp_family_id,
// tutp_teacher_id, ...) in sessionStorage, which is per tab and is wiped when
// the browser closes. The tutp_session cookie outlives that (30-day sliding
// expiry), so a missing id doesn't mean a missing login. Only when the id is
// missing, this asks GET /api/session/me who the cookie belongs to:
//   200 with the id    -> restore sessionStorage and reload the page, so
//                         every script on it starts with the id in place;
//   401 / no id / error -> /app/login/.
// The page stays hidden meanwhile, so nothing half-loaded shows.
//
// Reload-loop guard: tutp_guard_reloaded is set just before that reload. If
// the ids are still missing after it (storage not sticking), a second pass
// finds the flag and goes to login instead of reloading again. The flag is
// cleared once a page with its ids has finished loading.
//
// 2. Role guard (pages with data-role). Rule: nobody opens another family
// member's dashboard. The session's roles come from /api/session/me
// (roleMatches: the viewerKey the session was signed in as, else every role
// whose phone is the session's phone), cached per tab as tutp_roles; the
// login page stores them after sign-in. A page whose role isn't among them
// sends the viewer to their own dashboard. On /app/family-member/, the
// selected member must be one of the session's own members.
// Fails closed: no roles on record (empty or missing roleMatches, e.g. a
// phone shared by two families) or no answer from the server sends the
// viewer to /app/login/?pick=1, the profile picker, never leaves the page
// open. ?pick=1 stops the login page bouncing straight back here via
// tutp_last_dashboard, which this page sets as it loads.
// This is navigation only: the role-specific data (e.g. the Bonding Score)
// is refused by the server on its own.
(function(){
    var script = document.currentScript;
    var need = (script && script.getAttribute('data-need')) || 'family';
    var pageRole = script && script.getAttribute('data-role');
    var key = need === 'teacher' ? 'tutp_teacher_id' : 'tutp_family_id';
    var DASH = { mother: '/app/mother/', father: '/app/father/', family_member: '/app/family-member/' };

    function hide(){ document.documentElement.style.visibility = 'hidden'; }
    function show(){ document.documentElement.style.visibility = ''; }
    function toLogin(){ window.location.replace('/app/login/'); }
    function toPicker(){ hide(); window.location.replace('/app/login/?pick=1'); }
    function reloadOnce(){
        var already = null;
        try { already = sessionStorage.getItem('tutp_guard_reloaded'); } catch (e) {}
        if (already) { toLogin(); return; }
        sessionStorage.setItem('tutp_guard_reloaded', '1');
        window.location.reload();
    }
    function saveRoles(roles){
        try { sessionStorage.setItem('tutp_roles', JSON.stringify(roles || [])); } catch (e) {}
    }
    function setMember(r){
        sessionStorage.setItem('tutp_family_member_id', String(r.memberId));
        if (r.name) sessionStorage.setItem('tutp_family_member_name', r.name);
    }

    // Returns true when it has started a redirect/reload.
    function enforceRole(roles){
        if (!pageRole) return false;
        if (!Array.isArray(roles) || !roles.length) { toPicker(); return true; }
        var mine = roles.filter(function(r){ return r.role === pageRole; });
        if (!mine.length) {
            var own = roles[0];
            if (own.role === 'family_member' && own.memberId) setMember(own);
            hide();
            window.location.replace(DASH[own.role] || '/app/login/');
            return true;
        }
        if (pageRole === 'family_member') {
            var current = null;
            try { current = sessionStorage.getItem('tutp_family_member_id'); } catch (e) {}
            var ok = mine.some(function(r){ return String(r.memberId) === current; });
            if (!ok && mine[0].memberId) {
                setMember(mine[0]);
                hide();
                window.location.reload();
                return true;
            }
        }
        return false;
    }

    var have = null;
    try { have = sessionStorage.getItem(key); } catch (e) {}
    if (have) {
        window.addEventListener('load', function(){
            try { sessionStorage.removeItem('tutp_guard_reloaded'); } catch (e) {}
        });
        if (!pageRole) return;
        var cached = null;
        try { cached = JSON.parse(sessionStorage.getItem('tutp_roles') || 'null'); } catch (e) {}
        if (Array.isArray(cached)) { enforceRole(cached); return; }
        hide();
        fetch('/api/session/me', { credentials: 'same-origin', cache: 'no-store' }).then(function(res){
            if (!res.ok) { toLogin(); return; }
            return res.json().then(function(me){
                saveRoles(me.roleMatches);
                if (!enforceRole(me.roleMatches)) show();
            });
        }).catch(toPicker);
        return;
    }

    hide();
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
            saveRoles(me.roleMatches);
            // Which family member: only the one the server matched to this
            // session (its viewerKey, else the member whose phone is the
            // session's phone; see /api/session/me), and only when exactly
            // one role matched. Never a guess such as the first member; with
            // no single match, /app/family-member/ asks as before.
            var roles = me.roleMatches || [];
            if (need === 'family' && roles.length === 1 && roles[0].role === 'family_member' && roles[0].memberId) {
                setMember(roles[0]);
            }
            // The reloaded page applies the role guard from the cached roles.
            reloadOnce();
        });
    }).catch(toLogin);
})();
