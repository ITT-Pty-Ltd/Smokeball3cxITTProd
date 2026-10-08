# Generate a firm-specific 3CX CRM XML from the repo template.
# Usage:
#   ./deploy/scripts/New-FirmCrmTemplate.ps1 -FirmId acme-law -CrmDisplayName "Smokeball - Acme Law"

param(
    [Parameter(Mandatory = $true)]
    [string] $FirmId,
    [string] $CrmDisplayName = '',
    [string] $FirmsConfigPath = (Join-Path $PSScriptRoot '..' 'firms.json'),
    [string] $SourceTemplate = (Join-Path $PSScriptRoot '..' '..' '3cx_smokeball_template_fixed.xml'),
    [string] $OutDir = (Join-Path $PSScriptRoot '..' 'generated')
)

$ErrorActionPreference = 'Stop'

$firms = Get-Content $FirmsConfigPath -Raw | ConvertFrom-Json
$firm = $firms.firms | Where-Object { $_.id -eq $FirmId } | Select-Object -First 1
if (-not $firm) { throw "Firm '$FirmId' not in deploy/firms.json" }
if (-not (Test-Path $SourceTemplate)) { throw "Missing template $SourceTemplate" }

$display = if ($CrmDisplayName) { $CrmDisplayName } else { "Smokeball - $($firm.displayName)" }
$baseUrl = $firm.publicUrl.TrimEnd('/')

$xml = Get-Content $SourceTemplate -Raw -Encoding UTF8
$xml = $xml -replace 'Name="Smokeball ITT"', "Name=`"$display`""
$xml = [regex]::Replace(
    $xml,
    '(<Parameter Name="MiddlewareServerUrl"[^>]*Default=")[^"]*(")',
    "`${1}$baseUrl`$2",
    1
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$outFile = Join-Path $OutDir "3cx_smokeball_$FirmId.xml"
[System.IO.File]::WriteAllText($outFile, $xml, [System.Text.UTF8Encoding]::new($false))

Write-Host "Wrote $outFile"
Write-Host "Upload to 3CX Admin -> Integrations -> CRM for firm $($firm.displayName)"
