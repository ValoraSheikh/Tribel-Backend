ALTER TABLE "RoomTemplate" FORCE ROW LEVEL SECURITY;

CREATE POLICY "RoomTemplate_read_policy" ON "RoomTemplate"
    FOR SELECT
    USING (true);

CREATE POLICY "RoomTemplate_modify_policy" ON "RoomTemplate"
    FOR ALL
    USING (
        current_setting('app.current_role', true)::text = 'Super_Admin'
        OR
        (
            current_setting('app.current_role', true)::text = 'Admin' 
            AND EXISTS (
                SELECT 1 
                FROM "Property" p
                WHERE p."id" = "RoomTemplate"."propertyId"
                AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
            )
        )
    )
    WITH CHECK (
        current_setting('app.current_role', true)::text = 'Super_Admin'
        OR
        (
            current_setting('app.current_role', true)::text = 'Admin' 
            AND EXISTS (
                SELECT 1 
                FROM "Property" p
                WHERE p."id" = "RoomTemplate"."propertyId"
                AND p."tenantId" = current_setting('app.current_tenant_id', true)::text
            )
        )
    );