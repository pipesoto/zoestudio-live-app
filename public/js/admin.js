const tokenInput = document.getElementById("adminToken");
const saveTokenBtn = document.getElementById("saveTokenBtn");
const productForm = document.getElementById("productForm");
const productsTbody = document.getElementById("productsTbody");
const ordersTbody = document.getElementById("ordersTbody");
const adminMessage = document.getElementById("adminMessage");

let adminToken = localStorage.getItem("zoe_admin_token") || "";

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

function renderProducts(products) {
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
}

function renderOrders(orders) {
  ordersTbody.innerHTML = orders
    .map((o) => {
      const safeProductCode = escapeHtml(o.product_code);
      const safeProductName = escapeHtml(o.product_name);
      const safeCustomerName = escapeHtml(o.customer_name);
      const safeDistrict = escapeHtml(o.district);
      return `
      <tr class="border-b border-zinc-100">
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

loadSnapshot().catch((error) => showMessage(error.message, true));
