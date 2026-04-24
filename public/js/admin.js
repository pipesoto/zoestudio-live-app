const tokenInput = document.getElementById("adminToken");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const productForm = document.getElementById("productForm");
const productsTbody = document.getElementById("productsTbody");
const ordersTbody = document.getElementById("ordersTbody");
const adminMessage = document.getElementById("adminMessage");
const campaignNameInput = document.getElementById("campaignName");
const createCampaignBtn = document.getElementById("createCampaignBtn");
const campaignSelect = document.getElementById("campaignSelect");
const activateCampaignBtn = document.getElementById("activateCampaignBtn");
const exportDayInput = document.getElementById("exportDay");
const exportOrdersBtn = document.getElementById("exportOrdersBtn");
const exportSummaryBtn = document.getElementById("exportSummaryBtn");

let adminToken = localStorage.getItem("zoe_admin_token") || "";
let cachedProducts = [];
let cachedCampaigns = [];

function normalizeProduct(product) {
  return {
    ...product,
    id: Number(product.id)
  };
}

if (adminToken) tokenInput.value = adminToken;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.remove("hidden");
  adminMessage.className = `mt-4 rounded-lg p-3 text-sm ${
    isError ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
  }`;
}

function formatCLP(value) {
  return new Intl.NumberFormat("es-CL").format(Number(value || 0));
}

function adminFetch(path, options = {}) {
  if (!adminToken) throw new Error("Debes ingresar ADMIN_TOKEN");
  const headers = {
    ...(options.headers || {}),
    "x-admin-token": adminToken
  };
  return fetch(path, { ...options, headers });
}

function normalizeCampaign(campaign) {
  return {
    ...campaign,
    id: Number(campaign.id)
  };
}

function renderCampaignControls(campaigns) {
  if (!campaignSelect) return;
  cachedCampaigns = (campaigns || []).map(normalizeCampaign);

  const previousSelection = campaignSelect.value;
  campaignSelect.innerHTML = cachedCampaigns
    .map((campaign) => {
      const label = `${campaign.name} (#${campaign.id})${campaign.is_active ? " · ACTIVA" : ""}`;
      return `<option value="${campaign.id}">${escapeHtml(label)}</option>`;
    })
    .join("");

  const stillExists = cachedCampaigns.some((campaign) => String(campaign.id) === previousSelection);
  if (stillExists) {
    campaignSelect.value = previousSelection;
    return;
  }

  const active = cachedCampaigns.find((campaign) => campaign.is_active);
  if (active) {
    campaignSelect.value = String(active.id);
  }
}

async function downloadCsv(path) {
  const response = await adminFetch(path);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "No se pudo descargar el archivo");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "export.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderProducts(products) {
  cachedProducts = products.map(normalizeProduct);
  productsTbody.innerHTML = products
    .map((p) => {
      const safeCode = escapeHtml(p.code);
      const safeName = escapeHtml(p.name);
      return `
      <tr class="border-b border-zinc-100">
        <td class="py-2 pr-2 font-semibold">${safeCode}</td>
        <td class="py-2 pr-2">${safeName}</td>
        <td class="py-2 pr-2">$ ${formatCLP(p.price)}</td>
        <td class="py-2 pr-2">${p.current_stock} / ${p.initial_stock}</td>
        <td class="py-2 pr-2">
          <button data-id="${p.id}" class="toggle-btn rounded-full px-3 py-1 text-xs ${
            p.is_active ? "bg-emerald-200 text-emerald-900" : "bg-zinc-200 text-zinc-700"
          }">
            ${p.is_active ? "Publicado" : "Oculto"}
          </button>
        </td>
        <td class="py-2 pr-2">
          <div class="flex gap-2">
            <button
              data-id="${p.id}"
              class="edit-btn rounded-lg bg-blue-100 px-2.5 py-1 text-xs text-blue-800"
            >
              Editar
            </button>
            <button data-id="${p.id}" class="delete-btn rounded-lg bg-red-100 px-2.5 py-1 text-xs text-red-700">
              Eliminar
            </button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  document.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      try {
        const response = await adminFetch(`/api/admin/products/${id}/toggle`, { method: "PATCH" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Error al cambiar estado");
        renderSnapshot(data);
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const product = cachedProducts.find((item) => item.id === id);
      if (!product) {
        showMessage("No se encontró el producto seleccionado.", true);
        return;
      }

      const currentCode = product.code || "";
      const currentName = product.name || "";
      const currentPrice = product.price || "";
      const currentImageUrl = product.image_url || "";
      const currentInitialStock = product.initial_stock ?? 0;
      const currentCurrentStock = product.current_stock ?? 0;

      const code = prompt("Código del producto", currentCode);
      if (code === null) return;
      const name = prompt("Nombre del producto", currentName);
      if (name === null) return;
      const priceValue = prompt("Precio (solo número)", String(currentPrice));
      if (priceValue === null) return;
      const imageUrl = prompt("URL de imagen", currentImageUrl);
      if (imageUrl === null) return;
      const initialStockValue = prompt("Stock inicial", String(currentInitialStock));
      if (initialStockValue === null) return;
      const currentStockValue = prompt("Stock actual", String(currentCurrentStock));
      if (currentStockValue === null) return;

      try {
        const response = await adminFetch(`/api/admin/products/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: code.trim(),
            name: name.trim(),
            price: Number(priceValue),
            imageUrl: imageUrl.trim(),
            initialStock: Number(initialStockValue),
            currentStock: Number(currentStockValue)
          })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo editar producto");
        renderSnapshot(data);
        showMessage("Producto editado correctamente.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });

  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const confirmed = confirm("¿Eliminar este producto? Esta acción no se puede deshacer.");
      if (!confirmed) return;

      try {
        const response = await adminFetch(`/api/admin/products/${id}`, {
          method: "DELETE"
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudo eliminar producto");
        renderSnapshot(data);
        showMessage("Producto eliminado correctamente.");
      } catch (error) {
        showMessage(error.message, true);
      }
    });
  });
}

function renderOrders(orders) {
  ordersTbody.innerHTML = orders
    .map((o) => {
      const safeCampaignName = escapeHtml(o.campaign_name || "");
      const safeProductCode = escapeHtml(o.product_code);
      const safeProductName = escapeHtml(o.product_name);
      const safeCustomerName = escapeHtml(o.customer_name);
      const safeDistrict = escapeHtml(o.district);
      return `
      <tr class="border-b border-zinc-100">
        <td class="py-2 pr-2">${safeCampaignName}</td>
        <td class="py-2 pr-2">${new Date(o.created_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}</td>
        <td class="py-2 pr-2">${safeProductCode} - ${safeProductName}</td>
        <td class="py-2 pr-2">${safeCustomerName}</td>
        <td class="py-2 pr-2">${safeDistrict}</td>
        <td class="py-2 pr-2">$ ${formatCLP(o.reserved_price)}</td>
      </tr>`;
    })
    .join("");
}

function renderSnapshot(snapshot) {
  renderProducts(snapshot.products || []);
  renderOrders(snapshot.orders || []);
  renderCampaignControls(snapshot.campaigns || cachedCampaigns);
}

async function loadSnapshot() {
  const response = await adminFetch("/api/admin/snapshot");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "No se pudo cargar panel");
  renderSnapshot(data);
}

saveTokenBtn.addEventListener("click", () => {
  adminToken = tokenInput.value.trim();
  localStorage.setItem("zoe_admin_token", adminToken);
  showMessage("Token guardado.");
  loadSnapshot().catch((error) => showMessage(error.message, true));
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    code: document.getElementById("code").value.trim(),
    name: document.getElementById("name").value.trim(),
    price: Number(document.getElementById("price").value),
    initialStock: Number(document.getElementById("initialStock").value),
    imageUrl: document.getElementById("imageUrl").value.trim()
  };

  try {
    const response = await adminFetch("/api/admin/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo crear producto");
    renderSnapshot(data);
    productForm.reset();
    showMessage("Producto agregado correctamente.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

createCampaignBtn?.addEventListener("click", async () => {
  const name = campaignNameInput.value.trim();
  if (name.length < 3) {
    showMessage("Nombre de campaña demasiado corto.", true);
    return;
  }

  try {
    const response = await adminFetch("/api/admin/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo crear campaña");
    campaignNameInput.value = "";
    renderSnapshot(data);
    showMessage("Campaña creada. Actívala antes del live.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

activateCampaignBtn?.addEventListener("click", async () => {
  const campaignId = Number(campaignSelect.value);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    showMessage("Selecciona una campaña válida.", true);
    return;
  }

  try {
    const response = await adminFetch(`/api/admin/campaigns/${campaignId}/activate`, { method: "PATCH" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "No se pudo activar campaña");
    renderSnapshot(data);
    showMessage("Campaña activada.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

exportOrdersBtn?.addEventListener("click", async () => {
  const campaignId = Number(campaignSelect.value);
  const day = exportDayInput.value;
  const params = new URLSearchParams();
  if (Number.isInteger(campaignId) && campaignId > 0) params.set("campaignId", String(campaignId));
  if (day) params.set("day", day);

  try {
    await downloadCsv(`/api/admin/export/orders.csv?${params.toString()}`);
    showMessage("CSV descargado.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

exportSummaryBtn?.addEventListener("click", async () => {
  const campaignId = Number(campaignSelect.value);
  const day = exportDayInput.value;
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    showMessage("Selecciona una campaña para el resumen.", true);
    return;
  }

  const params = new URLSearchParams({ campaignId: String(campaignId) });
  if (day) params.set("day", day);

  try {
    await downloadCsv(`/api/admin/export/customers-summary.csv?${params.toString()}`);
    showMessage("Resumen descargado.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

loadSnapshot().catch((error) => showMessage(error.message, true));
