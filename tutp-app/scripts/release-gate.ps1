# TUT-88: the only place a traffic command comes from. Read-only.
#   powershell -File scripts/release-gate.ps1 <revision> <commit>
# Checks the new revision against the live one and the commit (see docs/specs/TUT-88-89.md),
# prints PASS/FAIL per check, and prints the one-line update-traffic command ONLY when all pass.
# It never moves traffic. Output is names only: no env value except the two flags, no secret
# value, and no --format=json (env is read as flattened text into memory, then reduced to names).
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Revision,
  [Parameter(Mandatory = $true, Position = 1)][string]$Commit,
  [string]$Region = 'us-central1',
  [string]$Service = 'tutp-demo'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\release-gate-logic.ps1')
$repoRoot = Split-Path -Parent $PSScriptRoot

# Runs a native command; returns its output lines, or $null when it fails (a failed fact is a FAIL).
function Invoke-Fact([scriptblock]$Cmd) {
  try {
    $out = & $Cmd
    if ($LASTEXITCODE -ne 0) { return $null }
    return , @($out)   # the comma keeps a one-line result an array (otherwise $o[0] is its first character)
  } catch { return $null }
}

function Resolve-Sha([string]$Ref) {
  if (-not $Ref) { return $null }
  $o = Invoke-Fact { git -C $repoRoot rev-parse --verify --quiet "$Ref^{commit}" }
  if ($o -and $o[0]) { return ([string]$o[0]).Trim() }
  return $null
}

function Get-Label([string]$Rev) {
  $o = Invoke-Fact { gcloud.cmd run revisions describe $Rev --region=$Region --format="value(metadata.labels.commit-sha)" }
  if ($o -and $o[0]) { return ([string]$o[0]).Trim() }
  return $null
}

function Get-Env([string]$Rev) {
  $o = Invoke-Fact { gcloud.cmd run revisions describe $Rev --region=$Region --format="flattened(spec.containers[0].env)" }
  if ($null -eq $o) { return $null }
  return ConvertFrom-FlattenedEnv $o
}

$traffic = Invoke-Fact { gcloud.cmd run services describe $Service --region=$Region --format="flattened(status.traffic)" }
$live = if ($traffic) { Get-LiveRevisionFromFlattened $traffic } else { $null }

$commitFull = Resolve-Sha $Commit
$liveLabel = if ($live) { Get-Label $live } else { $null }
$liveSha = Resolve-Sha $liveLabel
$isAncestor = $null
if ($liveSha -and $commitFull) {
  git -C $repoRoot merge-base --is-ancestor $liveSha $commitFull
  $isAncestor = ($LASTEXITCODE -eq 0)
  if ($LASTEXITCODE -gt 1) { $isAncestor = $null }
}
$newLabel = Get-Label $Revision

$state = $null
if ($commitFull) {
  $repo = Invoke-Fact { gh repo view --json nameWithOwner --jq .nameWithOwner }
  if ($repo -and $repo[0]) {
    # the combined-status endpoint lists the latest state per context; parsed here, not with --jq (PowerShell 5.1 eats the quotes in a jq filter)
    $s = Invoke-Fact { gh api "repos/$($repo[0])/commits/$commitFull/status" }
    if ($s) {
      $e2e = @(($s -join "`n" | ConvertFrom-Json).statuses | Where-Object { $_.context -ceq 'e2e' }) | Select-Object -First 1
      if ($e2e -and $e2e.state) { $state = [string]$e2e.state }
    }
  }
}

$facts = @{
  LiveRevision   = $live
  NewRevision    = $Revision
  Commit         = $commitFull
  LiveLabel      = $liveLabel
  LiveIsAncestor = $isAncestor
  NewLabelFull   = (Resolve-Sha $newLabel)
  LiveEnv        = if ($live) { Get-Env $live } else { $null }
  NewEnv         = Get-Env $Revision
  E2eState       = $state
}

$res = Invoke-ReleaseGate $facts $Region $Service
Write-Output "release gate: $Revision (commit $commitFull) over live $live"
foreach ($c in $res.Results) {
  Write-Output ("{0} {1}: {2} - {3}" -f $(if ($c.Pass) { 'PASS' } else { 'FAIL' }), $c.N, $c.Name, $c.Reason)
}
if ($res.AllPass) {
  Write-Output 'ALL CHECKS PASSED. Founder runs this one line:'
  Write-Output $res.Command
  exit 0
}
Write-Output ('NOT RELEASABLE: failed ' + ((@($res.Results | Where-Object { -not $_.Pass } | ForEach-Object { $_.N })) -join ', ') + '. No traffic command.')
exit 1
