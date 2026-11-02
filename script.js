const PER_PAGE = 50;

let photos = [];
let currentPage = 1;
let viewerIndex = 0;

let zoom = 1;
let drag = false;
let startX = 0;
let startY = 0;
let offsetX = 0;
let offsetY = 0;

const selected = new Set();
const instructions = new Map();

let currentGallery = null;
let clientToken = "";
let galleryType = "original";
let storageKey = "";

let availableGalleries = [];
let photosRequestId = 0;
const LOCAL_TEST_MODE = !!GALLERY_CONFIG.localTestMode;


/* =========================
   ELEMENTOS DE LA PÁGINA
========================= */

const gallery = document.getElementById("gallery");
const count = document.getElementById("selectedCount");
const pageInfo = document.getElementById("pageInfo");
const pageNumber = document.getElementById("pageNumber");
const selectionTitle = document.getElementById("selectionTitle");
const selectionList = document.getElementById("selectionList");

const lightbox = document.getElementById("lightbox");
const largePhoto = document.getElementById("largePhoto");
const largeName = document.getElementById("largeName");
const largePosition = document.getElementById("largePosition");
const selectLarge = document.getElementById("selectLarge");
const photoStage = document.getElementById("photoStage");
const photoInstruction = document.getElementById("photoInstruction");

const gallerySelector = document.getElementById("gallerySelector");
const galleryList = document.getElementById("galleryList");
const photoGallerySection = document.getElementById("photoGallerySection");

const clientNameTop = document.getElementById("clientNameTop");
const galleryTitle = document.getElementById("galleryTitle");
const statusEl = document.getElementById("connectionStatus");

const adminLink = document.getElementById("adminLink");
const backToGalleriesBtn = document.getElementById("backToGalleriesBtn");


/* =========================
   UTILIDADES
========================= */

function imageUrl(fileId, size = 1600) {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${size}`;
}


function downloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}


function folderUrl() {
  if (!currentGallery) return "#";

  const id = galleryType === "edited" ? currentGallery.editedFolderId : currentGallery.folderId;
  return id ? `https://drive.google.com/drive/folders/${encodeURIComponent(id)}` : "#";
}


function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[c])
  );
}


function numericNameCompare(a, b) {
  return a.name.localeCompare(
    b.name,
    undefined,
    {
      numeric: true,
      sensitivity: "base"
    }
  );
}


/* =========================
   ADMINISTRACIÓN
========================= */

if (adminLink && GALLERY_CONFIG.appsScriptUrl) {
  adminLink.href =
    `${GALLERY_CONFIG.appsScriptUrl}?admin=1`;
}


/* =========================
   SELECCIÓN LOCAL
========================= */

function loadSavedSelection() {

  selected.clear();
  instructions.clear();

  try {

    const data = JSON.parse(
      localStorage.getItem(storageKey) || "{}"
    );

    (data.selected || []).forEach(name => {
      selected.add(name);
    });

    Object.entries(data.instructions || {}).forEach(
      ([name, note]) => {
        instructions.set(name, note);
      }
    );

  } catch (_) {}

}


function saveSelection() {

  try {

    localStorage.setItem(
      storageKey,
      JSON.stringify({
        selected: [...selected],
        instructions: Object.fromEntries(instructions)
      })
    );

  } catch (_) {}
  if(!LOCAL_TEST_MODE && clientToken && currentGallery){
    const payload={selected:[...selected],instructions:Object.fromEntries(instructions)};
    const encoded=btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
    jsonpRequest({action:"saveSelection",galleryId:currentGallery.id,token:clientToken,payload:encoded}).then(r=>{if(!r.ok)console.warn(r.error);}).catch(err=>console.warn("No se pudo sincronizar la selección",err));
  }

}


/* =========================
   LISTA DE GALERÍAS
========================= */

function loadGalleryList() {

  galleryList.innerHTML = `
    <div class="connection-status">
      Cargando galerías…
    </div>
  `;

  const callbackName =
    `__galleryListCallback_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;

  const script = document.createElement("script");

  let finished = false;

  const cleanup = () => {

    try {
      delete window[callbackName];
    } catch (_) {
      window[callbackName] = undefined;
    }

    script.remove();
  };


  const finishError = message => {

    if (finished) return;

    finished = true;

    clearTimeout(timeout);
    cleanup();

    galleryList.innerHTML = `
      <div class="connection-status error">
        ${escapeHtml(message)}
      </div>
    `;
  };


  const timeout = setTimeout(() => {

    finishError(
      "No se pudo obtener la lista de galerías."
    );

  }, 30000);


  window[callbackName] = data => {

    if (finished) return;

    finished = true;

    clearTimeout(timeout);
    cleanup();


    if (!data || data.error) {

      galleryList.innerHTML = `
        <div class="connection-status error">
          ${escapeHtml(
            data?.error ||
            "Respuesta inválida del servidor."
          )}
        </div>
      `;

      return;
    }


    const galleries = data.galleries || [];

    availableGalleries = galleries;

    if (!galleries.length) {

      galleryList.innerHTML = `
        <div class="connection-status">
          No hay galerías registradas.
        </div>
      `;

      return;
    }


    renderGalleryList(galleries);

  };


  script.async = true;
  script.type = "text/javascript";


  script.src =
    `${GALLERY_CONFIG.appsScriptUrl}` +
    `?action=listGalleries` +
    `&callback=${encodeURIComponent(callbackName)}` +
    `&_=${Date.now()}`;


  script.onerror = () => {

    finishError(
      "No se pudo conectar con Google Apps Script."
    );

  };


  document.head.appendChild(script);

}


/* =========================
   MOSTRAR GALERÍAS
========================= */

function renderGalleryList(galleries) {
  galleryList.innerHTML = "";
  galleries.forEach((galleryData, index) => {
    const group = document.createElement("article");
    group.className = "client-gallery-card";
    group.dataset.name = String(galleryData.clientName || "").toLocaleLowerCase("es");
    group.dataset.original = "true";
    group.dataset.edited = galleryData.hasEdited ? "true" : "false";
    const safeName = escapeHtml(galleryData.clientName || "Cliente");
    const originalSrc = galleryData.originalThumb ? imageUrl(galleryData.originalThumb, 520) : "";
    const category = escapeHtml(galleryData.category || "GALERÍA PRIVADA");
    group.innerHTML = `
      <div class="client-card-photo">
        ${originalSrc
          ? `<img src="${originalSrc}" alt="Fotografía de ${safeName}" loading="lazy">`
          : `<div class="photo-placeholder"><span>JA</span><small>JORGE ARREOLA</small></div>`}
      </div>
      <div class="client-card-content">
        <div class="client-card-heading">
          <div><h3>${safeName}</h3><p class="client-category">${category}</p></div>
          <span class="availability ${galleryData.hasEdited ? "ready" : ""}"><i></i>${galleryData.hasEdited ? "Original y editada" : "Disponible"}</span>
        </div>
        <div class="client-card-actions">
          <div class="client-access original-access">
            <span class="access-icon" aria-hidden="true"><img src="icono-galeria.png" alt=""></span>
            <strong>Galería original</strong>
            <small>Fotografías de la sesión</small>
            <button type="button" class="gallery-enter" data-gallery-index="${index}" data-gallery-type="original">Ingresar <span>→</span></button>
          </div>
          <div class="client-access edited-access ${galleryData.hasEdited ? "" : "is-unavailable"}">
            <span class="access-icon" aria-hidden="true"><img src="icono-edicion.png" alt=""></span>
            <strong>Galería editada</strong>
            <small>${galleryData.hasEdited ? "Fotografías finales" : "Aún no disponible"}</small>
            <button type="button" class="gallery-enter" data-gallery-index="${index}" data-gallery-type="edited" ${galleryData.hasEdited ? "" : "disabled"}>${galleryData.hasEdited ? "Ingresar" : "No disponible"} <span>${galleryData.hasEdited ? "→" : "⌑"}</span></button>
          </div>
        </div>
      </div>`;
    galleryList.appendChild(group);
  });
  applyGalleryFilters();
}

function applyGalleryFilters() {
  const query = (document.getElementById("gallerySearch")?.value || "").trim().toLocaleLowerCase("es");
  const filter = document.querySelector("[data-gallery-filter].active")?.dataset.galleryFilter || "all";
  galleryList.querySelectorAll(".client-gallery-card").forEach(card => {
    const matchesName = !query || card.dataset.name.includes(query);
    const matchesType = filter === "all" ||
      (filter === "original" && card.dataset.original === "true") ||
      (filter === "edited" && card.dataset.edited === "true");
    card.hidden = !(matchesName && matchesType);
  });
}

document.getElementById("gallerySearch")?.addEventListener("input", applyGalleryFilters);
document.querySelectorAll("[data-gallery-filter]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-gallery-filter]").forEach(b => b.classList.toggle("active", b === button));
    applyGalleryFilters();
  });
});

/*
 * Delegación de clics para las galerías.
 * Funciona aunque la lista se vuelva a renderizar.
 */
galleryList.addEventListener("click", event => {
  const button = event.target.closest(".gallery-enter");
  if (!button || !galleryList.contains(button) || button.disabled) return;
  const index = Number(button.dataset.galleryIndex);
  const galleryData = availableGalleries[index];
  if (!galleryData) return;
  // La lista pública solo sirve para localizar la galería; el acceso real
  // siempre se valida con la contraseña en la pantalla de acceso individual.
  const url = new URL(window.location.href);
  url.searchParams.set("g", galleryData.id);
  window.location.href = url.toString();
});


/* =========================
   SELECCIONAR GALERÍA
========================= */

function selectGallery(galleryData) {

  currentGallery = galleryData;

  photosRequestId++;

  GALLERY_CONFIG.clientName =
    galleryData.clientName;

  GALLERY_CONFIG.galleryTitle =
    galleryData.galleryTitle ||
    `Galería de ${galleryData.clientName}`;

  GALLERY_CONFIG.folderId =
    galleryData.folderId;


  storageKey =
    `jorge-arreola-gallery:${galleryData.folderId}`;


  photos = [];
  currentPage = 1;
  viewerIndex = 0;


  selected.clear();
  instructions.clear();


  clientNameTop.textContent =
    galleryData.clientName;

  galleryTitle.textContent =
    GALLERY_CONFIG.galleryTitle;


  gallerySelector.style.display = "none";
  photoGallerySection.style.display = "";


  statusEl.classList.remove("error");
  statusEl.textContent =
    "Conectando con la galería…";


  loadPhotosViaJsonp();

}


/* =========================
   VOLVER A GALERÍAS
========================= */

backToGalleriesBtn.onclick = () => {

  closeViewer();

  photosRequestId++;

  photos = [];

  currentGallery = null;

  selected.clear();
  instructions.clear();

  gallery.innerHTML = "";

  gallerySelector.style.display = "none";
  photoGallerySection.style.display = "none";
  document.getElementById("clientLogin").classList.remove("hidden");
  clientToken = "";

  clientNameTop.textContent =
    "Selecciona una galería";

  galleryTitle.textContent =
    "Galería";

  count.textContent = "0";

  selectionTitle.textContent =
    "0 fotografías seleccionadas";

  selectionList.textContent =
    "Todavía no has seleccionado fotografías.";

  pageInfo.textContent = "";
  pageNumber.textContent = "";

  statusEl.textContent =
    "Selecciona una galería para continuar.";

  /*
   * La lista ya está cargada.
   * No hacemos otra petición a Apps Script.
   */
  if (availableGalleries.length) {
    renderGalleryList(availableGalleries);
  }

};


/* =========================
   RENDER DE FOTOS
========================= */

function render() {

  if (!photos.length) return;


  const totalPages =
    Math.ceil(photos.length / PER_PAGE);


  currentPage =
    Math.max(
      1,
      Math.min(
        currentPage,
        totalPages
      )
    );


  const start =
    (currentPage - 1) * PER_PAGE;


  const pagePhotos =
    photos.slice(
      start,
      start + PER_PAGE
    );


  gallery.innerHTML =
    pagePhotos
      .map((p, localIndex) => {

        const note =
          instructions.get(p.name) || "";


        return `
          <article
            class="card ${
              selected.has(p.name)
                ? "selected"
                : ""
            }"
            data-name="${escapeHtml(p.name)}"
          >

            <button
              class="photo-button"
              type="button"
              data-index="${start + localIndex}"
              aria-label="Ver ${escapeHtml(p.name)} en grande"
            >

              <img
                src="${imageUrl(p.id, 900)}"
                alt="${escapeHtml(p.name)}"
                loading="lazy"
              >

            </button>


            <div class="check">
              ${
                selected.has(p.name)
                  ? "✓"
                  : ""
              }
            </div>


            <div class="name">
              ${escapeHtml(p.name)}
            </div>


            ${
              note
                ? `
                  <div class="instruction-note">
                    <strong>Instrucción:</strong>
                    ${escapeHtml(note)}
                  </div>
                `
                : ""
            }


            <button
              class="select-card"
              type="button"
              data-select="${escapeHtml(p.name)}"
            >

              ${
                selected.has(p.name)
                  ? "✓ Seleccionada"
                  : "Seleccionar"
              }

            </button>

          </article>
        `;

      })
      .join("");


  gallery
    .querySelectorAll(".photo-button")
    .forEach(btn => {

      btn.addEventListener(
        "click",
        () => openViewer(
          Number(btn.dataset.index)
        )
      );

    });


  gallery
    .querySelectorAll("[data-select]")
    .forEach(btn => {

      btn.addEventListener(
        "click",
        e => {

          e.stopPropagation();

          toggle(
            btn.dataset.select
          );

        }
      );

    });


  pageInfo.textContent =
    `${start + 1}–${Math.min(
      start + PER_PAGE,
      photos.length
    )} de ${photos.length}`;


  pageNumber.textContent =
    `Página ${currentPage} de ${totalPages}`;


  document.getElementById("prevBtn").disabled =
    currentPage === 1;


  document.getElementById("nextBtn").disabled =
    currentPage === totalPages;


  updateSelection();

}


/* =========================
   SELECCIÓN
========================= */

function toggle(name) {

  if (selected.has(name)) {

    selected.delete(name);

  } else {

    selected.add(name);

  }


  saveSelection();

  render();


  if (
    lightbox.classList.contains("open")
  ) {

    updateViewerButton();

  }

}


function updateSelection() {

  const names =
    [...selected].sort(
      (a, b) =>
        a.localeCompare(
          b,
          undefined,
          {
            numeric: true
          }
        )
    );


  count.textContent =
    names.length;


  selectionTitle.textContent =
    `${names.length} fotografía${
      names.length === 1
        ? ""
        : "s"
    } seleccionada${
      names.length === 1
        ? ""
        : "s"
    }`;


  if (!names.length) {

    selectionList.textContent =
      "Todavía no has seleccionado fotografías.";

    return;

  }


  selectionList.innerHTML =
    names
      .map(name => {

        const note =
          instructions.get(name);


        return `
          <div class="selection-row">

            <strong>
              ${escapeHtml(name)}
            </strong>

            ${
              note
                ? `
                  <span>
                    Instrucción:
                    ${escapeHtml(note)}
                  </span>
                `
                : ""
            }

          </div>
        `;

      })
      .join("");

}


/* =========================
   VISOR
========================= */

function openViewer(index) {

  viewerIndex =
    Math.max(
      0,
      Math.min(
        index,
        photos.length - 1
      )
    );


  zoom = 1;
  offsetX = 0;
  offsetY = 0;


  updateViewer();


  lightbox.classList.add("open");

  lightbox.setAttribute(
    "aria-hidden",
    "false"
  );


  document.body.style.overflow =
    "hidden";

}


function closeViewer() {

  lightbox.classList.remove(
    "open"
  );

  lightbox.setAttribute(
    "aria-hidden",
    "true"
  );

  document.body.style.overflow =
    "";

}


function updateViewer() {

  const p =
    photos[viewerIndex];


  if (!p) return;


  largePhoto.src =
    imageUrl(p.id, 2200);


  largePhoto.alt =
    p.name;


  largeName.textContent =
    p.name;


  largePosition.textContent =
    `${viewerIndex + 1} / ${photos.length}`;


  photoInstruction.value =
    instructions.get(p.name) || "";


  applyZoom();

  updateViewerButton();

}


function updateViewerButton() {

  const p =
    photos[viewerIndex];


  if (!p) return;


  const isSelected =
    selected.has(p.name);


  selectLarge.textContent =
    isSelected
      ? "✓ Seleccionada"
      : "Seleccionar foto";


  selectLarge.classList.toggle(
    "is-selected",
    isSelected
  );

}


function applyZoom() {

  largePhoto.style.transform =
    `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`;


  largePhoto.style.cursor =
    zoom > 1
      ? (drag
          ? "grabbing"
          : "grab")
      : "default";

}


function changeZoom(amount) {

  zoom =
    Math.max(
      1,
      Math.min(
        4,
        zoom + amount
      )
    );


  if (zoom === 1) {

    offsetX = 0;
    offsetY = 0;

  }


  applyZoom();

}


/* =========================
   TEXTO DE SELECCIÓN
========================= */

function buildSelectionText(names) {

  const client =
    currentGallery
      ? currentGallery.clientName
      : "Galería";


  return (
    `JORGE ARREOLA FOTOGRAFÍA\n` +
    `GALERÍA: ${client.toUpperCase()}\n\n` +

    names
      .map(name => {

        const note =
          instructions.get(name);


        return (
          `${name}` +
          (
            note
              ? `\nINSTRUCCIÓN: ${note}`
              : ""
          )
        );

      })
      .join("\n\n") +

    "\n"
  );

}


function downloadBlob(
  data,
  filename,
  type
) {

  const blob =
    data instanceof Blob
      ? data
      : new Blob(
          [data],
          {
            type:
              type ||
              "application/octet-stream"
          }
        );


  const a =
    document.createElement("a");


  a.href =
    URL.createObjectURL(blob);


  a.download =
    filename;


  a.click();


  setTimeout(
    () =>
      URL.revokeObjectURL(a.href),
    1000
  );

}


/* =========================
   CARGAR FOTOS
========================= */

function loadPhotosViaJsonp() {

  const requestId =
    ++photosRequestId;

  if (
    !currentGallery ||
    !GALLERY_CONFIG.appsScriptUrl
  ) {

    statusEl.textContent =
      "No hay una galería seleccionada.";

    statusEl.classList.add(
      "error"
    );

    return;

  }


  const callbackName =
    `__driveGalleryCallback_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2)}`;


  const script =
    document.createElement("script");


  let finished = false;


  const cleanup = () => {

    try {

      delete window[callbackName];

    } catch (_) {

      window[callbackName] =
        undefined;

    }


    script.remove();

  };


  const finishError =
    message => {

      if (finished) return;

      finished = true;

      clearTimeout(timeout);

      cleanup();

      statusEl.textContent =
        message;

      statusEl.classList.add(
        "error"
      );

    };


  const timeout =
    setTimeout(
      () => {

        finishError(
          "No se recibió respuesta de Google Drive en 30 segundos."
        );

      },
      30000
    );


  window[callbackName] =
    data => {

      if (finished) return;

      /*
       * Si el usuario ya cambió de galería,
       * esta respuesta pertenece a una petición vieja
       * y no debe modificar la galería actual.
       */
      if (requestId !== photosRequestId) return;

      finished = true;

      clearTimeout(timeout);

      cleanup();


      if (!data || data.error) {

        statusEl.textContent =
          `Error de Drive: ${
            data?.error ||
            "respuesta inválida"
          }`;

        statusEl.classList.add(
          "error"
        );

        return;

      }


      photos =
        (data.files || [])
          .filter(
            f =>
              /^image\/(jpeg|jpg|png|webp)$/i
                .test(
                  f.mimeType || ""
                )
          );


      photos.sort(
        numericNameCompare
      );


      if (!photos.length) {

        statusEl.textContent =
          "La carpeta no contiene imágenes compatibles.";

        statusEl.classList.add(
          "error"
        );

        return;

      }


      statusEl.classList.remove(
        "error"
      );


      statusEl.textContent =
        `${photos.length} fotografías cargadas desde Google Drive.`;


      document
        .getElementById(
          "downloadGalleryBtn"
        )
        .title =
        "Abre la carpeta de Drive para descargar toda la galería";


      render();

    };


  script.async = true;
  script.type =
    "text/javascript";


  if (LOCAL_TEST_MODE) {
    // La implementación publicada actualmente usa el endpoint antiguo:
    // recibe folderId y devuelve {files:[...]}. No requiere actualizar Apps Script.
    const testFolderId = galleryType === "edited"
      ? currentGallery.editedFolderId
      : currentGallery.folderId;
    if (!testFolderId) {
      finishError("Esta galería todavía no tiene una carpeta configurada.");
      return;
    }
    script.src =
      `${GALLERY_CONFIG.appsScriptUrl}` +
      `?folderId=${encodeURIComponent(testFolderId)}` +
      `&callback=${encodeURIComponent(callbackName)}` +
      `&_=${Date.now()}`;
  } else {
    script.src =
      `${GALLERY_CONFIG.appsScriptUrl}` +
      `?action=photos&galleryId=${encodeURIComponent(currentGallery.id)}` +
      `&type=${encodeURIComponent(galleryType)}` +
      `&token=${encodeURIComponent(clientToken)}` +
      `&callback=${encodeURIComponent(callbackName)}` +
      `&_=${Date.now()}`;
  }


  script.onerror =
    () =>
      finishError(
        "No se pudo conectar con Google Apps Script."
      );


  document.head.appendChild(
    script
  );

}


/* =========================
   CONTROLES DEL VISOR
========================= */

document
  .getElementById("closeLightbox")
  .onclick =
  closeViewer;


document
  .getElementById("lightPrev")
  .onclick =
  () => {

    viewerIndex =
      (
        viewerIndex -
        1 +
        photos.length
      ) %
      photos.length;


    zoom = 1;
    offsetX = 0;
    offsetY = 0;

    updateViewer();

  };


document
  .getElementById("lightNext")
  .onclick =
  () => {

    viewerIndex =
      (
        viewerIndex +
        1
      ) %
      photos.length;


    zoom = 1;
    offsetX = 0;
    offsetY = 0;

    updateViewer();

  };


selectLarge.onclick =
  () => {

    if (!photos[viewerIndex]) return;

    toggle(
      photos[viewerIndex].name
    );

  };


document
  .getElementById("downloadPhoto")
  .onclick =
  () => {

    if (!photos[viewerIndex]) return;

    window.open(
      downloadUrl(
        photos[viewerIndex].id
      ),
      "_blank",
      "noopener"
    );

  };


/* =========================
   INSTRUCCIONES
========================= */

document
  .getElementById("saveInstruction")
  .onclick =
  () => {

    const p =
      photos[viewerIndex];


    if (!p) return;


    const name =
      p.name;


    const value =
      photoInstruction.value.trim();


    if (value) {

      instructions.set(
        name,
        value
      );

    } else {

      instructions.delete(
        name
      );

    }


    if (!selected.has(name)) {

      selected.add(name);

    }


    saveSelection();

    render();

    updateViewerButton();


    photoInstruction.value =
      instructions.get(name) || "";


    alert(
      value
        ? "Instrucción guardada y fotografía seleccionada."
        : "Instrucción eliminada. La fotografía quedó seleccionada."
    );

  };


/* =========================
   ZOOM
========================= */

document
  .getElementById("zoomIn")
  .onclick =
  () =>
    changeZoom(.5);


document
  .getElementById("zoomOut")
  .onclick =
  () =>
    changeZoom(-.5);


document
  .getElementById("zoomReset")
  .onclick =
  () => {

    zoom = 1;
    offsetX = 0;
    offsetY = 0;

    applyZoom();

  };


photoStage.addEventListener(
  "wheel",
  e => {

    e.preventDefault();

    changeZoom(
      e.deltaY < 0
        ? .25
        : -.25
    );

  },
  {
    passive: false
  }
);


largePhoto.addEventListener(
  "pointerdown",
  e => {

    if (zoom <= 1) return;


    drag = true;

    startX =
      e.clientX -
      offsetX;

    startY =
      e.clientY -
      offsetY;


    largePhoto.setPointerCapture(
      e.pointerId
    );


    applyZoom();

  }
);


largePhoto.addEventListener(
  "pointermove",
  e => {

    if (!drag) return;


    offsetX =
      e.clientX -
      startX;

    offsetY =
      e.clientY -
      startY;


    applyZoom();

  }
);


largePhoto.addEventListener(
  "pointerup",
  () => {

    drag = false;

    applyZoom();

  }
);


largePhoto.addEventListener(
  "pointercancel",
  () => {

    drag = false;

    applyZoom();

  }
);



// Gestos táctiles: swipe para cambiar de foto y pellizco para zoom.
let touchStartX=0,touchStartY=0,touchStartDistance=0,touchStartZoom=1;
function touchDistance(t){const dx=t[0].clientX-t[1].clientX,dy=t[0].clientY-t[1].clientY;return Math.hypot(dx,dy);}
photoStage.addEventListener("touchstart",e=>{if(e.touches.length===2){touchStartDistance=touchDistance(e.touches);touchStartZoom=zoom;}else if(e.touches.length===1){touchStartX=e.touches[0].clientX;touchStartY=e.touches[0].clientY;}},{passive:true});
photoStage.addEventListener("touchmove",e=>{if(e.touches.length===2){e.preventDefault();zoom=Math.max(1,Math.min(4,touchStartZoom*(touchDistance(e.touches)/touchStartDistance)));if(zoom===1){offsetX=0;offsetY=0;}applyZoom();}},{passive:false});
photoStage.addEventListener("touchend",e=>{if(zoom<=1.01&&e.changedTouches.length){const dx=e.changedTouches[0].clientX-touchStartX,dy=e.changedTouches[0].clientY-touchStartY;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)){document.getElementById(dx<0?"lightNext":"lightPrev").click();}}});

/* =========================
   TECLADO
========================= */

document.addEventListener(
  "keydown",
  e => {

    if (
      !lightbox.classList.contains(
        "open"
      )
    ) {
      return;
    }


    if (e.key === "Escape")
      closeViewer();


    if (e.key === "ArrowLeft")
      document
        .getElementById(
          "lightPrev"
        )
        .click();


    if (e.key === "ArrowRight")
      document
        .getElementById(
          "lightNext"
        )
        .click();


    if (
      e.key === "+" ||
      e.key === "="
    )
      changeZoom(.5);


    if (e.key === "-")
      changeZoom(-.5);

  }
);


/* =========================
   PAGINACIÓN
========================= */

document
  .getElementById("prevBtn")
  .onclick =
  () => {

    currentPage--;

    render();

    window.scrollTo({
      top: 250,
      behavior: "smooth"
    });

  };


document
  .getElementById("nextBtn")
  .onclick =
  () => {

    currentPage++;

    render();

    window.scrollTo({
      top: 250,
      behavior: "smooth"
    });

  };


/* =========================
   BOTONES DE SELECCIÓN
========================= */

document
  .getElementById("clearBtn")
  .onclick =
  () => {

    selected.clear();

    instructions.clear();

    saveSelection();

    render();

  };


document
  .getElementById("copyBtn")
  .onclick =
  async () => {

    const names =
      [...selected].sort(
        (a, b) =>
          a.localeCompare(
            b,
            undefined,
            {
              numeric: true
            }
          )
      );


    if (!names.length) {

      alert(
        "No hay fotografías seleccionadas."
      );

      return;

    }


    try {

      await navigator.clipboard.writeText(
        buildSelectionText(names)
      );


      alert(
        "Lista copiada al portapapeles."
      );

    } catch {

      alert(
        "No se pudo copiar automáticamente. Usa el botón Descargar selección TXT."
      );

    }

  };


document
  .getElementById("downloadBtn")
  .onclick =
  () => {

    const names =
      [...selected].sort(
        (a, b) =>
          a.localeCompare(
            b,
            undefined,
            {
              numeric: true
            }
          )
      );


    if (!names.length) {

      alert(
        "No hay fotografías seleccionadas."
      );

      return;

    }


    const client =
      currentGallery
        ? currentGallery.clientName
        : "galeria";


    downloadBlob(
      buildSelectionText(names),
      `seleccion-${client.toLowerCase()}.txt`,
      "text/plain;charset=utf-8"
    );

  };


document
  .getElementById("downloadGalleryBtn")
  .onclick =
  () => {

    const url =
      folderUrl();


    if (url && url !== "#") {

      window.open(
        url,
        "_blank",
        "noopener"
      );

    }

  };



/* =========================
   ACCESO PRIVADO POR CLIENTE
========================= */
function jsonpRequest(params, timeoutMs=30000) {
  return new Promise((resolve,reject)=>{
    const cb=`__ja_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script=document.createElement("script"); let done=false;
    const finish=(err,data)=>{if(done)return;done=true;clearTimeout(timer);try{delete window[cb]}catch(_){window[cb]=undefined}script.remove();err?reject(err):resolve(data)};
    const timer=setTimeout(()=>finish(new Error("Tiempo de espera agotado.")),timeoutMs);
    window[cb]=data=>finish(null,data);
    const q=new URLSearchParams({...params,callback:cb,_:Date.now()});
    script.src=`${GALLERY_CONFIG.appsScriptUrl}?${q.toString()}`;script.onerror=()=>finish(new Error("No se pudo conectar con el servidor."));document.head.appendChild(script);
  });
}
function initializePrivateGallery(){
  const id=new URLSearchParams(location.search).get("g");
  photoGallerySection.style.display="none";
  const login=document.getElementById("clientLogin");
  if(!id){login.classList.add("hidden");gallerySelector.style.display="grid";loadGalleryList();return;}
  gallerySelector.style.display="none";login.classList.remove("hidden");
  window.__privateGalleryId=id;
  document.getElementById("clientLoginForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const msg=document.getElementById("clientLoginMessage");
    const entered=document.getElementById("clientPassword").value;
    msg.textContent="Verificando contraseña…";
    try{
      if (LOCAL_TEST_MODE) {
        if (entered !== GALLERY_CONFIG.testPassword) {
          msg.textContent="Contraseña incorrecta.";
          return;
        }
        const list=await jsonpRequest({action:"listGalleries"});
        const rows=Array.isArray(list)?list:(list.galleries||[]);
        let found=rows.find(g=>String(g.id)===String(id));
        if (!found && rows.length===1) found=rows[0];
        if (!found) {
          msg.textContent="No se encontró esta galería en la lista actual del servidor.";
          return;
        }
        const originalFolder=found.folderId || (String(id)==="vianey" ? GALLERY_CONFIG.folderId : "");
        if (!originalFolder) {
          msg.textContent="La galería existe, pero el servidor actual no devuelve su folderId. No se modificó nada.";
          return;
        }
        currentGallery={
          id:found.id || id,
          clientName:found.clientName || GALLERY_CONFIG.clientName,
          galleryTitle:found.galleryTitle || `Galería de ${found.clientName || GALLERY_CONFIG.clientName}`,
          folderId:originalFolder,
          editedFolderId:found.editedFolderId || "",
          hasEdited:!!found.editedFolderId
        };
        clientToken="";
        GALLERY_CONFIG.clientName=currentGallery.clientName;
        GALLERY_CONFIG.galleryTitle=currentGallery.galleryTitle;
        GALLERY_CONFIG.folderId=currentGallery.folderId;
        storageKey=`jorge-arreola-gallery:${currentGallery.id}`;
        selected.clear();instructions.clear();loadSavedSelection();
        login.classList.add("hidden");
        document.getElementById("clientGalleryChoices").classList.remove("hidden");
        document.getElementById("choicesClientName").textContent=currentGallery.clientName;
        document.getElementById("originalTitle").textContent=currentGallery.galleryTitle;
        document.getElementById("originalThumb").src=found.originalThumb?imageUrl(found.originalThumb,600):"";
        document.getElementById("editedThumb").src=found.editedThumb?imageUrl(found.editedThumb,600):"";
        document.querySelectorAll("[data-open-type]").forEach(b=>b.onclick=()=>{
          galleryType=b.dataset.openType;
          if(galleryType==="edited"&&!currentGallery.editedFolderId){
            alert("La galería editada todavía no está configurada.");
            return;
          }
          document.getElementById("clientGalleryChoices").classList.add("hidden");
          photoGallerySection.style.display="";
          clientNameTop.textContent=currentGallery.clientName;
          galleryTitle.textContent=galleryType==="edited"?"Galería editada":currentGallery.galleryTitle;
          loadPhotosViaJsonp();
          updateSelection();
        });
        updateSelection();
        return;
      }
      const r=await jsonpRequest({action:"loginGallery",galleryId:id,password:entered});
      if(!r.ok){msg.textContent=r.error||"No se pudo iniciar sesión.";return;}
      clientToken=r.token;currentGallery=r.gallery;currentGallery.folderId=r.folderIds.original;currentGallery.editedFolderId=r.folderIds.edited;GALLERY_CONFIG.clientName=r.gallery.clientName;GALLERY_CONFIG.galleryTitle=r.gallery.galleryTitle;GALLERY_CONFIG.folderId=r.folderIds.original;storageKey=`jorge-arreola-gallery:${id}`;
      selected.clear();instructions.clear();if(r.selection){(r.selection.selected||[]).forEach(n=>selected.add(n));Object.entries(r.selection.instructions||{}).forEach(([n,v])=>instructions.set(n,v));}
      login.classList.add("hidden");document.getElementById("clientGalleryChoices").classList.remove("hidden");
      document.getElementById("choicesClientName").textContent=currentGallery.clientName;
      document.getElementById("originalTitle").textContent=currentGallery.galleryTitle;
      document.getElementById("originalThumb").src=r.originalThumb?imageUrl(r.originalThumb,600):"";
      document.getElementById("editedThumb").src=r.editedThumb?imageUrl(r.editedThumb,600):"";
      document.querySelectorAll("[data-open-type]").forEach(b=>b.onclick=()=>{galleryType=b.dataset.openType;if(galleryType==="edited"&&!currentGallery.hasEdited){alert("La galería editada todavía no está disponible.");return;}document.getElementById("clientGalleryChoices").classList.add("hidden");photoGallerySection.style.display="";clientNameTop.textContent=currentGallery.clientName;galleryTitle.textContent=galleryType==="edited"?"Galería editada":currentGallery.galleryTitle;loadPhotosViaJsonp();updateSelection();});
      updateSelection();
    }catch(err){msg.textContent=err.message||"Error de conexión.";}
  });
}

/* =========================
   INICIO
========================= */

photoGallerySection.style.display =
  "none";


gallerySelector.style.display =
  "";


initializePrivateGallery();
