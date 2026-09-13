@description('Azure region for the Container App resources.')
param location string = resourceGroup().location

@description('Immutable image published to the shared registry.')
param image string

@description('Resource ID of the persistent runtime user-assigned identity.')
param runtimeIdentityResourceId string

@description('Shared registry login server.')
param registryLoginServer string

param appName string = 'among-devs'
param targetPort int = 3000

resource environment 'Microsoft.App/managedEnvironments@2025-07-01' = {
  name: 'cae-${appName}-uks'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'none'
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource app 'Microsoft.App/containerApps@2025-07-01' = {
  name: 'ca-${appName}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${runtimeIdentityResourceId}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: targetPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registryLoginServer
          identity: runtimeIdentityResourceId
        }
      ]
    }
    template: {
      containers: [
        {
          name: appName
          image: image
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            {
              name: 'HOST'
              value: '0.0.0.0'
            }
            {
              name: 'PORT'
              value: string(targetPort)
            }
            {
              name: 'PROTOCOL_HEADER'
              value: 'x-forwarded-proto'
            }
            {
              name: 'HOST_HEADER'
              value: 'x-forwarded-host'
            }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/healthz'
                port: targetPort
              }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0
        maxReplicas: 1
      }
    }
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
