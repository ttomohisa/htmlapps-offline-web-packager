$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
$Root = Split-Path -Parent $PSScriptRoot
$fixture = Join-Path ([System.IO.Path]::GetTempPath()) ("packager-build-output-" + [Guid]::NewGuid().ToString("N"))
try {
  New-Item -ItemType Directory -Force -Path $fixture | Out-Null
  foreach ($name in @("build-standalone.ps1", "app.config.json", "dependencies.json", "dependencies.lock.json", "src", "assets", "scripts")) {
    Copy-Item -LiteralPath (Join-Path $Root $name) -Destination $fixture -Recurse
  }
  $builder = Join-Path $fixture "build-standalone.ps1"
  $publicHtml = Join-Path $fixture "offline-web-packager.html"
  $sentinel = "Public HTML must not change during a variant build."
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($publicHtml, $sentinel, $utf8)
  & $builder -OutputPath "variants/custom.html"
  if ([System.IO.File]::ReadAllText($publicHtml) -ne $sentinel) { throw "Explicit OutputPath overwrote public root HTML." }
  & $builder -SkipSelfExtract
  if ([System.IO.File]::ReadAllText($publicHtml) -ne $sentinel) { throw "SkipSelfExtract overwrote public root HTML." }
  $configPath = Join-Path $fixture "app.config.json"
  $originalConfig = [System.IO.File]::ReadAllText($configPath)
  $config = $originalConfig | ConvertFrom-Json
  $config.build.output = "variants/configured.html"
  [System.IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json -Depth 20), $utf8)
  & $builder
  if ([System.IO.File]::ReadAllText($publicHtml) -ne $sentinel) { throw "Alternative configured output overwrote public root HTML." }
  [System.IO.File]::WriteAllText($configPath, $originalConfig, $utf8)
  & $builder
  $readable = [System.IO.File]::ReadAllText((Join-Path $fixture "dist/index.html"))
  if ([System.IO.File]::ReadAllText($publicHtml) -cne $readable) { throw "Default release build did not synchronize public root HTML." }
  Write-Host "[OK] Public root synchronization and three variant-build guards passed."
} finally {
  Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction SilentlyContinue
}
