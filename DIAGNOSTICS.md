# Diagnósticos del Proyecto

Registro de métricas y estado de infraestructura. Actualizar manualmente con cada revisión.

---

## Plan gratuito de Supabase — Límites

| Recurso | Límite gratuito | Notas |
|---|---|---|
| **DB storage** | 500 MB | Postgres + índices |
| **File storage** | 1 GB | Archivos en buckets |
| **Bandwidth** | 5 GB / mes | Egress total (DB + storage + API) |
| **Auth users** | 50.000 | Usuarios registrados |
| **Edge Functions** | 500.000 invocaciones / mes | — |
| **Realtime** | 200 conexiones concurrentes | — |
| **Proyectos activos** | 2 | Pausados no cuentan |
| **Pausa por inactividad** | 7 días sin actividad | Se reactiva manualmente |

---

## 2026-05-29

### Supabase — Uso actual

| Recurso | Usado | Límite | % |
|---|---|---|---|
| **DB storage** | 27.3 MB | 500 MB | 5.5% |
| **File storage** | 11.8 MB (34 archivos) | 1 GB | 1.2% |
| **Auth users** | 3 | 50.000 | < 0.1% |

**Top tablas (DB):**

| Tabla | Tamaño |
|---|---|
| `public.ventas` | 10.2 MB |
| `public.detalle_compras` | 3.4 MB |
| `public.compras` | 1.7 MB |
| `public.proveedores` | 424 KB |
| `auth.users` | 248 KB |
| `public.articulos` | 240 KB |
| `storage.objects` | 176 KB |
| resto | < 160 KB c/u |

**Estado:** Sin riesgo en ningún recurso. Bandwidth y Edge Functions no medibles desde SQL — revisar en el [dashboard](https://supabase.com/dashboard/project/agykidgtdmkoplimjqrp/settings/billing).

---

<!-- TEMPLATE para próximas entradas:

## YYYY-MM-DD

### Supabase — Uso actual

| Recurso | Usado | Límite | % |
|---|---|---|---|
| **DB storage** | X MB | 500 MB | X% |
| **File storage** | X MB (N archivos) | 1 GB | X% |
| **Auth users** | N | 50.000 | X% |

**Top tablas (DB):** ...

**Estado:** ...

-->
