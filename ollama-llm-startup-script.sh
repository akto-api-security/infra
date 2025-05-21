#!/bin/bash
set -e

apt-get update
apt-get install -y docker nvidia-container-toolkit nginx

systemctl restart docker

# NGINX reverse proxy config
cat > /etc/nginx/sites-available/ollama <<'EOF'
server {
    listen 80;
    server_name jarvis.internal.akto.io;

    location / {
        proxy_pass http://localhost:11434;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/ollama /etc/nginx/sites-enabled/ollama
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx
systemctl enable nginx

systemctl enable docker
systemctl start docker

docker run --gpus all -d \
  -p 11434:11434 \
  --name ollama \
  --restart unless-stopped \
  ollama/ollama

# Wait for container to be ready
echo "Waiting for ollama container to start..."
until [ "$(docker inspect -f '{{.State.Running}}' ollama)" == "true" ]; do
    sleep 5
done

docker exec ollama ollama pull llama3.2:3b

touch /tmp/startup-complete
echo "Startup script completed."
