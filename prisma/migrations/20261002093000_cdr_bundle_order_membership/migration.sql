-- Bound per-order latest-package lookups without returning full manifests.
CREATE INDEX "DesignBundle_orderIds_idx" ON "DesignBundle" USING GIN ("orderIds");
