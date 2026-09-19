[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Preview', 'Deploy', 'Health', 'Destroy')]
    [string] $Mode,
    [ValidateSet('az-play', 'az')]
    [string] $AzureCommand = 'az-play'
)
$ErrorActionPreference = 'Stop'

function Invoke-Azure {
    $result = & $AzureCommand @args
    if ($LASTEXITCODE -ne 0) { throw "Azure command failed ($LASTEXITCODE): $($args[0..1] -join ' ')" }
    return $result
}

$subscription = '968d16ad-8f5a-4608-aaca-1facd4121402'
$tenant = '72e6af23-d94b-40db-ad70-1c01042f48c1'
$resourceGroup = 'rg-among-devs-uks'
$stackName = 'among-devs'
$imageRepository = 'ghcr.io/huxhamd/among-devs'
$template = Join-Path (Split-Path $PSScriptRoot) 'infra/main.bicep'
$account = (Invoke-Azure account show --output json) | ConvertFrom-Json
if ($account.id -ne $subscription -or $account.tenantId -ne $tenant) {
    throw 'Refusing to operate outside the expected personal subscription and tenant.'
}

if ($Mode -in @('Deploy', 'Destroy')) {
    if ($env:GITHUB_ACTIONS -ne 'true' -or $env:GITHUB_REPOSITORY -ne 'huxhamd/among-devs' -or
        $env:GITHUB_REF -ne 'refs/heads/master' -or $env:GITHUB_EVENT_NAME -notin @('push', 'workflow_dispatch')) {
        throw 'Deployment and destruction require a trusted master GitHub Actions run.'
    }
}

if ($Mode -eq 'Destroy') {
    if ($env:CONFIRMATION -cne 'DESTROY-among-devs') { throw 'Supply the exact confirmation DESTROY-among-devs.' }
    $stacks = Invoke-Azure stack group list --resource-group $resourceGroup --output json | ConvertFrom-Json
    if (-not ($stacks | Where-Object name -eq $stackName)) {
        Write-Host 'Application resources are already torn down.'
        exit 0
    }
    Invoke-Azure stack group delete --name $stackName --resource-group $resourceGroup --action-on-unmanage deleteAll --yes
    $remaining = Invoke-Azure resource list --resource-group $resourceGroup --output json | ConvertFrom-Json
    if ($remaining) { throw 'Unexpected resources remain in the application resource group.' }
    Write-Host 'Application resources removed. Empty resource group, deployment identity and GHCR images retained.'
    exit 0
}

Invoke-Azure bicep build --file $template --stdout | Out-Null
$image = $env:CONTAINER_IMAGE

if ($Mode -in @('Preview', 'Health') -and -not $image) {
    $apps = Invoke-Azure containerapp list --resource-group $resourceGroup --output json | ConvertFrom-Json
    $app = $apps | Where-Object name -eq 'ca-among-devs'
    if ($app) {
        if ($app.properties.provisioningState -ne 'Succeeded') { throw 'Container App provisioning is not healthy.' }
        $image = $app.properties.template.containers[0].image
        Write-Host 'Previewing the currently deployed image; no HTTP request or deployment is made.'
    } else {
        Write-Host 'Application is intentionally torn down. Previewing without deploying or requesting the app.'
        # What-if needs an image string, but does not pull it or start the application.
        $image = "$imageRepository`:validation"
    }
}

if ($image -ne "$imageRepository`:validation" -and $image -notmatch '^ghcr\.io/huxhamd/among-devs@sha256:[a-f0-9]{64}$') {
    throw 'Expected the public application image pinned to a GHCR sha256 digest.'
}
if ($Mode -eq 'Deploy' -and $image -eq "$imageRepository`:validation") { throw 'Cannot deploy the validation placeholder.' }
if ($image -ne "$imageRepository`:validation") {
    & (Join-Path $PSScriptRoot 'verify-image.ps1') -Image $image
}
$parameters = @("image=$image")
Invoke-Azure deployment group what-if --name among-devs-preview --resource-group $resourceGroup --template-file $template --parameters @parameters
if ($Mode -ne 'Deploy') { exit 0 }
Invoke-Azure stack group create --name $stackName --resource-group $resourceGroup --template-file $template --parameters @parameters --action-on-unmanage deleteAll --deny-settings-mode none --description 'Disposable Among Devs runtime resources.' --yes
$fqdn = Invoke-Azure containerapp show --name ca-among-devs --resource-group $resourceGroup --query properties.configuration.ingress.fqdn --output tsv
if ([string]::IsNullOrWhiteSpace($fqdn)) { throw 'Deployment returned no application hostname.' }
$url = "https://$fqdn"
& node (Join-Path $PSScriptRoot 'smoke.mjs') $url
if ($LASTEXITCODE -ne 0) { throw 'Live smoke test failed; inspect the deployment logs.' }
Write-Host "Deployed and verified $url"
