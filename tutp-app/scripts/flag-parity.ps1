# Prints the names and values of the plain environment flags of two Cloud Run
# revisions side by side (default: the revision with 100% traffic vs the one
# tagged "preview"), so a redeploy keeps production's flags.
#   powershell -File scripts/flag-parity.ps1 [-Prod <revision>] [-Preview <revision>]
# Only plain `value` entries are printed. Anything that comes from Secret
# Manager (secretKeyRef) is listed by NAME only, as "(secret)", never its
# value. Names that look like secrets (TOKEN, KEY, PASSWORD, SECRET) are
# printed as "(hidden)" even when plain.
param([string]$Prod = '', [string]$Preview = '', [string]$Region = 'us-central1', [string]$Service = 'tutp-demo')
$ErrorActionPreference = 'Stop'

function Get-Traffic { gcloud.cmd run services describe $Service --region=$Region --format=json | ConvertFrom-Json }
if (-not $Prod -or -not $Preview) {
  $svc = Get-Traffic
  if (-not $Prod) { $Prod = ($svc.status.traffic | Where-Object { $_.percent -eq 100 } | Select-Object -First 1).revisionName }
  if (-not $Preview) { $Preview = ($svc.status.traffic | Where-Object { $_.tag -eq 'preview' } | Select-Object -First 1).revisionName }
}

function Get-Flags([string]$rev) {
  $r = gcloud.cmd run revisions describe $rev --region=$Region --format=json | ConvertFrom-Json
  $h = @{}
  foreach ($e in $r.spec.containers[0].env) {
    if ($e.valueFrom -and $e.valueFrom.secretKeyRef) { $h[$e.name] = '(secret)' }
    elseif ($e.name -match 'TOKEN|KEY|PASSWORD|SECRET') { $h[$e.name] = '(hidden)' }
    else { $h[$e.name] = [string]$e.value }
  }
  return $h
}

$a = Get-Flags $Prod
$b = Get-Flags $Preview
Write-Output "prod    = $Prod"
Write-Output "preview = $Preview"
$names = @($a.Keys) + @($b.Keys) | Sort-Object -Unique
$diff = 0
foreach ($n in $names) {
  $va = if ($a.ContainsKey($n)) { $a[$n] } else { '(absent)' }
  $vb = if ($b.ContainsKey($n)) { $b[$n] } else { '(absent)' }
  $mark = if ($va -eq $vb) { '  ' } else { '!=' ; $diff++ }
  Write-Output ("{0} {1,-28} prod={2,-12} preview={3}" -f $mark, $n, $va, $vb)
}
Write-Output "differences: $diff (E2E_REPLAY on a preview is expected until the final redeploy)"
