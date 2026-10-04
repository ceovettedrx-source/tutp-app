# build.ps1 - builds the Android app bundle (.aab) for Google Play from android/twa-manifest.json.
# Run by Vet (not by Claude), in PowerShell:
#   powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\user\wt-android\tutp-app\scripts\android\build.ps1"
#   ... -CheckOnly                 only checks the tools and the keystore, builds nothing
#   ... -VersionCode 2             for the next upload: Play needs a higher number every time
#
# What it builds: a Trusted Web Activity (the app shows tutp.online full screen) with Bubblewrap,
# signed with YOUR UPLOAD KEY, for Play App Signing (Google keeps the final app-signing key).
#
# Passwords: this script never asks for, reads, prints or stores a keystore password. keytool
# (first run, to create the keystore) and Bubblewrap (every build) ask for them themselves, in
# this window. Nothing is written to a file or to the environment.
#
# Keystore: %USERPROFILE%\tutp-android-keys\tutp-upload.keystore (alias tutp-upload), outside the
# repository on purpose. BACK IT UP the day it is created (see the message printed then).
param(
    [switch]$CheckOnly,
    [int]$VersionCode = 0
)

$ErrorActionPreference = 'Stop'

$RepoDir   = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$AndroidDir = Join-Path $RepoDir 'android'
$BuildDir  = Join-Path $AndroidDir 'build'
$KeyDir    = Join-Path $env:USERPROFILE 'tutp-android-keys'
$Keystore  = Join-Path $KeyDir 'tutp-upload.keystore'
$KeyAlias  = 'tutp-upload'
$SiteUrl   = 'https://tutp.online'
$BubblewrapConfig = Join-Path $env:USERPROFILE '.bubblewrap\config.json'

$problems = @()
function Ok($m)   { Write-Host "  OK    $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  WARN  $m" -ForegroundColor Yellow }
function Bad($m)  { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:problems += $m }

Write-Host '== Tut-P Android build ==' -ForegroundColor Cyan

# --- 1. Tools ---------------------------------------------------------------
Write-Host 'Tools'
$bw = Get-Command bubblewrap -ErrorAction SilentlyContinue
if ($bw) { Ok 'Bubblewrap CLI found' } else { Bad 'Bubblewrap CLI missing. Install it once with:  npm install -g @bubblewrap/cli' }

# Bubblewrap keeps its JDK and SDK paths in ~/.bubblewrap/config.json.
$cfg = $null
if (Test-Path $BubblewrapConfig) { try { $cfg = Get-Content $BubblewrapConfig -Raw | ConvertFrom-Json } catch { $cfg = $null } }

$jdkHome = $null
if ($cfg -and $cfg.jdkPath) { $jdkHome = $cfg.jdkPath } elseif ($env:JAVA_HOME) { $jdkHome = $env:JAVA_HOME }
$javaExe = $null
if ($jdkHome -and (Test-Path (Join-Path $jdkHome 'bin\java.exe'))) { $javaExe = Join-Path $jdkHome 'bin\java.exe' }
elseif (Get-Command java -ErrorAction SilentlyContinue) { $javaExe = (Get-Command java).Source }
if ($javaExe) {
    $verText = (cmd /c "`"$javaExe`" -version 2>&1" | Out-String)
    if ($verText -match 'version "(\d+)') {
        $major = [int]$Matches[1]
        if ($major -eq 17) { Ok "JDK 17 found ($javaExe)" }
        else { Warn "JDK $major found ($javaExe). Bubblewrap's Gradle build is tested with JDK 17. If the build fails on Java, let Bubblewrap download JDK 17 when it asks (answer Y on its first run)." }
    } else { Warn "Could not read the Java version from $javaExe" }
} else {
    Warn 'No JDK found. On its first run Bubblewrap offers to download JDK 17: answer Y.'
}

$sdk = $null
if ($cfg -and $cfg.androidSdkPath) { $sdk = $cfg.androidSdkPath }
elseif ($env:ANDROID_HOME) { $sdk = $env:ANDROID_HOME }
elseif ($env:ANDROID_SDK_ROOT) { $sdk = $env:ANDROID_SDK_ROOT }
if ($sdk -and (Test-Path (Join-Path $sdk 'build-tools'))) { Ok "Android SDK found ($sdk)" }
elseif ($sdk) { Warn "Android SDK folder $sdk has no build-tools yet. Bubblewrap installs what it needs when you let it." }
else { Warn 'No Android SDK found. On its first run Bubblewrap offers to download it: answer Y.' }

# Tell Bubblewrap where an existing JDK 17 and SDK are, so it does not ask. Paths only.
if (-not $cfg -and $javaExe -and $sdk -and $jdkHome -and ($major -eq 17) -and (Test-Path (Join-Path $sdk 'build-tools')) -and -not $CheckOnly) {
    New-Item -ItemType Directory -Force (Split-Path $BubblewrapConfig) | Out-Null
    $json = (@{ jdkPath = $jdkHome; androidSdkPath = $sdk } | ConvertTo-Json)
    [System.IO.File]::WriteAllText($BubblewrapConfig, $json, (New-Object System.Text.UTF8Encoding($false)))
    Ok "wrote $BubblewrapConfig (paths only)"
}

# --- 2. The site the app opens ------------------------------------------------
Write-Host 'Site'
try {
    $m = Invoke-WebRequest -Uri "$SiteUrl/manifest.json" -UseBasicParsing -TimeoutSec 30
    if ($m.StatusCode -eq 200) { Ok "$SiteUrl/manifest.json answers 200" } else { Bad "$SiteUrl/manifest.json answered $($m.StatusCode)" }
} catch { Bad "$SiteUrl/manifest.json is not reachable: $($_.Exception.Message)" }
try {
    $a = Invoke-WebRequest -Uri "$SiteUrl/.well-known/assetlinks.json" -UseBasicParsing -TimeoutSec 30
    if ($a.Content -match '00:00:00:00:00:00:00:00') { Warn 'assetlinks.json is live but still holds the placeholder fingerprint. The app will open with a browser address bar until you run scripts/android/set-fingerprint.mjs and deploy. The build itself is fine.' }
    else { Ok 'assetlinks.json is live with a fingerprint' }
} catch { Warn "assetlinks.json is not live on $SiteUrl yet (release the android-prep revision first): $($_.Exception.Message)" }

# --- 3. Keystore (upload key) -------------------------------------------------
Write-Host 'Keystore'
if (Test-Path $Keystore) {
    Ok "upload keystore exists: $Keystore"
} else {
    Warn "no upload keystore yet at $Keystore"
}

if ($problems.Count -gt 0) {
    Write-Host ''
    Write-Host 'Fix the FAIL lines above and run again. Nothing was built.' -ForegroundColor Red
    exit 1
}
if ($CheckOnly) {
    Write-Host ''
    Write-Host 'Check only: nothing was built or created.' -ForegroundColor Cyan
    exit 0
}

if (-not (Test-Path $Keystore)) {
    $keytool = if ($jdkHome -and (Test-Path (Join-Path $jdkHome 'bin\keytool.exe'))) { Join-Path $jdkHome 'bin\keytool.exe' } else { (Get-Command keytool -ErrorAction SilentlyContinue).Source }
    if (-not $keytool) { Write-Host 'keytool not found: install a JDK, or run Bubblewrap once so it downloads JDK 17, then run this again.' -ForegroundColor Red; exit 1 }
    Write-Host ''
    Write-Host 'Creating the upload keystore. keytool will ask you to choose a password (twice) in this window.' -ForegroundColor Cyan
    Write-Host 'Choose a long one and put it in your password manager now. This script never sees it.' -ForegroundColor Cyan
    $go = Read-Host 'Type YES to create the keystore'
    if ($go -cne 'YES') { Write-Host 'Not created. Stopped.'; exit 1 }
    New-Item -ItemType Directory -Force $KeyDir | Out-Null
    & $keytool -genkeypair -v -keystore $Keystore -alias $KeyAlias -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Tut-P, O=Tut-P, L=Hyderabad, C=IN'
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Keystore)) { Write-Host 'keytool did not create the keystore. Stopped.' -ForegroundColor Red; exit 1 }
    Write-Host ''
    Write-Host 'KEYSTORE CREATED. BACK IT UP NOW:' -ForegroundColor Yellow
    Write-Host "  1. Copy $Keystore to two places that are not this computer (for example a USB stick kept at home and a private cloud drive folder)."
    Write-Host '  2. Save the keystore password and the alias (tutp-upload) in your password manager.'
    Write-Host '  3. Never commit it, email it or paste it into a chat. The repository ignores *.keystore and *.jks.'
    Write-Host '  With Play App Signing a lost upload key can be reset by Google support, but that takes days.'
}

# --- 4. Build -----------------------------------------------------------------
# A copy of twa-manifest.json with the keystore path filled in, so the repository file holds no personal path.
New-Item -ItemType Directory -Force $BuildDir | Out-Null
$tm = Get-Content (Join-Path $AndroidDir 'twa-manifest.json') -Raw | ConvertFrom-Json
$tm.signingKey.path = $Keystore
$tm.signingKey.alias = $KeyAlias
if ($VersionCode -gt 0) { $tm.appVersionCode = $VersionCode }
$tmJson = $tm | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText((Join-Path $BuildDir 'twa-manifest.json'), $tmJson, (New-Object System.Text.UTF8Encoding($false)))

Push-Location $BuildDir
try {
    Write-Host ''
    Write-Host "Generating the Android project (version code $($tm.appVersionCode)) ..." -ForegroundColor Cyan
    & bubblewrap update --manifest=twa-manifest.json --skipVersionUpgrade
    if ($LASTEXITCODE -ne 0) { throw "bubblewrap update failed (exit $LASTEXITCODE)" }
    Write-Host ''
    Write-Host 'Building. Bubblewrap now asks for the keystore password and the key password in this window.' -ForegroundColor Cyan
    & bubblewrap build --manifest=twa-manifest.json
    if ($LASTEXITCODE -ne 0) { throw "bubblewrap build failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

$aab = Join-Path $BuildDir 'app-release-bundle.aab'
if (-not (Test-Path $aab)) { Write-Host "Build finished but $aab was not found." -ForegroundColor Red; exit 1 }
$hash = (Get-FileHash $aab -Algorithm SHA256).Hash
Write-Host ''
Write-Host '================ DONE ================' -ForegroundColor Green
Write-Host "App bundle : $aab"
Write-Host "SHA-256    : $hash"
Write-Host 'Upload it in Play Console -> Test and release -> Testing -> Closed testing -> Create release.'
Write-Host 'Then copy the App signing key SHA-256 (App integrity page) and run:  node scripts/android/set-fingerprint.mjs <that value>'
Write-Host ''
