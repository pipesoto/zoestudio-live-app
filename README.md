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

## Rutas

- `/` -> catálogo público de clientas
- `/admin` -> panel privado (token manual en la interfaz)
- `/health` -> salud del servicio

## Seguridad y concurrencia

- Consultas parametrizadas con `pg`
- Validación de entradas en backend
- `helmet` + CSP
- Reserva con transacción SQL `BEGIN/COMMIT` y bloqueo `FOR UPDATE` para evitar sobreventa
- Escape HTML en frontend para reducir riesgo XSS en renderizado dinámico
