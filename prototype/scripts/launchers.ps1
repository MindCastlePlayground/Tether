$ErrorActionPreference = 'Stop'
$language = if ($null -ne $env:BB_LANGUAGE) { if ($env:BB_LANGUAGE -ceq 'zh-CN') { 'zh-CN' } else { 'en' } } elseif ([Globalization.CultureInfo]::CurrentCulture.Name.StartsWith('zh')) { 'zh-CN' } else { 'en' }
$text = @{ en = 'Launchers created.'; 'zh-CN' = '启动器已创建。' }
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe).Source
$local = Join-Path $root '.local'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $local /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
foreach ($role in @('host','broker','mcp')) {
  $out = Join-Path $local "$role.exe"
  if (Test-Path -LiteralPath $out) { continue }
  $script = Join-Path $root "dist\$role.js"
  $cfg = Join-Path $local "$role.json"
  $client = Join-Path $local 'agent.json'
  $source = @"
using System;
using System.Diagnostics;
using System.Threading.Tasks;
using System.IO;
using System.Threading;
class Launch {
  static void Pump(Stream input, Stream output) {
    byte[] buffer=new byte[8192];int count;
    try{while((count=input.Read(buffer,0,buffer.Length))>0){output.Write(buffer,0,count);output.Flush();}}catch{}
  }
  static int Main(string[] args) {
    Console.InputEncoding=new System.Text.UTF8Encoding(false);
    var p = new ProcessStartInfo(@"$node");
    p.UseShellExecute=false; p.CreateNoWindow=true;
    p.RedirectStandardInput=true; p.RedirectStandardOutput=true; p.RedirectStandardError=true;
    p.EnvironmentVariables.Clear();
    foreach(var name in new[]{"SystemRoot","WINDIR","TEMP","TMP","USERPROFILE","LOCALAPPDATA","APPDATA","BB_LANGUAGE","BB_BROKER_AUTOSTART"}) {
      var value=Environment.GetEnvironmentVariable(name); if(value!=null)p.EnvironmentVariables[name]=value;
    }
    p.EnvironmentVariables["BB_CLIENT_CONFIG"]=@"$client";
    p.Arguments="\""+@"$script"+"\" \""+@"$cfg"+"\"";
    var role=@"$role";
    if(role=="host") {
      if(args.Length<1 || !args[0].StartsWith("chrome-extension://") || args[0].Contains("\""))return 2;
      p.Arguments+=" \""+args[0]+"\"";
    }
    using(var child=Process.Start(p)){
      var input=new Thread(()=>{Pump(Console.OpenStandardInput(),child.StandardInput.BaseStream);try{child.StandardInput.Close();}catch{}});input.IsBackground=true;
      var output=new Thread(()=>Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput()));output.IsBackground=true;
      var error=new Thread(()=>Pump(child.StandardError.BaseStream,Console.OpenStandardError()));error.IsBackground=true;
      input.Start();output.Start();error.Start();child.WaitForExit();output.Join();error.Join();return child.ExitCode;
    }
  }
}
"@
  Add-Type -TypeDefinition $source -OutputAssembly $out -OutputType ConsoleApplication
}
Write-Output $text[$language]
