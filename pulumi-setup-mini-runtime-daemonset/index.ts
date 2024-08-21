import * as pulumi from "@pulumi/pulumi";
import * as helm from "@pulumi/kubernetes/helm/v3";
import * as yaml from "@pulumi/kubernetes/yaml";

const config = new pulumi.Config();
const k8sNamespace = config.get("k8sNamespace") || "default";
const databaseAbstractorToken = config.get("databaseAbstractorToken") || "";
const miniRuntimeChart = new helm.Chart("akto-mini-runtime", {
    version: "0.1.4",
    path: "./mini-runtime",
    namespace: k8sNamespace,
    values: {
        mini_runtime: {
            aktoApiSecurityRuntime: {
                env: {
                    databaseAbstractorToken: databaseAbstractorToken
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
                            container.env[env].value = "akto-mini-runtime-mini-runtime." + k8sNamespace + ".svc.cluster.local:9092"
                        }
                    }
                });
            }
        },
    ],
});
