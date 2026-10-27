# Bio-Spectral Entity Analyzer — simple local server (v0.4)
# Camera APIs require http://localhost (not file://)
# All MediaPipe assets are local under vendor/ — no internet required.

Set-Location $PSScriptRoot
$port = 8080

Write-Host "Starting Monster Scanner at http://localhost:$port"
Write-Host "Open that URL in Chrome. Press Ctrl+C to stop."
Write-Host ""

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server $port
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $port
} elseif (Get-Command npx -ErrorAction SilentlyContinue) {
  npx --yes serve -l $port
} else {
  Write-Host "Need Python 3 or Node.js (npx) to serve files."
  exit 1
}
