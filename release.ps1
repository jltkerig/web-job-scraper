# Builds the extension and puts it on the project's GitHub Pages site (the docs\ folder):
#   docs\web-job-scraper-vX.Y.Z.xpi   the install file
#   docs\updates.json                 what the extension's "Check for updates" and Firefox's gear menu read
# Commit and push docs\ afterwards; the new version is live a minute or two after the push.
$ErrorActionPreference = "Stop"
$pagesUrl = "https://jltkerig.github.io/web-job-scraper"

& (Join-Path $PSScriptRoot "build.ps1")
$manifest = Get-Content (Join-Path $PSScriptRoot "extension\manifest.json") -Raw | ConvertFrom-Json
$version = $manifest.version
$name = "web-job-scraper-v$version.xpi"
$docs = Join-Path $PSScriptRoot "docs"
New-Item -ItemType Directory -Force $docs | Out-Null

# Only the newest build is kept on the site.
Get-ChildItem $docs -Filter "web-job-scraper-v*.xpi" | Where-Object { $_.Name -ne $name } | Remove-Item -Force
Copy-Item (Join-Path $PSScriptRoot "dist\$name") (Join-Path $docs $name) -Force
New-Item -ItemType File -Force (Join-Path $docs ".nojekyll") | Out-Null

$hash = (Get-FileHash (Join-Path $docs $name) -Algorithm SHA256).Hash.ToLower()
$updates = @{
    addons = @{
        $manifest.browser_specific_settings.gecko.id = @{
            updates = @(@{ version = $version; update_link = "$pagesUrl/$name"; update_hash = "sha256:$hash" })
        }
    }
}
$json = $updates | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText((Join-Path $docs "updates.json"), $json, (New-Object System.Text.UTF8Encoding $false))
Write-Output "Release v$version is ready in docs\. Commit and push it to publish."
