@description('Azure region for the workspace.')
param location string = resourceGroup().location
param appName string = 'among-devs'
@description('Full container image reference, e.g. myregistry.azurecr.io/among-devs:latest.')
param image string
@description('Registry hostname. Leave blank for images that do not require authentication.')
param registryServer string = ''
param registryUsername string = ''
@secure()
param registryPassword string = ''
@description('Use 0 between sessions for scale-to-zero, or 1 to keep the workspace warm during a session.')
@allowed([
  0
  1
])
param minReplicas int = 0

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${appName}-environment'
  location: location
  properties: {
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      secrets: empty(registryServer) ? [] : [
        {
          name: 'registry-password'
          value: registryPassword
        }
      ]
      registries: empty(registryServer) ? [] : [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
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
              name: 'PORT'
              value: '3000'
            }
            {
              name: 'NODE_ENV'
              value: 'production'
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
                port: 3000
              }
              initialDelaySeconds: 15
              periodSeconds: 30
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: 1
        rules: [
          {
            name: 'http'
            http: {
              metadata: {
                concurrentRequests: '10'
              }
            }
          }
        ]
      }
    }
  }
}

output url string = 'https://${app.properties.configuration.ingress.fqdn}'
