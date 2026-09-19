[CmdletBinding()]
param([Parameter(Mandatory)][string] $Image)
$ErrorActionPreference = 'Stop'
if ($Image -notmatch '^ghcr\.io/huxhamd/among-devs@(?<digest>sha256:[a-f0-9]{64})$') {
    throw 'Expected a digest-pinned among-devs GHCR image.'
}
$digest = $Matches.digest
try {
    # Anonymous registry token: no GitHub credential or Docker login is used.
    $token = (Invoke-RestMethod 'https://ghcr.io/token?service=ghcr.io&scope=repository:huxhamd/among-devs:pull').token
    if (-not $token) { throw 'No anonymous pull token returned.' }
    $null = Invoke-WebRequest "https://ghcr.io/v2/huxhamd/among-devs/manifests/$digest" -Method Head -Headers @{
        Authorization = "Bearer $token"
        Accept = 'application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json'
    }
} catch {
    throw "Anonymous GHCR pull failed. Make the among-devs package public in GitHub package settings and retry. $($_.Exception.Message)"
}
Write-Host "Verified anonymous access to $Image"
