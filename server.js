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

function requireAdmin(req, res, next) {
  const token = req.header("x-admin-token");
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

async function fetchAdminSnapshot() {
  const [productsResult, ordersResult] = await Promise.all([
    pool.query(
      `SELECT id, code, name, price, initial_stock, current_stock, image_url, is_active, created_at, updated_at
       FROM products
       ORDER BY id DESC`
    ),
    pool.query(
      `SELECT o.id, o.product_id, o.product_code, o.customer_name, o.district, o.reserved_price, o.created_at,
              p.name AS product_name
       FROM orders o
       JOIN products p ON p.id = o.product_id
       ORDER BY o.created_at DESC
       LIMIT 150`
    )
  ]);

  return {
    products: productsResult.rows,
    orders: ordersResult.rows
  };
}

async function fetchPublicProducts() {
  const result = await pool.query(
    `SELECT id, code, name, price, current_stock, image_url
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
      `INSERT INTO orders (product_id, product_code, customer_name, district, reserved_price)
       VALUES ($1, $2, $3, $4, $5)`,
      [product.id, product.code, customerName, address, product.price]
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
      `INSERT INTO products (code, name, price, initial_stock, current_stock, image_url)
       VALUES ($1, $2, $3, $4, $4, $5)`,
      [code.toUpperCase(), name, price, initialStock, imageUrl]
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
       SET code = $1, name = $2, price = $3, image_url = $4,
           initial_stock = $5, current_stock = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id`,
      [code.toUpperCase(), name, price, imageUrl, initialStock, currentStock, productId]
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

app.listen(PORT, () => {
  console.log(`Servidor iniciado en puerto ${PORT}`);
});
