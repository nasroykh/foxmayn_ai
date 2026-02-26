.PHONY: help build up down logs logs-api logs-app logs-db ps restart clean validate migrate migrate-gen shell-api shell-app shell-db stats scan buildx-setup buildx-build env-setup

# Default target
help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Core operations
build: ## Build all production images
	docker compose build

up: ## Start all production containers in detached mode
	docker compose up -d

down: ## Stop and remove all production containers
	docker compose down

restart: ## Restart all containers
	make down && make up

ps: ## Show running containers
	docker compose ps

# Logging
logs: ## View all container logs
	docker compose logs -f

logs-api: ## View API container logs
	docker compose logs -f api

logs-app: ## View Frontend container logs
	docker compose logs -f app

logs-db: ## View Database container logs
	docker compose logs -f postgres

# Database operations
migrate: ## Run database migrations manually
	docker compose exec api pnpm --filter @repo/db db:migrate

migrate-gen: ## Generate new database migrations
	docker compose exec api pnpm --filter @repo/db db:generate

# Utility targets
shell-api: ## Open shell in running API container
	docker compose exec api sh

shell-app: ## Open shell in running App container
	docker compose exec app sh

shell-db: ## Open shell in running Database container
	docker compose exec postgres psql -U app_template_user -d app_template_db

validate: ## Validate Docker configuration
	@chmod +x docker-validate.sh
	@./docker-validate.sh

clean: ## Remove containers, networks, and images (preserving volumes)
	docker compose down --rmi local

clean-all: ## Remove containers, networks, images, and VOLUMES
	docker compose down -v --rmi all

# Health and monitoring
stats: ## Show container resource usage
	docker stats --no-stream

# Security scanning
scan: ## Scan API and App images for vulnerabilities (requires Docker Scout)
	@docker scout quickview app_template_api:latest || echo "Docker Scout not available for API"
	@docker scout quickview app_template_app:latest || echo "Docker Scout not available for App"

# Multi-architecture builds
buildx-setup: ## Set up buildx for multi-arch builds
	docker buildx create --name multiarch --use || true
	docker buildx inspect --bootstrap

buildx-build: ## Build multi-architecture images (amd64, arm64)
	docker buildx bake -f docker-compose.yml --set *.platform=linux/amd64,linux/arm64

# Environment setup
env-setup: ## Copy .env.example to .env if .env doesn't exist
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example"; \
		echo "Please update secrets in .env"; \
	else \
		echo ".env already exists"; \
	fi
