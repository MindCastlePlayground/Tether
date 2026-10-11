$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifest = Join-Path $root '.local\native-host.json'
if (!(Test-Path -LiteralPath $manifest)) { throw 'Run setup first' }
foreach ($browser in @('Google\Chrome','Microsoft\Edge')) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.freebird.browser_bridge"
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $manifest
}
Write-Output 'native_host_registered_current_user'
