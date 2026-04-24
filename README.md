# Zoe Studio - Stock en Vivo

Web app ligera para administrar y reservar productos durante transmisiones en vivo.

## Stack

- Backend: Node.js + Express
- Frontend: HTML + JavaScript + Tailwind (CDN)
- Base de datos: PostgreSQL

## Variables de entorno

Usa `.env.example` como base:

- `DATABASE_URL`: conexión PostgreSQL (Railway)
- `PORT`: puerto HTTP (Railway lo inyecta automáticamente)
- `ADMIN_TOKEN`: token privado para acceder al panel admin vía API
- `WHATSAPP_NUMBER`: número destino para `wa.me` (sin `+` ni espacios)

## Instalación

1. `npm install`
2. Crea `.env` desde `.env.example`
3. Ejecuta el schema:
   - `psql "$DATABASE_URL" -f schema.sql`
4. Inicia servidor:
   - `npm run dev` (local)
   - `npm start` (producción/Railway)

## Migraciones (bases ya existentes)

Si tu base ya tenía tablas creadas con `schema.sql` anterior, ejecuta:

- `psql "$DATABASE_URL" -f migration_campaigns.sql`

Esto agrega campañas y etiqueta pedidos históricos bajo la campaña `General`.

## Campañas y exportación

- Cada live se modela como una **campaña** en `/admin`.
- Solo puede existir **una campaña activa** a la vez.
- Cada reserva guarda `campaign_id` de la campaña activa en ese momento.
- Exporta CSV:
  - detalle de reservas
  - resumen agrupado por clienta + dirección (ideal para armar envíos)

## Rutas

- `/` -> catálogo público de clientas
- `/admin` -> panel privado (token manual en la interfaz)
- `/health` -> salud del servicio

## Endpoints admin (CSV)

- `GET /api/admin/export/orders.csv?campaignId=ID&day=YYYY-MM-DD`
- `GET /api/admin/export/customers-summary.csv?campaignId=ID&day=YYYY-MM-DD`

## Seguridad y concurrencia

- Consultas parametrizadas con `pg`
- Validación de entradas en backend
- `helmet` + CSP
- Reserva con transacción SQL `BEGIN/COMMIT` y bloqueo `FOR UPDATE` para evitar sobreventa
- Escape HTML en frontend para reducir riesgo XSS en renderizado dinámico
