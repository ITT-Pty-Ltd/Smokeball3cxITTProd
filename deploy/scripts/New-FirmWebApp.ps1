# Creates a Linux Node 20 Web App for one firm (shared plan optional).
# Usage:
#   ./deploy/scripts/New-FirmWebApp.ps1 -FirmId acme-law -WebAppName smokeball3cx-acme -ResourceGroup ITT-SMOKEBALL-RG -Location australiaeast

param(
    [Parameter(Mandatory = $true)]
    [string] $FirmId,
    [Parameter(Mandatory = $true)]
    [string] $WebAppName,
    [Parameter(Mandatory = $true)]
    [string] $ResourceGroup,
    [string] $Location = 'australiaeast',
    [string] $PlanName = 'plan-smokeball3cx-shared',
    [switch] $CreatePlan
)

$ErrorActionPreference = 'Stop'

if ($CreatePlan) {
    Write-Host "Creating App Service plan $PlanName..."
    az appservice plan create `
        --name $PlanName `
        --resource-group $ResourceGroup `
        --location $Location `
        --sku B1 `
        --is-linux | Out-Null
}

Write-Host "Creating Web App $WebAppName for firm $FirmId..."
az webapp create `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --plan $PlanName `
    --runtime 'NODE:20-lts' | Out-Null

az webapp config set `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --always-on true | Out-Null

az webapp config appsettings set `
    --name $WebAppName `
    --resource-group $ResourceGroup `
    --settings WEBSITE_NODE_DEFAULT_VERSION=~20 SCM_DO_BUILD_DURING_DEPLOYMENT=true | Out-Null

$defaultHost = az webapp show --name $WebAppName --resource-group $ResourceGroup --query defaultHostName -o tsv
$publicUrl = "https://$defaultHost"

Write-Host ""
Write-Host "Created: $publicUrl"
Write-Host "Next steps:"
Write-Host "  1. Add entry to deploy/firms.json (id=$FirmId, azureWebAppName=$WebAppName, publicUrl=$publicUrl)"
Write-Host "  2. Copy deploy/firm.env.example to deploy/firms/$FirmId.env and fill Smokeball credentials"
Write-Host "  3. Run: ./deploy/scripts/Apply-FirmSettings.ps1 -FirmId $FirmId -ResourceGroup $ResourceGroup"
Write-Host "  4. Register redirect URI in Smokeball: $publicUrl/auth/callback"
Write-Host "  5. GitHub Environment firm-$FirmId with AZURE_WEBAPP_PUBLISH_PROFILE (download from Azure portal)"
Write-Host "  6. Run: ./deploy/scripts/New-FirmCrmTemplate.ps1 -FirmId $FirmId"
