-- PostgreSQL initialization script
-- This script runs automatically when the container is first created

-- Create extensions if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Grant necessary privileges dynamically using current user/db
-- (resolves to POSTGRES_USER and POSTGRES_DB from docker-compose env)
DO $$
BEGIN
    EXECUTE format('GRANT ALL PRIVILEGES ON DATABASE %I TO %I', current_database(), current_user);
    RAISE NOTICE 'Database initialization completed successfully';
END$$;
