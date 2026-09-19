# One-time administrator setup. Runtime workflows need no PAT or client secret.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repo = 'huxhamd/among-devs'
$environment = 'among-devs-play'
$subscription = '968d16ad-8f5a-4608-aaca-1facd4121402'
$tenant = '72e6af23-d94b-40db-ad70-1c01042f48c1'

function Invoke-Play {
    $result = & az-play @args
    if ($LASTEXITCODE -ne 0) { throw 'Personal Azure CLI command failed.' }
    return $result
}
function Invoke-GitHub {
    param([string] $Path, [string] $Method = 'GET', $Body)
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 20 -Compress
        $result = $json | & gh api $Path --method $Method --input -
    } else {
        $result = & gh api $Path --method $Method
    }
    if ($LASTEXITCODE -ne 0) { throw "GitHub API failed: $Method $Path" }
    if ($result) { return $result | ConvertFrom-Json }
}

$account = Invoke-Play account show --output json | ConvertFrom-Json
if ($account.id -ne $subscription -or $account.tenantId -ne $tenant) { throw 'Wrong personal Azure account.' }
$identity = Invoke-Play identity show -g rg-ado-identities-uks -n id-ado-among-devs --output json | ConvertFrom-Json
$null = Invoke-GitHub "repos/$repo/environments/$environment" PUT @{
    deployment_branch_policy = @{ protected_branches = $false; custom_branch_policies = $true }
}
$policies = Invoke-GitHub "repos/$repo/environments/$environment/deployment-branch-policies"
if (-not ($policies.branch_policies | Where-Object { $_.name -eq 'master' -and $_.type -eq 'branch' })) {
    $null = Invoke-GitHub "repos/$repo/environments/$environment/deployment-branch-policies" POST @{ name = 'master'; type = 'branch' }
}
if ($policies.branch_policies | Where-Object { $_.name -ne 'master' -or $_.type -ne 'branch' }) {
    throw 'Unexpected environment branch policies. Review them before enabling Azure federation.'
}
$oidc = Invoke-GitHub "repos/$repo/actions/oidc/customization/sub"
if (-not $oidc.use_default) { throw 'Custom OIDC subject configured; review before creating federation.' }
$prefix = if ($oidc.sub_claim_prefix) { $oidc.sub_claim_prefix } else { "repo:$repo" }
$null = Invoke-Play identity federated-credential create -g rg-ado-identities-uks --identity-name id-ado-among-devs `
    --name fic-github-among-devs --issuer https://token.actions.githubusercontent.com `
    --subject "$prefix`:environment:$environment" --audiences api://AzureADTokenExchange --output none

$values = @{ AZURE_CLIENT_ID = $identity.clientId; AZURE_TENANT_ID = $tenant; AZURE_SUBSCRIPTION_ID = $subscription }
foreach ($name in $values.Keys) {
    & gh variable set $name --repo $repo --env $environment --body $values[$name]
    if ($LASTEXITCODE -ne 0) { throw "Unable to set $name" }
}
Write-Host "Configured $repo environment $environment with master-only Azure federation. No secrets stored."
