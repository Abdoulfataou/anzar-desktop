# Prépare msedgedriver.exe pour tauri-driver, à la même version que WebView2.
#
# Les runners Windows de GitHub fournissent déjà un Edge Driver aligné sur le navigateur
# Edge ; WebView2 suit en général la même version. On vérifie quand même : si les trois
# premiers nombres diffèrent, la session WebDriver peut rester bloquée (doc Tauri). Dans ce
# cas, on télécharge le pilote correspondant depuis le site officiel de Microsoft.
#
# Sortie : écrit MSEDGEDRIVER=<chemin> dans $env:GITHUB_ENV (ou l'affiche hors CI).
$ErrorActionPreference = 'Stop'

function Get-WebView2Version {
  $keys = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  )
  foreach ($k in $keys) {
    $pv = (Get-ItemProperty -Path $k -Name pv -ErrorAction SilentlyContinue).pv
    if ($pv -and $pv -ne '0.0.0.0') { return $pv }
  }
  throw 'WebView2 introuvable dans le registre.'
}

function Get-DriverVersion([string]$path) {
  $out = & $path --version 2>$null
  if ($out -match '(\d+\.\d+\.\d+\.\d+)') { return $Matches[1] }
  return $null
}

function Short([string]$v) { ($v -split '\.')[0..2] -join '.' }

$webview = Get-WebView2Version
Write-Host "WebView2 : $webview"

$candidates = @()
if ($env:EDGEWEBDRIVER) { $candidates += (Join-Path $env:EDGEWEBDRIVER 'msedgedriver.exe') }
$candidates += 'C:\SeleniumWebDrivers\EdgeDriver\msedgedriver.exe'
$cmd = Get-Command msedgedriver.exe -ErrorAction SilentlyContinue
if ($cmd) { $candidates += $cmd.Source }

$driver = $null
foreach ($c in $candidates) {
  if ($c -and (Test-Path $c)) {
    $v = Get-DriverVersion $c
    Write-Host "Pilote trouvé : $c ($v)"
    if ($v -and (Short $v) -eq (Short $webview)) { $driver = $c; break }
  }
}

if (-not $driver) {
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'win64' }
  $dir = Join-Path $env:RUNNER_TEMP "msedgedriver-$webview"
  if (-not $env:RUNNER_TEMP) { $dir = Join-Path $env:TEMP "msedgedriver-$webview" }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $zip = Join-Path $dir 'edgedriver.zip'
  $url = "https://msedgedriver.microsoft.com/$webview/edgedriver_$arch.zip"
  Write-Host "Téléchargement du pilote assorti : $url"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $dir -Force
  $driver = Join-Path $dir 'msedgedriver.exe'
  Write-Host "Pilote : $driver ($(Get-DriverVersion $driver))"
}

if ($env:GITHUB_ENV) {
  "MSEDGEDRIVER=$driver" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
} else {
  Write-Host "MSEDGEDRIVER=$driver"
}
