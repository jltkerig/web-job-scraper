# Deletes saved page copies in debug\ that are older than 10 days (the extension can't delete files itself).
# Run daily by the "Web Job Scraper debug cleanup" scheduled task.
$days = 10
$folders = @((Join-Path (Split-Path $PSScriptRoot -Parent) "debug"), (Join-Path $env:USERPROFILE "Downloads\web-job-scraper\debug"))
foreach ($folder in $folders) {
    if (-not (Test-Path $folder)) { continue }
    Get-ChildItem $folder -Force | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$days) } |
        Remove-Item -Recurse -Force
}
