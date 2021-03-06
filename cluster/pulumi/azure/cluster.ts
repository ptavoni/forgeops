import * as azure from "@pulumi/azure";
import * as azuread from "@pulumi/azuread";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as config from "./config";

// Create an Azure Resource Group
const resourceGroup = new azure.core.ResourceGroup("resourceGroup", {
    location: config.location,
    name: config.clusterResourceGroupName,
    tags: {
        deploymentType: "cdm"
    }
});

// Create the AD service principal for the K8s cluster.
export let adApp = new azuread.Application("aks");
export let adSp = new azuread.ServicePrincipal("aksSp", { applicationId: adApp.applicationId });
let adSpPassword = new azuread.ServicePrincipalPassword("aksSpPassword", {
    servicePrincipalId: adSp.id,
    value: config.servicePrincipalSecret,
    endDate: "2099-01-01T00:00:00Z",
});

// Now allocate an AKS cluster.
export const k8sCluster = new azure.containerservice.KubernetesCluster("aksCluster", {
    resourceGroupName: resourceGroup.name,
    location: config.location,
    agentPoolProfiles: [{
        name: "aksagentpool",
        count: config.nodeCount,
        vmSize: config.nodeSize,
    }],
    dnsPrefix: `${pulumi.getStack()}-kube`,
    linuxProfile: {
        adminUsername: "aksuser",
        sshKey: {
            keyData: config.sshPublicKey,
        },
    },
    servicePrincipal: {
        clientId: adApp.applicationId,
        clientSecret: adSpPassword.value,
    },
});

// Expose a K8s provider instance using our custom cluster instance.
export const k8sProvider = new k8s.Provider("aksK8s", {
    kubeconfig: k8sCluster.kubeConfigRaw,
});

// Create production namespace
new k8s.core.v1.Namespace("prod", { metadata: { name: "prod" }}, { provider: k8sProvider });

// Create Storage Classes
new k8s.storage.v1.StorageClass("sc-standard", {
    metadata: { name: 'standard' },
    provisioner: 'kubernetes.io/azure-disk',
    parameters: { 
        storageaccounttype: 'Standard_LRS',
        kind: 'Managed'       
    }
}, { provider: k8sProvider } );

new k8s.storage.v1.StorageClass("sc-premium", {
    metadata: { name: 'fast' },
    provisioner: 'kubernetes.io/azure-disk',
    parameters: { 
        storageaccounttype: 'Premium_LRS',
        kind: 'Managed'       
    }
}, { provider: k8sProvider } );

