$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$proc=Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'scripts/audit-client.mjs' -WorkingDirectory $root -WindowStyle Hidden -PassThru
$all=Get-CimInstance Win32_Process
$launchers=@($all | Where-Object {$_.ExecutablePath -in @((Join-Path $root '.local\broker.exe'),(Join-Path $root '.local\host.exe'))})
$ids=@($proc.Id)+@($launchers.ProcessId)+@($all | Where-Object {$_.ParentProcessId -in $launchers.ProcessId} | Select-Object -ExpandProperty ProcessId)
$rows=@()
try {
  for($sample=0;$sample -lt 4;$sample++){
    $rows+=@(Get-NetTCPConnection | Where-Object {$_.OwningProcess -in $ids} | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess)
    Start-Sleep -Milliseconds 500
  }
  $unique=@($rows | Sort-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess -Unique)
  $outside=@($unique | Where-Object {$_.RemoteAddress -notin @('0.0.0.0','127.0.0.1','::','::1')})
  $report=@{at=[DateTime]::UtcNow.ToString('o');scope='four TCP socket snapshots of prototype broker/native-host/SDK processes; not packet capture; browser and UDP excluded';outsideLoopbackCount=$outside.Count;connections=$unique}
  $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'evidence\network-sample.json') -Encoding UTF8
  Write-Output "socket_rows=$($unique.Count); outside_loopback=$($outside.Count)"
} finally {if(!$proc.HasExited){Stop-Process -Id $proc.Id}}
