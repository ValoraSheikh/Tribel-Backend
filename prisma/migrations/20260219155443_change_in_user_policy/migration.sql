DROP POLICY IF EXISTS "user_select_tenant_admin" ON "User";

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
        OR
        current_setting('app.current_role', true)::text = 'Super_Admin'
    );

