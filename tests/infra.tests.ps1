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
        'deployment group' { }
        default { throw "Unexpected Azure call: $args" }
    }
}
function Invoke-RestMethod {
    if ($global:infraTest_anonymousDenied) { throw 'Anonymous pull denied' }
    @{ token = 'anonymous-test-token' }
}
function Invoke-WebRequest { @{ StatusCode = 200 } }
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
    if (-not ($global:infraTest_calls | Where-Object { $_ -like "deployment group what-if *image=$global:infraTest_digest" })) {
        throw 'Health did not preserve the deployed digest.'
    }
    $global:infraTest_tornDown = $true
    & $infra -Mode Health
    if (-not ($global:infraTest_calls | Where-Object { $_ -like '*image=ghcr.io/huxhamd/among-devs:validation' })) {
        throw 'Torn-down health did not preview with the placeholder.'
    }
    if ($global:infraTest_calls | Where-Object { $_ -match '^acr |^stack ' }) { throw 'Unexpected mutation or ACR dependency.' }
    Write-Host 'PASS: tenant, branch, fork, event, confirmation, digest, anonymous access and health checks.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
}
