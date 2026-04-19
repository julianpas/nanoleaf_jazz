param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("windows", "macos", "linux")]
  [string] $Platform
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$ReleaseDir = Join-Path $Root "release"
$BrowserDir = Join-Path $ReleaseDir "browser-launcher"
$ElectronDir = Join-Path $ReleaseDir "electron"
$ArtifactDir = Join-Path $Root "artifacts"

Remove-Item -LiteralPath $ArtifactDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ArtifactDir | Out-Null

function Compress-ReleaseDirectory {
  param(
    [Parameter(Mandatory = $true)]
    [string] $SourceDir,
    [Parameter(Mandatory = $true)]
    [string] $Destination
  )

  if (-not (Test-Path -LiteralPath $SourceDir)) {
    throw "Missing release directory: $SourceDir"
  }

  Compress-Archive -Path (Join-Path $SourceDir "*") -DestinationPath $Destination -Force
}

function Copy-ReleaseFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Filter,
    [Parameter(Mandatory = $true)]
    [string] $Destination,
    [string] $ExcludePattern = ""
  )

  $Files = Get-ChildItem -LiteralPath $ElectronDir -File -Filter $Filter
  if ($ExcludePattern) {
    $Files = $Files | Where-Object { $_.Name -notmatch $ExcludePattern }
  }

  $File = $Files | Select-Object -First 1
  if (-not $File) {
    throw "No Electron release file found for filter '$Filter'"
  }

  Copy-Item -LiteralPath $File.FullName -Destination $Destination -Force
}

Compress-ReleaseDirectory `
  -SourceDir $BrowserDir `
  -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-browser-launcher-$Platform.zip")

switch ($Platform) {
  "windows" {
    Copy-ReleaseFile `
      -Filter "*.exe" `
      -ExcludePattern "uninstaller" `
      -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-electron-installer-windows.exe")

    Compress-ReleaseDirectory `
      -SourceDir (Join-Path $ElectronDir "win-unpacked") `
      -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-electron-portable-windows.zip")
  }

  "macos" {
    Copy-ReleaseFile `
      -Filter "*.dmg" `
      -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-electron-installer-macos.dmg")

    $MacDir = Get-ChildItem -LiteralPath $ElectronDir -Directory |
      Where-Object { $_.Name -like "mac*" } |
      Select-Object -First 1
    if (-not $MacDir) {
      throw "No macOS unpacked Electron directory found."
    }

    Compress-ReleaseDirectory `
      -SourceDir $MacDir.FullName `
      -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-electron-portable-macos.zip")
  }

  "linux" {
    Copy-ReleaseFile `
      -Filter "*.deb" `
      -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-electron-installer-linux.deb")

    Copy-ReleaseFile `
      -Filter "*.AppImage" `
      -Destination (Join-Path $ArtifactDir "nanoleaf-jazz-electron-portable-linux.AppImage")
  }
}

Get-ChildItem -LiteralPath $ArtifactDir -File | ForEach-Object {
  Write-Host "Prepared release asset: $($_.Name)"
}
