$ErrorActionPreference = 'Stop'
$language = if ($null -ne $env:BB_LANGUAGE) { if ($env:BB_LANGUAGE -ceq 'zh-CN') { 'zh-CN' } else { 'en' } } elseif ([Globalization.CultureInfo]::CurrentCulture.Name.StartsWith('zh')) { 'zh-CN' } else { 'en' }
$text = @{ en = @{ Done = 'Native host registered for the current user.'; Setup = 'Run setup first.' }; 'zh-CN' = @{ Done = '已为当前用户注册原生主机。'; Setup = '请先运行初始化脚本。' } }
$root = Split-Path $PSScriptRoot -Parent
$manifest = Join-Path $root '.local\native-host.json'
if (!(Test-Path -LiteralPath $manifest)) { throw $text[$language].Setup }
foreach ($browser in @('Google\Chrome','Microsoft\Edge')) {
  $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.freebird.browser_bridge"
  New-Item -Path $key -Force | Out-Null
  Set-Item -LiteralPath $key -Value $manifest
}
Write-Output $text[$language].Done
