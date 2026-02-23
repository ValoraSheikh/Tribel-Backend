
DROP POLICY IF EXISTS "booking_access_policy" ON "Booking";

-- Open Insert Policies
CREATE POLICY "tenant_insert_public" ON "Tenant"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "user_insert_public" ON "User"
    FOR INSERT WITH CHECK (true);

CREATE POLICY "booking_insert_public" ON "Booking"
    FOR INSERT WITH CHECK (true);

-- Tenant Admin View Policy
CREATE POLICY "user_select_tenant_admin" ON "User"
    FOR SELECT
    USING (
        "id" = current_setting('app.current_userId', true)::text
        OR
        (
            current_setting('app.current_role', true) = 'Admin' 
            AND EXISTS (
                SELECT 1 FROM "Booking" b
                JOIN "Property" p ON b."propertyId" = p."id"
                WHERE b."guestId" = "User"."id" 
                  AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
            )
        )
    );

-- User Isolation & Super Admin Policy
CREATE POLICY "user_all_self_or_superadmin" ON "User"
    FOR ALL
    USING (
        "id" = current_setting('app.current_userId', true)::text
        OR current_setting('app.current_role', true) = 'Super_Admin'
    )
    WITH CHECK (
        "id" = current_setting('app.current_userId', true)::text
        OR current_setting('app.current_role', true) = 'Super_Admin'
    );
    
-- Booking Policies
CREATE POLICY "booking_all_guest_or_admins" ON "Booking"
        FOR ALL
        USING (
            ("guestId" = current_setting('app.current_userId', true)::text)
            OR 
            (
                current_setting('app.current_role', true) = 'Admin' AND
                EXISTS (
                    SELECT 1 FROM "Property" p
                    WHERE p."id" = "Booking"."propertyId"
                      AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
                )
            )
            OR 
            current_setting('app.current_role', true) = 'Super_Admin'
        )
        WITH CHECK (
            ("guestId" = current_setting('app.current_userId', true)::text)
            OR 
            (
                current_setting('app.current_role', true) = 'Admin' AND
                EXISTS (
                    SELECT 1 FROM "Property" p
                    WHERE p."id" = "Booking"."propertyId"
                      AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
                )
            )
            OR 
            current_setting('app.current_role', true) = 'Super_Admin'
        );