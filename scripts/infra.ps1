[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Preview', 'Deploy', 'Health', 'Destroy')]
    [string] $Mode,
    # Locally, always use the isolated personal login. AzureCLI@2 provides its own login in CI.
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
$appName = 'among-devs'
$resourceGroup = 'rg-among-devs-uks'
$stackName = 'app-among-devs'
$registryName = 'acrplayobbyonpr53zda'
$registryGroup = 'rg-platform-shared-uks'
$location = 'uksouth'
$account = (Invoke-Azure account show --output json) | ConvertFrom-Json
if ($account.id -ne $subscription -or $account.tenantId -ne $tenant) {
    throw 'Refusing to operate outside the expected personal subscription and tenant.'
}

if ($Mode -eq 'Destroy') {
    if ($env:BUILD_SOURCEBRANCH -and $env:BUILD_SOURCEBRANCH -ne 'refs/heads/master') {
        throw 'Run destruction from master.'
    }
    if ($env:CONFIRMATION -cne 'DESTROY-among-devs') {
        throw 'Supply the exact confirmation DESTROY-among-devs.'
    }
    # A successful list distinguishes absence from authorization or network failures.
    $stacks = @(Invoke-Azure stack sub list --output json | ConvertFrom-Json)
    $stack = $stacks | Where-Object name -eq $stackName
    if (-not $stack) {
        $exists = Invoke-Azure group exists --name $resourceGroup --output tsv
        if ($exists -eq 'true') { throw 'App group exists without its stack; inspect it before deleting anything.' }
        Write-Host 'Application is already torn down.'
        exit 0
    }
    $stack = Invoke-Azure stack sub show --name $stackName --output json | ConvertFrom-Json
    $appScope = "/subscriptions/$subscription/resourceGroups/$resourceGroup"
    $roleScope = "/subscriptions/$subscription/resourceGroups/$registryGroup/providers/Microsoft.ContainerRegistry/registries/$registryName/providers/Microsoft.Authorization/roleAssignments/"
    foreach ($resource in $stack.resources) {
        if ($resource.id -ine $appScope -and -not $resource.id.StartsWith("$appScope/", [StringComparison]::OrdinalIgnoreCase) -and -not $resource.id.StartsWith($roleScope, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Stack contains an unexpected resource; refusing deletion: $($resource.id)"
        }
    }
    Invoke-Azure stack sub delete --name $stackName --action-on-unmanage deleteAll --yes
    if ((Invoke-Azure group exists --name $resourceGroup --output tsv) -eq 'true') {
        throw 'The app resource group still exists after stack deletion.'
    }
    Invoke-Azure acr show --name $registryName --resource-group $registryGroup --query name --output tsv
    Write-Host 'Application removed. Shared registry and its images retained.'
    exit 0
}

$template = $env:TEMPLATE_FILE
if (-not $template -or -not (Test-Path -LiteralPath $template)) { throw 'Set TEMPLATE_FILE to the pinned platform template main.bicep.' }
Invoke-Azure bicep build --file $template --stdout | Out-Null
$registry = Invoke-Azure acr show --name $registryName --resource-group $registryGroup --output json | ConvertFrom-Json
if ($registry.adminUserEnabled) { throw 'The shared registry admin account must remain disabled.' }
$imageTag = $env:IMAGE_TAG
if (-not $imageTag) { $imageTag = 'validation' }

if ($Mode -eq 'Health') {
    $exists = Invoke-Azure group exists --name $resourceGroup --output tsv
    if ($exists -eq 'true') {
        $app = Invoke-Azure containerapp show --name ca-among-devs --resource-group $resourceGroup --output json | ConvertFrom-Json
        if ($app.properties.provisioningState -ne 'Succeeded') { throw 'Container App provisioning is not healthy.' }
        $imageTag = ($app.properties.template.containers[0].image -split ':')[-1]
        Write-Host 'Previewing the currently deployed image; no HTTP request or deployment is made.'
    } else {
        Write-Host 'Application is intentionally torn down. Checking authentication, registry and deployment preview only.'
    }
}

$parameters = @(
    "appName=$appName", "imageTag=$imageTag", "registryName=$registryName",
    "registryResourceGroupName=$registryGroup", "location=$location",
    'targetPort=3000', 'maxReplicas=1', 'containerCpu=0.25', 'containerMemory=0.5Gi'
)
Invoke-Azure deployment sub what-if --name among-devs-preview --location $location --template-file $template --parameters @parameters
if ($Mode -ne 'Deploy') { exit 0 }
if ($env:BUILD_SOURCEBRANCH -ne 'refs/heads/master' -or $env:BUILD_REASON -eq 'PullRequest') {
    throw 'Deployment is restricted to master builds.'
}
if ($imageTag -notmatch '^[a-f0-9]{40}$') { throw 'Deployment requires a full source commit SHA image tag.' }

$image = "$($registry.loginServer)/${appName}:$imageTag"
Invoke-Azure acr login --name $registryName
& docker tag "${appName}:$imageTag" $image
if ($LASTEXITCODE -ne 0) { throw 'Unable to tag the validated image.' }
& docker push $image
if ($LASTEXITCODE -ne 0) { throw 'Unable to publish the image.' }
Invoke-Azure stack sub create --name $stackName --location $location --template-file $template --parameters @parameters --action-on-unmanage deleteAll --deny-settings-mode none --description 'Disposable Among Devs application; shared registry is externally owned.' --yes
$fqdn = Invoke-Azure containerapp show --name ca-among-devs --resource-group $resourceGroup --query properties.configuration.ingress.fqdn --output tsv
if ([string]::IsNullOrWhiteSpace($fqdn)) { throw 'Deployment returned no application hostname.' }
$url = "https://$fqdn"
& node (Join-Path $PSScriptRoot 'smoke.mjs') $url
if ($LASTEXITCODE -ne 0) { throw 'Live smoke test failed; inspect the deployment logs.' }
Write-Host "Deployed and verified $url"
Write-Host "##vso[task.setvariable variable=appUrl;isOutput=true]$url"
