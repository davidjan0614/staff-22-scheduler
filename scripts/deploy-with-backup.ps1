$ErrorActionPreference = 'Stop'
Push-Location (Join-Path $PSScriptRoot '..')
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    npm test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed; deployment stopped.' }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; deployment stopped.' }

    # Private SQL includes employee phone numbers and sessions. Never commit it.
    $backupDirectory = Join-Path (Get-Location) 'backups'
    New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
    $backupFile = Join-Path $backupDirectory ("before-update-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    npx wrangler d1 export staff-22-scheduler-db --remote --output $backupFile
    if ($LASTEXITCODE -ne 0) { throw 'Database export failed; no migration or deployment was performed.' }
    if (!(Test-Path -LiteralPath $backupFile) -or (Get-Item -LiteralPath $backupFile).Length -eq 0) {
        throw 'Backup is missing or empty; deployment stopped.'
    }
    $backupText = Get-Content -LiteralPath $backupFile -Raw
    if ($backupText -notmatch 'CREATE TABLE.+employees' -or $backupText -notmatch 'CREATE TABLE.+schedules') {
        throw 'Backup does not contain the expected tables; deployment stopped.'
    }
    Write-Host "Database backup saved: $backupFile"
    npm run db:migrate:remote
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed; deployment stopped. Keep the SQL backup.' }
    npx wrangler deploy
    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed. The additive migration and SQL backup are retained.' }
} finally {
    Pop-Location
}
