# Push Application Settings from deploy/firms/<firm-id>.env to Azure.
# Usage:
#   ./deploy/scripts/Apply-FirmSettings.ps1 -FirmId itt-demo -ResourceGroup ITT-SMOKEBALL-RG

param(
    [Parameter(Mandatory = $true)]
    [string] $FirmId,
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,
    [string] $FirmsConfigPath = (Join-Path $PSScriptRoot '..' 'firms.json'),
    [string] $EnvFile = (Join-Path $PSScriptRoot '..' 'firms' "$FirmId.env")
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $FirmsConfigPath)) {
    throw "Missing $FirmsConfigPath"
}
$firms = Get-Content $FirmsConfigPath -Raw | ConvertFrom-Json
$firm = $firms.firms | Where-Object { $_.id -eq $FirmId } | Select-Object -First 1
if (-not $firm) {
    throw "Firm id '$FirmId' not found in deploy/firms.json"
}

if (-not (Test-Path $EnvFile)) {
    throw "Missing $EnvFile — copy from deploy/firm.env.example"
}

$webAppName = $firm.azureWebAppName
$settings = @{}
Get-Content $EnvFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith('#')) { return }
    $idx = $line.IndexOf('=')
    if ($idx -lt 1) { return }
    $key = $line.Substring(0, $idx).Trim()
    $val = $line.Substring($idx + 1).Trim()
    if ($key) { $settings[$key] = $val }
}

if ($firm.publicUrl -and -not $settings['PUBLIC_URL']) {
    $settings['PUBLIC_URL'] = $firm.publicUrl.TrimEnd('/')
}
if ($firm.publicUrl -and -not $settings['SMOKEBALL_REDIRECT_URI']) {
    $settings['SMOKEBALL_REDIRECT_URI'] = "$($firm.publicUrl.TrimEnd('/'))/auth/callback"
}
if ($firm.smokeballApiUrl -and -not $settings['SMOKEBALL_API_URL']) {
    $settings['SMOKEBALL_API_URL'] = $firm.smokeballApiUrl
}
if ($firm.smokeballAuthUrl -and -not $settings['SMOKEBALL_AUTH_URL']) {
    $settings['SMOKEBALL_AUTH_URL'] = $firm.smokeballAuthUrl
}

$pairs = $settings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }

Write-Host "Applying $($pairs.Count) settings to $webAppName (firm $FirmId)..."
az webapp config appsettings set `
    --name $webAppName `
    --resource-group $ResourceGroup `
    --settings $pairs | Out-Null

Write-Host "Done. Restart the Web App if it was running."
