
-- User POLICY

CREATE POLICY "tenant_admin_info" ON "User"
FOR SELECT
USING (
    EXISTS (
        SELECT 1
        FROM "Tenant" t
        WHERE t."userId" = "User"."id"
    )
);
