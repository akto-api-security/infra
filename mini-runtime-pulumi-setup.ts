import * as pulumi from "@pulumi/pulumi";
import * as aws_native from "@pulumi/aws-native";

const awsRegion = aws_native.getRegion().then(invoke => invoke.region);
const awsAccountId = aws_native.getAccountId().then(invoke => invoke.accountId)
const config = new pulumi.Config();
const subnetId = config.require("subnetId");
const keyPair = config.require("keyPair");
const databaseAbstractorUrl = config.require("databaseAbstractorUrl");
const databaseAbstractorToken = config.require("databaseAbstractorToken");
const regionMap = {
    "af-south-1": {
        ami: "ami-093ca241e4c72c205",
    },
    "eu-north-1": {
        ami: "ami-0f58e72599cb99a79",
    },
    "ap-south-1": {
        ami: "ami-0400aca7799d8cf19",
    },
    "eu-west-3": {
        ami: "ami-064c70d04ad799d5e",
    },
    "eu-west-2": {
        ami: "ami-0dfe6158087b5c0ac",
    },
    "eu-south-1": {
        ami: "ami-07b2af763a8b958f3",
    },
    "eu-west-1": {
        ami: "ami-047aad752a426ed48",
    },
    "ap-northeast-3": {
        ami: "ami-0cffa2172948e071e",
    },
    "ap-northeast-2": {
        ami: "ami-087af0192368bc87c",
    },
    "me-south-1": {
        ami: "ami-0a31e56929248acca",
    },
    "ap-northeast-1": {
        ami: "ami-0828596b82405edd7",
    },
    "sa-east-1": {
        ami: "ami-0df67b3c17f090c24",
    },
    "ca-central-1": {
        ami: "ami-0eb3718c42cb70e52",
    },
    "ap-east-1": {
        ami: "ami-0e992f1e63814db10",
    },
    "ap-southeast-1": {
        ami: "ami-0ba98499caf94125a",
    },
    "ap-southeast-2": {
        ami: "ami-0849cc8fe4ceaf988",
    },
    "eu-central-1": {
        ami: "ami-0f7585ae7a0d9a25a",
    },
    "ap-southeast-3": {
        ami: "ami-0cf40308729b83366",
    },
    "us-east-1": {
        ami: "ami-0d52ddcdf3a885741",
    },
    "us-east-2": {
        ami: "ami-04148302a14f7d12b",
    },
    "us-west-1": {
        ami: "ami-0ee3e1e65adeef858",
    },
    "us-west-2": {
        ami: "ami-0ec021424fb596d6c",
    },
};
const getAktoSetupDetailsLambdaBasicExecutionRole = new aws_native.iam.Role("getAktoSetupDetailsLambdaBasicExecutionRole", {
    assumeRolePolicyDocument: {
        statement: [{
            effect: "Allow",
            principal: {
                service: "lambda.amazonaws.com",
            },
            action: "sts:AssumeRole",
        }],
    },
    path: "/",
    policies: [{
        policyName: "GetAktoSetupDetailsExecuteLambda",
        policyDocument: {
            version: "2012-10-17",
            statement: [{
                effect: "Allow",
                action: [
                    "ec2:DescribeNetworkInterfaces",
                    "ec2:DescribeTrafficMirrorSessions",
                    "ec2:DescribeInstances",
                    "ec2:DescribeVpcs",
                    "elasticloadbalancing:DescribeLoadBalancers",
                    "elasticloadbalancing:DescribeTargetGroups",
                    "elasticloadbalancing:DescribeTargetHealth",
                ],
                resource: "*",
            }],
        },
    }],
});
const aktoNLB = new aws_native.elasticloadbalancingv2.LoadBalancer("aktoNLB", {
    type: "network",
    scheme: "internal",
    ipAddressType: "ipv4",
    subnets: [subnetId],
    loadBalancerAttributes: [{
        key: "load_balancing.cross_zone.enabled",
        value: "true",
    }],
});
const getAktoSetupDetails = new aws_native.lambda.Function("getAktoSetupDetails", {
    runtime: "nodejs16.x",
    timeout: 60,
    role: getAktoSetupDetailsLambdaBasicExecutionRole.arn,
    handler: "index.handler",
    environment: {
        variables: {
            target_lb: aktoNLB.id,
        },
    },
    code: {
        s3Bucket: `akto-setup-${awsRegion}`,
        s3Key: "templates/get-akto-setup-details.zip",
    },
});
const getVpcDetailsLambdaRole = new aws_native.iam.Role("getVpcDetailsLambdaRole", {
    assumeRolePolicyDocument: {
        version: "2012-10-17",
        statement: [{
            effect: "Allow",
            principal: {
                service: ["lambda.amazonaws.com"],
            },
            action: ["sts:AssumeRole"],
        }],
    },
    path: "/",
    policies: [{
        policyName: "DescribeAssetsPolicy",
        policyDocument: {
            version: "2012-10-17",
            statement: [{
                effect: "Allow",
                action: [
                    "ec2:DescribeVpcs",
                    "ec2:DescribeSubnets",
                ],
                resource: "*",
            }],
        },
    }],
});
const getVpcDetailsLambda = new aws_native.lambda.Function("getVpcDetailsLambda", {
    description: "Look up info from a VPC",
    handler: "index.handler",
    runtime: "nodejs16.x",
    timeout: 30,
    role: getVpcDetailsLambdaRole.arn,
    environment: {
        variables: {
            subnet_id: subnetId,
        },
    },
    code: {
        zipFile: "var SUBNET_ID = process.env.SUBNET_ID; var aws = require('aws-sdk'); var response = require('cfn-response'); var ec2 = new aws.EC2(); exports.handler = async function(event, context) {     if (event.RequestType == 'Delete') {        await response.send(event, context, 'SUCCESS');        return;     }     var params = {        SubnetIds: [SUBNET_ID]      };     var subnets = await ec2.describeSubnets(params).promise().catch(err => {        console.error(err);     });     await response.send(event, context, 'SUCCESS', {VpcId: subnets['Subnets'][0]['VpcId']}) };",
    },
});
const customSourceGetVpcDetails = new aws_native.cloudformation.CustomResource("customSourceGetVpcDetails", { serviceToken: getVpcDetailsLambda.arn });

const instanceRefreshHandlerLambdaRole = new aws_native.iam.Role("instanceRefreshHandlerLambdaRole", {
    assumeRolePolicyDocument: {
        version: "2012-10-17",
        statement: [{
            effect: "Allow",
            principal: {
                service: ["lambda.amazonaws.com"],
            },
            action: ["sts:AssumeRole"],
        }],
    },
    path: "/service-role/",
    policies: [{
        policyName: "lambdaExecution-DashboardInstanceRefreshHandler",
        policyDocument: {
            version: "2012-10-17",
            statement: [
                {
                    effect: "Allow",
                    action: ["logs:CreateLogGroup"],
                    resource: "*",
                },
                {
                    effect: "Allow",
                    action: [
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                    ],
                    resource: "*",
                },
                {
                    effect: "Allow",
                    action: [
                        "autoscaling:StartInstanceRefresh",
                        "autoscaling:Describe*",
                        "autoscaling:UpdateAutoScalingGroup",
                        "ec2:CreateLaunchTemplateVersion",
                        "ec2:DescribeLaunchTemplates",
                        "ec2:RunInstances",
                    ],
                    resource: "*",
                },
            ],
        },
    }],
});
const dashboardInstanceRefreshHandler = new aws_native.lambda.Function("dashboardInstanceRefreshHandler", {
    handler: "index.handler",
    runtime: "nodejs16.x",
    timeout: 30,
    role: instanceRefreshHandlerLambdaRole.arn,
    code: {
        zipFile: "var aws = require('aws-sdk'); var autoscaling = new aws.AutoScaling(); exports.handler = function(event, context) {   var params = {     AutoScalingGroupName: 'AktoDashboardAutoScalingGroup',      Preferences: {       InstanceWarmup: 200,        MinHealthyPercentage: 0     }   };    autoscaling.startInstanceRefresh(params, function(err, data) {     if(err) { console.log(err) }     else { console.log(data) }   }) };",
    },
});
const trafficMirroringInstanceRefreshHandler = new aws_native.lambda.Function("trafficMirroringInstanceRefreshHandler", {
    handler: "index.handler",
    runtime: "nodejs16.x",
    timeout: 30,
    role: instanceRefreshHandlerLambdaRole.arn,
    code: {
        zipFile: "var aws = require('aws-sdk'); var autoscaling = new aws.AutoScaling(); exports.handler = function(event, context) {   var params = {     AutoScalingGroupName: 'AktoAutoScalingGroup',      Preferences: {       InstanceWarmup: 200,        MinHealthyPercentage: 0     }   };    autoscaling.startInstanceRefresh(params, function(err, data) {     if(err) { console.log(err) }     else { console.log(data) }   }) };",
    },
});
const refreshHandlerLambdaBasicExecutionRole = new aws_native.iam.Role("refreshHandlerLambdaBasicExecutionRole", {
    assumeRolePolicyDocument: {
        version: "2012-10-17",
        statement: [{
            effect: "Allow",
            principal: {
                service: "ec2.amazonaws.com",
            },
            action: "sts:AssumeRole",
        }],
    },
    policies: [{
        policyName: "InvokeLambdaPolicy",
        policyDocument: {
            version: "2012-10-17",
            statement: [{
                effect: "Allow",
                resource: [
                    dashboardInstanceRefreshHandler.arn,
                    trafficMirroringInstanceRefreshHandler.arn,
                ],
                action: "lambda:InvokeFunction",
            }],
        },
    }],
});
const iamInstanceProfile = new aws_native.iam.InstanceProfile("iamInstanceProfile", {
    path: "/",
    roles: [refreshHandlerLambdaBasicExecutionRole.id],
});

const aktoSecurityGroup = new aws_native.ec2.SecurityGroup("aktoSecurityGroup", {
    vpcId: [
        customSourceGetVpcDetails,
        "VpcId",
    ],
    groupDescription: "Enable the ports Akto requires (22, 4789, 8000, 9092)",
    securityGroupIngress: [],
    securityGroupEgress: [],
});


const aktoASGLaunchConfiguration = new aws_native.autoscaling.LaunchConfiguration("aktoASGLaunchConfiguration", {
    imageId: regionMap[awsRegion].ami,
    iamInstanceProfile: iamInstanceProfile,
    instanceType: "m5a.xlarge",
    securityGroups: aktoSecurityGroup,
    keyName: keyPair,
    associatePublicIpAddress: "false",
    blockDeviceMappings: [{
        deviceName: "/dev/xvda",
        ebs: {
            volumeType: "gp2",
            deleteOnTermination: "true",
            volumeSize: "50",
            encrypted: true,
        },
    }],
    metadataOptions: {
        httpTokens: "required",
    },
    userData: Buffer.from(`#!/bin/bash -xe
${`export DATABASE_ABSTRACTOR_SERVICE_URL='${databaseAbstractorUrl}'`}
${`export DATABASE_ABSTRACTOR_SERVICE_TOKEN='${databaseAbstractorToken}'`}
${`export AKTO_KAFKA_IP='${aktoNLB.DNSName}'`}
touch /tmp/hello.txt
touch ~/hello.txt
sudo yum update -y
sudo yum install -y python python-setuptools
sudo yum install -y docker
sudo dockerd&
sudo systemctl enable /usr/lib/systemd/system/docker.service
sudo mkdir -p /opt/aws/bin
export COMPOSE_FILE=docker-compose-mini-runtime.yml
sudo wget https://s3.amazonaws.com/cloudformation-examples/aws-cfn-bootstrap-latest.tar.gz
sudo python -m easy_install --script-dir /opt/aws/bin aws-cfn-bootstrap-latest.tar.gz
curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/mini-runtime-cft/cf-deploy-akto' > cf-deploy-akto
sudo chmod 700 cf-deploy-akto
./cf-deploy-akto < <(echo 'test')
sudo echo >> ~/akto/infra/docker-runtime.env
sudo echo AKTO_MONGO_CONN=$AKTO_MONGO_CONN >> ~/akto/infra/docker-runtime.env
sudo echo DATABASE_ABSTRACTOR_SERVICE_URL=$DATABASE_ABSTRACTOR_SERVICE_URL >> ~/akto/infra/docker-mini-runtime.env
sudo echo DATABASE_ABSTRACTOR_SERVICE_TOKEN=$DATABASE_ABSTRACTOR_SERVICE_TOKEN >> ~/akto/infra/docker-mini-runtime.env
sudo echo AKTO_KAFKA_IP=$AKTO_KAFKA_IP >> ~/akto/infra/.env
curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/mini-runtime-cft/cf-deploy-akto-start' > cf-deploy-akto-start
sudo chmod 700 cf-deploy-akto-start
./cf-deploy-akto-start < <(echo 'test')`).toString("base64"),
});

const aktoTrafficMirroringTargetGroup = new aws_native.elasticloadbalancingv2.TargetGroup("aktoTrafficMirroringTargetGroup", {
    port: "4789",
    protocol: "UDP",
    healthCheckEnabled: "true",
    healthCheckIntervalSeconds: 10,
    healthCheckPath: "/metrics",
    healthCheckPort: "8000",
    healthCheckProtocol: "HTTP",
    healthCheckTimeoutSeconds: 6,
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 2,
    targetType: "instance",
    vpcId: [
        customSourceGetVpcDetails,
        "VpcId",
    ],
    targets: [],
});
const aktoKafkaTargetGroup = new aws_native.elasticloadbalancingv2.TargetGroup("aktoKafkaTargetGroup", {
    port: "9092",
    protocol: "TCP",
    targetType: "instance",
    healthCheckEnabled: "true",
    healthCheckIntervalSeconds: 10,
    healthCheckPath: "/metrics",
    healthCheckPort: "8000",
    healthCheckProtocol: "HTTP",
    healthCheckTimeoutSeconds: 6,
    healthyThresholdCount: 2,
    unhealthyThresholdCount: 2,
    vpcId: [
        customSourceGetVpcDetails,
        "VpcId",
    ],
    targets: [],
});


const aktoAutoScalingGroup = new aws_native.autoscaling.AutoScalingGroup("aktoAutoScalingGroup", {
    launchConfigurationName: aktoASGLaunchConfiguration,
    vpcZoneIdentifier: [subnetId],
    targetGroupARNs: [
        aktoTrafficMirroringTargetGroup,
        aktoKafkaTargetGroup,
    ],
    maxSize: "10",
    minSize: "1",
});

const aktoKafkaListener = new aws_native.elasticloadbalancingv2.Listener("aktoKafkaListener", {
    loadBalancerArn: aktoNLB,
    port: "9092",
    protocol: "TCP",
    defaultActions: [{
        type: "forward",
        targetGroupArn: aktoKafkaTargetGroup,
    }],
});

const aktoTargetTrackingNetworkPolicy = new aws_native.autoscaling.ScalingPolicy("aktoTargetTrackingNetworkPolicy", {
    policyType: "TargetTrackingScaling",
    autoScalingGroupName: aktoAutoScalingGroup,
    estimatedInstanceWarmup: 30,
    targetTrackingConfiguration: {
        predefinedMetricSpecification: {
            predefinedMetricType: "ASGAverageNetworkIn",
        },
        targetValue: 200000000,
    },
});

const configureSecurityGroupsLambdaRole = new aws_native.iam.Role("configureSecurityGroupsLambdaRole", {
    assumeRolePolicyDocument: {
        version: "2012-10-17",
        statement: [{
            effect: "Allow",
            principal: {
                service: ["lambda.amazonaws.com"],
            },
            action: ["sts:AssumeRole"],
        }],
    },
    path: "/",
    policies: [
        {
            policyName: "DescribeAssetsPolicy",
            policyDocument: {
                version: "2012-10-17",
                statement: [
                    {
                        effect: "Allow",
                        action: [
                            "ec2:DescribeVpcs",
                            "ec2:DescribeSubnets",
                        ],
                        resource: "*",
                    },
                    {
                        effect: "Allow",
                        action: ["ec2:AuthorizeSecurityGroupIngress"],
                        resource: [`arn:aws:ec2:${awsRegion}:${awsAccountId}:security-group/${aktoSecurityGroup}`],
                    },
                ],
            },
        },
        {
            policyName: "AWSLambdaBasicExecutionRole",
            policyDocument: {
                version: "2012-10-17",
                statement: [{
                    effect: "Allow",
                    action: [
                        "logs:CreateLogGroup",
                        "logs:CreateLogStream",
                        "logs:PutLogEvents",
                    ],
                    resource: "*",
                }],
            },
        },
    ],
});

const configureSecurityGroupsLambda = new aws_native.lambda.Function("configureSecurityGroupsLambda", {
    description: "Configure Security Groups for Runtime processor and Context analyzer instances",
    handler: "lambda.lambda_handler",
    runtime: "python3.9",
    timeout: 30,
    role: [
        configureSecurityGroupsLambdaRole.arn
    ],
    environment: {
        variables: {
            subnet_id: subnetId,
            context_analyzer_security_group_id: aktoSecurityGroup,
            runtime_processor_security_group_id: aktoSecurityGroup,
            mode: "RUNTIME",
        },
    },
    code: {
        s3Bucket: `akto-setup-${awsRegion}`,
        s3Key: "templates/configure_security_groups.zip",
    },
});
const customSourceConfigureSecurityGroupsLambda = new aws_native.cloudformation.CustomResource("customSourceConfigureSecurityGroupsLambda", {serviceToken: [
    configureSecurityGroupsLambda.arn
]});

export const AktoNLB = [
    aktoNLB,
    aktoNLB.DNSName,
];