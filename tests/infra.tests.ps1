# No cloud access: exercise orchestration guards and digest handling with fake commands.
$ErrorActionPreference = 'Stop'
$infra = Join-Path $PSScriptRoot '../scripts/infra.ps1'
$names = @('GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_REF', 'GITHUB_EVENT_NAME', 'CONTAINER_IMAGE', 'CONFIRMATION')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
$global:infraTest_digest = 'ghcr.io/huxhamd/among-devs@sha256:' + ('a' * 64)
$global:infraTest_wrongTenant = $false
$global:infraTest_tornDown = $false
$global:infraTest_anonymousDenied = $false
$global:infraTest_calls = [Collections.Generic.List[string]]::new()
$global:infraTest_bindings = @()
$global:infraTest_smokeUrls = [Collections.Generic.List[string]]::new()

function az-play {
    $global:LASTEXITCODE = 0
    $global:infraTest_calls.Add(($args -join ' '))
    switch ("$($args[0]) $($args[1])") {
        'account show' {
            @{ id = '968d16ad-8f5a-4608-aaca-1facd4121402'; tenantId = $(if ($global:infraTest_wrongTenant) { 'wrong' } else { '72e6af23-d94b-40db-ad70-1c01042f48c1' }) } | ConvertTo-Json
        }
        'bicep build' { }
        'containerapp list' {
            if ($global:infraTest_tornDown) { '[]' } else {
                '[{"name":"ca-among-devs","properties":{"provisioningState":"Succeeded","template":{"containers":[{"image":"' + $global:infraTest_digest + '"}]}}}]'
            }
        }
        'containerapp show' {
            if ($args -contains 'properties.configuration.ingress.customDomains') {
                ConvertTo-Json -InputObject $global:infraTest_bindings -Compress -Depth 5
            } elseif ($args -contains 'properties.configuration.ingress.fqdn') {
                'ca-among-devs.example.azurecontainerapps.io'
            } else { throw "Unexpected show query: $args" }
        }
        'containerapp update' { }
        'containerapp hostname' {
            $hostname = $args[[array]::IndexOf($args, '--hostname') + 1]
            if ($args[2] -eq 'add') {
                $global:infraTest_bindings += @{ name = $hostname; bindingType = 'Disabled' }
            } elseif ($args[2] -eq 'bind') {
                $global:infraTest_bindings = @($global:infraTest_bindings | Where-Object name -ne $hostname)
                $global:infraTest_bindings += @{ name = $hostname; bindingType = 'SniEnabled'; certificateId = "/certificates/$hostname" }
            } else { throw "Unexpected hostname command: $args" }
        }
        'deployment group' { }
        'stack group' {
            if ($args[2] -eq 'create') { $global:infraTest_tornDown = $false }
            else { throw "Unexpected stack command: $args" }
        }
        default { throw "Unexpected Azure call: $args" }
    }
}
function Invoke-RestMethod {
    if ($global:infraTest_anonymousDenied) { throw 'Anonymous pull denied' }
    @{ token = 'anonymous-test-token' }
}
function Invoke-WebRequest { @{ StatusCode = 200 } }
function node {
    $global:LASTEXITCODE = 0
    $global:infraTest_smokeUrls.Add($args[$args.Count - 1])
}
function Expect-Failure([string] $Mode, [string] $Message) {
    $failed = $false
    try { & $infra -Mode $Mode } catch {
        if ($_.Exception.Message -notlike "*$Message*") { throw }
        $failed = $true
    }
    if (-not $failed) { throw "Expected failure containing: $Message" }
}
try {
    $env:GITHUB_ACTIONS = 'true'
    $env:GITHUB_REPOSITORY = 'huxhamd/among-devs'
    $env:GITHUB_REF = 'refs/heads/master'
    $env:GITHUB_EVENT_NAME = 'workflow_dispatch'
    $env:CONTAINER_IMAGE = $null
    $env:CONFIRMATION = $null

    $global:infraTest_wrongTenant = $true
    Expect-Failure Preview 'expected personal subscription and tenant'
    $global:infraTest_wrongTenant = $false
    $env:GITHUB_REF = 'refs/heads/feature'
    Expect-Failure Deploy 'trusted master'
    $env:GITHUB_REF = 'refs/heads/master'
    $env:GITHUB_REPOSITORY = 'someone/among-devs'
    Expect-Failure Deploy 'trusted master'
    $env:GITHUB_REPOSITORY = 'huxhamd/among-devs'
    $env:GITHUB_EVENT_NAME = 'pull_request'
    Expect-Failure Deploy 'trusted master'
    $env:GITHUB_EVENT_NAME = 'workflow_dispatch'
    Expect-Failure Destroy 'exact confirmation'
    $env:CONTAINER_IMAGE = 'ghcr.io/huxhamd/among-devs:latest'
    Expect-Failure Deploy 'sha256 digest'
    $env:CONTAINER_IMAGE = 'ghcr.io/huxhamd/among-devs:validation'
    Expect-Failure Deploy 'validation placeholder'
    $env:CONTAINER_IMAGE = $global:infraTest_digest
    $global:infraTest_anonymousDenied = $true
    Expect-Failure Deploy 'Anonymous GHCR pull failed'
    $global:infraTest_anonymousDenied = $false
    $env:CONTAINER_IMAGE = $null

    & $infra -Mode Health
    if (-not ($global:infraTest_calls | Where-Object { $_ -like "deployment group what-if *image=$global:infraTest_digest*customDomains=*" })) {
        throw 'Health did not preserve the deployed digest.'
    }

    $env:CONTAINER_IMAGE = $global:infraTest_digest
    & $infra -Mode Deploy
    if (-not ($global:infraTest_calls | Where-Object { $_ -like "containerapp update *--image $global:infraTest_digest*" })) {
        throw 'Existing app was not updated using the image-only command.'
    }
    if (@($global:infraTest_bindings | Where-Object bindingType -eq 'SniEnabled').Count -ne 2) {
        throw 'Both custom domains were not securely bound.'
    }
    if (@($global:infraTest_calls | Where-Object { $_ -like 'containerapp hostname bind *' }).Count -ne 2) {
        throw 'Missing custom domains were not bound using managed certificates.'
    }
    if ($global:infraTest_smokeUrls -notcontains 'https://among-devs.dev' -or
        $global:infraTest_smokeUrls -notcontains 'https://www.among-devs.dev') {
        throw 'Both custom domains were not smoke-tested.'
    }
    & $infra -Mode Deploy
    if (@($global:infraTest_calls | Where-Object { $_ -like 'containerapp hostname bind *' }).Count -ne 2) {
        throw 'An existing secure custom-domain binding was rebound.'
    }
    $env:CONTAINER_IMAGE = $null
    & $infra -Mode Health
    $preview = @($global:infraTest_calls | Where-Object { $_ -like 'deployment group what-if *' })[-1]
    if ($preview -notlike '*among-devs.dev*' -or $preview -notlike '*certificateId*') {
        throw 'Infrastructure preview did not preserve the current custom-domain bindings.'
    }

    $global:infraTest_tornDown = $true
    & $infra -Mode Health
    if (-not ($global:infraTest_calls | Where-Object { $_ -like '*image=ghcr.io/huxhamd/among-devs:validation*' })) {
        throw 'Torn-down health did not preview with the placeholder.'
    }
    if ($global:infraTest_calls | Where-Object { $_ -match '^acr |^stack ' }) { throw 'Unexpected mutation or ACR dependency.' }

    $global:infraTest_calls.Clear()
    $global:infraTest_bindings = @()
    $env:CONTAINER_IMAGE = $global:infraTest_digest
    & $infra -Mode Deploy
    if (-not ($global:infraTest_calls | Where-Object { $_ -like 'stack group create *' })) {
        throw 'A torn-down app was not recreated by the deployment stack.'
    }
    if (@($global:infraTest_bindings | Where-Object bindingType -eq 'SniEnabled').Count -ne 2) {
        throw 'A newly created app was not assigned both custom domains.'
    }
    Write-Host 'PASS: tenant, branch, fork, event, confirmation, digest, anonymous access, image-only deployment, managed domains, recreation and health checks.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
