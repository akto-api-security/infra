var aws = require('aws-sdk')
var response = require('cfn-response')
var saveCollectionNamesLambdaArn = process.env.SAVE_COLLECTION_NAMES_LAMBDA_ARN; var trafficMirrorTargetID = process.env.TRAFFIC_MIRROR_TARGET_ID;
var trafficMirrorFilterID = process.env.TRAFFIC_MIRROR_FILTER_ID;
var mirrorSessionNumber = "1";
var tgNamesArray = process.env.ELB_NAMES.split(",").map(item => item.trim());;
var elbNamesArray = process.env.ELB_NAMES.split(",").map(item => item.trim());;
var sampleSize = 100; 
var targetLB = process.env.TARGET_LB; 
function filterDuplicates(value, index, self) {
    return self.indexOf(value) === index;
}

function getSlicedArr(arr, size) {
    let sliced_arr = [];
    for(let i=0; i<arr.length; i+= size ){
        sliced_arr.push(arr.slice(i, Math.min(arr.length, i+size)));
    }
    return sliced_arr;
}

function existIn2dArray(src, key) {
    var matched = false;
    for (var i = 0; i < src.length; i++) {
        matched = true
        if (src[i].length != key.length)
            return false
        for (var j = 0; j < key.length; j++) {
            if (src[i][j] != key[j]) {
                matched = false;
            }
        }
        if (matched) {
            return matched;
        }
    }
    return matched
}
function calcVxLanId(name) {
  var hash = 0;
  if (name.length == 0) return hash;
  for (var i = 0; i < name.length; i++) {
    var char = name.charCodeAt(i);
    hash = ((hash<<5)-hash)+char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash & ((2<<20)-1);
}

async function retry(promiseFn, maxRetries = 3) {
    let retryCount = 0;
    while (true) {
        try {
            return await promiseFn();
        } catch (error) {
            console.log(error);
            if (error.code !== "Throttling") {
                console.log('Not a throttling issue, throwing error')
                throw error;
            }
            if (retryCount >= maxRetries) {
                console.log('Max retries reached, throwing error')
                throw error;
            }
            const delay = Math.pow(2, retryCount) * 1000;
            console.log(`Throttling error, retrying in ${delay}ms`);
            await new Promise(resolve => setTimeout(resolve, delay));
            retryCount++;
        }
    }
}


async function getEnisAndPortOfTargetGroup(params, allPorts, eniList) {
    var isError = false;
    var elbv2 = new aws.ELBv2();
    var ec2 = new aws.EC2();
    var i = 0,
        j = 0,
        k = 0;
    var targetGroups = await retry(() => elbv2.describeTargetGroups(params).promise()).catch((err) => {
        console.error(err);
        isError = true;
    });
    console.log("elbv2 describeTargetGroups ", JSON.stringify(targetGroups));
    if (!isError && targetGroups.TargetGroups != undefined) {
        for (j = 0; j < targetGroups.TargetGroups.length; j++) {
            var counter = sampleSize < 1 ? targetGroups.TargetGroups.length : sampleSize;
            var targetGroupName = targetGroups.TargetGroups[j].TargetGroupName || ("TargetGroups-"+j);
            isError = false;
            params = {
                TargetGroupArn: targetGroups.TargetGroups[j].TargetGroupArn
            }
            var backends = await retry(() => elbv2.describeTargetHealth(params).promise()).catch((err) => {
                console.error(err);
                isError = true;
            });
            console.log("elbv2 describeTargetHealth ", JSON.stringify(backends));
            if (!isError && backends.TargetHealthDescriptions != undefined) {
                if (targetGroups.TargetGroups[j].TargetType == "instance") {
                    var instanceIds = [];
                    for (k = 0; k < backends.TargetHealthDescriptions.length && counter > 0; k++) {
                        instanceIds.push(backends.TargetHealthDescriptions[k].Target.Id)
                        allPorts.push(backends.TargetHealthDescriptions[k].Target.Port)
                        counter -- 
                    }
                    if (instanceIds.length > 0) {
                        var slicedInstanceIds = getSlicedArr(instanceIds, 30);
                        for(slicedInstanceIdList of slicedInstanceIds){
                            params = {
                                Filters: [{
                                    Name: "attachment.instance-id",
                                    Values: slicedInstanceIdList
                                }]
                            };
                            var enis = await retry(() => ec2.describeNetworkInterfaces(params).promise()).catch((err) => {
                                console.error(err);
                                isError = true;
                            });
                            console.log("elbv2 instance params ", JSON.stringify(params));
                            console.log("elbv2 instance describeNetworkInterfaces ", JSON.stringify(enis));
                            if (!isError && enis.NetworkInterfaces != undefined) {
                                for (var l = 0; l < enis.NetworkInterfaces.length; l++) {
                                    // Use only primary interface
                                    if (enis.NetworkInterfaces[l].Attachment != undefined && enis.NetworkInterfaces[l].Attachment.DeviceIndex == 0) {
                                        eniList.push([targetGroupName, enis.NetworkInterfaces[l].NetworkInterfaceId])
                                    }
                                }
                            }
                        }
                    }
                }
                if (targetGroups.TargetGroups[j].TargetType == "ip") {
                    var ipList = [];
                    for (k = 0; k < backends.TargetHealthDescriptions.length && counter > 0; k++) {
                        ipList.push(backends.TargetHealthDescriptions[k].Target.Id)
                        allPorts.push(backends.TargetHealthDescriptions[k].Target.Port)
                        counter -- 
                    }
                    if (ipList.length > 0) {
                        slicedIpList = getSlicedArr(ipList, 30)
                        for(slicedList of slicedIpList){
                            params = {
                                Filters: [{
                                    Name: "addresses.private-ip-address",
                                    Values: slicedList
                                }]
                            };
                            var enis = await retry(() => ec2.describeNetworkInterfaces(params).promise()).catch((err) => {
                                console.error(err);
                                isError = true;
                            });
                            console.log("elbv2 ip params ", JSON.stringify(params));
                            console.log("elbv2 ip describeNetworkInterfaces ", JSON.stringify(enis));
                            if (!isError && enis.NetworkInterfaces != undefined) {
                                for (var l = 0; l < enis.NetworkInterfaces.length; l++) {
                                    eniList.push([targetGroupName, enis.NetworkInterfaces[l].NetworkInterfaceId])
                                }
                            }
                        }
                    }
                }
            }
        }
    }

}

async function updateTrafficMirroringRule(allPorts) {
    //console.log("eniList ", JSON.stringify(eniList))
    var params = {};
    console.log("params ", JSON.stringify(params))
    var isError = false;
    var ec2 = new aws.EC2();
    var i = 0,
        j = 0;
    params = {
        Filters: [{
            Name: "traffic-mirror-filter-id",
            Values: [
                trafficMirrorFilterID
            ]
        }]
    }
    isError = false;
    var filterList = await retry(() => ec2.describeTrafficMirrorFilters(params).promise()).catch((err) => {
        console.error(err);
        isError = true;
    });
    var uniqueAllPorts = allPorts.filter(filterDuplicates);
    uniqueAllPorts.sort(function(a, b) {
        return a - b;
    });;
    var uniqueAllPortsRange = []
    for (i = 0; i < uniqueAllPorts.length; i++) {
        uniqueAllPortsRange.push([uniqueAllPorts[i], uniqueAllPorts[i]])
    }
    if (uniqueAllPorts.length > 10) {
        // only 10 rules are allowed per filter
        console.log("ports are more than 10, grouping them")
        var diff = [];
        for (i = 1; i < uniqueAllPorts.length; i++) {
            diff.push(uniqueAllPorts[i] - uniqueAllPorts[1]);
        }
        console.log("1. uniqueAllPortsRange ", JSON.stringify(uniqueAllPortsRange))
        console.log("1. diff ", JSON.stringify(diff))
        for (i = (uniqueAllPortsRange.length - 10); i > 0; i--) {
            var minDiff = 65535; // max port number
            var minDiffIndex = 0;
            for (j = 0; j < diff.length; j++) {
                if (minDiff > diff[j]) {
                    minDiff = diff[j]
                    minDiffIndex = j;
                }
            }

            uniqueAllPortsRange[minDiffIndex][1] = uniqueAllPortsRange[minDiffIndex + 1][1]
            uniqueAllPortsRange.splice(minDiffIndex + 1, 1)
            diff.splice(minDiffIndex, 1)
            console.log("2. uniqueAllPortsRange ", JSON.stringify(uniqueAllPortsRange))
            console.log("2. diff ", JSON.stringify(diff))
        }
    }
    console.log("describe mirror filters ", JSON.stringify(filterList))
    console.log("uniqueAllPortsRange ", JSON.stringify(uniqueAllPortsRange))
    var existingUnsedPorts = []
    var unusedFilterId = []
    var maxRuleNumber = 1
    if (!isError && filterList.TrafficMirrorFilters != undefined) {
        for (i = 0; i < filterList.TrafficMirrorFilters.length; i++) {

            for (j = 0; j < filterList.TrafficMirrorFilters[i].IngressFilterRules.length; j++) {
                if (maxRuleNumber < filterList.TrafficMirrorFilters[i].IngressFilterRules[j].RuleNumber) {
                    maxRuleNumber = filterList.TrafficMirrorFilters[i].IngressFilterRules[j].RuleNumber;
                }
                if (filterList.TrafficMirrorFilters[i].IngressFilterRules[j].DestinationPortRange != undefined) {
                    let currentFromPort = filterList.TrafficMirrorFilters[i].IngressFilterRules[j].DestinationPortRange.FromPort;
                    let currentToPort = filterList.TrafficMirrorFilters[i].IngressFilterRules[j].DestinationPortRange.ToPort;
                    if (existIn2dArray(uniqueAllPortsRange, [currentFromPort, currentToPort])) {
                        uniqueAllPortsRange = uniqueAllPortsRange.filter(item => (item[0] != currentFromPort && item[1] != currentToPort))
                    }
                    else {
                        existingUnsedPorts.push([currentFromPort, currentToPort])
                        unusedFilterId.push(filterList.TrafficMirrorFilters[i].IngressFilterRules[j].TrafficMirrorFilterRuleId)
                    }
                }

            }
            for (j = 0; j < filterList.TrafficMirrorFilters[i].EgressFilterRules.length; j++) {
                if (maxRuleNumber < filterList.TrafficMirrorFilters[i].EgressFilterRules[j].RuleNumber) {
                    maxRuleNumber = filterList.TrafficMirrorFilters[i].EgressFilterRules[j].RuleNumber;
                }
                if (filterList.TrafficMirrorFilters[i].EgressFilterRules[j].SourcePortRange != undefined) {
                    let currentFromPort = filterList.TrafficMirrorFilters[i].EgressFilterRules[j].SourcePortRange.FromPort;
                    let currentToPort = filterList.TrafficMirrorFilters[i].EgressFilterRules[j].SourcePortRange.ToPort;
                    if (existIn2dArray(existingUnsedPorts, [currentFromPort, currentToPort])) {
                        unusedFilterId.push(filterList.TrafficMirrorFilters[i].EgressFilterRules[j].TrafficMirrorFilterRuleId)
                    }
                }

            }
        }
    }
    console.log("ports to remove from rule ", JSON.stringify(existingUnsedPorts))
    console.log("ports to add to rule ", JSON.stringify(uniqueAllPortsRange))
    unusedFilterId = []
    for (i = 0; i < unusedFilterId.length; i++) {
        params = {
            TrafficMirrorFilterRuleId: unusedFilterId[i]
        }
        await ec2.deleteTrafficMirrorFilterRule(params).promise().catch((err) => {
            console.error("error deleting rule", err);
            isError = true;
        });

    }


    params = {
        DestinationCidrBlock: '0.0.0.0/0',
        RuleAction: 'accept',
        RuleNumber: maxRuleNumber,
        SourceCidrBlock: '0.0.0.0/0',
        TrafficDirection: 'ingress',
        TrafficMirrorFilterId: trafficMirrorFilterID,
        Description: 'ingress rule for port ',
        DestinationPortRange: {
            FromPort: 0,
            ToPort: 65535
        },
        DryRun: false,
        Protocol: 6,
    };
    await ec2.createTrafficMirrorFilterRule(params).promise().catch((err) => {
        console.error("error creating rule", err);
        isError = true;
    });
    params = {
        DestinationCidrBlock: '0.0.0.0/0',
        RuleAction: 'accept',
        RuleNumber: maxRuleNumber,
        SourceCidrBlock: '0.0.0.0/0',
        TrafficDirection: 'egress',
        TrafficMirrorFilterId: trafficMirrorFilterID,
        Description: 'egress rule for port ',
        SourcePortRange: {
            FromPort: 0,
            ToPort: 65535
        },
        DryRun: false,
        Protocol: 6,
    };
    await ec2.createTrafficMirrorFilterRule(params).promise().catch((err) => {
        console.error("error creating rule", err);
        isError = true;
    });
}

function checkEni(eniList, eni){
    return eniList.flat().includes(eni);
}

async function updateMirroringSessions(eniList, failedEnis,
    successEnis) {
    //get Existing Mirroring session
    var isError = false;
    var ec2 = new aws.EC2();
    var i = 0;
    var params = {
        Filters: [
            {
                Name: 'session-number',
                Values: [ mirrorSessionNumber ]
            }
        ]
    }
    var mirrorSession = await retry(() => ec2.describeTrafficMirrorSessions(params).promise()).catch((err) => {
        console.error("error describing traffic mirror sessions", err);
        isError = true;
    });
    var mirroringSessionToDelete = []
    if (!isError && mirrorSession.TrafficMirrorSessions != undefined) {
        for (i = 0; i < mirrorSession.TrafficMirrorSessions.length; i++) {
            if (checkEni(eniList,mirrorSession.TrafficMirrorSessions[i].NetworkInterfaceId)) {
                // if mirroring session exist for eni but not with same target and filter
                if ( mirrorSession.TrafficMirrorSessions[i].TrafficMirrorTargetId != trafficMirrorTargetID ||
                     mirrorSession.TrafficMirrorSessions[i].TrafficMirrorFilterId != trafficMirrorFilterID ) {
                  mirroringSessionToDelete.push(mirrorSession.TrafficMirrorSessions[i].TrafficMirrorSessionId)
                } else {
                   eniList = eniList.filter(item => item[1] != mirrorSession.TrafficMirrorSessions[i].NetworkInterfaceId)
                }
            }
            else {
                mirroringSessionToDelete.push(mirrorSession.TrafficMirrorSessions[i].TrafficMirrorSessionId)
            }
        }
    }
    if (mirroringSessionToDelete.length > 0) {
        console.log("Deleting Mirroring sessions: ", JSON.stringify(mirroringSessionToDelete))
        slicedMirroringSessionsToDelete = getSlicedArr(mirroringSessionToDelete, 20)
        for(slicedMirroringSessionsToDeleteList of slicedMirroringSessionsToDelete){
            params = {
                DryRun: false,
                Filters: [{
                        Name: 'traffic-mirror-session-id',
                        Values: slicedMirroringSessionsToDeleteList
                    }
                ]
            }
            await deleteTrafficMirrorSessionInternal(params)
        }
    }


    console.log("New mirroring session to create: ", JSON.stringify(eniList))
    for (i = 0; i < eniList.length; i++) {
        await createMirroringSession(eniList[i], mirrorSessionNumber, trafficMirrorFilterID, successEnis, failedEnis)
    }
}


async function createTrafficMirrorSessionForTargetGroup(allPorts, eniList) {
    if (tgNamesArray == undefined || tgNamesArray.length == 0)
        return;
    if (tgNamesArray[0].trim() == "")
        return;

    
    slicedTgNamesArr = getSlicedArr(tgNamesArray, 20);
    for(slicedTgNamesList of slicedTgNamesArr){
        var params = {
            Names: slicedTgNamesList
        }
        await getEnisAndPortOfTargetGroup(params, allPorts, eniList)
    }
}

async function createTrafficMirrorSessionForLBs(allPorts, eniList) {
    if (elbNamesArray.length == 0)
        return;
    if (elbNamesArray[0].trim() == "")
        return;

    //console.log("params ", JSON.stringify(params))
    var isError = false;
    var elb = new aws.ELB();
    var elbv2 = new aws.ELBv2();
    var ec2 = new aws.EC2();
    var slicedElbNamesArray = getSlicedArr(elbNamesArray, 20) //not sure about max size, keeping it as 20
    for (let elbNames of slicedElbNamesArray){
        var params = {
            LoadBalancerNames: elbNames
        };
        console.log('elbv1 describeLoadBalancers request', params)
        var data = await retry(() => elb.describeLoadBalancers(params).promise()).catch((err) => {
            console.error(err);
            isError = true;
        });
        console.log("elbv1 describeLoadBalancers response", JSON.stringify(data));
        var i = 0,
            j = 0,
            k = 0;
        if (!isError && data.LoadBalancerDescriptions != undefined) {
            for (i = 0; i < data.LoadBalancerDescriptions.length; i++) {
                var loadBalancerName = data.LoadBalancerDescriptions[i].LoadBalancerName;
                if (!elbNamesArray.includes(data.LoadBalancerDescriptions[i].LoadBalancerName)) {
                    continue;
                }
                for (j = 0; j < data.LoadBalancerDescriptions[i].ListenerDescriptions.length; j++) {
                    if (data.LoadBalancerDescriptions[i].ListenerDescriptions[j].Listener.InstanceProtocol == "HTTP" ||
                        data.LoadBalancerDescriptions[i].ListenerDescriptions[j].Listener.InstanceProtocol == "TCP") {
                        allPorts.push(data.LoadBalancerDescriptions[i].ListenerDescriptions[j].Listener.InstancePort);
                    }
                }
    
                params = {
                    Filters: [{
                        Name: "attachment.instance-id",
                        Values: [
    
                        ]
                    }]
                };
                var counter = sampleSize < 1 ? targetGroups.TargetGroups.length : sampleSize
                for (j = 0; j < data.LoadBalancerDescriptions[i].Instances.length && counter > 0; j++) {
                    params.Filters[0].Values[j] = data.LoadBalancerDescriptions[i].Instances[j].InstanceId
                    counter --
                }
                console.log("elb eni params", JSON.stringify(params));
                if (params.Filters[0].Values.length > 0) {
                    var enis = await retry(() => ec2.describeNetworkInterfaces(params).promise()).catch((err) => { // to check
                        console.error(err);
                        isError = true;
                    });
                    console.log("elb enis ", JSON.stringify(enis));
                    if (!isError && enis.NetworkInterfaces != undefined) {
                        for (var k = 0; k < enis.NetworkInterfaces.length; k++) {
                            // Use only primary interface
                            if (enis.NetworkInterfaces[k].Attachment != undefined && enis.NetworkInterfaces[k].Attachment.DeviceIndex == 0) {
                                eniList.push([loadBalancerName, enis.NetworkInterfaces[k].NetworkInterfaceId])
                            }
                        }
                    }
                }
            }
        }
    }
    
    
    console.log("elb eniList after old ELB call ", JSON.stringify(eniList));

    // V2 Load balancers

    for(let elbNames of slicedElbNamesArray){
        params = {
            Names: elbNames
        };
        console.log('elbv2 describeLoadBalancers request', params)
        isError = false;
        data = await retry(() => elbv2.describeLoadBalancers(params).promise()).catch((err) => {
            console.error(err);
            isError = true;
        });
        console.log("elbv2 describeLoadBalancers response", JSON.stringify(data));
        if (!isError && data.LoadBalancers != undefined) {
            for (i = 0; i < data.LoadBalancers.length; i++) {
                if (!elbNamesArray.includes(data.LoadBalancers[i].LoadBalancerName)) {
                    continue;
                }
                isError = false;
                params = {
                    LoadBalancerArn: data.LoadBalancers[i].LoadBalancerArn
                }
                await getEnisAndPortOfTargetGroup(params, allPorts, eniList)
            }
        }
    }

    console.log("elb eniList after new ELB call ", JSON.stringify(eniList));
    
}
async function createMirroringSession(eni, sessionNumber, filterId, successEnis, failedEnis) {
    var params = {
        NetworkInterfaceId: eni[1],
        SessionNumber: parseInt(sessionNumber),
        /* required */
        TrafficMirrorFilterId: filterId,
        TrafficMirrorTargetId: trafficMirrorTargetID,
        VirtualNetworkId: calcVxLanId(eni[0])
    };
    console.log("params " + JSON.stringify(params));
    var ec2 = new aws.EC2();
    var promise = await ec2.createTrafficMirrorSession(params).promise().catch((err) => {
        console.error(err);
        failedEnis.push({ eni: eni, message: err.message });
    });
    if (promise != undefined) {
        // get vpc cidr
        var vpcPromise = await retry(() => ec2.describeVpcs().promise()).catch((err1) => {
          console.error(err1)
        })
        let cidrBlock = []
        if (vpcPromise !== undefined && vpcPromise["Vpcs"]) {
          vpcPromise["Vpcs"].forEach((x) => {
            cidrBlock.push(x["CidrBlock"])
          })
          console.log("cidrBlock: " + cidrBlock)
          eni.push(cidrBlock)
        }
        successEnis.push(eni);
    }
    console.log(promise);

}
async function deleteTrafficMirrorSessionInternal(params) {
    var isError = false;
    var ec2 = new aws.EC2();
    var data = await retry(() => ec2.describeTrafficMirrorSessions(params).promise()).catch((err) => {
        console.error(err);
        isError = true;
    });
    if (!isError) {
        console.log(data); // successful response
        if (data.TrafficMirrorSessions != undefined) {
            for (var i = 0; i < data.TrafficMirrorSessions.length; i++) {
                params = {
                    TrafficMirrorSessionId: data.TrafficMirrorSessions[i].TrafficMirrorSessionId,
                    DryRun: false
                };
                console.log(params);
                var ec2Tmp = new aws.EC2();
                var promise = await ec2Tmp.deleteTrafficMirrorSession(params).promise().catch((err) => { console.error(err); }); // not required
                console.log(promise);
            }
        }
    }
}

async function deleteTrafficMirrorSession() {
    var params = {
        DryRun: false,
        Filters: [{
            Name: 'traffic-mirror-target-id',
            Values: [
                trafficMirrorTargetID
            ]
        }]
    };
    await deleteTrafficMirrorSessionInternal(params)

}
async function initFromCF(event, context) {
    console.log("event received:\n" + JSON.stringify(event));
    if (event.RequestType != undefined) {
        // coming from cloudformation
        if (event.RequestType == "Delete") {
            await deleteTrafficMirrorSession();
            await response.send(event, context, "SUCCESS");
            return;
        }
        var successEnis = [];
        var failedEnis = [];
        await createTrafficMirrorSessionForLBsAndTargetGroup(successEnis, failedEnis)

        var responseData = {};

        successEnis.forEach((x) => {
          x[1] = ""
        });
        let set  = new Set(successEnis.map(JSON.stringify));
        successEnis = Array.from(set).map(JSON.parse);

        failedEnis.forEach((x) => {
          x[1] = ""
        });
        set  = new Set(failedEnis.map(JSON.stringify));
        failedEnis = Array.from(set).map(JSON.parse);

        responseData['successEnis'] = JSON.stringify(successEnis);
        responseData['failedEnis'] = JSON.stringify(failedEnis);

        console.log('Failed enis list', JSON.stringify(failedEnis))
        console.log('Success enis list', JSON.stringify(successEnis))
        console.log("starting to invoke lambda")

        var invokeSaveCollectionNamesLambdaParams = {
          FunctionName: saveCollectionNamesLambdaArn,
          InvocationType: 'RequestResponse',
          LogType: 'Tail' ,
          Payload: JSON.stringify(responseData)
        }
        console.log("starting to invoke lambda with params", invokeSaveCollectionNamesLambdaParams)
        var lambda = new aws.Lambda();

        lambda.invoke(invokeSaveCollectionNamesLambdaParams, function(err, data) {
          if (err) console.log("finished invoke lambda err", err, err.stack); 
          else     console.log("finished invoke lambda data", data);           
        });

        console.log("finished invoke lambda");
        console.log(await wait20());
        responseData = {}

        await response.send(event, context, "SUCCESS", responseData);
    }

}
function wait20(){
    return new Promise((resolve, reject) => {
        setTimeout(() => resolve("hello"), 20000)
    });
}
async function handlePeriodicEvents(event) {
    var successEnis = [];
    var failedEnis = [];
    await createTrafficMirrorSessionForLBsAndTargetGroup(successEnis, failedEnis)
    console.log("Mirroring session created for ", JSON.stringify(successEnis))
    console.log("failed ENIs ", JSON.stringify(failedEnis));
    var responseData = {};
    responseData['successEnis'] = JSON.stringify(successEnis);
    responseData['failedEnis'] = JSON.stringify(failedEnis);

    console.log("starting to invoke lambda")

    var invokeSaveCollectionNamesLambdaParams = {
      FunctionName: saveCollectionNamesLambdaArn,
      InvocationType: 'RequestResponse',
      LogType: 'Tail' ,
      Payload: JSON.stringify(responseData)
    }
    console.log("starting to invoke lambda with params", invokeSaveCollectionNamesLambdaParams)
    var lambda = new aws.Lambda();

    lambda.invoke(invokeSaveCollectionNamesLambdaParams, function(err, data) {
      if (err) console.log("finished invoke lambda err", err, err.stack); 
      else     console.log("finished invoke lambda data", data);           
    });

    console.log("finished invoke lambda");
    console.log(await wait20());
}
async function createTrafficMirrorSessionForLBsAndTargetGroup(successEnis, failedEnis) {
    var ports = [];
    var enis = []
    await createTrafficMirrorSessionForLBs(ports, enis);
    await createTrafficMirrorSessionForTargetGroup(ports, enis)
    await updateTrafficMirroringRule(ports)
    var uniqueEnis = enis.filter(filterDuplicates);
    await updateMirroringSessions(uniqueEnis, failedEnis, successEnis)
}

exports.handler = async function(event, context) {
    if (event.RequestType != undefined) {
        // coming from cf
        await initFromCF(event, context)
    }
    else {
        // coming from periodic rule
        await handlePeriodicEvents(event)
    }
};

