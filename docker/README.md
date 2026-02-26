# Docker Setup Guide

This document provides comprehensive guidance for running the application using Docker.

## Quick Start

### Development Mode

```bash
# Copy environment file
cp .env.example .env

# Start all services with hot reload
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up --build

# Or use the helper script
./docker/scripts/dev.sh
```

**Services will be available at:**

- Frontend: http://localhost:33460
- Backend API: http://localhost:33450
- API Docs: http://localhost:33450/docs
- PostgreSQL: localhost:5432

### Production Mode

```bash
# Ensure .env file is configured
cp .env.example .env
# Edit .env with production values

# Start services in detached mode
docker-compose up --build -d

# Or use the helper script
./docker/scripts/prod.sh

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## Architecture

### Multi-Stage Builds

Both the API and frontend applications use optimized multi-stage Docker builds:

**API Dockerfile Stages:**

1. **deps** - Install all dependencies with pnpm
2. **build** - Build shared packages and API
3. **production** - Minimal runtime image with only production dependencies
4. **development** - Development image with hot reload support

**Frontend Dockerfile Stages:**

1. **deps** - Install all dependencies with pnpm
2. **build** - Build static assets with Vite
3. **production** - Nginx serving static files
4. **development** - Vite dev server with HMR

### Services

#### PostgreSQL (postgres)

- **Image**: postgres:18-alpine
- **Port**: 5432
- **Health Check**: pg_isready command
- **Volumes**: Persistent data storage
- **Init Script**: `docker/postgres/init.sql`

#### Backend API (api)

- **Port**: 33450
- **Health Check**: HTTP check on `/api/v1/health`
- **Dependencies**: PostgreSQL (waits for healthy status)
- **Development**: Hot reload with tsx watch
- **Production**: Optimized Node.js runtime

#### Frontend App (app)

- **Port**: 33460
- **Health Check**: HTTP check on `/health`
- **Dependencies**: API (waits for healthy status)
- **Development**: Vite dev server with HMR
- **Production**: Nginx serving static files

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Database
DB_USER=app_template_user
DB_PASSWORD=app_template_password
DB_NAME=app_template_db

# Authentication
TOKEN_SECRET_KEY=<your-secret-key>
TOKEN_ENCRYPTION_KEY=<your-encryption-key>
BETTER_AUTH_SECRET=<your-auth-secret>

# SMTP (for emails)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM=noreply@yourdomain.com
```

### Volume Mounts (Development)

Development mode mounts source code for hot reload:

```yaml
volumes:
  - ./apps/api:/app/apps/api # API source
  - ./apps/app:/app/apps/app # Frontend source
  - ./packages:/app/packages # Shared packages
  - /app/node_modules # Preserve dependencies
```

## Common Commands

### Service Management

```bash
# Start all services
docker-compose up

# Start in detached mode
docker-compose up -d

# Stop all services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Rebuild and start
docker-compose up --build

# View logs
docker-compose logs -f

# View logs for specific service
docker-compose logs -f api
```

### Database Operations

```bash
# Run migrations
docker-compose exec api pnpm --filter @repo/db db:migrate

# Generate migrations
docker-compose exec api pnpm --filter @repo/db db:generate

# Open Drizzle Studio
docker-compose exec api pnpm --filter @repo/db db:studio

# Access PostgreSQL shell
docker-compose exec postgres psql -U app_template_user -d app_template_db

# Run SQL file
docker-compose exec -T postgres psql -U app_template_user -d app_template_db < backup.sql
```

### Container Management

```bash
# Execute command in container
docker-compose exec api sh

# View container processes
docker-compose top

# View resource usage
docker stats

# Inspect service configuration
docker-compose config

# Restart specific service
docker-compose restart api
```

### Development Workflows

```bash
# Install new dependency
docker-compose exec api pnpm add <package-name>

# Run linting
docker-compose exec api pnpm lint

# Run tests (if configured)
docker-compose exec api pnpm test

# Build for production
docker-compose exec api pnpm build
```

## Troubleshooting

### Port Already in Use

```bash
# Check what's using the port
lsof -i :33450
lsof -i :33460
lsof -i :5432

# Kill the process
kill -9 <PID>

# Or change ports in .env or docker-compose.yml
```

### Container Won't Start

```bash
# View detailed logs
docker-compose logs api

# Check health status
docker-compose ps

# Rebuild without cache
docker-compose build --no-cache api

# Remove all containers and start fresh
docker-compose down -v
docker-compose up --build
```

### Database Connection Issues

```bash
# Verify PostgreSQL is running and healthy
docker-compose ps postgres

# Check PostgreSQL logs
docker-compose logs postgres

# Test connection from API container
docker-compose exec api sh -c 'nc -zv postgres 5432'

# Verify environment variables
docker-compose exec api env | grep DB_
```

### Hot Reload Not Working

1. Ensure volumes are mounted correctly
2. Check file permissions
3. Verify node_modules is excluded from mounting
4. Restart the service: `docker-compose restart api`

### Image Build Failures

```bash
# Clear build cache
docker builder prune

# Build with verbose output
docker-compose build --no-cache --progress=plain api

# Check disk space
df -h
```

## Performance Optimization

### Build Performance

```bash
# Use BuildKit for faster builds
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# Parallel builds
docker-compose build --parallel
```

### Resource Limits

Adjust resource limits in `docker-compose.yml`:

```yaml
deploy:
  resources:
    limits:
      cpus: "1.0"
      memory: 1G
    reservations:
      cpus: "0.5"
      memory: 512M
```

## Security Best Practices

1. **Non-root Users**: All containers run as non-root users
2. **Secrets Management**: Use Docker secrets for sensitive data (see docker-compose.yml)
3. **Network Isolation**: Backend services on internal network
4. **Health Checks**: All services have health checks configured
5. **Resource Limits**: CPU and memory limits prevent resource exhaustion

## Production Deployment

### Pre-deployment Checklist

- [ ] Update `.env` with production values
- [ ] Change default passwords and secrets
- [ ] Configure SMTP for email notifications
- [ ] Set up SSL/TLS certificates
- [ ] Configure proper logging
- [ ] Set up monitoring and alerts
- [ ] Configure backup strategy for PostgreSQL

### Deployment Steps

```bash
# 1. Build production images
docker-compose build

# 2. Tag images
docker tag app_template_api:latest registry.example.com/app_template_api:latest
docker tag app_template_app:latest registry.example.com/app_template_app:latest

# 3. Push to registry
docker push registry.example.com/app_template_api:latest
docker push registry.example.com/app_template_app:latest

# 4. Deploy on production server
docker-compose up -d

# 5. Run migrations
docker-compose exec api pnpm --filter @repo/db db:migrate

# 6. Verify health
docker-compose ps
curl http://localhost:33450/api/v1/health
curl http://localhost:33460/health
```

## Helper Scripts

Located in `docker/scripts/`:

- `dev.sh` - Start development environment
- `prod.sh` - Start production environment
- `db-migrate.sh` - Run database migrations
- `clean.sh` - Clean up Docker resources

```bash
# Make scripts executable (if needed)
chmod +x docker/scripts/*.sh

# Run scripts
./docker/scripts/dev.sh
```

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)
- [Docker Security Best Practices](https://docs.docker.com/develop/security-best-practices/)
