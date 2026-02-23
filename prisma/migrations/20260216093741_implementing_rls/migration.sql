-- 1. SECURITY CONFIGURATION
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Property" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Booking" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

--ALTER ROLE neondb_owner BYPASSRLS;

-- 2. TRIGGER FUNCTION: PREVENT UNAUTHORIZED ROLE PROMOTION
CREATE OR REPLACE FUNCTION prevent_user_role_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.role::text = 'Super_Admin' AND (OLD.role IS NULL OR OLD.role != 'Super_Admin') AND
    current_setting('app.current_role', true) != 'Super_Admin'
    THEN
        RAISE EXCEPTION 'Security Violation: The system does not allow promotion to Super_Admin.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER block_Super_admin_promotion
    BEFORE UPDATE ON "User"
    FOR EACH ROW
    EXECUTE FUNCTION prevent_user_role_change();

-- 3. TENANT POLICIES
CREATE POLICY "tenant_public_read" ON "Tenant"
    FOR SELECT USING (true);

CREATE POLICY "tenant_isolation_policy" ON "Tenant"
    FOR ALL
    USING (
        ("id" = current_setting('app.current_tenant_id', true)::text AND 
         current_setting('app.current_role', true) = 'Admin')
        OR 
        current_setting('app.current_role', true) = 'Super_Admin'
    )
    WITH CHECK (
        ("id" = current_setting('app.current_tenant_id', true)::text AND 
         current_setting('app.current_role', true) = 'Admin')
        OR 
        current_setting('app.current_role', true) = 'Super_Admin'
    );

-- 4. PROPERTY POLICIES
CREATE POLICY "property_public_read_policy" ON "Property"
    FOR SELECT USING (true);

CREATE POLICY "property_update_policy" ON "Property"
    FOR ALL
    USING (
        ("tenantId" = current_setting('app.current_tenant_id', true)::text AND 
         current_setting('app.current_role', true) = 'Admin')
        OR 
        current_setting('app.current_role', true) = 'Super_Admin'
    )
    WITH CHECK (
        ("tenantId" = current_setting('app.current_tenant_id', true)::text AND 
         current_setting('app.current_role', true) = 'Admin')
        OR 
        current_setting('app.current_role', true) = 'Super_Admin'
    );

-- 5. BOOKING POLICIES
CREATE POLICY "booking_access_policy" ON "Booking"
    FOR ALL
    USING (
        ("guestId" = current_setting('app.current_userId', true)::text)
        OR 
        EXISTS (
            SELECT 1 FROM "Property" p
            WHERE p."id" = "Booking"."propertyId"
              AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
              AND current_setting('app.current_role', true) = 'Admin'
        )
        OR 
        current_setting('app.current_role', true) = 'Super_Admin'
    )
    WITH CHECK (
        ("guestId" = current_setting('app.current_userId', true)::text)
        OR 
        EXISTS (
            SELECT 1 FROM "Property" p
            WHERE p."id" = "Booking"."propertyId"
              AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
              AND current_setting('app.current_role', true) = 'Admin'
        )
        OR 
        current_setting('app.current_role', true) = 'Super_Admin'
    );