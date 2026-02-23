
CREATE POLICY "property_insert_policy" ON "Property"
    FOR INSERT
    WITH CHECK (
        current_setting('app.current_role', true)::text = 'Admin' 
        AND
        "tenantId" = current_setting('app.current_tenant_id', true)::text
    );