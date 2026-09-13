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
$registryName = 'acrplayobbyonpr53zda'
$registryGroup = 'rg-platform-shared-uks'
$runtimeIdentityId = "/subscriptions/$subscription/resourceGroups/rg-ado-identities-uks/providers/Microsoft.ManagedIdentity/userAssignedIdentities/id-runtime-among-devs"
$template = Join-Path (Split-Path $PSScriptRoot) 'infra/main.bicep'
$account = (Invoke-Azure account show --output json) | ConvertFrom-Json
if ($account.id -ne $subscription -or $account.tenantId -ne $tenant) {
    throw 'Refusing to operate outside the expected personal subscription and tenant.'
}

if ($Mode -eq 'Destroy') {
    if ($env:BUILD_SOURCEBRANCH -and $env:BUILD_SOURCEBRANCH -ne 'refs/heads/master') { throw 'Run destruction from master.' }
    if ($env:CONFIRMATION -cne 'DESTROY-among-devs') { throw 'Supply the exact confirmation DESTROY-among-devs.' }
    $stacks = @(Invoke-Azure stack group list --resource-group $resourceGroup --output json | ConvertFrom-Json)
    if (-not ($stacks | Where-Object name -eq $stackName)) {
        Write-Host 'Application resources are already torn down.'
        exit 0
    }
    Invoke-Azure stack group delete --name $stackName --resource-group $resourceGroup --action-on-unmanage deleteAll --yes
    $remaining = @(Invoke-Azure resource list --resource-group $resourceGroup --output json | ConvertFrom-Json)
    if ($remaining.Count) { throw 'Unexpected resources remain in the application resource group.' }
    Write-Host 'Application resources removed. Empty resource group, pipeline identities, registry and images retained.'
    exit 0
}

Invoke-Azure bicep build --file $template --stdout | Out-Null
$registry = Invoke-Azure acr show --name $registryName --resource-group $registryGroup --output json | ConvertFrom-Json
if ($registry.adminUserEnabled) { throw 'The shared registry admin account must remain disabled.' }
$imageTag = if ($env:IMAGE_TAG) { $env:IMAGE_TAG } else { 'validation' }

if ($Mode -eq 'Health') {
    $apps = @(Invoke-Azure containerapp list --resource-group $resourceGroup --output json | ConvertFrom-Json)
    $app = $apps | Where-Object name -eq 'ca-among-devs'
    if ($app) {
        if ($app.properties.provisioningState -ne 'Succeeded') { throw 'Container App provisioning is not healthy.' }
        $imageTag = ($app.properties.template.containers[0].image -split ':')[-1]
        Write-Host 'Previewing the currently deployed image; no HTTP request or deployment is made.'
    } else {
        Write-Host 'Application is intentionally torn down. Checking authentication, registry and deployment preview only.'
    }
}

$image = "$($registry.loginServer)/among-devs:$imageTag"
$parameters = @("image=$image", "runtimeIdentityResourceId=$runtimeIdentityId", "registryLoginServer=$($registry.loginServer)")
Invoke-Azure deployment group what-if --name among-devs-preview --resource-group $resourceGroup --template-file $template --parameters @parameters
if ($Mode -ne 'Deploy') { exit 0 }
if ($env:BUILD_SOURCEBRANCH -ne 'refs/heads/master' -or $env:BUILD_REASON -eq 'PullRequest') { throw 'Deployment is restricted to master builds.' }
if ($imageTag -notmatch '^[a-f0-9]{40}$') { throw 'Deployment requires a full source commit SHA image tag.' }

Invoke-Azure acr login --name $registryName
& docker tag "among-devs:$imageTag" $image
if ($LASTEXITCODE -ne 0) { throw 'Unable to tag the validated image.' }
& docker push $image
if ($LASTEXITCODE -ne 0) { throw 'Unable to publish the image.' }
Invoke-Azure stack group create --name $stackName --resource-group $resourceGroup --template-file $template --parameters @parameters --action-on-unmanage deleteAll --deny-settings-mode none --description 'Disposable Among Devs runtime resources.' --yes
$fqdn = Invoke-Azure containerapp show --name ca-among-devs --resource-group $resourceGroup --query properties.configuration.ingress.fqdn --output tsv
if ([string]::IsNullOrWhiteSpace($fqdn)) { throw 'Deployment returned no application hostname.' }
$url = "https://$fqdn"
& node (Join-Path $PSScriptRoot 'smoke.mjs') $url
if ($LASTEXITCODE -ne 0) { throw 'Live smoke test failed; inspect the deployment logs.' }
Write-Host "Deployed and verified $url"
