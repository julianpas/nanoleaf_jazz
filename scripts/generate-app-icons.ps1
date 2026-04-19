param(
  [string] $Source = "apps/electron/build/icon.png"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$SourcePath = Resolve-Path (Join-Path $Root $Source)
$ElectronBuildDir = Join-Path $Root "apps/electron/build"
$LinuxIconDir = Join-Path $ElectronBuildDir "icons"
$BrowserBuildDir = Join-Path $Root "apps/browser-launcher/build"

New-Item -ItemType Directory -Force $ElectronBuildDir, $LinuxIconDir, $BrowserBuildDir | Out-Null

function Save-ResizedPng {
  param(
    [Parameter(Mandatory = $true)]
    [System.Drawing.Image] $Image,
    [Parameter(Mandatory = $true)]
    [int] $Size,
    [Parameter(Mandatory = $true)]
    [string] $Path
  )

  $Bitmap = New-Object System.Drawing.Bitmap $Size, $Size
  $Graphics = [System.Drawing.Graphics]::FromImage($Bitmap)
  try {
    $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $Graphics.DrawImage($Image, 0, 0, $Size, $Size)
    $Bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $Graphics.Dispose()
    $Bitmap.Dispose()
  }
}

function Write-BigEndianUInt32 {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.BinaryWriter] $Writer,
    [Parameter(Mandatory = $true)]
    [uint32] $Value
  )

  $Bytes = [BitConverter]::GetBytes($Value)
  if ([BitConverter]::IsLittleEndian) {
    [Array]::Reverse($Bytes)
  }
  $Writer.Write($Bytes)
}

function Write-Icns {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,
    [Parameter(Mandatory = $true)]
    [array] $Entries
  )

  $TotalLength = 8
  foreach ($Entry in $Entries) {
    $TotalLength += 8 + $Entry.Bytes.Length
  }

  $Stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $Writer = New-Object System.IO.BinaryWriter $Stream
  try {
    $Writer.Write([Text.Encoding]::ASCII.GetBytes("icns"))
    Write-BigEndianUInt32 -Writer $Writer -Value $TotalLength
    foreach ($Entry in $Entries) {
      $Writer.Write([Text.Encoding]::ASCII.GetBytes($Entry.Type))
      Write-BigEndianUInt32 -Writer $Writer -Value ([uint32](8 + $Entry.Bytes.Length))
      $Writer.Write($Entry.Bytes)
    }
  } finally {
    $Writer.Dispose()
    $Stream.Dispose()
  }
}

function Write-Ico {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Path,
    [Parameter(Mandatory = $true)]
    [array] $Entries
  )

  $Stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  $Writer = New-Object System.IO.BinaryWriter $Stream
  try {
    $Writer.Write([uint16]0)
    $Writer.Write([uint16]1)
    $Writer.Write([uint16]$Entries.Count)

    $Offset = 6 + ($Entries.Count * 16)
    foreach ($Entry in $Entries) {
      $Writer.Write([byte]($(if ($Entry.Size -ge 256) { 0 } else { $Entry.Size })))
      $Writer.Write([byte]($(if ($Entry.Size -ge 256) { 0 } else { $Entry.Size })))
      $Writer.Write([byte]0)
      $Writer.Write([byte]0)
      $Writer.Write([uint16]1)
      $Writer.Write([uint16]32)
      $Writer.Write([uint32]$Entry.Bytes.Length)
      $Writer.Write([uint32]$Offset)
      $Offset += $Entry.Bytes.Length
    }

    foreach ($Entry in $Entries) {
      $Writer.Write($Entry.Bytes)
    }
  } finally {
    $Writer.Dispose()
    $Stream.Dispose()
  }
}

$Image = [System.Drawing.Image]::FromFile($SourcePath)
try {
  $Sizes = @(16, 32, 48, 64, 128, 256, 512, 1024)
  $PngBySize = @{}
  foreach ($Size in $Sizes) {
    $Path = Join-Path $LinuxIconDir "$Size`x$Size.png"
    Save-ResizedPng -Image $Image -Size $Size -Path $Path
    $PngBySize[$Size] = [System.IO.File]::ReadAllBytes($Path)
  }

  $IcoEntries = @(16, 32, 48, 64, 128, 256) | ForEach-Object {
    [pscustomobject]@{ Size = $_; Bytes = $PngBySize[$_] }
  }
  Write-Ico -Path (Join-Path $ElectronBuildDir "icon.ico") -Entries $IcoEntries

  $IcnsEntries = @(
    [pscustomobject]@{ Type = "icp4"; Bytes = $PngBySize[16] },
    [pscustomobject]@{ Type = "icp5"; Bytes = $PngBySize[32] },
    [pscustomobject]@{ Type = "icp6"; Bytes = $PngBySize[64] },
    [pscustomobject]@{ Type = "ic07"; Bytes = $PngBySize[128] },
    [pscustomobject]@{ Type = "ic08"; Bytes = $PngBySize[256] },
    [pscustomobject]@{ Type = "ic09"; Bytes = $PngBySize[512] },
    [pscustomobject]@{ Type = "ic10"; Bytes = $PngBySize[1024] },
    [pscustomobject]@{ Type = "ic11"; Bytes = $PngBySize[32] },
    [pscustomobject]@{ Type = "ic12"; Bytes = $PngBySize[64] },
    [pscustomobject]@{ Type = "ic13"; Bytes = $PngBySize[256] },
    [pscustomobject]@{ Type = "ic14"; Bytes = $PngBySize[512] }
  )
  Write-Icns -Path (Join-Path $ElectronBuildDir "icon.icns") -Entries $IcnsEntries

  Copy-Item -LiteralPath (Join-Path $ElectronBuildDir "icon.ico") -Destination (Join-Path $BrowserBuildDir "icon.ico") -Force
  Copy-Item -LiteralPath (Join-Path $ElectronBuildDir "icon.png") -Destination (Join-Path $BrowserBuildDir "icon.png") -Force
} finally {
  $Image.Dispose()
}

Write-Host "Generated Electron and browser-launcher icon assets."
