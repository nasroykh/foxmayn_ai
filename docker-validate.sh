#!/bin/bash

# Docker Configuration Validation Script for App Template
# Validates Docker setup without building images

set -e

echo "🔍 Validating Docker Configuration (Production Only)..."
echo ""

# Check Docker installation
echo "✓ Checking Docker installation..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed"
    exit 1
fi
echo "  Docker version: $(docker --version)"
echo ""

# Check Docker Compose installation
echo "✓ Checking Docker Compose installation..."
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "❌ Docker Compose is not installed"
    exit 1
fi
if command -v docker-compose &> /dev/null; then
    echo "  Docker Compose version: $(docker-compose --version)"
else
    echo "  Docker Compose version: $(docker compose version)"
fi
echo ""

# Validate Dockerfiles
echo "✓ Validating Dockerfiles..."
if [ ! -f "apps/api/Dockerfile" ]; then
    echo "❌ API Dockerfile not found at apps/api/Dockerfile"
    exit 1
fi
if [ ! -f "apps/app/Dockerfile" ]; then
    echo "❌ App Dockerfile not found at apps/app/Dockerfile"
    exit 1
fi
echo "  Dockerfiles exist"
echo ""

# Validate docker-compose.yml
echo "✓ Validating docker-compose.yml..."
if [ ! -f "docker-compose.yml" ]; then
    echo "❌ docker-compose.yml not found"
    exit 1
fi

# Check compose config
if command -v docker-compose &> /dev/null; then
    docker-compose -f docker-compose.yml config > /dev/null 2>&1 || { echo "❌ docker-compose.yml config is invalid"; exit 1; }
else
    docker compose -f docker-compose.yml config > /dev/null 2>&1 || { echo "❌ docker-compose.yml config is invalid"; exit 1; }
fi
echo "  docker-compose.yml is valid"
echo ""

# Check .dockerignore
echo "✓ Checking .dockerignore..."
if [ ! -f ".dockerignore" ]; then
    echo "⚠️  Root .dockerignore not found"
else
    echo "  Root .dockerignore exists"
fi
echo ""

# Check environment files
echo "✓ Checking environment configuration..."
if [ ! -f ".env.example" ]; then
    echo "⚠️  .env.example template not found"
else
    echo "  .env.example exists (template)"
fi

if [ ! -f ".env" ]; then
    echo "⚠️  Root .env not found (copy from .env.example)"
else
    echo "  Root .env exists"

    # Check for critical variables in .env
    REQUIRED_VARS=("BETTER_AUTH_SECRET" "TOKEN_SECRET_KEY" "DB_PASSWORD")
    for var in "${REQUIRED_VARS[@]}"; do
        if ! grep -q "$var" .env; then
            echo "⚠️  Critical variable $var might be missing in .env"
        fi
    done
fi
echo ""

# Check pnpm-workspace.yaml
echo "✓ Checking workspace configuration..."
if [ ! -f "pnpm-workspace.yaml" ]; then
    echo "❌ pnpm-workspace.yaml not found (required for monorepo build)"
    exit 1
fi
echo "  Workspace configuration exists"
echo ""

# Summary
echo "✅ Docker configuration validation complete!"
echo ""
echo "Next steps:"
echo "  1. Configure .env from .env.example"
echo "  2. Build and run: make up"
echo "  3. Monitor migrations: make logs-api"
echo ""
echo "For detailed documentation, see DOCKER.md"
