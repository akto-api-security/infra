import * as pulumi from "@pulumi/pulumi";
import * as helm from "@pulumi/kubernetes/helm/v3";
import * as k8s from "@pulumi/kubernetes";
import * as yaml from "@pulumi/kubernetes/yaml";
import * as aws from "@pulumi/aws";


const config = new pulumi.Config();
const k8sNamespace = config.get("k8sNamespace") || "default";
const aktoMongoConn = config.get("akto-mongo-connection") || "";
const eksClusterName = config.get("eks-cluster-name") || "";

const eksCluster = aws.eks.getCluster({
    name: eksClusterName,
});

const vpcId = eksCluster.then(cluster => cluster.vpcConfig.vpcId);

const subnets = eksCluster.then(cluster => aws.ec2.getSubnets({
    filters: [
        { name: "vpc-id", values: [cluster.vpcConfig.vpcId] },
    ],
}));

const docdbSecurityGroup = new aws.ec2.SecurityGroup("docdbSecurityGroup", {
    vpcId: vpcId,
    ingress: [
        {
            protocol: "tcp",
            fromPort: 27017,
            toPort: 27017,
            cidrBlocks: ["0.0.0.0/0"],  // Adjust to restrict access to specific IP ranges
        },
    ],
    egress: [
        {
            protocol: "-1",
            fromPort: 0,
            toPort: 0,
            cidrBlocks: ["0.0.0.0/0"],
        },
    ],
});

const docdbSubnetGroup = new aws.docdb.SubnetGroup("docdbsubnetgroup", {
    subnetIds: subnets.then(subnets => subnets.ids),
});

const docdbParameterGroup = new aws.docdb.ClusterParameterGroup("docdbparametergroup", {
    family: "docdb5.0",
    parameters: [
        {
            name: "tls",
            value: "disabled",  // Disable TLS for the cluster
        },
    ],
});

const docdbCluster = new aws.docdb.Cluster("aktoDocDBCluster", {
    clusterIdentifier: "akto-docdb-cluster",
    engine: "docdb",
    masterUsername: "angellist",
    masterPassword: "eightdigitpassword",
    dbSubnetGroupName: docdbSubnetGroup.name,
    vpcSecurityGroupIds: [docdbSecurityGroup.id],
    applyImmediately: true,
    dbClusterParameterGroupName: docdbParameterGroup.name,
    skipFinalSnapshot: true
});

const docdbInstance = new aws.docdb.ClusterInstance("exampleInstance", {
    identifier: "example-docdb-instance",
    clusterIdentifier: docdbCluster.id,
    instanceClass: "db.r5.large",  // Adjust the instance class as needed
    applyImmediately: true,
}, { dependsOn: [docdbCluster] });

const connectionString = pulumi.interpolate`mongodb://${docdbCluster.masterUsername}:${docdbCluster.masterPassword}@${docdbCluster.endpoint}:${docdbCluster.port}`;

const miniRuntimeChart = new helm.Chart("akto", {
    version: "0.1.8",
    chart: "akto",
    fetchOpts: {
        repo: "https://akto-api-security.github.io/helm-charts",
    },
    namespace: k8sNamespace,
    values: {
        mongo: {
            aktoMongoConn: connectionString
        },
        keel: {
            keel: {
                env: {
                    enabled: false
                }
            }
        },
        runtime: {
            kafka1: {
                image: {
                    tag: latest
                }
            }
        },
        runtime: {
            zoo1: {
                image: {
                    tag: latest
                }
            }
        }
    },
});

// Step 2: Deploy the Kubernetes DaemonSet using the ClusterIP from mini-runtime
const daemonsetEbpf = new yaml.ConfigFile("daemonset-ebpf", {
    file: "./akto-daemonset-config.yaml",
    transformations: [
        (obj: any) => {
            if (obj.kind === "DaemonSet") {
                // Modify namespace
                obj.metadata.namespace = k8sNamespace
                // Modify the DaemonSet to use the mini-runtime ClusterIP
                obj.spec.template.spec.containers.forEach((container: any) => {
                    container.env = container.env || [];
                    for (let env in container.env) {
                        if (container.env[env].name === "AKTO_KAFKA_BROKER_MAL") {
                            container.env[env].value = "akto-runtime." + k8sNamespace + ".svc.cluster.local:9092"
                        }
                        if (container.env[env].name === "AKTO_MONGO_CONN") {
                            container.env[env].value = connectionString
                        }
                    }
                });
            }
        },
    ],
});
