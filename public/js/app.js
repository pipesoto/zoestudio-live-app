const productsGrid = document.getElementById("productsGrid");
const reserveModal = document.getElementById("reserveModal");
const reserveForm = document.getElementById("reserveForm");
const modalProductInfo = document.getElementById("modalProductInfo");
const customerNameInput = document.getElementById("customerName");
const addressInput = document.getElementById("address");
const statusBar = document.getElementById("statusBar");
const cancelBtn = document.getElementById("cancelBtn");
const whatsappFallback = document.getElementById("whatsappFallback");
const whatsappLink = document.getElementById("whatsappLink");
const orderItems = document.getElementById("orderItems");
const orderTotal = document.getElementById("orderTotal");
const checkoutBtn = document.getElementById("checkoutBtn");
const clearOrderBtn = document.getElementById("clearOrderBtn");

let products = [];
let order = [];

function isAppleMobile() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPad|iPod/i.test(ua);
}

function openWhatsAppUrl(url) {
  if (!url) return;

  if (isAppleMobile()) {
    window.location.assign(url);
    return;
  }

  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    if (whatsappLink && whatsappFallback) {
      whatsappLink.href = url;
      whatsappFallback.classList.remove("hidden");
    } else {
      window.location.assign(url);
    }
  }
}

function normalizeProduct(product) {
  return {
    ...product,
    id: Number(product.id)
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatCLP(value) {
  return new Intl.NumberFormat("es-CL").format(Number(value || 0));
}

function notify(message, warning = false) {
  statusBar.textContent = message;
  statusBar.classList.remove("hidden");
  statusBar.className = `mb-4 rounded-lg p-3 text-sm ${
    warning ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
  }`;
}

function renderProducts(list) {
  if (!Array.isArray(list) || list.length === 0) {
    productsGrid.innerHTML =
      '<p class="rounded-xl bg-white p-4 text-sm text-zinc-500 shadow-sm">No hay productos activos en este momento.</p>';
    return;
  }

  productsGrid.innerHTML = list
    .map((product) => {
      const soldOut = product.current_stock <= 0;
      const safeName = escapeHtml(product.name);
      const safeCode = escapeHtml(product.code);
      const safeImageUrl = escapeHtml(product.image_url);
      return `
        <article class="rounded-2xl bg-white p-4 shadow-sm">
          <img src="${safeImageUrl}" alt="${safeName}" class="h-48 w-full rounded-xl object-cover" />
          <div class="mt-3">
            <p class="text-xs font-semibold text-zinc-500">${safeCode}</p>
            <h3 class="text-lg font-semibold">${safeName}</h3>
            <p class="mt-1 text-sm">Precio: <span class="font-bold">$ ${formatCLP(product.price)}</span></p>
            <p class="text-sm">Stock: <span class="font-semibold">${product.current_stock}</span></p>
            <button data-id="${product.id}" class="reserve-btn mt-3 w-full rounded-lg py-2 font-medium ${
              soldOut ? "bg-zinc-300 text-zinc-600 cursor-not-allowed" : "bg-black text-white"
            }" ${soldOut ? "disabled" : ""}>
              ${soldOut ? "AGOTADO" : "Agregar"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".reserve-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const product = products.find((p) => p.id === id);
      if (!product || product.current_stock <= 0) return;

      const currentQty = order.filter((item) => item.productId === product.id).length;
      if (currentQty >= product.current_stock) {
        notify(`No puedes agregar más de ${product.code}, stock disponible alcanzado.`, true);
        return;
      }

      order.push({ productId: product.id, qty: 1 });
      renderOrder();
      notify(`${product.code} agregado a tu pedido.`);
    });
  });
}

function mergeOrderItems() {
  const merged = new Map();
  for (const item of order) {
    merged.set(item.productId, (merged.get(item.productId) || 0) + 1);
  }
  return [...merged.entries()].map(([productId, qty]) => ({ productId, qty }));
}

function pruneOrderByVisibleProducts() {
  const allowedIds = new Set(products.map((p) => p.id));
  const before = order.length;
  order = order.filter((item) => allowedIds.has(item.productId));
  if (order.length !== before) {
    notify("Algunos productos de tu pedido ya no están disponibles y fueron removidos.", true);
  }
}

function renderOrder() {
  const merged = mergeOrderItems();
  if (merged.length === 0) {
    orderItems.innerHTML = '<p class="text-zinc-500">Aún no agregas productos.</p>';
    orderTotal.textContent = "$ 0";
    return;
  }

  let total = 0;
  orderItems.innerHTML = merged
    .map((item) => {
      const product = products.find((p) => p.id === item.productId);
      if (!product) return "";
      const line = Number(product.price) * item.qty;
      total += line;
      return `
        <div class="flex items-center justify-between rounded-lg border border-zinc-200 p-2">
          <p>${escapeHtml(product.code)} - ${escapeHtml(product.name)} x${item.qty}</p>
          <div class="flex items-center gap-3">
            <span class="font-semibold">$ ${formatCLP(line)}</span>
            <button data-remove-id="${product.id}" class="text-xs text-red-600 underline">Quitar</button>
          </div>
        </div>
      `;
    })
    .join("");
  orderTotal.textContent = `$ ${formatCLP(total)}`;

  document.querySelectorAll("[data-remove-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const productId = Number(btn.dataset.removeId);
      const idx = order.findIndex((item) => item.productId === productId);
      if (idx >= 0) order.splice(idx, 1);
      renderOrder();
    });
  });
}

async function loadProducts() {
  const response = await fetch("/api/public/products");
  const data = await response.json();
  products = (data.products || []).map(normalizeProduct);
  pruneOrderByVisibleProducts();
  renderProducts(products);
  renderOrder();
}

cancelBtn.addEventListener("click", () => {
  reserveModal.classList.add("hidden");
  reserveModal.classList.remove("flex");
});

reserveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (order.length === 0) {
    notify("Tu pedido está vacío.", true);
    return;
  }

  const customerName = customerNameInput.value.trim();
  const address = addressInput.value.trim();
  if (customerName.length < 2 || address.length < 5) {
    notify("Ingresa nombre y dirección válidos.", true);
    return;
  }

  const response = await fetch("/api/public/reserve-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customerName,
      address,
      items: mergeOrderItems()
    })
  });
  const data = await response.json();

  if (!response.ok) {
    notify(data.error || "No se pudo reservar.", true);
    loadProducts();
    return;
  }

  notify("Pedido confirmado. Abriendo WhatsApp...");
  reserveModal.classList.add("hidden");
  reserveModal.classList.remove("flex");
  order = [];
  renderOrder();
  if (whatsappFallback) whatsappFallback.classList.add("hidden");
  openWhatsAppUrl(data.whatsappUrl);
});

checkoutBtn.addEventListener("click", () => {
  if (order.length === 0) {
    notify("Agrega productos antes de finalizar.", true);
    return;
  }
  reserveModal.classList.remove("hidden");
  reserveModal.classList.add("flex");
});

clearOrderBtn.addEventListener("click", () => {
  order = [];
  renderOrder();
});

function initRealtime() {
  const source = new EventSource("/api/public/stream");
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "stock") {
      products = (payload.products || []).map(normalizeProduct);
      pruneOrderByVisibleProducts();
      renderProducts(products);
      renderOrder();
    }
  };
  source.onerror = () => {
    notify("Reconectando actualizaciones en vivo...", true);
    source.close();
    setTimeout(initRealtime, 2500);
  };
}

loadProducts().catch(() => notify("No se pudo cargar el catálogo.", true));
initRealtime();
renderOrder();
