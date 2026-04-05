DO $$
BEGIN
    IF NOT EXISTS (
    SELECT FROM pg_catalog.pg_roles 
        WHERE rolname = 'app_user'
    ) THEN

    CREATE ROLE app_user WITH LOGIN PASSWORD 'xQTzv9LsiDaasd49R1PBeZXtKV' NOBYPASSRLS;
    
  END IF;
END
$$;