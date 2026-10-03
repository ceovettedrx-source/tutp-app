# release-sq.ps1 - moves production traffic of tutp-demo to the sqrel revision
# (storytelling visuals v2: a picture drawn in code for every maths story) with
# checks before and after, an automatic rollback to the revision that was live
# when the script started, and a fast-forward of main when everything passed.
#
# Run in PowerShell (not committed secrets, run by Vet):
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-story-visuals\tutp-app\scripts\release-sq.ps1"
#
# Rules: no secrets are read or printed, nothing is deleted, no --format=json.
# Only the traffic split changes (--to-revisions, never --update-tags or
# --set-tags). Safe to run again: it only changes what is not already right.
# OldRev is read at run time (the revision holding 100% now), NewRev is the
# revision the sqrel tag points to and must equal $NewRev below.

$ErrorActionPreference = 'Stop'

$Service    = 'tutp-demo'
$Region     = 'us-central1'
$NewRev     = 'tutp-demo-00373-buy'              # release candidate, tagged sqrel
$Branch     = 'story-visuals-v2'        # fast-forwarded into main on success
$RepoDir    = 'C:\Users\user\wt-story-visuals'
$SaltRef    = 'CHIP_HASH_SALT:2'        # required secret reference (version 2)
$TagUrl     = 'https://sqrel---tutp-demo-vs4743puka-uc.a.run.app'
$SiteUrl    = 'https://tutp.online'     # the real domain, also checked after the switch

function Stop-Release($msg) {
    Write-Host ''
    Write-Host "ABORTED: $msg" -ForegroundColor Red
    Write-Host 'Nothing was changed by this step.' -ForegroundColor Red
    exit 1
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

# POST /api/homework as storytelling with no session: the route must be
# reachable and refuse with 401/403 (auth gate working, no model call, no cost).
function Get-StoryRouteStatus($baseUrl) {
    $body = '{"feature":"storytelling","studentId":"release-check","language":"English","text":"multiplication"}'
    try {
        $r = Invoke-WebRequest -Uri "$baseUrl/api/homework" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -TimeoutSec 30
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
    $story = Get-StoryRouteStatus $SiteUrl
    if (($story -ne 401) -and ($story -ne 403)) { return "storytelling request without a session returned $story (expected 401 or 403)" }
    $mod = Get-HttpStatus "$SiteUrl/app/shared/story-modal.js"
    if ($mod -ne 200) { return "story-modal.js returned $mod (expected 200)" }
    return ''
}

Write-Host '== Release: storytelling visuals v2 (revision' $NewRev ') ==' -ForegroundColor Cyan

# --- 1. Pre-checks (read only) ---------------------------------------------
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

    $tagged = $traffic | Where-Object { $_.Tag -eq 'sqrel' } | Select-Object -First 1
    if (-not $tagged -or $tagged.Revision -ne $NewRev) { Stop-Release "the sqrel tag does not point to $NewRev." }

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
Write-Host 'Pre-checks OK: traffic split, sqrel tag, revision Ready, CHIP_HASH_SALT version 2, no E2E_REPLAY.' -ForegroundColor Green

# --- 2. Smoke check on the sqrel URL ----------------------------------------
$code = Get-HttpStatus $TagUrl
if ($code -ne 200) { Stop-Release "GET $TagUrl returned $code (expected 200). Traffic not moved." }
Write-Host 'Smoke check OK: sqrel URL returned 200.' -ForegroundColor Green

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
$mainNote = 'main fast-forwarded'
try {
    & git -C $RepoDir fetch origin 2>&1 | Out-Null
    & git -C $RepoDir merge-base --is-ancestor origin/main $Branch
    if ($LASTEXITCODE -ne 0) { throw "origin/main is not an ancestor of $Branch, so it cannot be fast-forwarded" }
    & git -C $RepoDir push origin "${Branch}:refs/heads/main" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'git push to main was refused' }
    & git -C $RepoDir fetch origin main:main 2>&1 | Out-Null   # local main, fast-forward only; skipped if checked out elsewhere
    $mainNote = "main fast-forwarded to $((& git -C $RepoDir rev-parse --short $Branch).Trim())"
} catch {
    $mainNote = "MAIN NOT UPDATED ($($_.Exception.Message)). Traffic is live; tell Claude Code: fast-forward main."
}

# --- 7. Final summary --------------------------------------------------------
Write-Host ''
Write-Host '================ DONE ================' -ForegroundColor Green
Write-Host "Production traffic : 100% on $NewRev"
Write-Host "Production URL     : 200 OK ($ProdUrl)"
Write-Host "Real domain        : 200 OK ($SiteUrl), /health ok, storytelling route answers, story-modal.js 200"
Write-Host "Git                : $mainNote"
if ($OldRev) { Write-Host "Rollback command   : gcloud run services update-traffic $Service --region=$Region --to-revisions=$OldRev=100" }
Write-Host ''
