# release-il.ps1 - moves production traffic of tutp-demo to the ilrel revision
# (story image library: checked science pictures with code-drawn labels, a
# Venn diagram, icons on more pictures, pictures for chain equations, the
# prompt fix for scene 3) with checks before and after, an automatic rollback
# to the revision that was live when the script started, and a fast-forward of
# main when everything passed. Modelled on release-sq.ps1.
#
# Run in PowerShell (not committed secrets, run by Vet):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-imglib\tutp-app\scripts\release-il.ps1"
# Read-only check of the git step alone (fetch, rev-parse, ancestor test; no gcloud, nothing changed):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-imglib\tutp-app\scripts\release-il.ps1" -GitSelfTest
#
# Rules: no secrets are read or printed, nothing is deleted, no --format=json.
# Only the traffic split changes (--to-revisions, never --update-tags or
# --set-tags). Safe to run again: it only changes what is not already right.
# OldRev is read at run time (the revision holding 100% now), NewRev is the
# revision the ilrel tag points to and must equal $NewRev below.
#
# Git under Windows PowerShell 5.1: git writes progress to stderr, and with
# $ErrorActionPreference = 'Stop' a redirected stderr line becomes a
# terminating NativeCommandError even when git succeeded. Every git call goes
# through Invoke-Git, which relaxes that for the call and decides success from
# $LASTEXITCODE only.
param([switch]$GitSelfTest)

$ErrorActionPreference = 'Stop'

$Service    = 'tutp-demo'
$Region     = 'us-central1'
$NewRev     = 'tutp-demo-00376-muj'          # release candidate, tagged ilrel
$Commit     = '60a81077600ef5b788ace9546fe31700ee911fba'   # the tested commit (full sha); the branch must contain it
$Branch     = 'story-image-library'          # fast-forwarded into main on success
$RepoDir    = 'C:\Users\user\wt-imglib'
$SaltRef    = 'CHIP_HASH_SALT:2'             # required secret reference (version 2)
$TagUrl     = 'https://ilrel---tutp-demo-vs4743puka-uc.a.run.app'
$SiteUrl    = 'https://tutp.online'          # the real domain, also checked after the switch

function Stop-Release($msg) {
    Write-Host ''
    Write-Host "ABORTED: $msg" -ForegroundColor Red
    Write-Host 'Nothing was changed by this step.' -ForegroundColor Red
    exit 1
}

# Runs git in $RepoDir. Returns Code (git's exit code) and Output (stdout and
# stderr as text). Never throws because of what git writes to stderr.
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

# The full sha of a ref, or '' when git cannot resolve it.
function Get-Sha($ref) {
    $r = Invoke-Git @('rev-parse', '--verify', '--quiet', "$ref^{commit}")
    if ($r.Code -ne 0) { return '' }
    return $r.Output.Trim()
}

# Fetches, then checks that origin/main is an ancestor of the branch (a
# fast-forward). Returns '' when fine, else the reason.
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
    if ($why) { Write-Host "fast-forward check: NOT OK - $why" -ForegroundColor Yellow } else { Write-Host 'fast-forward check: OK (origin/main is an ancestor of the branch)' -ForegroundColor Green }
    exit 0
}

# Runs gcloud (stdout returned as one string). Throws if gcloud fails.
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

# GET a url and return its status and content type ('' when it failed).
function Get-HttpHead($url) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Type = [string]$r.Headers['Content-Type'] }
    } catch {
        if ($_.Exception.Response) { return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Type = '' } }
        return [pscustomobject]@{ Status = 0; Type = '' }
    }
}

# POST a JSON body with no session: the route must be reachable and refuse
# with 401/403 (auth gate working, no model call, no cost).
function Get-PostStatus($baseUrl, $route, $body) {
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl$route" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 30
        return [int]$r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
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
    $story = Get-PostStatus $SiteUrl '/api/homework' '{"feature":"storytelling","studentId":"release-check","language":"English","text":"multiplication"}'
    if (($story -ne 401) -and ($story -ne 403)) { return "storytelling request without a session returned $story (expected 401 or 403)" }
    $rep = Get-PostStatus $SiteUrl '/api/story-image/report' '{"studentId":"release-check","imageId":"chromosome"}'
    if (($rep -ne 401) -and ($rep -ne 403)) { return "image report without a session returned $rep (expected 401 or 403)" }
    $mod = Get-HttpStatus "$SiteUrl/app/shared/story-modal.js"
    if ($mod -ne 200) { return "story-modal.js returned $mod (expected 200)" }
    $img = Get-HttpHead "$SiteUrl/imglib/chromosome.webp"
    if (($img.Status -ne 200) -or ($img.Type -notmatch 'image/webp')) { return "/imglib/chromosome.webp returned $($img.Status) '$($img.Type)' (expected 200 image/webp)" }
    return ''
}

Write-Host '== Release: story image library (revision' $NewRev ') ==' -ForegroundColor Cyan

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

    $tagged = $traffic | Where-Object { $_.Tag -eq 'ilrel' } | Select-Object -First 1
    if (-not $tagged -or $tagged.Revision -ne $NewRev) { Stop-Release "the ilrel tag does not point to $NewRev." }

    # Revision exists and is Ready.
    $conds = Invoke-Gcloud @('run', 'revisions', 'describe', $NewRev, "--region=$Region", '--format=value(status.conditions)')
    $ready = $false
    foreach ($c in ($conds -split '\};')) {
        if (($c -match "'type':\s*'Ready'") -and ($c -match "'status':\s*'True'")) { $ready = $true }
    }
    if (-not $ready) { Stop-Release "revision $NewRev is missing or not Ready." }

    # Secret reference is version 2, E2E_REPLAY absent (names/versions only are checked, values never printed).
    $desc = Invoke-Gcloud @('run', 'revisions', 'describe', $NewRev, "--region=$Region")
    if ($desc -notmatch ('CHIP_HASH_SALT\s+' + [regex]::Escape($SaltRef) + '(\s|$)')) {
        Stop-Release "$NewRev does not reference $SaltRef (CHIP_HASH_SALT must be pinned to version 2)."
    }
    if ($desc -match 'E2E_REPLAY') { Stop-Release "$NewRev has E2E_REPLAY set; it must not be on a revision that gets traffic." }
} catch {
    Stop-Release "pre-check error: $($_.Exception.Message)"
}
Write-Host 'Pre-checks OK: branch contains the tested commit, main fast-forwardable, traffic split, ilrel tag, revision Ready, CHIP_HASH_SALT version 2, no E2E_REPLAY.' -ForegroundColor Green

# --- 2. Smoke check on the ilrel URL ----------------------------------------
$code = Get-HttpStatus $TagUrl
if ($code -ne 200) { Stop-Release "GET $TagUrl returned $code (expected 200). Traffic not moved." }
$tagImg = Get-HttpHead "$TagUrl/imglib/chromosome.webp"
if (($tagImg.Status -ne 200) -or ($tagImg.Type -notmatch 'image/webp')) { Stop-Release "the ilrel URL does not serve /imglib/chromosome.webp as image/webp (got $($tagImg.Status)). Traffic not moved." }
Write-Host 'Smoke check OK: ilrel URL returned 200 and serves the library picture.' -ForegroundColor Green

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
# Every git call goes through Invoke-Git: success is git's exit code, never
# what it printed to stderr (Windows PowerShell 5.1), and the result is
# verified with rev-parse at the end.
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
            Invoke-Git @('fetch', 'origin', 'main:main') | Out-Null   # local main, fast-forward only; fails harmlessly when checked out elsewhere
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
Write-Host "Production URL     : 200 OK ($ProdUrl)"
Write-Host "Real domain        : 200 OK ($SiteUrl), /health ok, storytelling and image-report routes answer, story-modal.js and the library image 200"
Write-Host "Git                : $mainNote"
if ($OldRev) { Write-Host "Rollback command   : gcloud run services update-traffic $Service --region=$Region --to-revisions=$OldRev=100" }
Write-Host ''
