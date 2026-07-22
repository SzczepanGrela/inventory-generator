#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CONTAINER_NAME="inventory-generator"
IMAGE_NAME="inventory-generator:latest"
PORT=8090

cd "$APP_DIR"

echo "[INFO] Building Docker image..."
docker build -f infra/Dockerfile -t "$IMAGE_NAME" .

echo "[INFO] Replacing container..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --memory="512m" \
  --cpus="0.5" \
  -p 127.0.0.1:$PORT:8080 \
  "$IMAGE_NAME"

echo "[INFO] Pruning unused Docker images..."
docker image prune -f

echo "[SUCCESS] Deployment completed on 127.0.0.1:$PORT!"
