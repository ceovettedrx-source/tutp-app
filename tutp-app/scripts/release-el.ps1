# release-el.ps1 - moves production traffic of tutp-demo to the elrel revision
# (Experiential Learning v2: Guided Discovery pilot + shared video service)
# with checks before and after, an automatic rollback to the revision that was
# live when the script started, and a fast-forward of main when everything
# passed. Modelled on release-il.ps1.
#
# Run in PowerShell (run by Vet; the auto-mode classifier blocks update-traffic for Claude):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-el-v2\tutp-app\scripts\release-el.ps1"
# Read-only check of the git step alone (no gcloud, nothing changed):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-el-v2\tutp-app\scripts\release-el.ps1" -GitSelfTest
#
# Rules: no secrets are read or printed, nothing is deleted. Only the traffic
# split changes (--to-revisions, never --update-tags or --set-tags). Safe to
# run again. OldRev is read at run time (the revision holding 100% now).
# Git under Windows PowerShell 5.1: every git call goes through Invoke-Git,
# which decides success from $LASTEXITCODE only.
param([switch]$GitSelfTest)

$ErrorActionPreference = 'Stop'

$Service = 'tutp-demo'
$Region  = 'us-central1'
$NewRev  = 'tutp-demo-00393-huf'          # tested image (sha256:e2a84adb...), no E2E_REPLAY, tagged elrel
$Commit  = 'c3d9863ff563d4aebc82c9c1024e50d31bff20b0'   # the commit the tested image was built from; the branch must contain it
$Branch  = 'experiential-learning-v2'     # fast-forwarded into main on success
$RepoDir = 'C:\Users\user\wt-el-v2'
$SaltRef = 'CHIP_HASH_SALT:2'
$TagUrl  = 'https://elrel---tutp-demo-vs4743puka-uc.a.run.app'
$SiteUrl = 'https://tutp.online'

function Stop-Release($msg) {
    Write-Host ''
    Write-Host "ABORTED: $msg" -ForegroundColor Red
    Write-Host 'Nothing was changed by this step.' -ForegroundColor Red
    exit 1
}

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

function Test-FastForward {
    $f = Invoke-Git @('fetch', 'origin')
    if ($f.Code -ne 0) { return "git fetch failed (exit $($f.Code)): $($f.Output)" }
    $branchSha = Get-Sha $Branch
    if (-not $branchSha) { return "branch $Branch does not exist in $RepoDir" }
    $mainSha = Get-Sha 'origin/main'
    if (-not $mainSha) { return 'origin/main cannot be resolved' }
    $a = Invoke-Git @('merge-base', '--is-ancestor', 'origin/main', $Branch)
    if ($a.Code -eq 1) { return "origin/main ($($mainSha.Substring(0,7))) is not an ancestor of $Branch ($($branchSha.Substring(0,7))), so it cannot be fast-forwarded" }
    if ($a.Code -ne 0) { return "git merge-base failed (exit $($a.Code)): $($a.Output)" }
    return ''
}

if ($GitSelfTest) {
    Write-Host '== git self-test (read only) ==' -ForegroundColor Cyan
    $why = Test-FastForward
    Write-Host ("branch $Branch  : " + (Get-Sha $Branch))
    Write-Host ("origin/main     : " + (Get-Sha 'origin/main'))
    if ($why) { Write-Host "fast-forward check: NOT OK - $why" -ForegroundColor Yellow } else { Write-Host 'fast-forward check: OK' -ForegroundColor Green }
    exit 0
}

function Invoke-Gcloud {
    param([string[]]$GcloudArgs)
    $text = (& gcloud.cmd @GcloudArgs) | Out-String
    if ($LASTEXITCODE -ne 0) { throw "gcloud failed: gcloud $($GcloudArgs -join ' ')" }
    return $text
}

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

# GET a url and return the body text ('' when it failed).
function Get-Body($url) {
    try { return (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30).Content } catch { return '' }
}

function Test-FullTraffic($rev) {
    $t = Get-Traffic
    $total = ($t | Where-Object { $_.Revision -eq $rev } | Measure-Object -Property Percent -Sum).Sum
    $others = ($t | Where-Object { $_.Revision -ne $rev } | Measure-Object -Property Percent -Sum).Sum
    return (($total -eq 100) -and (-not $others))
}

# Checks on a base url that serves the new code: returns '' when fine, else the reason.
function Test-ElSurface($base) {
    $body = Get-Body "$base/api/el/concepts"
    try { $n = @(($body | ConvertFrom-Json).concepts).Count } catch { $n = 0 }
    if ($n -lt 10) { return "$base/api/el/concepts lists $n concepts (expected 10 or more)" }
    $page = Get-Body "$base/app/mother/"
    if ($page -notmatch 'el-guided\.js') { return "$base/app/mother/ does not load el-guided.js" }
    if ($page -match "isn't available yet|isn&#39;t available yet") { return "$base/app/mother/ still has the old video notice" }
    $js = Get-HttpStatus "$base/app/shared/el-guided.js"
    if ($js -ne 200) { return "el-guided.js returned $js (expected 200)" }
    $lesson = Get-HttpStatus "$base/api/el/lesson/friction?studentId=release-check"
    if (($lesson -ne 401) -and ($lesson -ne 403)) { return "a lesson request without a session returned $lesson (expected 401 or 403)" }
    $vid = Get-HttpStatus "$base/api/el/videos?concept=friction"
    if (($vid -ne 401) -and ($vid -ne 403)) { return "a video request without a session returned $vid (expected 401 or 403)" }
    return ''
}

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
    $why = Test-ElSurface $SiteUrl
    if ($why) { return $why }
    return ''
}

Write-Host '== Release: Experiential Learning v2 (revision' $NewRev ') ==' -ForegroundColor Cyan

# --- 1. Pre-checks (read only) ---------------------------------------------
$tip = Get-Sha $Branch
$contains = Invoke-Git @('merge-base', '--is-ancestor', $Commit, $Branch)
if ($contains.Code -ne 0) { Stop-Release "branch $Branch (at '$tip') does not contain the tested commit $Commit." }
$ffWhy = Test-FastForward
if ($ffWhy) { Stop-Release "main cannot be fast-forwarded: $ffWhy. Nothing was moved." }
try {
    $ProdUrl = (Invoke-Gcloud @('run', 'services', 'describe', $Service, "--region=$Region", '--format=value(status.url)')).Trim()
    if ($ProdUrl -notmatch '^https://') { Stop-Release 'could not read the service URL.' }
    $traffic = Get-Traffic
    $alreadyNew = Test-FullTraffic $NewRev
    $live = @($traffic | Where-Object { $_.Percent -eq 100 })
    if (-not $alreadyNew) {
        if ($live.Count -ne 1) { Stop-Release '100% of traffic is not on one revision.' }
        $OldRev = $live[0].Revision
    } else { $OldRev = '' }

    $tagged = $traffic | Where-Object { $_.Tag -eq 'elrel' } | Select-Object -First 1
    if (-not $tagged -or $tagged.Revision -ne $NewRev) { Stop-Release "the elrel tag does not point to $NewRev." }

    $conds = Invoke-Gcloud @('run', 'revisions', 'describe', $NewRev, "--region=$Region", '--format=value(status.conditions)')
    $ready = $false
    foreach ($c in ($conds -split '\};')) {
        if (($c -match "'type':\s*'Ready'") -and ($c -match "'status':\s*'True'")) { $ready = $true }
    }
    if (-not $ready) { Stop-Release "revision $NewRev is missing or not Ready." }

    $desc = Invoke-Gcloud @('run', 'revisions', 'describe', $NewRev, "--region=$Region")
    if ($desc -notmatch ('CHIP_HASH_SALT\s+' + [regex]::Escape($SaltRef) + '(\s|$)')) { Stop-Release "$NewRev does not reference $SaltRef." }
    if ($desc -match 'E2E_REPLAY') { Stop-Release "$NewRev has E2E_REPLAY set; it must not get traffic." }
    if ($desc -match 'ANSWER_V2_ENABLED') { Stop-Release "$NewRev carries ANSWER_V2_ENABLED, which is not in the live env." }
} catch {
    Stop-Release "pre-check error: $($_.Exception.Message)"
}
Write-Host 'Pre-checks OK: branch has the tested commit, main fast-forwardable, traffic split, elrel tag, revision Ready, CHIP_HASH_SALT version 2, no E2E_REPLAY.' -ForegroundColor Green

# --- 2. Smoke check on the elrel URL ----------------------------------------
$tagWhy = Test-ElSurface $TagUrl
if ($tagWhy) { Stop-Release "elrel URL check failed: $tagWhy. Traffic not moved." }
Write-Host 'Smoke check OK: the elrel URL serves the lessons list, the page script, and refuses requests without a session.' -ForegroundColor Green

if ($alreadyNew) {
    Write-Host "Traffic is already 100% on $NewRev - skipping the switch." -ForegroundColor Yellow
} else {
    Write-Host ''
    Write-Host 'About to move production traffic:' -ForegroundColor Cyan
    Write-Host "  from : $OldRev (100%)"
    Write-Host "  to   : $NewRev (100%)"
    Write-Host '  tags : not changed'
    Write-Host "  auto-rollback to $OldRev if a check after the switch fails"
    $answer = Read-Host 'Type YES to continue (anything else aborts)'
    if ($answer -cne 'YES') { Stop-Release 'not confirmed.' }

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
                Write-Host "ROLLED BACK: 100% on $OldRev, both URLs return 200. The release did NOT go live." -ForegroundColor Yellow
            } else {
                Write-Host "ROLLBACK RAN BUT NOT VERIFIED (traffic on ${OldRev}: $rbTraffic, run.app: $rbHttp, site: $rbSite). Check manually now." -ForegroundColor Red
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

Write-Host ''
Write-Host '================ DONE ================' -ForegroundColor Green
Write-Host "Production traffic : 100% on $NewRev"
Write-Host "Production URL     : 200 OK ($ProdUrl)"
Write-Host "Real domain        : 200 OK ($SiteUrl), /health ok, lessons list, page script, auth gate on lessons and videos"
Write-Host "Git                : $mainNote"
if ($OldRev) { Write-Host "Rollback command   : gcloud run services update-traffic $Service --region=$Region --to-revisions=$OldRev=100" }
Write-Host ''
