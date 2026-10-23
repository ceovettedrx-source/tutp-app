# Test runner for tests/unit/release-gate.test.js: reads a JSON array of cases (overrides on top
# of an all-pass fact set), runs the pure gate logic on each, prints one JSON array of results.
param([Parameter(Mandatory = $true)][string]$CasesFile)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\scripts\lib\release-gate-logic.ps1')

$commit = 'a' * 40
$liveEnvText = @(
  'env[0].name: ANSWER_V2_ENABLED', 'env[0].value: 1',
  'env[1].name: IMAGE_GEN_ENABLED', 'env[1].value: 1',
  'env[2].name: SOME_TOKEN', 'env[2].value: FAKE-VALUE-MUST-NEVER-PRINT-123',
  'env[3].name: ADMIN_TOKEN', 'env[3].valueFrom.secretKeyRef.name: admin-token', 'env[3].valueFrom.secretKeyRef.key: latest',
  'env[4].name: CRON_TOKEN', 'env[4].valueFrom.secretKeyRef.name: cron-token-v2'
)
$newEnvText = $liveEnvText + @('env[5].name: NEW_ONLY_NAME', 'env[5].value: x')

$out = @()
foreach ($case in (Get-Content -Raw $CasesFile | ConvertFrom-Json)) {
  $f = @{
    LiveRevision = 'tutp-demo-00512-pov'; NewRevision = 'tutp-demo-00520-new'; Commit = $commit
    LiveLabel = '0b7c748'; LiveIsAncestor = $true; NewLabelFull = $commit; E2eState = 'success'
    LiveEnvText = $liveEnvText; NewEnvText = $newEnvText
  }
  foreach ($p in $case.PSObject.Properties) { $f[$p.Name] = $p.Value }
  $f.LiveEnv = if ($null -ne $f.LiveEnvText) { ConvertFrom-FlattenedEnv ([string[]]$f.LiveEnvText) } else { $null }
  $f.NewEnv = if ($null -ne $f.NewEnvText) { ConvertFrom-FlattenedEnv ([string[]]$f.NewEnvText) } else { $null }
  $res = Invoke-ReleaseGate $f
  $out += [pscustomobject]@{
    allPass = $res.AllPass; command = $res.Command
    results = @($res.Results | ForEach-Object { [pscustomobject]@{ n = $_.N; pass = $_.Pass; reason = $_.Reason } })
  }
}
ConvertTo-Json -Depth 6 -InputObject @($out)
