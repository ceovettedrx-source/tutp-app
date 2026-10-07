# release-img1.ps1 - moves production traffic of tutp-demo to the img1 revision
# (Explain please explains every question in full and in parallel, one language rule for every
# card of a photo, the Telugu quality pass, and one shared picture per concept on Explain, Notes,
# Storytelling, Answer cards and Experiential Learning, with the free tier: one generated picture
# a day in full, the rest blurred) with checks before and after, an automatic rollback to the
# revision that was live when the script started, and a fast-forward of main when everything
# passed. Modelled on release-us.ps1. Written by Claude Code, NOT run by Claude Code.
#
# Run in PowerShell (no secrets, run by Vet):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-img1\tutp-app\scripts\release-img1.ps1"
# Read-only check of the git step alone (fetch, rev-parse, ancestor test; no gcloud, nothing changed):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-img1\tutp-app\scripts\release-img1.ps1" -GitSelfTest
#
# Rules: no secrets are read or printed, nothing is deleted, no --format=json.
# Only the traffic split changes (--to-revisions, never --update-tags or --set-tags). Safe to run
# again: it only changes what is not already right. OldRev is read at run time (the revision holding
# 100% now), NewRev is the revision the preview tag points to and must equal $NewRev below.
#
# If main has moved since this branch was cut, the script stops in the pre-checks, before any
# traffic moves, and says so: the branch then has to be merged with main and re-tested first.
#
# Git under Windows PowerShell 5.1: git writes progress to stderr, and with $ErrorActionPreference
# = 'Stop' a redirected stderr line becomes a terminating NativeCommandError even when git
# succeeded. Every git call goes through Invoke-Git, which decides success from $LASTEXITCODE only.
param([switch]$GitSelfTest)

$ErrorActionPreference = 'Stop'

$Service    = 'tutp-demo'
$Region     = 'us-central1'
$NewRev     = 'TO_BE_FILLED'                 # release candidate, tagged preview (no E2E_REPLAY, v2 on, pictures on)
$Commit     = 'TO_BE_FILLED'                 # the tested commit (full sha); the branch must contain it
$Branch     = 'img1'                         # fast-forwarded into main on success
$RepoDir    = 'C:\Users\user\wt-img1'
$SaltRef    = 'CHIP_HASH_SALT:2'             # required secret reference (version 2)
$ImageKeyRef = 'gemini-imagelib-key'            # the secret GEMINI_IMAGE_API_KEY must come from (name only; never gemini-image-api-key)
$TagName    = 'preview'
$TagUrl     = 'https://preview---tutp-demo-vs4743puka-uc.a.run.app'
$SiteUrl    = 'https://tutp.online'          # the real domain, also checked after the switch

function Stop-Release($msg) {
    Write-Host ''
    Write-Host "ABORTED: $msg" -ForegroundColor Red
    Write-Host 'Nothing was changed by this step.' -ForegroundColor Red
    exit 1
}

# Runs git in $RepoDir. Returns Code (git's exit code) and Output (stdout and stderr as text).
function Invoke-Git {
    param([string[]]$GitArgs)
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = & git -C $RepoDir @GitArgs 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prev
    }
    return [pscustomobject]@{ Code = $code; Output = (($lines | Out-String).Trim()) }
}

function Get-Sha($ref) {
    $r = Invoke-Git @('rev-parse', '--verify', '--quiet', "$ref^{commit}")
    if ($r.Code -ne 0) { return '' }
    return $r.Output.Trim()
}

# Fetches, then checks that origin/main is an ancestor of the branch (a fast-forward). '' when fine, else the reason.
function Test-FastForward {
    $f = Invoke-Git @('fetch', 'origin')
    if ($f.Code -ne 0) { return "git fetch failed (exit $($f.Code)): $($f.Output)" }
    $branchSha = Get-Sha $Branch
    if (-not $branchSha) { return "branch $Branch does not exist in $RepoDir" }
    $mainSha = Get-Sha 'origin/main'
    if (-not $mainSha) { return 'origin/main cannot be resolved' }
    $a = Invoke-Git @('merge-base', '--is-ancestor', 'origin/main', $Branch)
    if ($a.Code -eq 1) { return "origin/main ($($mainSha.Substring(0,7))) is not an ancestor of $Branch ($($branchSha.Substring(0,7))), so it cannot be fast-forwarded (main moved: merge it into $Branch and re-test)" }
    if ($a.Code -ne 0) { return "git merge-base failed (exit $($a.Code)): $($a.Output)" }
    return ''
}

if ($GitSelfTest) {
    Write-Host '== git self-test (read only) ==' -ForegroundColor Cyan
    $why = Test-FastForward
    Write-Host ("branch $Branch  : " + (Get-Sha $Branch))
    Write-Host ("origin/main     : " + (Get-Sha 'origin/main'))
    if ($why) { Write-Host "fast-forward check: NOT OK - $why" -ForegroundColor Yellow } else { Write-Host 'fast-forward check: OK (origin/main is an ancestor of the branch)' -ForegroundColor Green }
    exit 0
}

function Invoke-Gcloud {
    param([string[]]$GcloudArgs)
    $text = (& gcloud.cmd @GcloudArgs) | Out-String
    if ($LASTEXITCODE -ne 0) { throw "gcloud failed: gcloud $($GcloudArgs -join ' ')" }
    return $text
}

# status.traffic as a list of objects: Revision, Percent, Tag.
function Get-Traffic {
    $raw = Invoke-Gcloud @('run', 'services', 'describe', $Service, "--region=$Region", '--format=value(status.traffic)')
    $items = @()
    foreach ($chunk in ($raw -split ';')) {
        if ($chunk -notmatch "'revisionName':\s*'([^']+)'") { continue }
        $rev = $Matches[1]
        $pct = 0
        if ($chunk -match "'percent':\s*(\d+)") { $pct = [int]$Matches[1] }
        $tag = ''
        if ($chunk -match "'tag':\s*'([^']+)'") { $tag = $Matches[1] }
        $items += [pscustomobject]@{ Revision = $rev; Percent = $pct; Tag = $tag }
    }
    return $items
}

function Get-HttpStatus($url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        return [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

function Get-PostStatus($baseUrl, $route, $body) {
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl$route" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 30
        return [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

# The gates of this release on a base url, with no sign-in: the upload gate of the last release still
# holds (401), and the two picture routes exist and refuse an unsigned caller (401; an old revision
# without them would answer 404). Returns '' when fine, else the reason.
function Test-Gates($base) {
    $up = Get-PostStatus $base '/api/upload' '{"dataBase64":"iVBORw0KGgo="}'
    if ($up -ne 401) { return "$base/api/upload without a sign-in returned $up (expected 401)" }
    $open = Get-HttpStatus "$base/api/files/open?path=families/1/00000000-0000-4000-8000-000000000000.png"
    if ($open -ne 401) { return "$base/api/files/open without a sign-in returned $open (expected 401)" }
    $poll = Get-HttpStatus "$base/api/illustration/c9-physics-speed?studentId=release-check"
    if ($poll -ne 401) { return "$base/api/illustration/<key> without a sign-in returned $poll (expected 401: the picture route must exist and refuse an unsigned caller)" }
    $req = Get-PostStatus $base '/api/illustration/request' '{"studentId":"release-check","picture":{"concept_key":"c9-physics-speed","scene_prompt":"A boy runs.","sig":"0000000000000000"}}'
    if ($req -ne 401) { return "$base/api/illustration/request without a sign-in returned $req (expected 401)" }
    return ''
}

function Test-FullTraffic($rev) {
    $t = Get-Traffic
    $total = ($t | Where-Object { $_.Revision -eq $rev } | Measure-Object -Property Percent -Sum).Sum
    $others = ($t | Where-Object { $_.Revision -ne $rev } | Measure-Object -Property Percent -Sum).Sum
    return (($total -eq 100) -and (-not $others))
}

# All checks that must pass after traffic is on $rev. Returns '' when fine, else the reason.
function Test-Live($rev, $prodUrl) {
    if (-not (Test-FullTraffic $rev)) { return "status.traffic does not show 100% on $rev" }
    $pc = Get-HttpStatus $prodUrl
    if ($pc -ne 200) { return "production URL returned $pc (expected 200)" }
    $sc = Get-HttpStatus $SiteUrl
    if ($sc -ne 200) { return "$SiteUrl returned $sc (expected 200)" }
    try {
        $h = Invoke-RestMethod -Uri "$SiteUrl/health" -TimeoutSec 30
        if ($h.status -ne 'ok') { return "$SiteUrl/health status is '$($h.status)' (expected ok)" }
    } catch { return "$SiteUrl/health failed: $($_.Exception.Message)" }
    $why = Test-Gates $SiteUrl
    if ($why) { return $why }
    $story = Get-PostStatus $SiteUrl '/api/homework' '{"feature":"storytelling","studentId":"release-check","language":"English","text":"multiplication"}'
    if (($story -ne 401) -and ($story -ne 403)) { return "storytelling request without a session returned $story (expected 401 or 403)" }
    foreach ($p in @('/app/login/', '/app/register/', '/app/shared/concept-picture.js')) {
        $c = Get-HttpStatus "$SiteUrl$p"
        if ($c -ne 200) { return "$SiteUrl$p returned $c (expected 200)" }
    }
    return ''
}

Write-Host '== Release: img1 (revision' $NewRev ') ==' -ForegroundColor Cyan

# --- 1. Pre-checks (read only) ---------------------------------------------
if (($NewRev -like '*TO_BE_FILLED') -or ($Commit -like '*TO_BE_FILLED')) { Stop-Release 'this script still has placeholder values for the revision or the commit.' }
$tip = Get-Sha $Branch
$contains = Invoke-Git @('merge-base', '--is-ancestor', $Commit, $Branch)
if ($contains.Code -ne 0) { Stop-Release "branch $Branch (at '$tip') does not contain the tested commit $Commit. Ask Claude Code to re-test or update the script." }
$ffWhy = Test-FastForward
if ($ffWhy) { Stop-Release "main cannot be fast-forwarded: $ffWhy. Nothing was moved." }
try {
    $ProdUrl = (Invoke-Gcloud @('run', 'services', 'describe', $Service, "--region=$Region", '--format=value(status.url)')).Trim()
    if ($ProdUrl -notmatch '^https://') { Stop-Release "could not read the service URL (got an unexpected value)." }

    $traffic = Get-Traffic
    $alreadyNew = Test-FullTraffic $NewRev
    $live = @($traffic | Where-Object { $_.Percent -eq 100 })
    if (-not $alreadyNew) {
        if ($live.Count -ne 1) {
            Stop-Release "100% of traffic is not on one revision. Current split: $(($traffic | Where-Object { $_.Percent -gt 0 } | ForEach-Object { "$($_.Revision)=$($_.Percent)%" }) -join ', ')"
        }
        $OldRev = $live[0].Revision
    } else {
        $OldRev = ''
    }

    $tagged = $traffic | Where-Object { $_.Tag -eq $TagName } | Select-Object -First 1
    if (-not $tagged -or $tagged.Revision -ne $NewRev) { Stop-Release "the $TagName tag does not point to $NewRev." }

    $conds = Invoke-Gcloud @('run', 'revisions', 'describe', $NewRev, "--region=$Region", '--format=value(status.conditions)')
    $ready = $false
    foreach ($c in ($conds -split '\};')) {
        if (($c -match "'type':\s*'Ready'") -and ($c -match "'status':\s*'True'")) { $ready = $true }
    }
    if (-not $ready) { Stop-Release "revision $NewRev is missing or not Ready." }

    # Names and versions only are checked, values are never printed.
    $desc = Invoke-Gcloud @('run', 'revisions', 'describe', $NewRev, "--region=$Region")
    if ($desc -notmatch ('CHIP_HASH_SALT\s+' + [regex]::Escape($SaltRef) + '(\s|$)')) {
        Stop-Release "$NewRev does not reference $SaltRef (CHIP_HASH_SALT must be pinned to version 2)."
    }
    if ($desc -match 'E2E_REPLAY') { Stop-Release "$NewRev has E2E_REPLAY set; it must not be on a revision that gets traffic." }
    if ($desc -notmatch 'ANSWER_V2_ENABLED\s+1(\s|$)') { Stop-Release "$NewRev does not have ANSWER_V2_ENABLED=1 (v2 is live and must stay on)." }
    # img1: pictures on, from the existing secret (never a second image secret).
    if ($desc -notmatch 'IMAGE_GEN_ENABLED\s+1(\s|$)') { Stop-Release "$NewRev does not have IMAGE_GEN_ENABLED=1 (the pictures would never be made)." }
    if ($desc -notmatch ('GEMINI_IMAGE_API_KEY\s+' + [regex]::Escape($ImageKeyRef) + ':')) { Stop-Release "$NewRev does not bind GEMINI_IMAGE_API_KEY from the secret $ImageKeyRef." }
    if ($desc -match 'gemini-image-api-key') { Stop-Release "$NewRev references gemini-image-api-key; the picture key is $ImageKeyRef only." }
    if ($OldRev) {
        $oldLabels = Invoke-Gcloud @('run', 'revisions', 'describe', $OldRev, "--region=$Region", '--format=value(metadata.labels)')
        if ($oldLabels -match 'git-sha=([0-9a-f]{40})') {
            $liveSha = $Matches[1]
            $anc = Invoke-Git @('merge-base', '--is-ancestor', $liveSha, $Commit)
            if ($anc.Code -ne 0) { Stop-Release "the live revision $OldRev runs commit $liveSha, which is not contained in the tested commit $Commit (merge main and re-test)." }
        } else {
            Write-Host "NOTE: live revision $OldRev has no git-sha label; the live commit could not be compared." -ForegroundColor Yellow
        }
    }
} catch {
    Stop-Release "pre-check error: $($_.Exception.Message)"
}
Write-Host 'Pre-checks OK: branch contains the tested commit, main fast-forwardable, traffic split, preview tag, revision Ready, CHIP_HASH_SALT version 2, no E2E_REPLAY, ANSWER_V2_ENABLED=1, IMAGE_GEN_ENABLED=1, picture key from gemini-imagelib-key, live commit inside the tested commit.' -ForegroundColor Green

# --- 2. Smoke check on the preview URL ---------------------------------------
$code = Get-HttpStatus $TagUrl
if ($code -ne 200) { Stop-Release "GET $TagUrl returned $code (expected 200). Traffic not moved." }
$tagWhy = Test-Gates $TagUrl
if ($tagWhy) { Stop-Release "preview URL: $tagWhy. Traffic not moved." }
Write-Host 'Smoke check OK: preview URL returned 200; upload and picture routes refuse an unsigned caller with 401.' -ForegroundColor Green

if ($alreadyNew) {
    Write-Host ''
    Write-Host "Traffic is already 100% on $NewRev - skipping the switch." -ForegroundColor Yellow
} else {
    # --- 3. Summary and confirmation ----------------------------------------
    Write-Host ''
    Write-Host 'About to move production traffic:' -ForegroundColor Cyan
    Write-Host "  from : $OldRev (100%)"
    Write-Host "  to   : $NewRev (100%)"
    Write-Host '  tags : not changed'
    Write-Host "  auto-rollback to $OldRev if a check after the switch fails"
    Write-Host '  (a rollback moves traffic only; never send traffic to tutp-demo-00292-v54, its ANSWER_V2_ENABLED is 0)'
    $answer = Read-Host 'Type YES to continue (anything else aborts)'
    if ($answer -cne 'YES') { Stop-Release 'not confirmed.' }

    # --- 4 + 5. Switch, verify, roll back on any failure ---------------------
    $why = ''
    try {
        Invoke-Gcloud @('run', 'services', 'update-traffic', $Service, "--region=$Region", "--to-revisions=$NewRev=100") | Out-Null
        $why = Test-Live $NewRev $ProdUrl
    } catch {
        $why = $_.Exception.Message
    }

    if ($why -ne '') {
        Write-Host ''
        Write-Host "CHECK FAILED after the switch: $why" -ForegroundColor Red
        Write-Host "Rolling back to $OldRev ..." -ForegroundColor Red
        try {
            Invoke-Gcloud @('run', 'services', 'update-traffic', $Service, "--region=$Region", "--to-revisions=$OldRev=100") | Out-Null
            $rbTraffic = Test-FullTraffic $OldRev
            $rbHttp = Get-HttpStatus $ProdUrl
            $rbSite = Get-HttpStatus $SiteUrl
            if ($rbTraffic -and $rbHttp -eq 200 -and $rbSite -eq 200) {
                Write-Host "ROLLED BACK: 100% on $OldRev, run.app URL and $SiteUrl both return 200. The release did NOT go live." -ForegroundColor Yellow
            } else {
                Write-Host "ROLLBACK RAN BUT NOT VERIFIED (traffic on ${OldRev}: $rbTraffic, run.app status: $rbHttp, $SiteUrl status: $rbSite). Check manually now:" -ForegroundColor Red
                Write-Host "  gcloud run services describe $Service --region=$Region --format=`"value(status.traffic)`""
            }
        } catch {
            Write-Host "ROLLBACK COMMAND FAILED: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "Run by hand: gcloud run services update-traffic $Service --region=$Region --to-revisions=$OldRev=100" -ForegroundColor Red
        }
        exit 1
    }
}

# --- 6. Fast-forward main (no force) -----------------------------------------
$mainNote = ''
$ffWhy = Test-FastForward
if ($ffWhy) {
    $mainNote = "MAIN NOT UPDATED ($ffWhy). Traffic is live; tell Claude Code: fast-forward main."
} else {
    $push = Invoke-Git @('push', 'origin', "${Branch}:refs/heads/main")
    if ($push.Code -ne 0) {
        $mainNote = "MAIN NOT UPDATED (git push was refused, exit $($push.Code): $($push.Output)). Traffic is live; tell Claude Code: fast-forward main."
    } else {
        $f2 = Invoke-Git @('fetch', 'origin')
        $remoteMain = Get-Sha 'origin/main'
        $branchTip = Get-Sha $Branch
        if (($f2.Code -eq 0) -and $remoteMain -and ($remoteMain -eq $branchTip)) {
            Invoke-Git @('fetch', 'origin', 'main:main') | Out-Null
            $mainNote = "main fast-forwarded to $($branchTip.Substring(0,7)) (verified: origin/main = $Branch)"
        } else {
            $mainNote = "MAIN PUSH RAN BUT NOT VERIFIED (origin/main is '$remoteMain', $Branch is '$branchTip'). Tell Claude Code to check."
        }
    }
}

# --- 7. Final summary --------------------------------------------------------
Write-Host ''
Write-Host '================ DONE ================' -ForegroundColor Green
Write-Host "Production traffic : 100% on $NewRev"
Write-Host "Previous revision  : $OldRev"
Write-Host "Main               : $mainNote"
Write-Host ''
Write-Host 'Rollback if anything looks wrong:'
Write-Host "  gcloud run services update-traffic $Service --region=$Region --to-revisions=$OldRev=100"
