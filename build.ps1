# Packs extension\ into dist\web-job-scraper-vX.Y.Z.xpi for Firefox Developer Edition.
# Zip entries use forward slashes, which Firefox requires.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$source = Join-Path $PSScriptRoot "extension"
$manifest = Get-Content (Join-Path $source "manifest.json") -Raw | ConvertFrom-Json
$dist = Join-Path $PSScriptRoot "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$target = Join-Path $dist "web-job-scraper-v$($manifest.version).xpi"
if (Test-Path $target) { Remove-Item $target -Force }

$zip = [System.IO.Compression.ZipFile]::Open($target, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem $source -Recurse -File | ForEach-Object {
        $entry = $_.FullName.Substring($source.Length + 1).Replace("\", "/")
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $entry) | Out-Null
    }
} finally {
    $zip.Dispose()
}
Write-Output "Built $target"
