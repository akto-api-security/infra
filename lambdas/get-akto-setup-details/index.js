const { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand } = require('@aws-sdk/client-elastic-load-balancing-v2');
const { EC2Client, DescribeNetworkInterfacesCommand } = require('@aws-sdk/client-ec2');

const elb = new ElasticLoadBalancingV2Client({});
const ec2 = new EC2Client({});

async function sendResponse(event, context, status, data, reason) {
  const body = JSON.stringify({
    Status: status,
    Reason: reason || `See CloudWatch log stream: ${context.logStreamName}`,
    PhysicalResourceId: event.PhysicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data || {},
  });
  await fetch(event.ResponseURL, { method: 'PUT', headers: { 'Content-Type': '' }, body });
}

async function getAktoLBDetails() {
  const targetLB = process.env.TARGET_LB;
  const lbParams = { LoadBalancerArns: [targetLB] };
  console.log('GASD Getting Akto LB Details : ', JSON.stringify(lbParams));

  const lbResp = await elb.send(new DescribeLoadBalancersCommand(lbParams));
  const lb = lbResp.LoadBalancers && lbResp.LoadBalancers[0];
  if (!lb) {
    throw new Error('Could not find Akto Load Balancer');
  }

  // NLB network interfaces are described as "ELB net/<name>/<id>"
  const eniDesc = 'ELB ' + targetLB.substring(targetLB.indexOf('/') + 1);
  const eniResp = await ec2.send(new DescribeNetworkInterfacesCommand({
    Filters: [{ Name: 'description', Values: [eniDesc] }],
  }));
  const eni = eniResp.NetworkInterfaces && eniResp.NetworkInterfaces[0];
  if (!eni) {
    throw new Error('Could not find Network Interface Details for ' + eniDesc);
  }
  console.log('GASD ENIDesc: ', eniResp);

  const details = {
    PrivateIpAddress: eni.PrivateIpAddress,
    Subnets: lb.AvailabilityZones.map((az) => az.SubnetId),
    VpcId: lb.VpcId,
  };
  console.log('GASD LoadBalancerDescription : ', JSON.stringify({ ...lb, ...details }));
  return details;
}

exports.handler = async (event, context) => {
  try {
    if (event.RequestType === 'Delete') {
      await sendResponse(event, context, 'SUCCESS');
      return;
    }
    const details = await getAktoLBDetails();
    const responseData = {
      successEnis: JSON.stringify([]),
      kafkaIp: details.PrivateIpAddress,
      SubnetId: details.Subnets,
      VpcId: details.VpcId,
    };
    console.log('GASD responseData', responseData);
    await sendResponse(event, context, 'SUCCESS', responseData);
  } catch (err) {
    console.error(err);
    await sendResponse(event, context, 'FAILED', {}, String(err));
  }
};
