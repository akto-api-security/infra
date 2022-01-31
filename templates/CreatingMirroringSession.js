var aws = require('aws-sdk') 
var response = require('cfn-response')

/** Environment Variables */ 
var trafficMirrorTargetID = process.env.TRAFFIC_MIRROR_TARGET_ID; 
var trafficMirrorFilterID = process.env.TRAFFIC_MIRROR_FILTER_ID; 
var mirrorSessionNumber = process.env.TRAFFIC_MIRROR_SESSION_NUMBER;

var sourceECS = process.env.ECS_NAME;

var tgNamesArray = process.env.TARGET_GROUP_NAMES;
if(tgNamesArray)
    tgNamesArray = tgNamesArray.split(",").map(item => item.trim());

var elbNamesArray = process.env.ELB_NAMES;
if(elbNamesArray)
    elbNamesArray = elbNamesArray.split(",").map(item => item.trim());

var EBEnvironmentNamesArray = process.env.EB_ENV_NAMES;
if(EBEnvironmentNamesArray)
    EBEnvironmentNamesArray = EBEnvironmentNamesArray.split(",").map(item=>item.trim());
    

var sampleSize = process.env.SAMPLE_SIZE;
var targetENI = process.env.TARGET_ENI;  
var targetLB = process.env.TARGET_LB;

/** Common Code */
function filterDuplicates(value, index, self) {
    return self.indexOf(value) === index;
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
} function calcVxLanId(name) {
  var hash = 0;
  if (name.length == 0) return hash;
  for (var i = 0; i < name.length; i++) {
    var char = name.charCodeAt(i);
    hash = ((hash<<5)-hash)+char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash & ((2<<20)-1);
} async function getAktoInstanceDetails() {
  var ec2 = new aws.EC2();
  var params = {
      Filters: [{
          Name: "network-interface.network-interface-id",
          Values: [
            targetENI
          ]
      }]
  };
  console.log("ec2 describeInstances ", JSON.stringify(params));
  var instances = await ec2.describeInstances(params).promise().catch((err) => {
      console.error(err);
  });
  console.log("ec2 describeInstances ", JSON.stringify(instances));
  return instances.Reservations[0].Instances[0];
}
async function getAktoLBDetails() {
  var elb = new aws.ELBv2();
    var params = {
        "LoadBalancerArns" : [targetLB]
    };


    console.log("Getting Akto LB Details : ", JSON.stringify(params));

    var LBDesc = await elb.describeLoadBalancers(params).promise().catch(err=>{
      console.log("Error describing Akto LB",err);
    });
    
    if(!LBDesc.LoadBalancers[0])
    {
      console.log("Could not find Akto Load Balancer");
      return ;
    }
    
    LBDesc = LBDesc.LoadBalancers[0];

    var LBName = targetLB.substring(targetLB.indexOf('/')+1);
    // LBname to get private ip of ENI of LB 

  var eniDesc = 'ELB '+LBName;
    var ec2 = new aws.EC2();
    params = {
      Filters: [{
        'Name' : 'description',
        'Values' : [eniDesc]
      }]
    };
    
    var ENIDesc = await ec2.describeNetworkInterfaces(params).promise().catch(err=>{
          console.log("Error getting ENI Details of ENI with Description ",eniDesc, " error : ",err); 
    });
    
    if(!ENIDesc.NetworkInterfaces[0])
    {
      console.log("Coud not find Network Interface Details");
      return ;
      
    }
    
    console.log("ENIDesc: ",ENIDesc);
    
    LBDesc.PrivateIpAddress  = ENIDesc.NetworkInterfaces[0].PrivateIpAddress;
    LBDesc.Subnets = LBDesc.AvailabilityZones.map(x=>x.SubnetId);
    
    
    
    console.log("LoadBalancerDescription : ",JSON.stringify(LBDesc));
    return LBDesc;
    
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
    var filterList = await ec2.describeTrafficMirrorFilters(params).promise().catch((err) => {
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

    for (i = 0; i < unusedFilterId.length; i++) {
        params = {
            TrafficMirrorFilterRuleId: unusedFilterId[i]
        }
        await ec2.deleteTrafficMirrorFilterRule(params).promise().catch((err) => {
            console.error("error deleting rule", err);
            isError = true;
        });

    }

    for (i = 0; i < uniqueAllPortsRange.length; i++) {
        ++maxRuleNumber;
        params = {
            DestinationCidrBlock: '0.0.0.0/0',
            RuleAction: 'accept',
            RuleNumber: maxRuleNumber,
            SourceCidrBlock: '0.0.0.0/0',
            TrafficDirection: 'ingress',
            TrafficMirrorFilterId: trafficMirrorFilterID,
            Description: 'ingress rule for port ' + JSON.stringify(uniqueAllPortsRange[i]),
            DestinationPortRange: {
                FromPort: uniqueAllPortsRange[i][0],
                ToPort: uniqueAllPortsRange[i][1]
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
            Description: 'egress rule for port ' + JSON.stringify(uniqueAllPortsRange[i]),
            SourcePortRange: {
                FromPort: uniqueAllPortsRange[i][0],
                ToPort: uniqueAllPortsRange[i][1]
            },
            DryRun: false,
            Protocol: 6,
        };
        await ec2.createTrafficMirrorFilterRule(params).promise().catch((err) => {
            console.error("error creating rule", err);
            isError = true;
        });

    }
}
async function updateMirroringSessions(eniList, failedEnis,
    successEnis) {
    //get Existing Mirroring session
    console.log("Updating mirroring sessions");
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
    var mirrorSession = await ec2.describeTrafficMirrorSessions(params).promise().catch((err) => {
        console.error("error describing traffic mirror sessions", err);
        isError = true;
    });
    var mirroringSessionToDelete = []
    if (!isError && mirrorSession.TrafficMirrorSessions != undefined) {
        for (i = 0; i < mirrorSession.TrafficMirrorSessions.length; i++) {
            if (eniList.includes(mirrorSession.TrafficMirrorSessions[i].NetworkInterfaceId)) {
                // if mirroring session exist for eni but not with same target and filter
                if ( mirrorSession.TrafficMirrorSessions[i].TrafficMirrorTargetId != trafficMirrorTargetID ||
                    mirrorSession.TrafficMirrorSessions[i].TrafficMirrorFilterId != trafficMirrorFilterID ) {
                  mirroringSessionToDelete.push(mirrorSession.TrafficMirrorSessions[i].TrafficMirrorSessionId)
                } else {
                  eniList = eniList.filter(item => item != mirrorSession.TrafficMirrorSessions[i].NetworkInterfaceId)
                }
            }
            else {
                mirroringSessionToDelete.push(mirrorSession.TrafficMirrorSessions[i].TrafficMirrorSessionId)
            }
        }
    }
    if (mirroringSessionToDelete.length > 0) {
        console.log("Deleting Mirroring sessions: ", JSON.stringify(mirroringSessionToDelete))
        params = {
            DryRun: false,
            Filters: [{
                    Name: 'traffic-mirror-session-id',
                    Values: mirroringSessionToDelete
                }
            ]
        }
        await deleteTrafficMirrorSessionInternal(params)
    }


    console.log("New mirroring session to create: ", JSON.stringify(eniList))
    for (i = 0; i < eniList.length; i++) {
        await createMirroringSession(eniList[i], mirrorSessionNumber, trafficMirrorFilterID, successEnis, failedEnis)
    }
}
async function createMirroringSession(eni, sessionNumber, filterId, successEnis, failedEnis) {
    var params = {
        NetworkInterfaceId: eni[1],
        SessionNumber: parseInt(sessionNumber),
        TrafficMirrorTargetId: trafficMirrorTargetID,
        TrafficMirrorFilterId: filterId,
        VirtualNetworkId: calcVxLanId(eni[0])
    };

    console.log("params createMirroringSession " + JSON.stringify(params));
    var ec2 = new aws.EC2();
    var promise = await ec2.createTrafficMirrorSession(params).promise().catch((err) => {
        console.error(err);
        failedEnis.push({ eni: eni, message: err.message });
    });
    if (promise != undefined) {
        successEnis.push(eni);
    }
    console.log(promise);

} async function deleteTrafficMirrorSessionInternal(params) {
    var isError = false;
    var ec2 = new aws.EC2();
    var data = await ec2.describeTrafficMirrorSessions(params).promise().catch((err) => {
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
                var promise = await ec2Tmp.deleteTrafficMirrorSession(params).promise().catch((err) => { console.error(err); });
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
async function validateInput(event,context) {

    console.log("Validating input...");

    if(targetENI.length == 0 && targetLB.length == 0)
    {
      console.log("One destination required to set up mirroring. No found");
        await response.send(event,context, "FAILED");
        return;
    }
    
    if(targetENI.length !=0 && targetLB.length !=0)
    {
      console.log("Both targetENI and targetLB found. Only one has to be provided");
      await response.send(event,context, "FAILED");
      return;
    }
    
}
async function sendResponse(event,context,successEnis,failedEnis) {
    var responseData = {};
    responseData['successEnis'] = JSON.stringify(successEnis);
    responseData['failedEnis'] = JSON.stringify(failedEnis);

    if(targetENI.length !=0 )
    {
    // when targetEni is given
        var aktoDetails = await getAktoInstanceDetails();
        responseData['kafkaIp'] = aktoDetails.PrivateIpAddress;
        responseData['SubnetId'] = [aktoDetails.SubnetId];
        responseData['VpcId'] = aktoDetails.VpcId;

    }
    else 
    {
    // when targetLB is given
        var aktoDetails = await getAktoLBDetails();
        responseData['kafkaIp'] = aktoDetails.PrivateIpAddress;
        responseData['SubnetId'] = aktoDetails.Subnets;
        responseData['VpcId'] = aktoDetails.VpcId;
    }

    console.log("Result : "+JSON.stringify(responseData));
    await response.send(event, context, "SUCCESS", responseData);
}


/** For Elastic BeanStalk */
async function createTrafficMirrorSessionForEBEnvironments(successEnis, failedEnis) {
        var ports = []; // Ports List for TrafficMirroring Filter
        var enis = [];
        await createTrafficMirrorSessionForEBEnvironmentsInternal(ports, enis);
//      await updateTrafficMirroringRule(ports); Function Removed, traffic mirroring all ports...
        var uniqueEnis = enis.filter(filterDuplicates);
        await updateMirroringSessions(uniqueEnis,failedEnis,successEnis);
}
async function createTrafficMirrorSessionForEBEnvironmentsInternal(allPorts, eniList) {
        if(EBEnvironmentNamesArray == undefined || EBEnvironmentNamesArray.length == 0)
            return;
        
        if(EBEnvironmentNamesArray[0].trim() == "")
            return;
            
        // updating NetworkInterface & allPorts List for each ElasticeBeanstalk Environment
        for(var i=0;i<EBEnvironmentNamesArray.length;i++)
        {
            await getEnisAndPortOfInstancesInEBEnv(EBEnvironmentNamesArray[i],allPorts,eniList);
        }
}
async function getEnisAndPortOfInstancesInEBEnv(EBEnvironmentName, allPorts, eniList) {
    
    console.log("ElasticBeanstalk Environment : ",EBEnvironmentName);
    var isError = false;
    
    var params = {
        EnvironmentName: EBEnvironmentName
    };
    
    var ebstalk = new aws.ElasticBeanstalk();
    
    console.log("ElasticBeanstalk object",ebstalk);
    
    var ebstalkResources = await ebstalk.describeEnvironmentResources(params).promise().catch(err=>{
        console.log(err);
        isError = true;
    });
    
  
    
    
    if(!isError && ebstalkResources.EnvironmentResources.Instances != undefined)
    {
        
        console.log("Resources for current ElasticBeanstalk Environment : ",JSON.stringify(ebstalkResources.EnvironmentResources));
        
        
        params = {
            Filters:[{
                Name : "attachment.instance-id",
                Values : [
                
                ]
            }]    
        };
        
        var counter = sampleSize < 1 ? ebstalkResources.EnvironmentResources.Instances.length: sampleSize;
        var maxInstancesCnt = counter<ebstalkResources.EnvironmentResources.Instances.length?counter: ebstalkResources.EnvironmentResources.Instances.length ;
        // Taking only min(ebstalkResources.Instances.length,counter) instances from all instances present in environment
        
        for(var j=0;j<maxInstancesCnt;j++)
        {
            // need to update allPorts List too!! TODO
            params.Filters[0].Values.push(ebstalkResources.EnvironmentResources.Instances[j].Id);
          
        }
        
        console.log("params : "+JSON.stringify(params));
        var ec2 = new aws.EC2();
        
        if(params.Filters[0].Values.length>0)
        {
            var enis = await ec2.describeNetworkInterfaces(params).promise().catch(err=>{
              console.log(err);
              isError = true;
            });
        }
        
        console.log("ElasticBeanstalk Instances Sample describing NetworkInterfaces ", JSON.stringify(enis));
        
        if(!isError && enis.NetworkInterfaces != undefined)
        {
            for(var j=0;j<enis.NetworkInterfaces.length;j++)
            {
                // Use only primary interface
                if(enis.NetworkInterfaces[j].Attachment != undefined && enis.NetworkInterfaces[j].Attachment.DeviceIndex == 0)
                {
                    eniList.push([EBEnvironmentName, enis.NetworkInterfaces[j].NetworkInterfaceId]);
                }
            }
        }
    
        console.log("Updated eniList successfully for ElasticBeanstalk Environment : "+EBEnvironmentName);
    }
  
}
    
/** For Load Balancers and Target Group */
async function createTrafficMirrorSessionForLBsAndTargetGroup(successEnis, failedEnis) {
    var ports = [];
    var enis = []
    await createTrafficMirrorSessionForLBs(ports, enis);
    await createTrafficMirrorSessionForTargetGroup(ports, enis)
   // await updateTrafficMirroringRule(ports)
    var uniqueEnis = enis.filter(filterDuplicates);
    await updateMirroringSessions(uniqueEnis, failedEnis, successEnis)
}
async function createTrafficMirrorSessionForLBs(allPorts, eniList) {
    if (elbNamesArray.length == 0)
        return;
    if (elbNamesArray[0].trim() == "")
        return;

    var params = {};
    console.log("params ", JSON.stringify(params))
    var isError = false;
    var elb = new aws.ELB();
    var elbv2 = new aws.ELBv2();
    var ec2 = new aws.EC2();
    var data = await elb.describeLoadBalancers(params).promise().catch((err) => {
        console.error(err);
        isError = true;
    });
    console.log("describe elb ", JSON.stringify(data));
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
                var enis = await ec2.describeNetworkInterfaces(params).promise().catch((err) => {
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
    console.log("elb eniList ", JSON.stringify(eniList));

    // V2 Load balancers

    params = {};
    isError = false;
    data = await elbv2.describeLoadBalancers(params).promise().catch((err) => {
        console.error(err);
        isError = true;
    });
    console.log("elbv2 describeLoadBalancers ", JSON.stringify(data));
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
async function createTrafficMirrorSessionForTargetGroup(allPorts,
    eniList) {
        if (tgNamesArray == undefined || tgNamesArray.length == 0)
            return;
        if (tgNamesArray[0].trim() == "")
            return;

        var params = {
            Names: tgNamesArray
        }
        await getEnisAndPortOfTargetGroup(params, allPorts, eniList)
}
async function getEnisAndPortOfTargetGroup(params, allPorts, eniList) {
    var isError = false;
    var elbv2 = new aws.ELBv2();
    var ec2 = new aws.EC2();
    var i = 0,
        j = 0,
        k = 0;
    var targetGroups = await elbv2.describeTargetGroups(params).promise().catch((err) => {
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
            var backends = await elbv2.describeTargetHealth(params).promise().catch((err) => {
                console.error(err);
                isError = true;
            });
            console.log("elbv2 describeTargetHealth ", JSON.stringify(backends));
            if (!isError && backends.TargetHealthDescriptions != undefined) {
                if (targetGroups.TargetGroups[j].TargetType == "instance") {
                    params = {
                        Filters: [{
                            Name: "attachment.instance-id",
                            Values: [

                            ]
                        }]
                    };
                    for (k = 0; k < backends.TargetHealthDescriptions.length && counter > 0; k++) {
                        params.Filters[0].Values.push(backends.TargetHealthDescriptions[k].Target.Id)
                        allPorts.push(backends.TargetHealthDescriptions[k].Target.Port)
                        counter -- 
                    }
                    if (params.Filters[0].Values.length > 0) {
                        var enis = await ec2.describeNetworkInterfaces(params).promise().catch((err) => {
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
                if (targetGroups.TargetGroups[j].TargetType == "ip") {
                    params = {
                        Filters: [{
                            Name: "addresses.private-ip-address",
                            Values: [

                            ]
                        }]
                    };
                    for (k = 0; k < backends.TargetHealthDescriptions.length && counter > 0; k++) {
                        params.Filters[0].Values.push(backends.TargetHealthDescriptions[k].Target.Id)
                        allPorts.push(backends.TargetHealthDescriptions[k].Target.Port)
                        counter -- 
                    }
                    if (params.Filters[0].Values.length > 0) {
                        var enis = await ec2.describeNetworkInterfaces(params).promise().catch((err) => {
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

/** For ECS */
async function createTrafficMirrorSessionForECS(successEnis,
    failedEnis) {
    if (sourceECS === "")
        return;
    var params = {
        cluster: sourceECS
    };
    var isError = false;
    var ecs = new aws.ECS();
    var ec2 = new aws.EC2();
    //get all tasks in the cluster
    console.log("params ", JSON.stringify(params));
    var data = await ecs.listTasks(params).promise().catch((err) => {
        console.error(err);
        isError = true;
    });
    var eniList = []
    console.log("describe ecs cluster ", JSON.stringify(data))
    if (!isError) {
        //get subArray of 100
        for (var taskIndex = 0; taskIndex < data.taskArns.length; taskIndex += 100) {
            var subArray = data.taskArns.slice(taskIndex, taskIndex + 100)
            params = {
                cluster: sourceECS,
                tasks: subArray
            };
            var taskDetails = await ecs.describeTasks(params).promise().catch((err) => {
                console.error(err);
                isError = true;
            });
            console.log(JSON.stringify(taskDetails))
            var counter = sampleSize < 1 ? taskDetails.tasks.length : sampleSize
            for (var taskDetailsIndex = 0; taskDetailsIndex < taskDetails.tasks.length; taskDetailsIndex++) {
                if (taskDetails.tasks[taskDetailsIndex].attachments != undefined) {
                    for (var attachmentIndex = 0; attachmentIndex < taskDetails.tasks[taskDetailsIndex].attachments.length; attachmentIndex++) {
                        let eni = taskDetails.tasks[taskDetailsIndex].attachments[attachmentIndex].details.find(o => o.name === 'networkInterfaceId');
                        if (eni != undefined && counter > 0) {
                            eniList.push([sourceECS, eni.value])
                            counter--
                        }
                    }
                }
            }
        }
        var uniqueEnis = eniList.filter(filterDuplicates);
        await updateMirroringSessions(uniqueEnis, failedEnis, successEnis)
    }
}

async function handleEventForECS(event) {
    console.log("event recieved:\n" + JSON.stringify(event));
    var successEnis = [];
    var failedEnis = [];
    if (event.detail != undefined && event.detail.attachments != undefined) {
        if (event.detail.lastStatus == "RUNNING" && event.detail.desiredStatus == "RUNNING") {
            for (var attachmentIndex = 0; attachmentIndex < event.detail.attachments.length; attachmentIndex++) {
                let eni = event.detail.attachments[attachmentIndex].details.find(o => o.name === 'networkInterfaceId');
                if (eni != undefined) {
                    await createMirroringSession(eni.value, mirrorSessionNumber, trafficMirrorFilterID, successEnis, failedEnis)
                }

            }
            console.log("Mirroring session created for ", JSON.stringify(successEnis))
            console.log("failed ENIs ", JSON.stringify(failedEnis))
        }

    }
}









/** Handlers */ exports.ECShandler = async function(event, context) {
    if (event.RequestType != undefined) {
        // coming from cf
        if (event.RequestType == "Delete") {
            await deleteTrafficMirrorSession();
            await response.send(event, context, "SUCCESS");
            return;
        }
        validateInput(event,context);
        var successEnis = [];
        var failedEnis = [];
        await createTrafficMirrorSessionForECS(successEnis, failedEnis);
        sendResponse(event,context,successEnis,failedEnis);

    }
    else if (event.detail != undefined && event.detail.attachments != undefined) {
        await handleEventForECS(event)
    }
};
exports.ElasticBeanstalkHandler = async function(event, context) {
    if(event.RequestType!= undefined)
    {
        if (event.RequestType == "Delete") {
            await deleteTrafficMirrorSession();
            await response.send(event, context, "SUCCESS");
            return;
        }
        validateInput(event,context);
        var successEnis = [];
        var failedEnis = [];
        await createTrafficMirrorSessionForEBEnvironments(successEnis,failedEnis)
        sendResponse(event,context,successEnis,failedEnis);
    }
}
exports.LoadBalancerAndTargetGroupHandler = async function(event,context) {
    if(event.RequestType != undefined) 
    {
        if (event.RequestType == "Delete") {
            await deleteTrafficMirrorSession();
            await response.send(event, context, "SUCCESS");
            return;
        }

        validateInput(event,context);
        var successEnis = [];
        var failedEnis = [];
        await createTrafficMirrorSessionForLBsAndTargetGroup(successEnis, failedEnis)
        await sendResponse(event,context,successEnis,failedEnis);
    }
}
