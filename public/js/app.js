const productsGrid = document.getElementById("productsGrid");
const reserveModal = document.getElementById("reserveModal");
const reserveForm = document.getElementById("reserveForm");
const modalProductInfo = document.getElementById("modalProductInfo");
const customerNameInput = document.getElementById("customerName");
const districtInput = document.getElementById("district");
const statusBar = document.getElementById("statusBar");
const cancelBtn = document.getElementById("cancelBtn");

let selectedProduct = null;
let products = [];

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
              ${soldOut ? "AGOTADO" : "Reservar"}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".reserve-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      selectedProduct = products.find((p) => p.id === id);
      if (!selectedProduct) return;
      modalProductInfo.textContent = `${selectedProduct.code} - ${selectedProduct.name} ($ ${formatCLP(selectedProduct.price)})`;
      reserveModal.classList.remove("hidden");
      reserveModal.classList.add("flex");
    });
  });
}

async function loadProducts() {
  const response = await fetch("/api/public/products");
  const data = await response.json();
  products = (data.products || []).map(normalizeProduct);
  renderProducts(products);
}

cancelBtn.addEventListener("click", () => {
  reserveModal.classList.add("hidden");
  reserveModal.classList.remove("flex");
  reserveForm.reset();
});

reserveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedProduct) return;

  const customerName = customerNameInput.value.trim();
  const district = districtInput.value.trim();
  if (customerName.length < 2 || district.length < 2) {
    notify("Ingresa nombre y comuna válidos.", true);
    return;
  }

  const response = await fetch("/api/public/reserve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId: selectedProduct.id,
      customerName,
      district
    })
  });
  const data = await response.json();

  if (!response.ok) {
    notify(data.error || "No se pudo reservar.", true);
    if (data.error === "AGOTADO") loadProducts();
    return;
  }

  notify("Reserva confirmada. Abriendo WhatsApp...");
  reserveModal.classList.add("hidden");
  reserveModal.classList.remove("flex");
  reserveForm.reset();
  window.open(data.whatsappUrl, "_blank");
});

function initRealtime() {
  const source = new EventSource("/api/public/stream");
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "stock") {
      products = (payload.products || []).map(normalizeProduct);
      renderProducts(products);
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
