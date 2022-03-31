#!/bin/bash
SCRIPT_NAME=$(basename "$0")
ENDPOINT=""
PACKAGE_URL=""
PUBLIC_IP_RANGES=(0.0.0.0/5 8.0.0.0/7 11.0.0.0/8 12.0.0.0/6 16.0.0.0/4
    32.0.0.0/3 64.0.0.0/2 128.0.0.0/3 160.0.0.0/5 168.0.0.0/6
    172.0.0.0/12 172.32.0.0/11 172.64.0.0/10 172.128.0.0/9 173.0.0.0/8
    174.0.0.0/7 176.0.0.0/4 192.0.0.0/9 192.128.0.0/11 192.160.0.0/13
    192.169.0.0/16 192.170.0.0/15 192.172.0.0/14 192.176.0.0/12 192.192.0.0/10
    193.0.0.0/8 194.0.0.0/7 196.0.0.0/6 200.0.0.0/5 208.0.0.0/4)

check_error() {
  if [ $? -ne 0 ]
  then
    echo "Error occurred !!!"
    echo -e "\n$1"
    exit 1
  else
    echo "done."
  fi
}
confirm() {
  # call with a prompt string or use a default
  read -r -p "Are you sure? [y/N] " response
  case "$response" in
    [yY][eE][sS]|[yY])
      true
      ;;
    *)
      false
      ;;
  esac
}

create_from_config() {
  INITIAL_DELAY_SECONDS=180
    create_resources
}

delete_from_config() {
  read_delete_config
  confirm && delete_resources
}


read_delete_config() {

read -p "Please provide project: " PROJECT
read -p "Please provide region: " REGION
read -p "Please provide prefix: " PREFIX
read -p "Please provide zone: " ZONE

  echo "Deleting resources with the following params"
  echo "project: $PROJECT"
  echo "region: $REGION"
  echo "prefix: $PREFIX"
  echo "zone: $ZONE"
  echo ""
}

create_resources() {
  read -p "Enter your project name: " PROJECT
  echo "PROJECT=$PROJECT" 
    read -p "Enter your region: " REGION
  echo "REGION=$REGION" 
  read -p "Enter your NETWORK: " NETWORK
  echo "NETWORK=$NETWORK" 
   read -p "Enter your SUBNET: " SUBNET
  echo "SUBNET=$SUBNET" 
   read -p "Enter your ZONE: " ZONE
  echo "ZONE=$ZONE" 

  PREFIX="akto"
  echo "Will be creating Akto resources with prefix $PREFIX"
    set_names

    create_instance_mongo
    create_health_checks
    create_load_balancer
    create_forwarding_rule
    create_mirroring_policy
    create_instance_template
    create_ig
    add_backend_service
    create_instance_dashboard
    

    # Print disclaimer to put it behind VPN
}

delete_resources() {
    set_names
    delete_forwarding_rule
    delete_load_balancer
    delete_mirroring_policy
    delete_ig
    delete_instance_template
    delete_health_checks
    delete_instance_mongo
    delete_instance_dashboard
    
}

set_names() {
  akto_instance_template="${PREFIX}-instance-template"
  akto_health_check="${PREFIX}-instance-group-health-check"
  akto_instance_group="${PREFIX}-instance-group"
  akto_load_balancer="${PREFIX}-load-balancer"
  akto_forwarding_rule="${PREFIX}-forwarding-rule"
  akto_mirroring_policy="${PREFIX}-mirroring-policy"
  akto_instance_mongo="${PREFIX}-instance-mongo"
  akto_instance_dashboard="${PREFIX}-instance-dashboard"
}


create_instance_template() {
    echo -n "Creating $akto_instance_template"
    local AktoMongoInstancePrivateIp=$(find_mongo_ip)
    local AktoLoadBalancerPrivateIp=$(find_load_balancer_ip)
    echo $AktoLoadBalancerPrivateIp
    echo $AktoMongoInstancePrivateIp
  args=(compute instance-templates create "$akto_instance_template" 
    --project "$PROJECT"
    --labels "name=receiver"
    --region "$REGION" 
    --machine-type "n2-standard-2" 
    --network-interface "network=$NETWORK,subnet=$SUBNET,network-tier=PREMIUM,no-address" 
    --maintenance-policy "MIGRATE" 
    --scopes "storage-ro,logging-write,monitoring-write,service-control,service-management,trace"
    --metadata AktoMongoInstancePrivateIp=$AktoMongoInstancePrivateIp,AktoLoadBalancerPrivateIp=$AktoLoadBalancerPrivateIp,startup-script='#! /bin/bash
        AktoMongoInstancePrivateIp=$(curl http://metadata.google.internal/computeMetadata/v1/instance/attributes/AktoMongoInstancePrivateIp -H "Metadata-Flavor: Google")
        AktoLoadBalancerPrivateIp=$(curl http://metadata.google.internal/computeMetadata/v1/instance/attributes/AktoLoadBalancerPrivateIp -H "Metadata-Flavor: Google")
        echo $AktoMongoInstancePrivateIp
        apt-get update
        apt-get install -y  ca-certificates  curl gnupg lsb-release unzip
        curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        echo   "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian \
        $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io      
        export AKTO_MONGO_CONN="$AktoMongoInstancePrivateIp"
        export AKTO_KAFKA_IP="$AktoLoadBalancerPrivateIp"
        export AKTO_INFRA_MIRRORING_MODE=gcp
        export COMPOSE_FILE=docker-compose-runtime.yml
        curl -fsSL "https://raw.githubusercontent.com/akto-api-security/infra/feature/segregation/cf-deploy-akto" > cf-deploy-akto
        sudo chmod 700 cf-deploy-akto
        ./cf-deploy-akto < <(echo "test")
        sudo echo >> ~/akto/infra/docker-runtime.env
        sudo echo AKTO_MONGO_CONN=mongodb://$AKTO_MONGO_CONN:27017/admin >> ~/akto/infra/docker-runtime.env
        sudo echo AKTO_KAFKA_IP=$AKTO_KAFKA_IP >> ~/akto/infra/.env
        curl -fsSL "https://raw.githubusercontent.com/akto-api-security/infra/feature/segregation/cf-deploy-akto-start" > cf-deploy-akto-start
        sudo chmod 700 cf-deploy-akto-start
        ./cf-deploy-akto-start < <(echo "test") 
     '
  )
     err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
  check_error "$err"
}

delete_instance_template(){
     args=(compute instance-templates describe "$akto_instance_template"
      --project "$PROJECT"      
      --format "value(name)")
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_instance_template" ]
  then
    echo -n "Deleting instance template [$akto_instance_template]..."
    args=(compute instance-templates delete "$akto_instance_template"
        --project "$PROJECT"
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}

create_ig() {
    echo -n "Creating Akto managed instance group"
    args=(compute instance-groups managed create "$akto_instance_group" 
        --project "$PROJECT" 
        --base-instance-name "$akto_instance_group" 
        --size 1 
        --region "$REGION"
        --description "Collector of traffic" 
        --template "$akto_instance_template" 
        --health-check "$akto_health_check" 
        --initial-delay 300)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err" 

    echo -n " Creating autoscaler for akto managed instance group"
    args=( compute instance-groups managed set-autoscaling "$akto_instance_group" 
        --project "$PROJECT"
        --region "$REGION"
        --cool-down-period 60 
        --max-num-replicas 5 
        --min-num-replicas 1 
        --mode "on" 
        --update-stackdriver-metric=compute.googleapis.com/instance/network/received_bytes_count 
        --stackdriver-metric-filter='metric.labels.loadbalanced = true'
        --stackdriver-metric-utilization-target=200000000.0 
        --stackdriver-metric-utilization-target-type=gauge)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
}

delete_ig() {
  args=(compute instance-groups managed describe "$akto_instance_group"
      --project "$PROJECT"
      --region "$REGION"
      --format="value(name)")
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_instance_group" ]
  then
    echo -n "Deleting managed instance group [$akto_instance_group]..."
    args=(compute instance-groups managed delete "$akto_instance_group"
        --project "$PROJECT"
        --region "$REGION"
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}

create_nat() {
  args=(compute routers list
      --project "$PROJECT"
      --regions "$REGION"
      --format "csv(name,region)")
  valid=$(gcloud "${args[@]}" 2>/dev/null | tail +2 | awk -v PROJECT="$PROJECT" -F, \
      '{print "gcloud compute routers nats list --router="$1" --region="$2" --project="PROJECT" \
      --format=\"value(sourceSubnetworkIpRangesToNat)\"" }' | sh | \
      grep -c "ALL_SUBNETWORKS_ALL_IP_RANGES\|ALL_SUBNETWORKS_ALL_PRIMARY_IP_RANGES")
  if [ "$valid" != "1" ]
  then
    echo "INFO: cloud NAT not configured for all subnets in network [$NETWORK]\
 region [$REGION]. Will create for subnet [$SUBNET]."

    echo -n "Creating router [$ROUTER]..."
    args=(compute routers create "$ROUTER"
        --project "$PROJECT"
        --region "$REGION"
        --network "$NETWORK")
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"

    echo -n "Creating NAT [$NAT]..."
    args=(compute routers nats create "$NAT"
        --project "$PROJECT"
        --region "$REGION"
        --router "$ROUTER"
        --nat-custom-subnet-ip-ranges "$SUBNET"
        --auto-allocate-nat-external-ips)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"

    echo "INFO: waiting for 60 seconds to allow NAT to be configured."
    sleep 60 # allowing NAT to be configured before we use it in collector VM
  else
    echo "INFO: cloud NAT pre-configured in network [$NETWORK] region [$REGION].\
 Skipping this step."
  fi
}

create_instance_mongo() {
    echo -n "Creating instance for mongo"
    args=(compute instances create "$akto_instance_mongo" 
        --project "$PROJECT"
        # --REGION "$REGION"
        --zone "$ZONE" 
        --machine-type "e2-standard-2" 
        --network-interface "network=$NETWORK,subnet=$SUBNET,network-tier=PREMIUM,no-address"
        --maintenance-policy "MIGRATE" 
        --scopes "storage-ro,logging-write,monitoring-write,service-control,service-management,trace"
        --metadata startup-script='#! /bin/bash
        apt-get update
        apt-get install -y  ca-certificates  curl gnupg lsb-release unzip
        curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        echo   "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian \
        $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io
        export COMPOSE_FILE=docker-compose-mongo.yml
        curl -fsSL "https://raw.githubusercontent.com/akto-api-security/infra/feature/segregation/cf-deploy-akto" > cf-deploy-akto
        sudo chmod 700 cf-deploy-akto
        ./cf-deploy-akto < <(echo "test")
        curl -fsSL "https://raw.githubusercontent.com/akto-api-security/infra/feature/segregation/cf-deploy-akto-start" > cf-deploy-akto-start
        sudo chmod 700 cf-deploy-akto-start
        ./cf-deploy-akto-start < <(echo "test")
     '
        )
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
}

delete_instance_mongo(){
    args=(compute instances describe "$akto_instance_mongo"
      --project "$PROJECT" 
      --zone "$ZONE"  
      --format "value(name)"
      )
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_instance_mongo" ]
  then
    echo -n "Deleting mongo instance [$akto_instance_mongo]..."
    args=(compute instances delete "$akto_instance_mongo"
        --project "$PROJECT"
        --zone "$ZONE" 
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}

create_instance_dashboard() {
    echo -n "Creating instance for dashboard"
    local AktoMongoInstancePrivateIp=$(find_mongo_ip)
    local AktoLoadBalancerPrivateIp=$(find_load_balancer_ip)
    echo $AktoLoadBalancerPrivateIp
    echo $AktoMongoInstancePrivateIp
    args=(compute instances create "$akto_instance_dashboard" 
        --project "$PROJECT"
        --zone "$ZONE" 
        --machine-type "e2-standard-2" 
        --network-interface "network=$NETWORK,subnet=$SUBNET,network-tier=PREMIUM"
        --maintenance-policy "MIGRATE" 
        --scopes "storage-ro,logging-write,monitoring-write,service-control,service-management,trace"
        --metadata AktoMongoInstancePrivateIp=$AktoMongoInstancePrivateIp,AktoLoadBalancerPrivateIp=$AktoLoadBalancerPrivateIp,startup-script='#! /bin/bash
        AktoMongoInstancePrivateIp=$(curl http://metadata.google.internal/computeMetadata/v1/instance/attributes/AktoMongoInstancePrivateIp -H "Metadata-Flavor: Google")
        AktoLoadBalancerPrivateIp=$(curl http://metadata.google.internal/computeMetadata/v1/instance/attributes/AktoLoadBalancerPrivateIp -H "Metadata-Flavor: Google")
        echo $AktoMongoInstancePrivateIp
        apt-get update
        apt-get install -y  ca-certificates  curl gnupg lsb-release unzip
        curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
        echo   "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian \
        $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
        apt-get update
        apt-get install -y docker-ce docker-ce-cli containerd.io
        export AKTO_MONGO_CONN="$AktoMongoInstancePrivateIp"
        export AKTO_KAFKA_BROKER_URL="$AktoLoadBalancerPrivateIp"
        export COMPOSE_FILE=docker-compose-dashboard.yml
        curl -fsSL "https://raw.githubusercontent.com/akto-api-security/infra/feature/segregation/cf-deploy-akto" > cf-deploy-akto
        sudo chmod 700 cf-deploy-akto
        ./cf-deploy-akto < <(echo "test")
        sudo echo >> ~/akto/infra/docker-dashboard.env
        sudo echo AKTO_MONGO_CONN=mongodb://$AKTO_MONGO_CONN:27017/admini >> ~/akto/infra/docker-dashboard.env
        sudo echo AKTO_KAFKA_BROKER_URL=$AKTO_KAFKA_BROKER_URL:9092 >> ~/akto/infra/docker-dashboard.env
        curl -fsSL "https://raw.githubusercontent.com/akto-api-security/infra/feature/segregation/cf-deploy-akto-start" > cf-deploy-akto-start
        sudo chmod 700 cf-deploy-akto-start
        ./cf-deploy-akto-start < <(echo "test")

     '
        )
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
}

delete_instance_dashboard(){
    args=(compute instances describe "$akto_instance_dashboard"
      --project "$PROJECT"
      --zone "$ZONE"      
      --format "value(name)"
      )
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_instance_dashboard" ]
  then
    echo -n "Deleting dashboard instance [$akto_instance_dashboard]..."
    args=(compute instances delete "$akto_instance_dashboard"
        --project "$PROJECT"
        --zone "$ZONE" 
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}

find_mongo_ip(){
  args=(compute instances describe "$akto_instance_mongo" 
  --format "get(networkInterfaces[0].networkIP)"
  --zone "$ZONE" 
        )
    echo $(gcloud "${args[@]}")
}

create_load_balancer() {
  echo -n "Creating load balancer service"
  args=(compute backend-services create "$akto_load_balancer"
      --description "Target Load balancer"
      --project "$PROJECT"
      --region "$REGION" 
      --network "$NETWORK"
      --health-checks "$akto_health_check"
      --load-balancing-scheme INTERNAL
      --protocol udp)
  err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
  check_error "$err"
  
}

delete_load_balancer() {
  args=(compute backend-services describe "$akto_load_balancer"
      --project "$PROJECT"
      --region "$REGION"
      --format "value(name)")
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_load_balancer" ]
  then
    echo -n "Deleting akto load balancer [$akto_load_balancer]..."
    args=(compute backend-services delete "$akto_load_balancer"
        --project "$PROJECT"
        --region "$REGION"
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}

find_load_balancer_ip(){
  args=(compute forwarding-rules describe "$akto_forwarding_rule" 
  --region "$REGION" 
  --format "get(IPAddress)"
    )
    echo $(gcloud "${args[@]}")
}


add_backend_service(){
echo -n "Adding Akto instance group to [$akto_load_balancer]"
  args=(compute backend-services add-backend "$akto_load_balancer"
      --project "$PROJECT"
      --region "$REGION" 
      --instance-group "$akto_instance_group"
      --instance-group-region "$REGION" 
      )
  err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
  check_error "$err"
}
create_forwarding_rule() {
  echo -n "Creating lb forwarding rule"
  args=(compute forwarding-rules create "$akto_forwarding_rule"
      --description "Akto forwarding rule to get traffic"
      --project "$PROJECT"
      --region "$REGION" 
      --network "$NETWORK"
      --subnet "$SUBNET"
      --backend-service "$akto_load_balancer"
      --load-balancing-scheme INTERNAL
      --ip-protocol udp
      --ports ALL
      --is-mirroring-collector
      )
  err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
  check_error "$err"
}

delete_forwarding_rule() {
  args=(compute forwarding-rules describe "$akto_forwarding_rule"
      --project "$PROJECT"
      --region "$REGION"
      --format "value(name)")
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_forwarding_rule" ]
  then
    echo -n "Deleting forwarding rule [$akto_forwarding_rule]..."
    args=(compute forwarding-rules delete "$akto_forwarding_rule"
        --project "$PROJECT"
        --region "$REGION"
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}


create_mirroring_policy() {
    echo -n "Creating packet mirroring policy"
  args=(compute packet-mirrorings create "$akto_mirroring_policy"
      --project "$PROJECT"
      --region "$REGION" 
      --network "$NETWORK"
      --collector-ilb "$akto_forwarding_rule"
      --mirrored-tags "mirror"
      )

  args=("${args[@]}" --filter-protocols tcp)
  err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
  check_error "$err"
}
delete_mirroring_policy() {
  args=(compute packet-mirrorings describe "$akto_mirroring_policy"
      --project "$PROJECT"
      --region "$REGION"
      --format "value(name)")
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_mirroring_policy" ]
  then
    echo -n "Deleting packet mirroring policy [$akto_mirroring_policy]..."
    args=(compute packet-mirrorings delete "$akto_mirroring_policy"
        --project "$PROJECT"
        --region "$REGION"
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}

create_health_checks(){
    echo -n "Creating health checks for akto managed instance group"
    args=(compute health-checks create http "$akto_health_check"  
       --project "$PROJECT"
       --description "creating health check of instance group"
       --port 8000 
       --request-path "/metrics" 
       --proxy-header NONE 
       --no-enable-logging 
       --check-interval 10 
       --timeout 5 
       --unhealthy-threshold 3 
       --healthy-threshold 3
        --global --no-enable-logging
        )
  err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
  check_error "$err" 

}

delete_health_checks() {
  args=(compute health-checks describe "$akto_health_check"
      --project "$PROJECT"
      --format "value(name)")
  found=$(gcloud "${args[@]}" 2>/dev/null)
  if [ "$found" == "$akto_health_check" ]
  then
    echo -n "Deleting health check [$akto_health_check]..."
    args=(compute health-checks delete "$akto_health_check"
        --project "$PROJECT"
        -q)
    err=$(gcloud "${args[@]}" 2>&1 >/dev/null)
    check_error "$err"
  fi
}


parse_input() {
  if [ "$#" -eq "0" ]
  then
    echo "No input provided. Please provide 'create' or 'delete' as input"
    return
  fi

  local cmd_type="$1"
  case $cmd_type in
    create)
      create_from_config
      ;;
    delete)
      delete_from_config
      ;;
    *) #unknown option
      echo "Unknown cmd type: $cmd_type. Please provide 'create' or 'delete' as input"
      return
      ;;
  esac
}

parse_input "$@"
