#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONTAINER_NAME="inventory-generator"
IMAGE_NAME="inventory-generator:latest"
NETWORK_NAME="inventory-network"
PORT=8090

cd "$APP_DIR"

echo "[INFO] Ensuring dedicated Docker network '$NETWORK_NAME' exists..."
docker network create "$NETWORK_NAME" 2>/dev/null || true

echo "[INFO] Building Docker image..."
docker build -f infra/Dockerfile -t "$IMAGE_NAME" .

echo "[INFO] Replacing container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --network "$NETWORK_NAME" \
  --restart unless-stopped \
  --memory="512m" \
  --cpus="0.5" \
  -p 127.0.0.1:$PORT:8080 \
  "$IMAGE_NAME"

echo "[INFO] Connecting Nginx Proxy Manager container to '$NETWORK_NAME'..."
docker network connect "$NETWORK_NAME" nginx-proxy-manager 2>/dev/null || true

echo "[INFO] Pruning unused Docker images..."
docker image prune -f

echo "[SUCCESS] Deployment completed for container '$CONTAINER_NAME' on network '$NETWORK_NAME'!"
