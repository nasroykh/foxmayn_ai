#!/bin/bash
# Production Docker Compose startup script

set -e

echo "🚀 Starting production environment with Docker Compose..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ No .env file found. Please create one from .env.example"
    exit 1
fi

# Build and start services
docker-compose up --build -d

echo "✅ Production environment started"
echo "📊 View logs: docker-compose logs -f"
echo "🛑 Stop services: docker-compose down"
