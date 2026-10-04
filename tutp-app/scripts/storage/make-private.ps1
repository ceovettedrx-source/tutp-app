# make-private.ps1 - makes the Supabase Storage bucket "family-uploads" private.
# Written by Claude Code, NOT run by Claude Code. Run it by hand, ONLY AFTER
# production traffic is on the upload-security revision (scripts\release-us.ps1),
# because the old code writes and shows public urls that stop working the
# moment the bucket is private.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-upsec\tutp-app\scripts\storage\make-private.ps1"
#   -CountOnly   : only the checks and the object counts (nothing is asked, nothing is changed)
#   -Revert      : sets the bucket back to public (use if something breaks after the change)
#
# What it does, in order:
#   1. checks that the live site already runs the new upload code (an upload and a
#      file-open request without a sign-in are refused with 401) - stops if not
#   2. reads the Supabase address from the Cloud Run service and the service key from
#      Secret Manager (secret name supabase-service-role-key) into memory only
#   3. reads the bucket setting and COUNTS the objects (no object names are printed)
#   4. prints exactly what it will change and asks y/n
#   5. sets the bucket to private and checks that an object's old public url now fails
# It never prints, stores or logs the key, and never deletes, moves or renames an
# object. Only the bucket's public flag changes.
param([switch]$CountOnly, [switch]$Revert)

$ErrorActionPreference = 'Stop'
$Service = 'tutp-demo'
$Region  = 'us-central1'
$Bucket  = 'family-uploads'
$Secret  = 'supabase-service-role-key'   # the secret's NAME in Secret Manager, not a value (secret-scan:allow)
$SiteUrl = 'https://tutp.online'

function Stop-Script($msg) {
    Write-Host ''
    Write-Host "STOPPED: $msg" -ForegroundColor Red
    Write-Host 'Nothing was changed.' -ForegroundColor Red
    exit 1
}

function Get-Status($url, $method, $body) {
    try {
        $p = @{ Uri = $url; Method = $method; UseBasicParsing = $true; TimeoutSec = 30 }
        if ($body) { $p.Body = $body; $p.ContentType = 'application/json' }
        return [int](Invoke-WebRequest @p).StatusCode
    } catch {
        if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
        return 0
    }
}

# --- 1. the live site runs the new code ---------------------------------------
if (-not $Revert) {
    $up   = Get-Status "$SiteUrl/api/upload" 'Post' '{"dataBase64":"AAAA"}'
    $open = Get-Status "$SiteUrl/api/files/open?path=families/1/x.png" 'Get' $null
    if (($up -ne 401) -or ($open -ne 401)) {
        Stop-Script "the live site does not refuse an unsigned upload ($up) and file open ($open) with 401, so it is not running the upload-security release yet. Run scripts\release-us.ps1 first."
    }
    Write-Host 'Live site check OK: unsigned upload and file open are refused (401).' -ForegroundColor Green
}

# --- 2. address and key (memory only, never printed) ---------------------------
try {
    $envText = (& gcloud.cmd run services describe $Service "--region=$Region" '--format=value(spec.template.spec.containers[0].env)') | Out-String
    if ($LASTEXITCODE -ne 0) { throw 'gcloud describe failed' }
    if ($envText -notmatch "'name': 'SUPABASE_URL', 'value': '(https://[^']+)'") { throw 'SUPABASE_URL not found on the service' }
    $Base = $Matches[1].TrimEnd('/')
    $envText = $null
    $Key = ((& gcloud.cmd secrets versions access latest "--secret=$Secret") | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $Key) { throw 'could not read the service key from Secret Manager' }
} catch {
    Stop-Script "could not read the connection details: $($_.Exception.Message)"
}
$Headers = @{ Authorization = "Bearer $Key"; apikey = $Key }

function Invoke-Storage($method, $path, $body) {
    try {
        $p = @{ Uri = "$Base/storage/v1$path"; Method = $method; Headers = $Headers; TimeoutSec = 60 }
        if ($body) { $p.Body = ($body | ConvertTo-Json -Depth 5 -Compress); $p.ContentType = 'application/json' }
        return Invoke-RestMethod @p
    } catch {
        $code = 0
        if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
        throw "storage request $method $path failed (HTTP $code)"   # never the headers
    }
}

# --- 3. bucket setting and object counts (no names printed) --------------------
try {
    $b = Invoke-Storage 'Get' "/bucket/$Bucket" $null
} catch { Stop-Script $_.Exception.Message }
Write-Host ("Bucket '$Bucket': public = " + $b.public)

$script:total = 0; $script:old = 0; $script:newFam = 0; $script:newTeach = 0; $script:reg = 0
$script:sample = $null
function Measure-Folder($prefix) {
    $offset = 0
    while ($true) {
        $page = Invoke-Storage 'Post' "/object/list/$Bucket" @{ prefix = $prefix; limit = 1000; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } }
        if (-not $page -or $page.Count -eq 0) { break }
        foreach ($it in $page) {
            if ($null -eq $it.id) { Measure-Folder ($prefix + $it.name + '/'); continue }   # a folder
            $script:total++
            $full = $prefix + $it.name
            if     ($full -like 'families/*')     { $script:newFam++ }
            elseif ($full -like 'teachers/*')     { $script:newTeach++ }
            elseif ($full -like 'registration/*') { $script:reg++ }
            else { $script:old++; if (-not $script:sample) { $script:sample = $full } }
        }
        if ($page.Count -lt 1000) { break }
        $offset += 1000
    }
}
try { Measure-Folder '' } catch { Stop-Script $_.Exception.Message }
Write-Host "Objects in the bucket : $($script:total)"
Write-Host "  old (bucket root, public urls stored in the database) : $($script:old)"
Write-Host "  new families/ : $($script:newFam)   teachers/ : $($script:newTeach)   registration/ : $($script:reg)"
if ($b.public) { Write-Host "Public objects        : $($script:total) (the bucket is public, so every object is readable by anyone with its url)" -ForegroundColor Yellow }
else { Write-Host 'Public objects        : 0 (the bucket is already private)' -ForegroundColor Green }

if ($CountOnly) { exit 0 }

# --- 4. what will change, ask --------------------------------------------------
$want = -not $Revert
if ([bool]$b.public -eq $want) { Write-Host "The bucket is already public = $want. Nothing to do." -ForegroundColor Yellow; exit 0 }
Write-Host ''
Write-Host 'About to change:' -ForegroundColor Cyan
Write-Host "  bucket $Bucket : public $($b.public) -> $want"
if ($want) {
    Write-Host '  no object is deleted, moved or renamed'
    Write-Host '  old public urls (without a token) stop working at once; the app keeps working because it now hands out signed urls (15 minutes)'
} else {
    Write-Host '  every object becomes readable again by anyone with its url'
}
$answer = Read-Host 'Type y to continue (anything else aborts)'
if ($answer -cne 'y') { Stop-Script 'not confirmed.' }

# --- 5. apply and verify --------------------------------------------------------
try {
    Invoke-Storage 'Put' "/bucket/$Bucket" @{ public = $want } | Out-Null
    $after = Invoke-Storage 'Get' "/bucket/$Bucket"
} catch { Write-Host "FAILED: $($_.Exception.Message). Check the bucket in the Supabase dashboard (Storage)." -ForegroundColor Red; exit 1 }
if ([bool]$after.public -ne $want) { Write-Host "NOT APPLIED: the bucket still reports public = $($after.public)." -ForegroundColor Red; exit 1 }
Write-Host "Bucket public = $($after.public)." -ForegroundColor Green
if ($want -and $script:sample) {
    $code = Get-Status "$Base/storage/v1/object/public/$Bucket/$($script:sample)" 'Get' $null
    if ($code -eq 200) { Write-Host 'WARNING: an old public url still returns 200. Check the bucket in the Supabase dashboard.' -ForegroundColor Red; exit 1 }
    Write-Host "Check OK: an old public url now returns $code (not 200)." -ForegroundColor Green
}
Write-Host ''
Write-Host 'Done. Open a child homework attachment and the register page photo once to see them still work. To undo: re-run with -Revert.'
