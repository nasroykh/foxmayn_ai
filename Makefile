COMPOSE ?= docker compose

.PHONY: help env-setup check-env build up down restart deploy migrate ps logs logs-api logs-app logs-worker logs-db \
	shell-api shell-worker shell-app shell-db stats scan dev-infra clean clean-all

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  %-16s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# Environment
env-setup: ## Create .env from .env.example if missing
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		echo "Created .env from .env.example. Replace every CHANGE_ME before deploying."; \
	else \
		echo ".env already exists"; \
	fi

check-env: ## Fail if .env is missing or still has CHANGE_ME placeholders
	@test -f .env || { echo "No .env file. Run: make env-setup"; exit 1; }
	@if grep -n 'CHANGE_ME' .env | grep -v '^[0-9]*:[[:space:]]*#'; then \
		echo "Replace the CHANGE_ME values above in .env first."; exit 1; \
	fi

# Core operations
build: ## Build all images
	$(COMPOSE) build

up: check-env ## Start the stack in the background (migrations run first)
	$(COMPOSE) up -d

down: ## Stop and remove containers (volumes are kept)
	$(COMPOSE) down

restart: ## Restart all services
	$(COMPOSE) restart

deploy: check-env ## Pull latest code (fast-forward only), rebuild, restart
	git pull --ff-only
	$(COMPOSE) build
	$(COMPOSE) up -d --remove-orphans

migrate: ## Run pending database migrations (one-shot migrate service)
	$(COMPOSE) run --rm migrate

ps: ## Show service status
	$(COMPOSE) ps

# Logs
logs: ## Follow all logs
	$(COMPOSE) logs -f --tail=200

logs-api: ## Follow API logs
	$(COMPOSE) logs -f --tail=200 api

logs-worker: ## Follow worker logs
	$(COMPOSE) logs -f --tail=200 worker

logs-app: ## Follow frontend (Caddy) logs
	$(COMPOSE) logs -f --tail=200 app

logs-db: ## Follow Postgres logs
	$(COMPOSE) logs -f --tail=200 postgres

# Shells
shell-api: ## Shell in the API container
	$(COMPOSE) exec api sh

shell-worker: ## Shell in the worker container
	$(COMPOSE) exec worker sh

shell-app: ## Shell in the app container
	$(COMPOSE) exec app sh

shell-db: ## psql in the Postgres container
	$(COMPOSE) exec postgres sh -c 'psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"'

# Local development
dev-infra: ## Start only postgres, redis and qdrant (for `pnpm dev`)
	$(COMPOSE) up -d postgres redis qdrant

# Monitoring and security
stats: ## Show container resource usage
	$(COMPOSE) ps -q | xargs -r docker stats --no-stream

scan: ## Scan built images for vulnerabilities (needs Docker Scout)
	@for image in api worker app migrate; do \
		docker scout quickview foxmayn-ai-$$image:latest || echo "Docker Scout unavailable for $$image"; \
	done

# Destructive
clean: ## Remove containers, networks and built images (volumes are kept)
	@printf 'Remove containers, networks and built images of this project? Data volumes are kept. [y/N] ' && read ans && [ "$$ans" = y ]
	$(COMPOSE) down --rmi local

clean-all: ## Remove containers, images AND ALL DATA VOLUMES (postgres, redis, qdrant)
	@printf 'This DELETES the Postgres, Redis and Qdrant volumes of this project. Type "delete" to continue: ' && read ans && [ "$$ans" = delete ]
	$(COMPOSE) down -v --rmi local
