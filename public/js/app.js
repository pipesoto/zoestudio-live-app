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

function getColorOptions(product) {
  const options = new Set();

  const fromColorField = String(product.color || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  fromColorField.forEach((item) => options.add(item));

  if (Array.isArray(product.attributes_json)) {
    for (const attr of product.attributes_json) {
      const key = String(attr?.key || "").toLowerCase();
      if (key === "colores" || key === "color" || key === "colores") {
        String(attr?.value || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .forEach((item) => options.add(item));
      }
    }
  }

  return [...options];
}

function getDisplayAttributes(product) {
  const attrs = [];
  if (product.color) attrs.push({ key: "Color", value: product.color });
  if (product.quantity_label) attrs.push({ key: "Cantidad", value: product.quantity_label });
  if (Array.isArray(product.attributes_json)) {
    for (const item of product.attributes_json) {
      if (!item?.key || !item?.value) continue;
      attrs.push({ key: String(item.key), value: String(item.value) });
    }
  }
  return attrs.slice(0, 10);
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
      const attrs = getDisplayAttributes(product);
      const colorOptions = getColorOptions(product);
      const attrsHtml = attrs
        .map((item) => `<span class="rounded bg-zinc-100 px-2 py-1">${escapeHtml(item.key)}: ${escapeHtml(item.value)}</span>`)
        .join(" ");
      const safeImageUrl = escapeHtml(product.image_url);
      const colorSelectHtml =
        colorOptions.length > 1
          ? `<select id="color-select-${product.id}" class="mt-2 w-full rounded-lg border border-zinc-300 p-2 text-sm">
              ${colorOptions
                .map((color) => `<option value="${escapeHtml(color)}">${escapeHtml(color)}</option>`)
                .join("")}
            </select>`
          : "";
      const singleColorHtml =
        colorOptions.length === 1
          ? `<p class="mt-1 text-xs text-zinc-600">Color seleccionado: <span class="font-semibold">${escapeHtml(
              colorOptions[0]
            )}</span></p>`
          : "";
      return `
        <article class="rounded-2xl bg-white p-4 shadow-sm">
          <img src="${safeImageUrl}" alt="${safeName}" class="h-48 w-full rounded-xl object-cover" />
          <div class="mt-3">
            <p class="text-xs font-semibold text-zinc-500">${safeCode}</p>
            <h3 class="text-lg font-semibold">${safeName}</h3>
            ${attrs.length ? `<p class="mt-1 flex flex-wrap gap-1 text-xs text-zinc-600">${attrsHtml}</p>` : ""}
            <p class="mt-1 text-sm">Precio: <span class="font-bold">$ ${formatCLP(product.price)}</span></p>
            <p class="text-sm">Stock: <span class="font-semibold">${product.current_stock}</span></p>
            ${singleColorHtml}
            ${colorSelectHtml}
            <div class="mt-2">
              <label class="mb-1 block text-xs text-zinc-600">Cantidad</label>
              <input
                id="qty-input-${product.id}"
                type="number"
                min="1"
                max="${product.current_stock}"
                value="1"
                class="w-full rounded-lg border border-zinc-300 p-2 text-sm"
              />
            </div>
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

      const qtyInput = document.getElementById(`qty-input-${product.id}`);
      const qty = Number(qtyInput?.value || 1);
      if (!Number.isInteger(qty) || qty <= 0) {
        notify("Cantidad inválida.", true);
        return;
      }

      const colorOptions = getColorOptions(product);
      let selectedColor = "";
      if (colorOptions.length > 1) {
        const colorSelect = document.getElementById(`color-select-${product.id}`);
        selectedColor = String(colorSelect?.value || "").trim();
        if (!selectedColor) {
          notify("Selecciona un color.", true);
          return;
        }
      } else if (colorOptions.length === 1) {
        selectedColor = colorOptions[0];
      }

      const currentQty = order
        .filter((item) => item.productId === product.id)
        .reduce((sum, item) => sum + Number(item.qty || 0), 0);
      if (currentQty + qty > product.current_stock) {
        notify(`No puedes agregar ${qty} unidades de ${product.code}, stock disponible insuficiente.`, true);
        return;
      }

      order.push({ productId: product.id, qty, selectedColor });
      renderOrder();
      notify(
        `${product.code} agregado (${qty}${
          selectedColor ? `, ${selectedColor}` : ""
        }) a tu pedido.`
      );
    });
  });
}

function mergeOrderItems() {
  const merged = new Map();
  for (const item of order) {
    const key = `${item.productId}__${item.selectedColor || ""}`;
    const current = merged.get(key) || {
      productId: item.productId,
      qty: 0,
      selectedColor: item.selectedColor || ""
    };
    current.qty += Number(item.qty || 0);
    merged.set(key, current);
  }
  return [...merged.values()];
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
      const key = `${item.productId}__${item.selectedColor || ""}`;
      const encodedKey = encodeURIComponent(key);
      return `
        <div class="flex items-center justify-between rounded-lg border border-zinc-200 p-2">
          <p>
            ${escapeHtml(product.code)} - ${escapeHtml(product.name)} x${item.qty}
            ${item.selectedColor ? `<span class="ml-1 text-xs text-zinc-600">(${escapeHtml(item.selectedColor)})</span>` : ""}
          </p>
          <div class="flex items-center gap-3">
            <span class="font-semibold">$ ${formatCLP(line)}</span>
            <button data-remove-key="${encodedKey}" class="text-xs text-red-600 underline">Quitar</button>
          </div>
        </div>
      `;
    })
    .join("");
  orderTotal.textContent = `$ ${formatCLP(total)}`;

  document.querySelectorAll("[data-remove-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = decodeURIComponent(String(btn.dataset.removeKey || ""));
      const idx = order.findIndex((item) => `${item.productId}__${item.selectedColor || ""}` === key);
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
