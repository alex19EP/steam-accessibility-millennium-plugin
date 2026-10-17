<#
.SYNOPSIS
  Make Steam show a test notification toast.

.DESCRIPTION
  Calls Steam's own test functions on window.NotificationStore in SharedJSContext through the
  CEF DevTools port. Steam only opens that port (127.0.0.1:8080) when started with
  -cef-enable-debugging:
    & 'C:\Program Files (x86)\Steam\Steam.exe' -shutdown
    & 'C:\Program Files (x86)\Steam\steam.exe' -cef-enable-debugging
  While the port is open any local program can control Steam, so restart Steam normally when
  done testing.

.PARAMETER Kind
  Message: a chat message from a friend (Steam picks one) with -Text as the body.
  Download: "download complete" for -AppId.

.EXAMPLE
  .\tools\test-toast.ps1 -Text 'Привет'
  .\tools\test-toast.ps1 -Kind Download -AppId 570
#>
param(
  [ValidateSet('Message', 'Download')] [string]$Kind = 'Message',
  [string]$Text = 'Тестовое сообщение',
  [int]$AppId = 570,
  [int]$Port = 8080
)
$ErrorActionPreference = 'Stop'

try {
  $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json" -TimeoutSec 3
} catch {
  Write-Error "No DevTools port on $Port. Start Steam with -cef-enable-debugging (see Get-Help $PSCommandPath)."
}
$target = $targets | Where-Object { $_.title -eq 'SharedJSContext' } | Select-Object -First 1
if (-not $target) { Write-Error 'SharedJSContext not found among the DevTools targets.' }

$call = if ($Kind -eq 'Download') {
  "NotificationStore.TestDownloadComplete($AppId)"
} else {
  "NotificationStore.TestFriendMessage(null, $($Text | ConvertTo-Json))"
}
$request = @{
  id = 1
  method = 'Runtime.evaluate'
  params = @{ expression = "(() => { $call; return 'ok' })()"; returnByValue = $true }
} | ConvertTo-Json -Depth 4 -Compress

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$ws.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
try {
  $bytes = [Text.Encoding]::UTF8.GetBytes($request)
  $ws.SendAsync([ArraySegment[byte]]$bytes, 'Text', $true, [Threading.CancellationToken]::None).Wait()
  $buffer = [byte[]]::new(65536)
  $reply = ''
  do {
    $r = $ws.ReceiveAsync([ArraySegment[byte]]$buffer, [Threading.CancellationToken]::None).Result
    $reply += [Text.Encoding]::UTF8.GetString($buffer, 0, $r.Count)
  } until ($r.EndOfMessage)
} finally {
  $ws.Dispose()
}
$result = ($reply | ConvertFrom-Json).result
if ($result.exceptionDetails) {
  Write-Error $result.exceptionDetails.exception.description
}
"$Kind toast requested: $($result.result.value)"
