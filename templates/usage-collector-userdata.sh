
sudo yum update -y
sudo yum install -y python python-setuptools
sudo yum install -y docker
sudo dockerd&
export COMPOSE_FILE=docker-compose-usage.yml
curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/usage-infra/cf-deploy-akto' > cf-deploy-akto
sudo chmod 700 cf-deploy-akto
"./cf-deploy-akto < <(echo 'test')"
sudo echo DB_CONN_RUL="{url}" >>
                  ~/akto/infra/docker-usage.env

curl -fsSL 'https://raw.githubusercontent.com/akto-api-security/infra/feature/usage-infra/cf-deploy-akto-start' > cf-deploy-akto-start
sudo chmod 700 cf-deploy-akto-start
"./cf-deploy-akto-start < <(echo 'test')"