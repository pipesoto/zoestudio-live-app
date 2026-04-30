require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const pool = require("./db");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || "";

if (!ADMIN_TOKEN) {
  throw new Error("Falta ADMIN_TOKEN en variables de entorno");
}

if (!WHATSAPP_NUMBER) {
  throw new Error("Falta WHATSAPP_NUMBER en variables de entorno");
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.tailwindcss.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"]
      }
    }
  })
);
app.use(express.json({ limit: "40kb" }));
app.use(express.static("public"));

app.get("/admin", (req, res) => {
  res.sendFile("admin.html", { root: "public" });
});

const sseClients = new Set();

function normalizeText(value, maxLen) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLen);
}

function isPositiveInt(value) {
  return Number.isInteger(value) && value >= 0;
}

function isSafeProductCode(code) {
  return /^[A-Za-z0-9_-]{1,20}$/.test(code);
}

function isValidImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeAttributes(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const item of raw) {
    const key = normalizeText(item?.key, 40);
    const value = normalizeText(item?.value, 100);
    if (!key || !value) continue;
    cleaned.push({ key, value });
  }
  return cleaned.slice(0, 12);
}

function requireAdmin(req, res, next) {
  const token = req.header("x-admin-token");
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

async function fetchCampaigns() {
  const result = await pool.query(
    `SELECT id, name, is_active, created_at
     FROM campaigns
     ORDER BY id DESC`
  );
  return result.rows;
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function buildCsv(rows, columns) {
  const header = columns.map((col) => csvEscape(col.header)).join(",");
  const lines = rows.map((row) => columns.map((col) => csvEscape(col.value(row))).join(","));
  return `${header}\n${lines.join("\n")}\n`;
}

async function fetchAdminSnapshot() {
  const [productsResult, ordersResult, campaignsResult] = await Promise.all([
    pool.query(
      `SELECT id, code, name, color, quantity_label, attributes_json, price, initial_stock, current_stock, image_url, is_active, created_at, updated_at
       FROM products
       ORDER BY id DESC`
    ),
    pool.query(
      `SELECT o.id, o.campaign_id, o.product_id, o.product_code, o.customer_name, o.district, o.reserved_price, o.created_at,
              p.name AS product_name,
              c.name AS campaign_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN campaigns c ON c.id = o.campaign_id
       ORDER BY o.created_at DESC
       LIMIT 150`
    ),
    fetchCampaigns()
  ]);

  return {
    products: productsResult.rows,
    orders: ordersResult.rows,
    campaigns: campaignsResult
  };
}

async function fetchPublicProducts() {
  const result = await pool.query(
    `SELECT id, code, name, color, quantity_label, attributes_json, price, current_stock, image_url
     FROM products
     WHERE is_active = TRUE
     ORDER BY id DESC`
  );
  return result.rows;
}

async function broadcastStock() {
  if (sseClients.size === 0) return;
  const publicProducts = await fetchPublicProducts();
  const payload = `data: ${JSON.stringify({ type: "stock", products: publicProducts })}\n\n`;
  for (const client of sseClients) client.write(payload);
}

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error: "db_unreachable" });
  }
});

app.get("/api/public/products", async (req, res) => {
  try {
    const products = await fetchPublicProducts();
    res.json({ products });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error cargando productos" });
  }
});

app.get("/api/public/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  sseClients.add(res);
  const products = await fetchPublicProducts();
  res.write(`data: ${JSON.stringify({ type: "stock", products })}\n\n`);

  const heartbeat = setInterval(() => {
    res.write("event: ping\ndata: {}\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

app.post("/api/public/reserve", async (req, res) => {
  const productId = Number(req.body?.productId);
  const customerName = normalizeText(req.body?.customerName, 120);
  const address = normalizeText(req.body?.address || req.body?.district, 180);

  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "Producto inválido" });
  }
  if (!customerName || customerName.length < 2) {
    return res.status(400).json({ error: "Nombre inválido" });
  }
  if (!address || address.length < 5) {
    return res.status(400).json({ error: "Dirección inválida" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const campaignResult = await client.query(
      `SELECT id
       FROM campaigns
       WHERE is_active = TRUE
       LIMIT 1
       FOR UPDATE`
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No hay campaña activa. Activa una campaña en el panel admin." });
    }

    const productResult = await client.query(
      `SELECT id, code, name, price, current_stock, is_active
       FROM products
       WHERE id = $1
       FOR UPDATE`,
      [productId]
    );

    const product = productResult.rows[0];
    if (!product || !product.is_active) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Producto no disponible" });
    }

    if (product.current_stock <= 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "AGOTADO" });
    }

    await client.query(
      `UPDATE products
       SET current_stock = current_stock - 1, updated_at = NOW()
       WHERE id = $1`,
      [product.id]
    );

    await client.query(
      `INSERT INTO orders (campaign_id, product_id, product_code, customer_name, district, reserved_price)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [campaign.id, product.id, product.code, customerName, address, product.price]
    );
    await client.query("COMMIT");

    const text = `Hola Zoe Studio, soy ${customerName}, reservé el producto ${product.code} para la dirección ${address}. Envíame los datos para pagar $ ${product.price}`;
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
    await broadcastStock();
    return res.json({ ok: true, whatsappUrl });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: "No se pudo completar la reserva" });
  } finally {
    client.release();
  }
});

app.post("/api/public/reserve-batch", async (req, res) => {
  const customerName = normalizeText(req.body?.customerName, 120);
  const address = normalizeText(req.body?.address, 180);
  const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];

  if (!customerName || customerName.length < 2) {
    return res.status(400).json({ error: "Nombre inválido" });
  }
  if (!address || address.length < 5) {
    return res.status(400).json({ error: "Dirección inválida" });
  }
  if (rawItems.length === 0) {
    return res.status(400).json({ error: "Debes agregar al menos un producto." });
  }
  if (rawItems.length > 80) {
    return res.status(400).json({ error: "Demasiados productos en el pedido." });
  }

  const quantities = new Map();
  for (const item of rawItems) {
    const productId = Number(item?.productId);
    const qty = Number(item?.qty || 1);
    if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(qty) || qty <= 0 || qty > 20) {
      return res.status(400).json({ error: "Productos inválidos en el pedido." });
    }
    quantities.set(productId, (quantities.get(productId) || 0) + qty);
  }

  const productIds = [...quantities.keys()];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const campaignResult = await client.query(
      `SELECT id
       FROM campaigns
       WHERE is_active = TRUE
       LIMIT 1
       FOR UPDATE`
    );
    const campaign = campaignResult.rows[0];
    if (!campaign) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "No hay campaña activa. Activa una campaña en el panel admin." });
    }

    const productResult = await client.query(
      `SELECT id, code, name, price, current_stock, is_active
       FROM products
       WHERE id = ANY($1::bigint[])
       FOR UPDATE`,
      [productIds]
    );

    if (productResult.rowCount !== productIds.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Uno o más productos ya no están disponibles." });
    }

    const productById = new Map(productResult.rows.map((row) => [Number(row.id), row]));
    for (const [productId, qty] of quantities.entries()) {
      const product = productById.get(productId);
      if (!product || !product.is_active) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: "Hay productos ocultos o no disponibles en tu pedido." });
      }
      if (Number(product.current_stock) < qty) {
        await client.query("ROLLBACK");
        return res.status(409).json({ error: `Stock insuficiente para ${product.code}.` });
      }
    }

    let total = 0;
    const summaryLines = [];
    for (const [productId, qty] of quantities.entries()) {
      const product = productById.get(productId);
      await client.query(
        `UPDATE products
         SET current_stock = current_stock - $1, updated_at = NOW()
         WHERE id = $2`,
        [qty, productId]
      );

      for (let i = 0; i < qty; i += 1) {
        await client.query(
          `INSERT INTO orders (campaign_id, product_id, product_code, customer_name, district, reserved_price)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [campaign.id, product.id, product.code, customerName, address, product.price]
        );
      }

      const lineTotal = Number(product.price) * qty;
      total += lineTotal;
      summaryLines.push(`- ${product.code} ${product.name} x${qty} ($ ${lineTotal})`);
    }

    await client.query("COMMIT");

    const text =
      `Hola Zoe Studio, soy ${customerName}. Reservé en el live:\n` +
      `${summaryLines.join("\n")}\n` +
      `Total: $ ${total}\n` +
      `Dirección: ${address}\n` +
      "Envíame los datos para pagar.";
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
    await broadcastStock();
    return res.json({ ok: true, whatsappUrl });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    return res.status(500).json({ error: "No se pudo completar el pedido" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/snapshot", requireAdmin, async (req, res) => {
  try {
    const snapshot = await fetchAdminSnapshot();
    res.json(snapshot);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cargar panel admin" });
  }
});

app.post("/api/admin/products", requireAdmin, async (req, res) => {
  const code = normalizeText(req.body?.code, 20);
  const name = normalizeText(req.body?.name, 120);
  const color = normalizeText(req.body?.color, 60);
  const quantityLabel = normalizeText(req.body?.quantityLabel, 80);
  const attributes = normalizeAttributes(req.body?.attributes);
  const price = Number(req.body?.price);
  const initialStock = Number(req.body?.initialStock);
  const imageUrl = normalizeText(req.body?.imageUrl, 500);

  if (!isSafeProductCode(code)) {
    return res.status(400).json({ error: "Código inválido. Usa letras, números, - o _." });
  }
  if (!name || name.length < 3) {
    return res.status(400).json({ error: "Nombre inválido" });
  }
  if (!isPositiveInt(price)) {
    return res.status(400).json({ error: "Precio inválido" });
  }
  if (!isPositiveInt(initialStock)) {
    return res.status(400).json({ error: "Stock inicial inválido" });
  }
  if (!isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: "URL de imagen inválida" });
  }

  try {
    await pool.query(
      `INSERT INTO products (code, name, color, quantity_label, attributes_json, price, initial_stock, current_stock, image_url)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $7, $8)`,
      [code.toUpperCase(), name, color, quantityLabel, JSON.stringify(attributes), price, initialStock, imageUrl]
    );
    const snapshot = await fetchAdminSnapshot();
    await broadcastStock();
    res.status(201).json(snapshot);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El código ya existe" });
    }
    console.error(error);
    res.status(500).json({ error: "No se pudo crear el producto" });
  }
});

app.patch("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  const code = normalizeText(req.body?.code, 20);
  const name = normalizeText(req.body?.name, 120);
  const color = normalizeText(req.body?.color, 60);
  const quantityLabel = normalizeText(req.body?.quantityLabel, 80);
  const attributes = normalizeAttributes(req.body?.attributes);
  const price = Number(req.body?.price);
  const imageUrl = normalizeText(req.body?.imageUrl, 500);
  const initialStock = Number(req.body?.initialStock);
  const currentStock = Number(req.body?.currentStock);

  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }
  if (!isSafeProductCode(code)) {
    return res.status(400).json({ error: "Código inválido. Usa letras, números, - o _." });
  }
  if (!name || name.length < 3) {
    return res.status(400).json({ error: "Nombre inválido" });
  }
  if (!isPositiveInt(price)) {
    return res.status(400).json({ error: "Precio inválido" });
  }
  if (!isValidImageUrl(imageUrl)) {
    return res.status(400).json({ error: "URL de imagen inválida" });
  }
  if (!isPositiveInt(initialStock)) {
    return res.status(400).json({ error: "Stock inicial inválido" });
  }
  if (!isPositiveInt(currentStock)) {
    return res.status(400).json({ error: "Stock actual inválido" });
  }
  if (currentStock > initialStock) {
    return res.status(400).json({ error: "Stock actual no puede ser mayor al stock inicial" });
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET code = $1, name = $2, color = $3, quantity_label = $4, attributes_json = $5::jsonb, price = $6, image_url = $7,
           initial_stock = $8, current_stock = $9, updated_at = NOW()
       WHERE id = $10
       RETURNING id`,
      [
        code.toUpperCase(),
        name,
        color,
        quantityLabel,
        JSON.stringify(attributes),
        price,
        imageUrl,
        initialStock,
        currentStock,
        productId
      ]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    const snapshot = await fetchAdminSnapshot();
    await broadcastStock();
    return res.json(snapshot);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "El código ya existe" });
    }
    console.error(error);
    return res.status(500).json({ error: "No se pudo editar el producto" });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const result = await pool.query(`DELETE FROM products WHERE id = $1`, [productId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    const snapshot = await fetchAdminSnapshot();
    await broadcastStock();
    return res.json(snapshot);
  } catch (error) {
    if (error.code === "23503") {
      return res
        .status(409)
        .json({ error: "No se puede eliminar: este producto ya tiene reservas asociadas." });
    }
    console.error(error);
    return res.status(500).json({ error: "No se pudo eliminar el producto" });
  }
});

app.patch("/api/admin/products/:id/toggle", requireAdmin, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }

  try {
    const result = await pool.query(
      `UPDATE products
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [productId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Producto no encontrado" });
    }
    const snapshot = await fetchAdminSnapshot();
    await broadcastStock();
    res.json(snapshot);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo actualizar estado" });
  }
});

app.get("/api/admin/campaigns", requireAdmin, async (req, res) => {
  try {
    const campaigns = await fetchCampaigns();
    res.json({ campaigns });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo cargar campañas" });
  }
});

app.post("/api/admin/campaigns", requireAdmin, async (req, res) => {
  const name = normalizeText(req.body?.name, 160);
  if (!name || name.length < 3) {
    return res.status(400).json({ error: "Nombre de campaña inválido" });
  }

  try {
    await pool.query(`INSERT INTO campaigns (name, is_active) VALUES ($1, FALSE)`, [name]);
    const snapshot = await fetchAdminSnapshot();
    res.status(201).json(snapshot);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "No se pudo crear la campaña" });
  }
});

app.patch("/api/admin/campaigns/:id/activate", requireAdmin, async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).json({ error: "ID inválido" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query(`SELECT id FROM campaigns WHERE id = $1 FOR UPDATE`, [campaignId]);
    if (exists.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Campaña no encontrada" });
    }
    await client.query(`UPDATE campaigns SET is_active = FALSE`);
    await client.query(`UPDATE campaigns SET is_active = TRUE WHERE id = $1`, [campaignId]);
    await client.query("COMMIT");

    const snapshot = await fetchAdminSnapshot();
    res.json(snapshot);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "No se pudo activar la campaña" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/export/orders.csv", requireAdmin, async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;

  if (!campaignId || !Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).send("campaignId es obligatorio para exportar");
  }

  const whereClause = `WHERE o.campaign_id = $1`;
  const params = [campaignId];

  try {
    const result = await pool.query(
      `SELECT o.id, o.created_at, c.name AS campaign_name, o.product_code, p.name AS product_name,
              p.color AS product_color, p.quantity_label AS product_quantity_label,
              p.attributes_json AS product_attributes,
              o.customer_name, o.district, o.reserved_price
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN campaigns c ON c.id = o.campaign_id
       ${whereClause}
       ORDER BY o.created_at ASC`,
      params
    );

    const csv = buildCsv(result.rows, [
      { header: "id", value: (row) => row.id },
      { header: "fecha_hora_utc", value: (row) => new Date(row.created_at).toISOString() },
      { header: "campaña", value: (row) => row.campaign_name },
      { header: "codigo_producto", value: (row) => row.product_code },
      { header: "nombre_producto", value: (row) => row.product_name },
      { header: "color", value: (row) => row.product_color || "" },
      { header: "cantidad", value: (row) => row.product_quantity_label || "" },
      {
        header: "propiedades",
        value: (row) =>
          Array.isArray(row.product_attributes)
            ? row.product_attributes
                .map((item) => `${item?.key || ""}: ${item?.value || ""}`)
                .filter(Boolean)
                .join(" | ")
            : ""
      },
      { header: "clienta", value: (row) => row.customer_name },
      { header: "direccion", value: (row) => row.district },
      { header: "precio_reservado", value: (row) => row.reserved_price }
    ]);

    const suffixParts = [];
    suffixParts.push(`campana-${campaignId}`);
    const suffix = `-${suffixParts.join("-")}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="reservas${suffix}.csv"`);
    res.send(`\ufeff${csv}`);
  } catch (error) {
    console.error(error);
    res.status(500).send("No se pudo exportar CSV");
  }
});

app.get("/api/admin/export/customers-summary.csv", requireAdmin, async (req, res) => {
  const campaignId = req.query.campaignId ? Number(req.query.campaignId) : null;

  if (!campaignId || !Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).send("campaignId es obligatorio para el resumen");
  }

  const conditions = [`o.campaign_id = $1`];
  const params = [campaignId];

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  try {
    const result = await pool.query(
      `SELECT o.customer_name,
              o.district,
              COUNT(*)::int AS reservas,
              SUM(o.reserved_price)::bigint AS total,
              STRING_AGG(
                o.product_code || ' ' || p.name ||
                CASE WHEN p.color <> '' THEN ' (' || p.color || ')' ELSE '' END ||
                CASE WHEN p.quantity_label <> '' THEN ' [' || p.quantity_label || ']' ELSE '' END,
                ' | ' ORDER BY o.created_at
              ) AS productos
       FROM orders o
       JOIN products p ON p.id = o.product_id
       ${whereClause}
       GROUP BY o.customer_name, o.district
       ORDER BY MIN(o.created_at) ASC`,
      params
    );

    const csv = buildCsv(result.rows, [
      { header: "clienta", value: (row) => row.customer_name },
      { header: "direccion", value: (row) => row.district },
      { header: "reservas", value: (row) => row.reservas },
      { header: "total", value: (row) => row.total },
      { header: "productos", value: (row) => row.productos }
    ]);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="resumen-clientas-campana-${campaignId}.csv"`
    );
    res.send(`\ufeff${csv}`);
  } catch (error) {
    console.error(error);
    res.status(500).send("No se pudo exportar resumen");
  }
});

app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
