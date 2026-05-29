-- Enable RLS on all Prisma-managed tables.
-- Policy: authenticated users have full access (internal app, no per-row tenant isolation needed).

-- locales
ALTER TABLE locales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON locales FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- puntos_de_venta
ALTER TABLE puntos_de_venta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON puntos_de_venta FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- rubros_concepto_caja
ALTER TABLE rubros_concepto_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON rubros_concepto_caja FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- conceptos_caja
ALTER TABLE conceptos_caja ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON conceptos_caja FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- rubros_articulo
ALTER TABLE rubros_articulo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON rubros_articulo FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- subrubros_articulo
ALTER TABLE subrubros_articulo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON subrubros_articulo FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- articulos
ALTER TABLE articulos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON articulos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- proveedores
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON proveedores FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- compras
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON compras FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- detalle_compras
ALTER TABLE detalle_compras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON detalle_compras FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ventas
ALTER TABLE ventas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_full_access" ON ventas FOR ALL TO authenticated USING (true) WITH CHECK (true);
