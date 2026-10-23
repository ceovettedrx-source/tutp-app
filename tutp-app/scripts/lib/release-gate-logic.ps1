# Pure logic of scripts/release-gate.ps1 (TUT-88). No network, no gcloud, no git:
# the wrapper gathers the facts, this file decides. Tested by tests/unit/release-gate.test.js.
# A missing fact ($null) is always a FAIL, never a pass. Only env and secret NAMES are kept
# (plus the values of the two flags below); every other env value is dropped while parsing.

$script:GateFlags = @('ANSWER_V2_ENABLED', 'IMAGE_GEN_ENABLED')

# Reads `gcloud ... --format="flattened(spec.containers[0].env)"` text.
# Returns @{ Names = env names; Secrets = secretKeyRef secret names; Flags = name -> value }.
function ConvertFrom-FlattenedEnv([string[]]$Lines) {
  $by = @{}
  foreach ($l in $Lines) {
    if ($l -match 'env\[(\d+)\]\.(name|value|valueFrom\.secretKeyRef\.name)\s*:\s*(.*)$') {
      $i = [int]$Matches[1]
      if (-not $by.ContainsKey($i)) { $by[$i] = @{} }
      $by[$i][$Matches[2]] = $Matches[3].Trim()
    }
  }
  $names = New-Object System.Collections.Generic.List[string]
  $secrets = New-Object System.Collections.Generic.List[string]
  $flags = @{}
  foreach ($i in $by.Keys) {
    $e = $by[$i]
    if (-not $e.ContainsKey('name')) { continue }
    $names.Add($e['name'])
    if ($e.ContainsKey('valueFrom.secretKeyRef.name')) { $secrets.Add($e['valueFrom.secretKeyRef.name']) }
    if ($script:GateFlags -ccontains $e['name']) {
      if ($e.ContainsKey('value')) { $flags[$e['name']] = $e['value'] }
      elseif ($e.ContainsKey('valueFrom.secretKeyRef.name')) { $flags[$e['name']] = '(secret)' }
    }
  }
  return @{ Names = @($names); Secrets = @($secrets); Flags = $flags }
}

# Reads `gcloud run services describe --format="flattened(status.traffic)"` text;
# returns the revision that has 100 percent, or $null.
function Get-LiveRevisionFromFlattened([string[]]$Lines) {
  $by = @{}
  foreach ($l in $Lines) {
    if ($l -match 'traffic\[(\d+)\]\.(percent|revisionName)\s*:\s*(.*)$') {
      $i = [int]$Matches[1]
      if (-not $by.ContainsKey($i)) { $by[$i] = @{} }
      $by[$i][$Matches[2]] = $Matches[3].Trim()
    }
  }
  foreach ($i in $by.Keys) {
    if ($by[$i]['percent'] -eq '100' -and $by[$i]['revisionName']) { return $by[$i]['revisionName'] }
  }
  return $null
}

function New-GateResult([int]$N, [string]$Name, [bool]$Pass, [string]$Reason) {
  return [pscustomobject]@{ N = $N; Name = $Name; Pass = $Pass; Reason = $Reason }
}

# Facts (hashtable): LiveRevision, NewRevision, Commit (full sha), LiveLabel (raw label or $null),
# LiveIsAncestor ($true/$false/$null: live label is an ancestor of Commit), NewLabelFull (full sha
# of the new revision's label, or $null), LiveEnv/NewEnv (ConvertFrom-FlattenedEnv result or $null),
# E2eState (latest commit status "e2e" on Commit: 'success', 'failure', ... or $null).
function Invoke-ReleaseGate([hashtable]$F, [string]$Region = 'us-central1', [string]$Service = 'tutp-demo') {
  $r = New-Object System.Collections.Generic.List[object]

  # 0: the new revision must be a different one from the one serving now
  if (-not $F.LiveRevision -or -not $F.NewRevision) {
    $r.Add((New-GateResult 0 'new revision is not the live one' $false 'live or new revision unknown'))
  } elseif ($F.LiveRevision -ceq $F.NewRevision) {
    $r.Add((New-GateResult 0 'new revision is not the live one' $false "$($F.NewRevision) is already live"))
  } else {
    $r.Add((New-GateResult 0 'new revision is not the live one' $true "$($F.NewRevision) will replace $($F.LiveRevision)"))
  }

  # 1: live commit-sha label is an ancestor of the commit
  if (-not $F.LiveLabel) {
    $r.Add((New-GateResult 1 'live commit is an ancestor of the new commit' $false 'the live revision has no commit-sha label'))
  } elseif ($null -eq $F.LiveIsAncestor) {
    $r.Add((New-GateResult 1 'live commit is an ancestor of the new commit' $false "git cannot resolve $($F.LiveLabel) or the commit (git fetch, then retry)"))
  } elseif ($F.LiveIsAncestor -ne $true) {
    $r.Add((New-GateResult 1 'live commit is an ancestor of the new commit' $false "live $($F.LiveLabel) is NOT an ancestor of the commit: the release would drop what is live"))
  } else {
    $r.Add((New-GateResult 1 'live commit is an ancestor of the new commit' $true "$($F.LiveLabel) is an ancestor"))
  }

  # 2: env and secret names: nothing only on live
  if ($null -eq $F.LiveEnv -or $null -eq $F.NewEnv) {
    $r.Add((New-GateResult 2 'env and secret names: nothing only on live' $false 'could not read env names of one of the revisions'))
  } else {
    $lost = @()
    foreach ($n in $F.LiveEnv.Names) { if (-not ($F.NewEnv.Names -ccontains $n)) { $lost += "env $n" } }
    foreach ($n in $F.LiveEnv.Secrets) { if (-not ($F.NewEnv.Secrets -ccontains $n)) { $lost += "secret $n" } }
    if ($lost.Count -gt 0) { $r.Add((New-GateResult 2 'env and secret names: nothing only on live' $false ('only on live: ' + ($lost -join ', ')))) }
    else { $r.Add((New-GateResult 2 'env and secret names: nothing only on live' $true "$($F.LiveEnv.Names.Count) env names, $($F.LiveEnv.Secrets.Count) secrets all present")) }
  }

  # 3: the two flag values are the same
  if ($null -eq $F.LiveEnv -or $null -eq $F.NewEnv) {
    $r.Add((New-GateResult 3 'flag values are the same' $false 'could not read flags of one of the revisions'))
  } else {
    $bad = @()
    foreach ($n in $script:GateFlags) {
      $a = $F.LiveEnv.Flags[$n]; $b = $F.NewEnv.Flags[$n]
      if ($null -eq $a -and $null -eq $b) { continue }
      if ($null -eq $a -or $null -eq $b) { $bad += "$n set on one revision only"; continue }
      if ($a -cne $b) { $bad += "$n live=$a new=$b" }
    }
    if ($bad.Count -gt 0) { $r.Add((New-GateResult 3 'flag values are the same' $false ($bad -join '; '))) }
    else { $r.Add((New-GateResult 3 'flag values are the same' $true ($script:GateFlags -join ', '))) }
  }

  # 4: E2E_REPLAY is absent on the new revision
  if ($null -eq $F.NewEnv) {
    $r.Add((New-GateResult 4 'E2E_REPLAY absent on the new revision' $false 'could not read env names of the new revision'))
  } elseif ($F.NewEnv.Names -ccontains 'E2E_REPLAY') {
    $r.Add((New-GateResult 4 'E2E_REPLAY absent on the new revision' $false 'E2E_REPLAY is set: this is a preview image'))
  } else {
    $r.Add((New-GateResult 4 'E2E_REPLAY absent on the new revision' $true 'not set'))
  }

  # 5: commit status e2e is success on the commit
  if ($F.E2eState -ceq 'success') { $r.Add((New-GateResult 5 'commit status e2e is success' $true "e2e=success on $($F.Commit)")) }
  elseif (-not $F.E2eState) { $r.Add((New-GateResult 5 'commit status e2e is success' $false "no e2e status on $($F.Commit)")) }
  else { $r.Add((New-GateResult 5 'commit status e2e is success' $false "e2e=$($F.E2eState) on $($F.Commit)")) }

  # 6: the new revision was built from exactly this commit
  if (-not $F.NewLabelFull -or -not $F.Commit) {
    $r.Add((New-GateResult 6 'new revision label equals the commit' $false 'the new revision has no usable commit-sha label'))
  } elseif ($F.NewLabelFull -ine $F.Commit) {
    $r.Add((New-GateResult 6 'new revision label equals the commit' $false "new revision is built from $($F.NewLabelFull), not $($F.Commit)"))
  } else {
    $r.Add((New-GateResult 6 'new revision label equals the commit' $true 'label equals the commit'))
  }

  $all = -not (@($r | Where-Object { -not $_.Pass }).Count)
  $cmd = $null
  if ($all) {
    $cmd = "gcloud.cmd run services update-traffic $Service --region=$Region --to-revisions=$($F.NewRevision)=100 --update-tags=pdftest=$($F.NewRevision)"
  }
  $results = $r.ToArray()
  return New-Object psobject -Property @{ Results = $results; AllPass = [bool]$all; Command = $cmd }
}
