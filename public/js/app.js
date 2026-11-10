// ==========================================
// ESTADO GLOBAL Y CONFIGURACIÓN
// ==========================================
let html5QrCode = null;
let nfcAbortController = null;
let bulkAborted = false;
let bulkResults = [];

// Elementos de Navegación
const tabSingleBtn = document.getElementById('tab-single-btn');
const tabBulkBtn = document.getElementById('tab-bulk-btn');
const viewSingle = document.getElementById('view-single');
const viewBulk = document.getElementById('view-bulk');
const mainContainer = document.querySelector('.container');

// Elementos Modo Individual
const cedulaInput = document.getElementById('cedula-input');
const btnConsultar = document.getElementById('btn-consultar');
const validationHint = document.getElementById('validation-hint');
const btnCamera = document.getElementById('btn-camera');
const btnNfc = document.getElementById('btn-nfc');
const btnUsbScanner = document.getElementById('btn-usb-scanner');
const scannerBanner = document.getElementById('scanner-banner');
const scannerBannerText = document.getElementById('scanner-banner-text');
const btnStopCamera = document.getElementById('btn-stop-camera');
const scannerContainer = document.getElementById('scanner-container');
const loader = document.getElementById('loader');
const resultContainer = document.getElementById('result-container');
const btnNuevaConsulta = document.getElementById('btn-nueva-consulta');

const statusBanner = document.getElementById('status-banner');
const statusTitle = document.getElementById('status-title');
const statusDesc = document.getElementById('status-desc');
const resCedula = document.getElementById('res-cedula');
const resNombres = document.getElementById('res-nombres');
const resTipoSeguro = document.getElementById('res-tipo-seguro');
const resCodigoSeguro = document.getElementById('res-codigo-seguro');
const resFechaCalificada = document.getElementById('res-fecha-calificada');
const resAfiliacion = document.getElementById('res-afiliacion');
const resTiempo = document.getElementById('res-tiempo');
const mspDesc = document.getElementById('msp-desc');
const singleDateInput = document.getElementById('single-date-input');

// Elementos Modo Masivo
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const bulkTextarea = document.getElementById('bulk-textarea');
const bulkCounterLive = document.getElementById('bulk-counter-live');
const modeAllRows = document.getElementById('mode-all-rows');
const modeUniqueOnly = document.getElementById('mode-unique-only');
const bulkBatchDate = document.getElementById('bulk-batch-date');
const sheetSelectorContainer = document.getElementById('sheet-selector-container');
const sheetSelect = document.getElementById('sheet-select');

// Almacén en memoria del archivo cargado para alternar entre "Únicas" y "Todas las filas"
let archivoCargadoDatos = null; // { totalOriginal, duplicadosOriginal, todas: [], unicas: [], nombre: '', cerosRecuperados: 0 }
let workbookSheetsMap = null;   // Map: sheetName -> { todas: [], unicas: [], ceros: 0 }

/**
 * Normaliza cualquier formato de fecha a DD/MM/YYYY:
 * - Serial Excel (ej. 45427 -> 15/05/2024)
 * - ISO / YYYY-MM-DD
 * - DD/MM/YYYY o DD-MM-YYYY
 * - Date object nativo
 */
function parsearFechaGenerica(val) {
  if (val === null || val === undefined || val === '') return null;

  // Si es un objeto Date nativo
  if (val instanceof Date && !isNaN(val.getTime())) {
    const d = String(val.getDate()).padStart(2, '0');
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const y = val.getFullYear();
    return `${d}/${m}/${y}`;
  }

  // Si es un número serial de fecha de Excel (ej. 45427 -> 15/05/2024)
  if (typeof val === 'number' && val > 20000 && val < 80000) {
    if (window.XLSX && window.XLSX.SSF) {
      try {
        const d = window.XLSX.SSF.parse_date_code(val);
        if (d && d.d && d.m && d.y) {
          return `${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y}`;
        }
      } catch (_) {}
    }
    const epoch = new Date((val - (25567 + 2)) * 86400 * 1000);
    if (!isNaN(epoch.getTime())) {
      const d = String(epoch.getUTCDate()).padStart(2, '0');
      const m = String(epoch.getUTCMonth() + 1).padStart(2, '0');
      const y = epoch.getUTCFullYear();
      return `${d}/${m}/${y}`;
    }
  }

  const str = String(val).trim();
  if (!str) return null;

  // DD/MM/YYYY o DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmy) {
    const d = String(dmy[1]).padStart(2, '0');
    const m = String(dmy[2]).padStart(2, '0');
    const y = dmy[3];
    return `${d}/${m}/${y}`;
  }

  // YYYY-MM-DD o YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = String(ymd[2]).padStart(2, '0');
    const d = String(ymd[3]).padStart(2, '0');
    return `${d}/${m}/${y}`;
  }

  return null;
}

function formatItemParaTextarea(item) {
  if (!item) return '';
  if (typeof item === 'string') return item;
  return item.fecha ? `${item.cedula}, ${item.fecha}` : item.cedula;
}

function actualizarContadorLive() {
  if (!bulkCounterLive) return;
  const raw = bulkTextarea.value.trim();
  if (!raw) {
    bulkCounterLive.textContent = '0 cédulas detectadas';
    return;
  }
  const lines = raw.split(/[\r\n]+/).map(t => t.trim()).filter(Boolean);
  const items = [];
  lines.forEach(line => {
    const parsed = extraerCedulaYFechaDeLinea(line);
    if (parsed) {
      items.push(parsed);
    } else {
      const digits = line.replace(/\D/g, '');
      if (digits.length > 0) items.push({ cedula: digits, fecha: null });
    }
  });

  const total = items.length;
  const unicasSet = new Set(items.map(it => it.cedula));
  const unicas = unicasSet.size;
  const duplicados = total - unicas;

  if (archivoCargadoDatos && modeUniqueOnly && modeUniqueOnly.checked) {
    bulkCounterLive.textContent = `${total.toLocaleString()} pacientes únicos (de ${archivoCargadoDatos.totalOriginal.toLocaleString()} filas originales - ${archivoCargadoDatos.duplicadosOriginal.toLocaleString()} duplicados removidos)`;
  } else if (archivoCargadoDatos && modeAllRows && modeAllRows.checked) {
    bulkCounterLive.textContent = `${total.toLocaleString()} filas en total (${unicas.toLocaleString()} pacientes únicos - memoria inteligente activa)`;
  } else if (total === unicas) {
    bulkCounterLive.textContent = `${total.toLocaleString()} pacientes únicos (sin duplicados)`;
  } else {
    bulkCounterLive.textContent = `${total.toLocaleString()} filas ingresadas (${unicas.toLocaleString()} pacientes únicos - ${duplicados.toLocaleString()} duplicados)`;
  }
}

function actualizarTextareaPorModo() {
  if (!archivoCargadoDatos) return;
  const esUnicas = modeUniqueOnly && modeUniqueOnly.checked;
  const lista = esUnicas ? archivoCargadoDatos.unicas : archivoCargadoDatos.todas;
  bulkTextarea.value = lista.map(formatItemParaTextarea).join('\n');
  actualizarContadorLive();
}

if (modeAllRows) modeAllRows.addEventListener('change', actualizarTextareaPorModo);
if (modeUniqueOnly) modeUniqueOnly.addEventListener('change', actualizarTextareaPorModo);

if (sheetSelect) {
  sheetSelect.addEventListener('change', () => {
    if (!workbookSheetsMap) return;
    const sel = sheetSelect.value;
    if (sel === '__TODAS__') {
      const todas = [];
      let ceros = 0;
      workbookSheetsMap.forEach(info => {
        todas.push(...info.todas);
        ceros += info.ceros;
      });
      const unicasMap = new Map();
      todas.forEach(it => {
        if (!unicasMap.has(it.cedula)) unicasMap.set(it.cedula, it);
        else if (!unicasMap.get(it.cedula).fecha && it.fecha) unicasMap.set(it.cedula, it);
      });
      const unicas = Array.from(unicasMap.values());
      archivoCargadoDatos = {
        totalOriginal: todas.length,
        duplicadosOriginal: todas.length - unicas.length,
        todas,
        unicas,
        nombre: archivoCargadoDatos ? archivoCargadoDatos.nombre : 'Excel',
        cerosRecuperados: ceros
      };
    } else if (workbookSheetsMap.has(sel)) {
      const info = workbookSheetsMap.get(sel);
      archivoCargadoDatos = {
        totalOriginal: info.todas.length,
        duplicadosOriginal: info.todas.length - info.unicas.length,
        todas: info.todas,
        unicas: info.unicas,
        nombre: `${archivoCargadoDatos ? archivoCargadoDatos.nombre : 'Excel'} [${sel}]`,
        cerosRecuperados: info.ceros
      };
    }
    actualizarTextareaPorModo();
  });
}

bulkTextarea.addEventListener('input', actualizarContadorLive);
bulkTextarea.addEventListener('paste', () => setTimeout(actualizarContadorLive, 100));
const btnStartBulk = document.getElementById('btn-start-bulk');
const btnStopBulk = document.getElementById('btn-stop-bulk');
const bulkProgressCard = document.getElementById('bulk-progress-card');
const bulkProgressText = document.getElementById('bulk-progress-text');
const bulkProgressFill = document.getElementById('bulk-progress-fill');
const bulkTableCard = document.getElementById('bulk-table-card');
const bulkTableBody = document.getElementById('bulk-table-body');
const btnExportExcel = document.getElementById('btn-export-excel');

const statTotal = document.getElementById('stat-total');
const statAcreditados = document.getElementById('stat-acreditados');
const statNoAcreditados = document.getElementById('stat-no-acreditados');
const statInvalidos = document.getElementById('stat-invalidos');

// ==========================================
// 1. NORMALIZADOR Y VALIDADOR MÓDULO 10
// ==========================================

/**
 * Normaliza cualquier formato de cédula:
 * - Elimina guiones, puntos y espacios.
 * - Si tiene 9 dígitos (porque Excel le quitó el '0' inicial a Azuay, Guayas, etc.),
 *   le antepone el '0' automáticamente para recuperar la cédula real.
 */
function normalizarCedula(valor) {
  if (!valor) return '';
  let limpia = String(valor).trim().replace(/\D/g, '');
  if (limpia.length === 9) {
    limpia = '0' + limpia; // Restaurar el cero que Excel eliminó
  }
  return limpia;
}

function validarCedulaCliente(cedula) {
  const limpia = normalizarCedula(cedula);
  if (limpia.length !== 10) return false;

  const prov = parseInt(limpia.substring(0, 2), 10);
  if ((prov < 1 || prov > 24) && prov !== 30) return false;
  if (parseInt(limpia[2], 10) >= 6) return false;

  const coef = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let val = parseInt(limpia[i], 10) * coef[i];
    if (val >= 10) val -= 9;
    sum += val;
  }
  const digitoEsperado = (sum % 10 === 0) ? 0 : 10 - (sum % 10);
  return digitoEsperado === parseInt(limpia[9], 10);
}

// Extrae y normaliza cédula desde texto escaneado, código de barras o celda
function extraerCedulaDeTexto(texto) {
  if (!texto) return null;
  const str = String(texto).trim();

  // 1. Intentar normalización directa si es solo dígitos
  const normal = normalizarCedula(str);
  if (normal.length === 10 && validarCedulaCliente(normal)) {
    return normal;
  }

  // 2. Buscar secuencias con límites de palabra (\b)
  const wordMatches = str.match(/\b\d{9,10}\b/g) || [];
  for (const m of wordMatches) {
    const cand = normalizarCedula(m);
    if (validarCedulaCliente(cand)) return cand;
  }

  // 3. Buscar cualquier secuencia continua de 9 o 10 dígitos (para PDF417 o MRZ con prefijos como ECU...)
  const anyDigits = str.match(/\d{9,10}/g) || [];
  for (const d of anyDigits) {
    const cand = normalizarCedula(d);
    if (validarCedulaCliente(cand)) return cand;
  }

  // 4. Fallback: remover caracteres no numéricos completos
  const soloNum = str.replace(/\D/g, '');
  if (soloNum.length === 9 || soloNum.length === 10) {
    const cand = normalizarCedula(soloNum);
    if (validarCedulaCliente(cand)) return cand;
  }

  return null;
}

/**
 * Extrae cédula y fecha opcional de una línea de texto (ej. "1710034065, 15/05/2024" o "1708683873 2024-05-15")
 */
function extraerCedulaYFechaDeLinea(linea) {
  if (!linea) return null;
  const str = String(linea).trim();
  if (!str) return null;

  // Separar tokens por comas, punto y comas, tabs o barras verticales
  const tokens = str.split(/[,;\t|]+/).map(t => t.trim()).filter(Boolean);

  let cedula = null;
  let fecha = null;

  for (const tok of tokens) {
    if (!fecha) {
      const fCand = parsearFechaGenerica(tok);
      if (fCand) {
        fecha = fCand;
        continue;
      }
    }
    if (!cedula) {
      const cand = extraerCedulaDeTexto(tok);
      if (cand) {
        cedula = cand;
        continue;
      }
    }
  }

  // Si no se encontró cédula por tokens, buscar en la línea completa
  if (!cedula) {
    cedula = extraerCedulaDeTexto(str);
  }

  // Si no se encontró fecha por tokens, buscar patrones de fecha en la línea completa
  if (!fecha) {
    const matchDmy = str.match(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\b/);
    if (matchDmy) {
      fecha = parsearFechaGenerica(matchDmy[0]);
    } else {
      const matchYmd = str.match(/\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/);
      if (matchYmd) {
        fecha = parsearFechaGenerica(matchYmd[0]);
      }
    }
  }

  if (!cedula) return null;
  return { cedula, fecha };
}

// ==========================================
// 2. MANEJO DE PESTAÑAS
// ==========================================
tabSingleBtn.addEventListener('click', () => {
  tabSingleBtn.classList.add('active');
  tabBulkBtn.classList.remove('active');
  viewSingle.style.display = 'block';
  viewBulk.style.display = 'none';
  mainContainer.classList.remove('wide');
});

tabBulkBtn.addEventListener('click', () => {
  tabBulkBtn.classList.add('active');
  tabSingleBtn.classList.remove('active');
  viewSingle.style.display = 'none';
  viewBulk.style.display = 'block';
  mainContainer.classList.add('wide');
  cerrarCamara();
});

// Eventos de entrada manual individual
cedulaInput.addEventListener('input', () => {
  let val = cedulaInput.value.replace(/\D/g, '');
  if (val.length === 9) {
    // Sugerencia de autocompletar cero si el usuario lo ingresó sin el 0
    validationHint.textContent = '💡 Si es de Azuay a Guayas, se agregará el 0 al inicio';
  }

  const normal = normalizarCedula(val);
  if (normal.length === 10) {
    if (validarCedulaCliente(normal)) {
      cedulaInput.value = normal; // Ajustar a los 10 dígitos con el 0
      validationHint.textContent = '✓ Cédula válida (Módulo 10)';
      validationHint.className = 'validation-hint valid';
      btnConsultar.disabled = false;
    } else {
      validationHint.textContent = '✕ Cédula no válida';
      validationHint.className = 'validation-hint invalid';
      btnConsultar.disabled = true;
    }
  } else {
    validationHint.textContent = val.length > 0 ? `${val.length}/10 dígitos` : '';
    validationHint.className = 'validation-hint';
    btnConsultar.disabled = true;
  }
});

cedulaInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !btnConsultar.disabled) {
    ejecutarConsultaIndividual(normalizarCedula(cedulaInput.value));
  }
});

btnConsultar.addEventListener('click', () => {
  if (!btnConsultar.disabled) {
    ejecutarConsultaIndividual(normalizarCedula(cedulaInput.value));
  }
});

// ==========================================
// 3. CÁMARA Y ESCÁNER (INDIVIDUAL)
// ==========================================
function feedbackEscaneo() {
  if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {}
}

const btnToggleTorch = document.getElementById('btn-toggle-torch');
const btnSwitchCamera = document.getElementById('btn-switch-camera');
const cameraLabel = document.getElementById('camera-label');
const scannerZoomBar = document.getElementById('scanner-zoom-bar');
const zoomButtons = document.querySelectorAll('.btn-zoom');

let isTorchOn = false;
let isCameraBusy = false;
let availableCameras = [];
let currentCameraIndex = 0;
let textDetectorInterval = null;

// Control de Linterna
if (btnToggleTorch) {
  btnToggleTorch.addEventListener('click', async () => {
    if (!html5QrCode) return;
    try {
      isTorchOn = !isTorchOn;
      await html5QrCode.applyVideoConstraints({
        advanced: [{ torch: isTorchOn }]
      });
      btnToggleTorch.innerHTML = isTorchOn ? '💡 <span class="tool-label">Apagar</span>' : '💡 <span class="tool-label">Linterna</span>';
      btnToggleTorch.classList.toggle('active', isTorchOn);
    } catch (e) {
      console.warn('Torch no soportado:', e);
    }
  });
}

// Control de Zoom Rápido (1x, 1.5x, 2x, 3x)
async function setCameraZoom(zoomLevel) {
  if (!html5QrCode) return;
  try {
    const track = html5QrCode.getRunningTrack();
    if (track && track.applyConstraints) {
      await track.applyConstraints({
        advanced: [{ zoom: zoomLevel }]
      });
      zoomButtons.forEach(btn => {
        const z = parseFloat(btn.dataset.zoom);
        btn.classList.toggle('active', Math.abs(z - zoomLevel) < 0.1);
      });
    }
  } catch (e) {
    console.warn('Zoom no soportado:', e);
  }
}

zoomButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const z = parseFloat(btn.dataset.zoom);
    if (!isNaN(z)) setCameraZoom(z);
  });
});

// Control de Cambio de Cámara / Lente
if (btnSwitchCamera) {
  btnSwitchCamera.addEventListener('click', async () => {
    if (isCameraBusy || availableCameras.length <= 1) return;
    currentCameraIndex = (currentCameraIndex + 1) % availableCameras.length;
    await iniciarEscaneoCamara(availableCameras[currentCameraIndex].id);
  });
}

async function cerrarCamaraSilencioso() {
  if (textDetectorInterval) {
    clearInterval(textDetectorInterval);
    textDetectorInterval = null;
  }
  if (html5QrCode) {
    if (isTorchOn) {
      try {
        await html5QrCode.applyVideoConstraints({ advanced: [{ torch: false }] });
      } catch (_) {}
      isTorchOn = false;
      if (btnToggleTorch) {
        btnToggleTorch.innerHTML = '💡 <span class="tool-label">Linterna</span>';
        btnToggleTorch.classList.remove('active');
      }
    }
    try {
      if (html5QrCode.isScanning) await html5QrCode.stop();
    } catch (_) {}
    try {
      await html5QrCode.clear();
    } catch (_) {}
    html5QrCode = null;
  }
}

async function cerrarCamara() {
  if (isCameraBusy) return;
  isCameraBusy = true;
  try {
    await cerrarCamaraSilencioso();
  } catch (_) {}
  finally {
    scannerContainer.style.display = 'none';
    if (btnToggleTorch) btnToggleTorch.style.display = 'none';
    if (btnSwitchCamera) btnSwitchCamera.style.display = 'none';
    if (scannerZoomBar) scannerZoomBar.style.display = 'none';
    isCameraBusy = false;
  }
}

async function iniciarEscaneoCamara(cameraId = null) {
  if (isCameraBusy) return;
  isCameraBusy = true;

  try {
    // 1. Limpiar completamente cualquier instancia previa
    await cerrarCamaraSilencioso();

    // 2. Mostrar contenedor
    scannerContainer.style.display = 'block';

    // 3. Formatos soportados (PDF417 de cédula nueva, Code 39/128 de cédula tradicional, QR)
    const formats = [];
    if (window.Html5QrcodeSupportedFormats) {
      formats.push(
        Html5QrcodeSupportedFormats.PDF_417,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.QR_CODE
      );
    }

    // Instancia limpia con ZXing nativo en JS
    html5QrCode = new Html5Qrcode("reader", {
      useBarCodeDetectorIfSupported: false,
      formatsToSupport: formats.length > 0 ? formats : undefined,
      verbose: false
    });

    const isMobile = window.innerWidth <= 600;

    const config = {
      fps: 20,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const w = Math.round(Math.min(viewfinderWidth * 0.90, 360));
        const h = Math.round(Math.min(viewfinderHeight * 0.70, 240));
        return { width: Math.max(w, 240), height: Math.max(h, 150) };
      },
      aspectRatio: isMobile ? 1.2 : 1.5
    };

    const onDecoded = (decodedText) => {
      const cedulaEncontrada = extraerCedulaDeTexto(decodedText);
      if (cedulaEncontrada) {
        feedbackEscaneo();
        cerrarCamara();
        cedulaInput.value = cedulaEncontrada;
        btnConsultar.disabled = false;
        validationHint.textContent = `✓ Escaneado: ${cedulaEncontrada}`;
        validationHint.className = 'validation-hint valid';
        ejecutarConsultaIndividual(cedulaEncontrada);
      }
    };

    // Fuente de cámara: cameraId como string si existe, o { facingMode: "environment" } universal
    const cameraSource = cameraId ? cameraId : { facingMode: "environment" };

    await html5QrCode.start(cameraSource, config, onDecoded, () => {});

    // Una vez que la cámara ya está corriendo exitosamente:
    // A) Aplicar enfoque y zoom de manera segura
    try {
      const track = html5QrCode.getRunningTrack();
      if (track) {
        const caps = track.getCapabilities ? track.getCapabilities() : {};

        // Autoenfoque continuo si está disponible
        if (caps.focusMode && caps.focusMode.includes('continuous')) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
        }

        // Barra de zoom si el teléfono lo soporta
        if (caps.zoom) {
          if (scannerZoomBar) scannerZoomBar.style.display = 'flex';
          zoomButtons.forEach(btn => {
            const z = parseFloat(btn.dataset.zoom);
            btn.style.display = (z <= (caps.zoom.max || 8)) ? 'inline-block' : 'none';
          });
          // Auto-zoom a 1.5x o 2x para acercar la imagen sin que se vea lejana
          const defaultZoom = Math.min(2.0, caps.zoom.max || 1.0);
          if (defaultZoom >= 1.5) {
            setCameraZoom(defaultZoom);
          }
        }
      }
    } catch (e) {
      console.warn("No se pudo configurar zoom/enfoque:", e);
    }

    // B) Linterna si el teléfono la soporta
    try {
      const capabilities = html5QrCode.getRunningTrackCameraCapabilities();
      if (capabilities && capabilities.torchFeature && capabilities.torchFeature().isSupported()) {
        if (btnToggleTorch) btnToggleTorch.style.display = 'inline-flex';
      }
    } catch (_) {}

    // C) Enumerar cámaras secundarias para el botón de cambio de lente
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices && devices.length > 1) {
        const rear = devices.filter(d => 
          /back|rear|trasera|environment|0\b/i.test(d.label) || 
          !/front|delantera|selfie|user/i.test(d.label)
        );
        availableCameras = rear.length > 1 ? rear : devices;
        if (availableCameras.length > 1 && btnSwitchCamera) {
          btnSwitchCamera.style.display = 'inline-flex';
          if (cameraLabel) {
            cameraLabel.textContent = `Lente ${currentCameraIndex + 1}/${availableCameras.length}`;
          }
        }
      }
    } catch (_) {}

    // D) Detección de texto OCR para leer los 10 dígitos al frente
    if ('TextDetector' in window) {
      try {
        const textDetector = new TextDetector();
        textDetectorInterval = setInterval(async () => {
          if (!html5QrCode || !html5QrCode.isScanning) return;
          const videoEl = document.querySelector('#reader video');
          if (!videoEl || videoEl.readyState < 2) return;
          try {
            const detectedTexts = await textDetector.detect(videoEl);
            for (const t of detectedTexts) {
              const ced = extraerCedulaDeTexto(t.rawValue);
              if (ced) {
                onDecoded(ced);
                break;
              }
            }
          } catch (_) {}
        }, 350);
      } catch (_) {}
    }

  } catch (err) {
    console.error("Error al iniciar cámara:", err);
    await cerrarCamaraSilencioso();
    scannerContainer.style.display = 'none';

    const msg = (err && (err.message || String(err))) || '';
    if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
      alert('Permiso de cámara no concedido.\nActiva el permiso de cámara en la app o navegador para escanear.');
    } else {
      alert(`No se pudo acceder a la cámara: ${msg}`);
    }
  } finally {
    isCameraBusy = false;
  }
}

btnCamera.addEventListener('click', async () => {
  if (scannerContainer.style.display === 'block') {
    await cerrarCamara();
    return;
  }
  await iniciarEscaneoCamara();
});

btnStopCamera.addEventListener('click', cerrarCamara);

// NFC
btnNfc.addEventListener('click', async () => {
  // Si el botón sugiere usar la cámara tras detectar el chip protegido
  if (btnNfc.querySelector('span').textContent.includes('Cámara')) {
    btnCamera.click();
    return;
  }

  // 1. Si está ejecutándose dentro de la App Nativa Android
  if (window.AndroidBridge) {
    if (window.AndroidBridge.showToast) {
      window.AndroidBridge.showToast('NFC Activo: Acerca la cédula a la parte posterior del teléfono');
    }
    btnNfc.style.borderColor = 'var(--warning)';
    btnNfc.querySelector('span').textContent = 'Acerca la cédula al teléfono...';
    setTimeout(() => {
      btnNfc.style.borderColor = 'var(--primary)';
      btnNfc.querySelector('span').textContent = 'NFC Nativo Activo';
    }, 4000);
    return;
  }

  // 2. Si está en navegador web estándar
  if (!('NDEFReader' in window)) {
    alert('Tu navegador web no soporta Web NFC directo.\nUsa la cámara para escanear el código de barras o instala la App oficial.');
    return;
  }

  try {
    nfcAbortController = new AbortController();
    const ndef = new NDEFReader();
    await ndef.scan({ signal: nfcAbortController.signal });

    btnNfc.style.borderColor = 'var(--warning)';
    btnNfc.querySelector('span').textContent = 'Acerca la cédula al teléfono...';

    ndef.onreading = (event) => {
      feedbackEscaneo();
      let cedula = null;
      if (event.serialNumber) cedula = extraerCedulaDeTexto(event.serialNumber);

      for (const record of event.message.records) {
        const textDecoder = new TextDecoder(record.encoding || 'utf-8');
        const pos = extraerCedulaDeTexto(textDecoder.decode(record.data));
        if (pos) { cedula = pos; break; }
      }

      if (cedula) {
        if (nfcAbortController) nfcAbortController.abort();
        btnNfc.style.borderColor = 'var(--primary)';
        btnNfc.querySelector('span').textContent = 'Acercar Cédula (NFC)';
        cedulaInput.value = cedula;
        ejecutarConsultaIndividual(cedula);
      }
    };
  } catch (error) {
    btnNfc.style.borderColor = 'var(--primary)';
    btnNfc.querySelector('span').textContent = 'Acercar Cédula (NFC)';

    if (error.name === 'NotAllowedError') {
      alert('Permiso NFC no concedido en el navegador.\n\nPara activarlo en Chrome:\n1. Toca el icono de configuración a la izquierda del enlace.\n2. Ve a "Permisos" y activa "NFC".\n\nO usa el botón de Cámara que lee el código de barras al instante.');
    } else {
      alert(`Información NFC: ${error.message}\nUsa la cámara para lectura instantánea.`);
    }
  }
});

// ==========================================
// 3.1. LECTOR DE CÓDIGO DE BARRAS EXTERNO (USB / BLUETOOTH / WEDGE)
// Compatible con computadoras, laptops y lectores tipo pistola
// ==========================================
let scannerBuffer = '';
let lastKeyTime = 0;
let scannerTimer = null;

function procesarBufferEscaneado(texto) {
  if (!texto) return false;
  const cedula = extraerCedulaDeTexto(texto);
  if (cedula && validarCedulaCliente(cedula)) {
    feedbackEscaneo();
    cedulaInput.value = cedula;
    btnConsultar.disabled = false;
    validationHint.textContent = `✓ Escaneado por Lector: ${cedula}`;
    validationHint.className = 'validation-hint valid';

    if (scannerBanner) {
      scannerBanner.classList.add('flash-success');
      if (scannerBannerText) {
        scannerBannerText.innerHTML = `<strong>¡Cédula Escaneada (${cedula})!</strong> Calificando paciente...`;
      }
      setTimeout(() => {
        scannerBanner.classList.remove('flash-success');
        if (scannerBannerText) {
          scannerBannerText.innerHTML = `<strong>Lector Externo Activo:</strong> Dispara al código de barras (PDF417) en cualquier momento.`;
        }
      }, 3500);
    }

    ejecutarConsultaIndividual(cedula);
    return true;
  }
  return false;
}

if (btnUsbScanner) {
  btnUsbScanner.addEventListener('click', () => {
    feedbackEscaneo();
    cedulaInput.focus();
    if (scannerBanner) {
      scannerBanner.classList.add('flash-success');
      if (scannerBannerText) {
        scannerBannerText.innerHTML = `<strong>Lector Listo:</strong> Apunta la pistola o lector al código de barras de la cédula...`;
      }
      setTimeout(() => {
        scannerBanner.classList.remove('flash-success');
        if (scannerBannerText) {
          scannerBannerText.innerHTML = `<strong>Lector Externo Activo:</strong> Dispara al código de barras (PDF417) en cualquier momento.`;
        }
      }, 3000);
    }
  });
}

// Escucha global de teclado (Keyboard Wedge) para lectores de códigos de barras USB / Bluetooth
window.addEventListener('keydown', (e) => {
  // Si el usuario está trabajando en el cuadro de texto masivo, no interferir
  if (document.activeElement === bulkTextarea) {
    return;
  }

  const currentTime = Date.now();
  const timeDiff = currentTime - lastKeyTime;
  lastKeyTime = currentTime;

  // Si pasa más de 120ms entre teclas, se reinicia el buffer (a menos que sea Enter)
  if (timeDiff > 120) {
    scannerBuffer = '';
  }

  if (e.key === 'Enter') {
    // Si viene de un lector de barras o el buffer acumuló datos
    if (scannerBuffer.length >= 8) {
      const exitoso = procesarBufferEscaneado(scannerBuffer);
      if (exitoso) {
        e.preventDefault();
        e.stopPropagation();
      }
      scannerBuffer = '';
      return;
    }
    // Si el foco estaba en cedulaInput y se presionó Enter
    if (document.activeElement === cedulaInput && cedulaInput.value) {
      const exitoso = procesarBufferEscaneado(cedulaInput.value);
      if (exitoso) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    scannerBuffer = '';
    return;
  }

  // Teclas imprimibles (alfanuméricas y caracteres estándar)
  if (e.key.length === 1) {
    scannerBuffer += e.key;

    // Timeout de seguridad por si la pistola lectora no envía Enter al final
    clearTimeout(scannerTimer);
    scannerTimer = setTimeout(() => {
      if (scannerBuffer.length >= 9) {
        procesarBufferEscaneado(scannerBuffer);
      }
      scannerBuffer = '';
    }, 100);
  }
}, true);

// Integración con Android Nativo (Bridge)
if (window.AndroidBridge) {
  btnNfc.querySelector('span').textContent = 'NFC Nativo Activo';
  if (window.AndroidBridge.getAppVersion) {
    const vBadge = document.getElementById('app-version-badge');
    const fVersion = document.getElementById('footer-version');
    const nativeV = window.AndroidBridge.getAppVersion();
    if (vBadge && nativeV && nativeV >= '1.3.0') vBadge.textContent = 'v' + nativeV;
    if (fVersion && nativeV && nativeV >= '1.3.0') fVersion.textContent = nativeV;
  }
}

window.onNativeNfcDiscovered = function(data) {
  feedbackEscaneo();

  // CASO 1: El chip entregó el número de cédula (DG1 o lectura directa)
  if (data.cedula && validarCedulaCliente(data.cedula)) {
    if (window.AndroidBridge && window.AndroidBridge.showToast) {
      window.AndroidBridge.showToast('Cédula leída por NFC: ' + data.cedula);
    }
    btnNfc.style.borderColor = 'var(--success)';
    btnNfc.querySelector('span').textContent = 'Cédula: ' + data.cedula;

    // Escribir el número en el campo de texto
    cedulaInput.value = data.cedula;

    // Arrancar inmediatamente la calificación del paciente
    ejecutarConsultaIndividual(data.cedula);
    return;
  }

  // CASO 2: Si el input ya tenía cédula y se acerca la tarjeta
  if (cedulaInput.value && validarCedulaCliente(cedulaInput.value)) {
    if (window.AndroidBridge && window.AndroidBridge.showToast) {
      window.AndroidBridge.showToast('Calificando paciente...');
    }
    btnNfc.style.borderColor = 'var(--success)';
    btnNfc.querySelector('span').textContent = 'Consultando...';
    ejecutarConsultaIndividual(cedulaInput.value);
    return;
  }

  // CASO 3: Chip detectado pero protegido por seguridad criptográfica BAC (Registro Civil ICAO)
  if (data.requiereDesbloqueoBAC || data.esCedulaElectronica) {
    btnNfc.style.borderColor = 'var(--warning)';
    btnNfc.querySelector('span').textContent = 'Chip Protegido (ICAO)';
    if (window.AndroidBridge && window.AndroidBridge.showToast) {
      window.AndroidBridge.showToast('🛡️ Chip seguro: usa la cámara o lector USB');
    }
    
    if (scannerBanner && scannerBannerText) {
      scannerBanner.classList.add('flash-success');
      scannerBannerText.innerHTML = `<strong>🛡️ Chip ICAO Detectado:</strong> Por seguridad nacional no transmite datos al aire. <strong>Usa la Cámara o Lector USB para calificar en 0.2 seg.</strong>`;
    }

    validationHint.textContent = '💡 Por seguridad del Registro Civil (ICAO 9303), escanea el código del reverso';
    validationHint.className = 'validation-hint';
    return;
  }

  // CASO 4: Tarjeta NFC o chip con serial de hardware (ej. 043518A3)
  if (data.serialHex) {
    btnNfc.style.borderColor = 'var(--warning)';
    btnNfc.querySelector('span').textContent = '📸 Toca Cámara (0.1s)';
    
    if (window.AndroidBridge && window.AndroidBridge.showToast) {
      window.AndroidBridge.showToast('Chip detectado: Toca "Escanear Cámara" para calificar');
    }

    if (scannerBanner && scannerBannerText) {
      scannerBanner.classList.add('flash-success');
      scannerBannerText.innerHTML = `<strong>Chip NFC Detectado (${data.serialHex.substring(0, 8)}):</strong> Por seguridad nacional ICAO, la cédula no se transmite al aire. <strong>Toca "Escanear Cámara" para calificar en 0.1s.</strong>`;
    }

    validationHint.textContent = `💡 Chip NFC ${data.serialHex.substring(0, 8)} detectado. Toca 'Escanear Cámara' o enfoca el código del reverso.`;
    validationHint.className = 'validation-hint';
  }
};

// ==========================================
// 4. CONSULTA INDIVIDUAL
// ==========================================
async function ejecutarConsultaIndividual(cedula) {
  loader.style.display = 'block';
  resultContainer.style.display = 'none';

  try {
    let fechaQuery = '';
    if (singleDateInput && singleDateInput.value) {
      const fNorm = parsearFechaGenerica(singleDateInput.value);
      if (fNorm) {
        fechaQuery = `&fecha=${encodeURIComponent(fNorm)}`;
      }
    }
    const res = await fetch(`/api/calificar?cedula=${cedula}${fechaQuery}`);
    const data = await res.json();
    loader.style.display = 'none';
    mostrarResultadoIndividual(data);
  } catch (error) {
    loader.style.display = 'none';
    alert(`Error al consultar: ${error.message}`);
  }
}

/**
 * Clasifica de forma precisa el Tipo de Seguro médico según la normativa IESS:
 * - CA: Campesino Afiliado (Jefe de familia / Titular del Seguro Social Campesino)
 * - CB: Campesino Beneficiario (Dependiente / Familiar del Seguro Social Campesino)
 * - JUB-SSC: Jubilado del Seguro Social Campesino
 * - SG: Seguro General (Tiempo Completo / Tiempo Parcial)
 * - JUB-SG: Jubilado Seguro General
 * - MONTEPIO: Pensionista / Montepío
 * - VOL: Afiliado Voluntario
 * - DEP-SG: Dependiente por extensión de cobertura (Cónyuge / Hijos menores)
 */
function clasificarTipoSeguroCliente(tipoAfiliacion = '', observacion = '', acreditado = true) {
  const afil = String(tipoAfiliacion || '').trim();
  const obs = String(observacion || '').trim();
  const combo = `${afil} ${obs}`.toUpperCase();

  if (!acreditado) {
    return {
      codigo: 'SIN_COBERTURA',
      nombre: 'SIN COBERTURA ACTIVA',
      subsistema: 'NO ACREDITADO',
      badgeClass: 'badge-seguro invalido'
    };
  }

  // 1. SEGURO SOCIAL CAMPESINO (SSC)
  const esCampesino = /CAMPESINO|SSC/i.test(combo);
  if (esCampesino) {
    if (/JEFE DE FAMILIA/i.test(combo)) {
      return {
        codigo: 'CA',
        nombre: 'SEGURO SOCIAL CAMPESINO - CA (JEFE DE FAMILIA / TITULAR)',
        subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)',
        badgeClass: 'badge-seguro ca'
      };
    }
    if (/JUBILAD/i.test(combo)) {
      return {
        codigo: 'JUB-SSC',
        nombre: 'JUBILADO SEGURO SOCIAL CAMPESINO (SSC)',
        subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)',
        badgeClass: 'badge-seguro jub'
      };
    }
    return {
      codigo: 'CB',
      nombre: 'SEGURO SOCIAL CAMPESINO - CB (BENEFICIARIO / DEPENDIENTE)',
      subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)',
      badgeClass: 'badge-seguro cb'
    };
  }

  // 2. JUBILADOS SEGURO GENERAL
  if (/JUBILAD/i.test(combo)) {
    return {
      codigo: 'JUB-SG',
      nombre: 'JUBILADO SEGURO GENERAL',
      subsistema: 'SEGURO GENERAL (IESS)',
      badgeClass: 'badge-seguro jub'
    };
  }

  // 3. MONTEPÍO / PENSIONISTA
  if (/MONTEP[IÍ]O|PENSIONISTA/i.test(combo)) {
    return {
      codigo: 'MONTEPIO',
      nombre: 'PENSIONISTA / MONTEPÍO (IESS)',
      subsistema: 'SEGURO GENERAL (IESS)',
      badgeClass: 'badge-seguro sg'
    };
  }

  // 4. AFILIADO VOLUNTARIO
  if (/VOLUNTARI/i.test(combo)) {
    return {
      codigo: 'VOL',
      nombre: 'AFILIADO VOLUNTARIO (IESS)',
      subsistema: 'SEGURO GENERAL (IESS)',
      badgeClass: 'badge-seguro sg'
    };
  }

  // 5. DEPENDIENTES (CÓNYUGE / HIJOS MENORES - EXTENSIÓN DE COBERTURA)
  if (/C[OÓ]NYUGE|HIJO|DEPENDIENTE|EXTENSI[OÓ]N/i.test(combo)) {
    return {
      codigo: 'DEP-SG',
      nombre: 'DEPENDIENTE POR EXTENSIÓN DE COBERTURA (IESS)',
      subsistema: 'SEGURO GENERAL (IESS)',
      badgeClass: 'badge-seguro sg'
    };
  }

  // 6. SEGURO GENERAL TIEMPO COMPLETO / PARCIAL
  if (/TIEMPO COMPLETO/i.test(combo)) {
    return {
      codigo: 'SG',
      nombre: 'AFILIADO SEGURO GENERAL TIEMPO COMPLETO',
      subsistema: 'SEGURO GENERAL (IESS)',
      badgeClass: 'badge-seguro sg'
    };
  }
  if (/TIEMPO PARCIAL|MEDIO TIEMPO/i.test(combo)) {
    return {
      codigo: 'SG-TP',
      nombre: 'AFILIADO SEGURO GENERAL TIEMPO PARCIAL',
      subsistema: 'SEGURO GENERAL (IESS)',
      badgeClass: 'badge-seguro sg'
    };
  }

  return {
    codigo: 'SG',
    nombre: afil || 'SEGURO GENERAL',
    subsistema: 'SEGURO GENERAL (IESS)',
    badgeClass: 'badge-seguro sg'
  };
}

function mostrarResultadoIndividual(data) {
  resultContainer.style.display = 'block';

  resCedula.textContent = data.cedula || '---';
  resNombres.textContent = (data.iess && data.iess.nombres) || 'No especificado';
  resAfiliacion.textContent = (data.iess && data.iess.tipoAfiliacion) || 'Seguro General';
  resTiempo.textContent = `${data.duracionMs || 0} ms`;

  const isAcred = data.estadoFinal === 'ACREDITADO';
  const segInfo = (data.iess && data.iess.tipoSeguro && data.iess.codigoSeguro)
    ? {
        codigo: data.iess.codigoSeguro,
        nombre: data.iess.tipoSeguro,
        subsistema: data.iess.subSistema || data.iess.entidad,
        badgeClass: `badge-seguro ${data.iess.codigoSeguro.toLowerCase().replace(/[^a-z]/g, '')}`
      }
    : clasificarTipoSeguroCliente(data.iess?.tipoAfiliacion, data.iess?.observacion, isAcred);

  if (resTipoSeguro) resTipoSeguro.textContent = segInfo.nombre;
  if (resCodigoSeguro) {
    resCodigoSeguro.innerHTML = `<span class="${segInfo.badgeClass}">${segInfo.codigo}</span> <strong style="color: var(--slate-700); margin-left: 6px;">${segInfo.subsistema}</strong>`;
  }
  if (resFechaCalificada) {
    const fInput = singleDateInput && singleDateInput.value ? parsearFechaGenerica(singleDateInput.value) : null;
    resFechaCalificada.textContent = data.fechaCalificada || fInput || 'Al día de hoy';
  }

  if (isAcred) {
    statusBanner.className = 'status-banner acreditado';
    statusTitle.innerHTML = `🟢 ACREDITADO • ${segInfo.codigo}`;
    statusDesc.textContent = `${segInfo.nombre} — ${(data.iess && data.iess.observacion) || 'Cobertura médica vigente para Enfermedad.'}`;
  } else if (data.estadoFinal === 'NO_ACREDITADO') {
    statusBanner.className = 'status-banner no-acreditado';
    statusTitle.innerHTML = '🔴 NO ACREDITADO';
    statusDesc.textContent = (data.iess && data.iess.observacion) || 'Sin cobertura para Enfermedad en el IESS.';
  } else {
    statusBanner.className = 'status-banner';
    statusBanner.style.backgroundColor = 'var(--warning-bg)';
    statusBanner.style.borderColor = 'var(--warning)';
    statusBanner.style.color = '#78350f';
    statusTitle.innerHTML = '🟡 REVISIÓN REQUERIDA';
    statusDesc.textContent = (data.iess && data.iess.observacion) || data.mensaje || 'Se requiere validación manual.';
  }

  if (data.msp && data.msp.exito) {
    mspDesc.innerHTML = `<strong>Red detectada:</strong> ${data.msp.redDetectada || 'Cobertura Pública'}`;
  } else if (data.msp) {
    mspDesc.textContent = data.msp.mensaje || 'Información de RPIS no disponible en este momento';
  }

  resultContainer.scrollIntoView({ behavior: 'smooth' });
}

btnNuevaConsulta.addEventListener('click', () => {
  resultContainer.style.display = 'none';
  cedulaInput.value = '';
  if (singleDateInput) singleDateInput.value = '';
  validationHint.textContent = '';
  btnConsultar.disabled = true;
  cedulaInput.focus();
});

// ==========================================
// 5. MODO MASIVO (SOPORTE DE 4000+ CÉDULAS)
// ==========================================

const btnPickFile = document.getElementById('btn-pick-file');
const fileSelectedName = document.getElementById('file-selected-name');

if (btnPickFile) {
  btnPickFile.addEventListener('click', () => fileInput.click());
}

dropzone.addEventListener('click', () => fileInput.click());

['dragenter', 'dragover'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  const files = dt.files;
  if (files && files.length > 0) {
    const f = files[0];
    if (fileSelectedName) fileSelectedName.textContent = `✓ Seleccionado: ${f.name} (${Math.round(f.size/1024)} KB)`;
    procesarArchivoSeleccionado(f);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    const f = e.target.files[0];
    if (fileSelectedName) fileSelectedName.textContent = `✓ Seleccionado: ${f.name} (${Math.round(f.size/1024)} KB)`;
    procesarArchivoSeleccionado(f);
  }
});

// Carga automática directa desde C:\DATOSMIS
const btnLoadDatosmis = document.getElementById('btn-load-datosmis');
if (btnLoadDatosmis) {
  btnLoadDatosmis.addEventListener('click', async () => {
    btnLoadDatosmis.disabled = true;
    const textoOriginal = btnLoadDatosmis.innerHTML;
    btnLoadDatosmis.innerHTML = '<span>⏳ Leyendo C:\\DATOSMIS...</span>';

    try {
      const res = await fetch('/api/cargar-datosmis');
      const data = await res.json();

      if (!data.exito) {
        alert(`Aviso: ${data.mensaje}`);
        btnLoadDatosmis.disabled = false;
        btnLoadDatosmis.innerHTML = textoOriginal;
        return;
      }

      const rawTodas = data.todasCedulas || data.cedulas || [];
      const todas = rawTodas.map(c => ({ cedula: c, fecha: null }));
      const unicasMap = new Map();
      todas.forEach(it => {
        if (!unicasMap.has(it.cedula)) unicasMap.set(it.cedula, it);
      });
      const unicas = Array.from(unicasMap.values());
      const duplicadosRemovidos = todas.length - unicas.length;

      archivoCargadoDatos = {
        totalOriginal: todas.length,
        duplicadosOriginal: duplicadosRemovidos,
        todas,
        unicas,
        nombre: data.archivo,
        cerosRecuperados: data.conCeroRecuperado
      };

      if (sheetSelectorContainer) sheetSelectorContainer.style.display = 'none';
      actualizarTextareaPorModo();

      alert(`¡Archivo cargado automáticamente desde C:\\DATOSMIS!\n\n` +
            `• Archivo leído: ${data.archivo}\n` +
            `• Total registros de atención: ${todas.length.toLocaleString()} filas\n` +
            `• Pacientes únicos: ${unicas.length.toLocaleString()} (${duplicadosRemovidos.toLocaleString()} duplicados removidos)\n` +
            `• Cédulas con '0' inicial restaurado: ${data.conCeroRecuperado}\n\n` +
            `Se han cargado los ${unicas.length.toLocaleString()} pacientes únicos listos para calificar.`);

      btnLoadDatosmis.disabled = false;
      btnLoadDatosmis.innerHTML = `<span>✓ Cargado: ${data.archivo} (${unicas.length.toLocaleString()} únicos de ${todas.length.toLocaleString()})</span>`;
    } catch (err) {
      alert(`No se pudo cargar desde el servidor local: ${err.message}`);
      btnLoadDatosmis.disabled = false;
      btnLoadDatosmis.innerHTML = textoOriginal;
    }
  });
}

function procesarArchivoSeleccionado(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });

        workbookSheetsMap = new Map();
        const sheetsConDatos = [];

        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          if (!sheet) return;
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
          if (!rows || rows.length === 0) return;

          // Buscar columnas de cédula y fecha si la primera fila tiene cabecera
          let colCedulaIdx = -1;
          let colFechaIdx = -1;

          if (Array.isArray(rows[0])) {
            const headers = rows[0].map(h => String(h || '').trim().toUpperCase());
            const posiblesHeadersCedula = ['NRO_DOCUMENTO', 'NUMERO_DOCUMENTO', 'CEDULA', 'IDENTIFICACION', 'DOCUMENTO', 'NRO_DOC', 'PACIENTE_CEDULA', 'CEDULA_PACIENTE', 'CI'];
            for (const ph of posiblesHeadersCedula) {
              const idx = headers.indexOf(ph);
              if (idx !== -1) {
                colCedulaIdx = idx;
                break;
              }
            }

            const posiblesHeadersFecha = ['FECHA', 'FECHA_ATENCION', 'FECHA ATENCION', 'FEC_ATENCION', 'FECHA FORMULARIO 053', 'FECHA_FORMULARIO_053', 'FECHA_CONSULTA', 'FECHA CONSULTA', 'FEC_CONSULTA', 'FECHA_CITA', 'FECHA CITA', 'FECHA_EMISION', 'FECHA EMISION', 'FEC_REGISTRO', 'FECHA REGISTRO'];
            for (const ph of posiblesHeadersFecha) {
              const idx = headers.indexOf(ph);
              if (idx !== -1) {
                colFechaIdx = idx;
                break;
              }
            }
          }

          const cedulasHoja = [];
          let corregidasHoja = 0;

          rows.forEach((r, rIdx) => {
            if (!Array.isArray(r)) return;
            if (colCedulaIdx !== -1) {
              if (rIdx === 0) return; // Saltar cabecera
              const cellCedula = r[colCedulaIdx];
              if (cellCedula !== null && cellCedula !== undefined) {
                const digits = String(cellCedula).replace(/\D/g, '');
                if (digits.length === 9 || digits.length === 10) {
                  const norm = normalizarCedula(digits);
                  if (digits.length === 9) corregidasHoja++;

                  // Extraer fecha si existe en columna específica o en otra celda
                  let fechaRow = null;
                  if (colFechaIdx !== -1 && r[colFechaIdx] !== null && r[colFechaIdx] !== undefined) {
                    fechaRow = parsearFechaGenerica(r[colFechaIdx]);
                  }
                  if (!fechaRow) {
                    for (let c = 0; c < r.length; c++) {
                      if (c === colCedulaIdx) continue;
                      const fCand = parsearFechaGenerica(r[c]);
                      if (fCand) {
                        fechaRow = fCand;
                        break;
                      }
                    }
                  }

                  cedulasHoja.push({ cedula: norm, fecha: fechaRow });
                }
              }
            } else {
              // Sin encabezado específico (ej. CB CA.xlsx): escanear fila
              let normCedula = null;
              let fechaRow = null;

              for (const cell of r) {
                if (cell === null || cell === undefined) continue;
                if (!normCedula) {
                  const digits = String(cell).replace(/\D/g, '');
                  if (digits.length === 9 || digits.length === 10) {
                    normCedula = normalizarCedula(digits);
                    if (digits.length === 9) corregidasHoja++;
                    continue;
                  }
                }
                if (!fechaRow) {
                  const fCand = parsearFechaGenerica(cell);
                  if (fCand) {
                    fechaRow = fCand;
                  }
                }
              }

              if (normCedula) {
                cedulasHoja.push({ cedula: normCedula, fecha: fechaRow });
              }
            }
          });

          if (cedulasHoja.length > 0) {
            const unicasMap = new Map();
            cedulasHoja.forEach(item => {
              if (!unicasMap.has(item.cedula)) {
                unicasMap.set(item.cedula, item);
              } else if (!unicasMap.get(item.cedula).fecha && item.fecha) {
                unicasMap.set(item.cedula, item);
              }
            });
            const unicasHoja = Array.from(unicasMap.values());

            workbookSheetsMap.set(sheetName, {
              todas: cedulasHoja,
              unicas: unicasHoja,
              ceros: corregidasHoja
            });
            sheetsConDatos.push({
              name: sheetName,
              total: cedulasHoja.length,
              unicas: unicasHoja.length,
              ceros: corregidasHoja
            });
          }
        });

        if (sheetsConDatos.length === 0) {
          alert(`No se detectaron columnas con números de cédula (de 9 o 10 dígitos) en el archivo "${file.name}".`);
          return;
        }

        // Si hay múltiples hojas con datos, mostrar selector de hojas
        if (sheetsConDatos.length > 1 && sheetSelectorContainer && sheetSelect) {
          sheetSelect.innerHTML = '';
          const totalGeneral = sheetsConDatos.reduce((acc, s) => acc + s.total, 0);
          const optTodas = document.createElement('option');
          optTodas.value = '__TODAS__';
          optTodas.textContent = `⭐ Todas las hojas combinadas (${totalGeneral.toLocaleString()} filas en total)`;
          sheetSelect.appendChild(optTodas);

          sheetsConDatos.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.name;
            opt.textContent = `📄 Hoja: ${s.name} (${s.total.toLocaleString()} filas, ${s.unicas.toLocaleString()} únicos)`;
            sheetSelect.appendChild(opt);
          });

          sheetSelectorContainer.style.display = 'block';

          // Por defecto combinar todas las hojas
          const todasCombinadas = [];
          let cerosTotales = 0;
          sheetsConDatos.forEach(s => {
            todasCombinadas.push(...workbookSheetsMap.get(s.name).todas);
            cerosTotales += s.ceros;
          });

          const unicasMap = new Map();
          todasCombinadas.forEach(it => {
            if (!unicasMap.has(it.cedula)) unicasMap.set(it.cedula, it);
            else if (!unicasMap.get(it.cedula).fecha && it.fecha) unicasMap.set(it.cedula, it);
          });
          const unicasCombinadas = Array.from(unicasMap.values());

          archivoCargadoDatos = {
            totalOriginal: todasCombinadas.length,
            duplicadosOriginal: todasCombinadas.length - unicasCombinadas.length,
            todas: todasCombinadas,
            unicas: unicasCombinadas,
            nombre: file.name,
            cerosRecuperados: cerosTotales
          };
        } else {
          // Una sola hoja
          if (sheetSelectorContainer) sheetSelectorContainer.style.display = 'none';
          const s = sheetsConDatos[0];
          const info = workbookSheetsMap.get(s.name);
          archivoCargadoDatos = {
            totalOriginal: info.todas.length,
            duplicadosOriginal: info.todas.length - info.unicas.length,
            todas: info.todas,
            unicas: info.unicas,
            nombre: file.name,
            cerosRecuperados: info.ceros
          };
        }

        actualizarTextareaPorModo();

        const totalCargado = archivoCargadoDatos.totalOriginal;
        const unicosCargados = archivoCargadoDatos.unicas.length;
        const duplicadosRemovidos = archivoCargadoDatos.duplicadosOriginal;

        alert(`¡Archivo cargado con éxito!\n\n` +
              `• Archivo: ${file.name}\n` +
              `• Total filas en planilla: ${totalCargado.toLocaleString()}\n` +
              `• Pacientes únicos: ${unicosCargados.toLocaleString()} (Se removieron ${duplicadosRemovidos.toLocaleString()} filas duplicadas)\n` +
              `• Cédulas restauradas con el '0' inicial: ${archivoCargadoDatos.cerosRecuperados}\n\n` +
              `Por defecto se cargaron los ${unicosCargados.toLocaleString()} pacientes únicos sin duplicados para calificar rápido.\n` +
              `Si deseas calificar cada una de las ${totalCargado.toLocaleString()} filas completas, puedes seleccionar "Todas las filas" arriba.`);
      } catch (err) {
        alert(`Error al leer archivo Excel: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // CSV o TXT
    if (sheetSelectorContainer) sheetSelectorContainer.style.display = 'none';
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const rawLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const cedulasExtraidas = [];
      let corregidasConCero = 0;

      // Detectar cabecera CSV
      if (rawLines.length > 0) {
        const firstLine = rawLines[0];
        const delim = firstLine.includes(';') ? ';' : (firstLine.includes('\t') ? '\t' : ',');
        const headers = firstLine.split(delim).map(h => h.replace(/["']/g, '').trim().toUpperCase());

        let colIndex = -1;
        let colFechaIndex = -1;
        const posiblesHeadersCedula = ['NRO_DOCUMENTO', 'NUMERO_DOCUMENTO', 'CEDULA', 'IDENTIFICACION', 'DOCUMENTO', 'NRO_DOC', 'PACIENTE_CEDULA', 'CI'];
        for (const ph of posiblesHeadersCedula) {
          const idx = headers.indexOf(ph);
          if (idx !== -1) {
            colIndex = idx;
            break;
          }
        }
        const posiblesHeadersFecha = ['FECHA', 'FECHA_ATENCION', 'FECHA ATENCION', 'FEC_ATENCION', 'FECHA FORMULARIO 053', 'FECHA_CONSULTA', 'FEC_CONSULTA'];
        for (const ph of posiblesHeadersFecha) {
          const idx = headers.indexOf(ph);
          if (idx !== -1) {
            colFechaIndex = idx;
            break;
          }
        }

        if (colIndex !== -1) {
          for (let i = 1; i < rawLines.length; i++) {
            const cols = rawLines[i].split(delim);
            if (cols.length > colIndex) {
              const rawVal = cols[colIndex].replace(/["']/g, '').trim();
              const digits = rawVal.replace(/\D/g, '');
              if (digits.length === 9 || digits.length === 10) {
                const normal = normalizarCedula(digits);
                if (digits.length === 9) corregidasConCero++;
                let fechaRow = null;
                if (colFechaIndex !== -1 && cols.length > colFechaIndex) {
                  fechaRow = parsearFechaGenerica(cols[colFechaIndex].replace(/["']/g, '').trim());
                }
                cedulasExtraidas.push({ cedula: normal, fecha: fechaRow });
              }
            }
          }
        } else {
          // Búsqueda genérica en cada línea
          rawLines.forEach(line => {
            const parsed = extraerCedulaYFechaDeLinea(line);
            if (parsed) {
              cedulasExtraidas.push(parsed);
            }
          });
        }
      }

      if (cedulasExtraidas.length === 0) {
        alert(`No se detectaron cédulas en el archivo "${file.name}".`);
        return;
      }

      const totalAtenciones = cedulasExtraidas.length;
      const unicasMap = new Map();
      cedulasExtraidas.forEach(it => {
        if (!unicasMap.has(it.cedula)) unicasMap.set(it.cedula, it);
        else if (!unicasMap.get(it.cedula).fecha && it.fecha) unicasMap.set(it.cedula, it);
      });
      const unicas = Array.from(unicasMap.values());
      const duplicadosRemovidos = totalAtenciones - unicas.length;

      archivoCargadoDatos = {
        totalOriginal: totalAtenciones,
        duplicadosOriginal: duplicadosRemovidos,
        todas: cedulasExtraidas,
        unicas,
        nombre: file.name,
        cerosRecuperados: corregidasConCero
      };

      actualizarTextareaPorModo();

      alert(`¡Archivo cargado con éxito!\n\n` +
            `• Archivo: ${file.name}\n` +
            `• Total filas en planilla: ${totalAtenciones.toLocaleString()}\n` +
            `• Pacientes únicos: ${unicas.length.toLocaleString()} (Se removieron ${duplicadosRemovidos.toLocaleString()} duplicados)\n` +
            `• Cédulas restauradas con el '0' inicial: ${corregidasConCero}\n\n` +
            `Se han cargado los ${unicas.length.toLocaleString()} pacientes únicos sin duplicados.`);
    };
    reader.readAsText(file, 'latin1');
  }
}

// Iniciar Procesamiento Masivo con Pool Paralelo y Caché Inteligente
btnStartBulk.addEventListener('click', async () => {
  const rawText = bulkTextarea.value.trim();
  if (!rawText) {
    alert('Por favor sube un archivo o pega tus cédulas en el recuadro.');
    return;
  }

  // Dividir por líneas para respetar el orden exacto de la planilla o texto
  const rawLines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean);
  const items = [];

  rawLines.forEach(line => {
    const parsed = extraerCedulaYFechaDeLinea(line);
    if (parsed) {
      items.push(parsed);
    } else {
      const digits = line.replace(/\D/g, '');
      if (digits.length > 0) {
        items.push({ cedula: digits, fecha: null });
      }
    }
  });

  const esModoUnicas = modeUniqueOnly && modeUniqueOnly.checked;
  let listaAProcesar = [];
  if (esModoUnicas) {
    const unicasMap = new Map();
    items.forEach(it => {
      if (!unicasMap.has(it.cedula)) {
        unicasMap.set(it.cedula, it);
      } else if (!unicasMap.get(it.cedula).fecha && it.fecha) {
        unicasMap.set(it.cedula, it);
      }
    });
    listaAProcesar = Array.from(unicasMap.values());
  } else {
    listaAProcesar = items;
  }

  if (listaAProcesar.length === 0) {
    alert('No se detectaron cédulas en el texto pegado.');
    return;
  }

  bulkAborted = false;
  bulkResults = [];
  bulkTableBody.innerHTML = '';
  bulkProgressCard.style.display = 'block';
  bulkTableCard.style.display = 'block';
  btnExportExcel.style.display = 'none';
  btnStartBulk.style.display = 'none';
  btnStopBulk.style.display = 'inline-block';

  const total = listaAProcesar.length;
  let completados = 0;
  let acreditadosCount = 0;
  let noAcreditadosCount = 0;
  let invalidosCount = 0;

  statTotal.textContent = total.toLocaleString();
  statAcreditados.textContent = '0';
  statNoAcreditados.textContent = '0';
  statInvalidos.textContent = '0';
  actualizarBarraProgreso(0, total);

  // Fecha general del lote si fue seleccionada por el usuario
  const fechaLoteGlobal = bulkBatchDate && bulkBatchDate.value ? parsearFechaGenerica(bulkBatchDate.value) : null;

  // Caché en memoria para reutilizar consultas de pacientes repetidos
  const cacheIESS = new Map();
  const CONCURRENCIA = 4;
  let indiceActual = 0;

  async function worker() {
    while (indiceActual < listaAProcesar.length && !bulkAborted) {
      const currentIndex = indiceActual++;
      const item = listaAProcesar[currentIndex];
      const ced = item.cedula;
      const fechaACalificar = item.fecha || fechaLoteGlobal || null;
      let rowData = null;

      // Validación con Módulo 10
      if (!validarCedulaCliente(ced)) {
        invalidosCount++;
        statInvalidos.textContent = invalidosCount;
        rowData = {
          indice: currentIndex + 1,
          cedula: ced,
          paciente: 'Cédula Inválida',
          estado: 'INVÁLIDA',
          tipoSeguro: 'CÉDULA INVÁLIDA',
          codigoSeguro: 'ERR',
          badgeSeguroClass: 'badge-seguro invalido',
          subsistema: 'NO ACREDITADO',
          afiliacion: '---',
          fechaCalificada: fechaACalificar || 'Hoy',
          observacion: 'Dígito verificador incorrecto o provincia no válida'
        };
      } else {
        try {
          let data;
          const cacheKey = `${ced}_${fechaACalificar || 'HOY'}`;
          if (cacheIESS.has(cacheKey)) {
            // Reutilización instantánea (0ms) sin sobrecargar al IESS
            data = cacheIESS.get(cacheKey);
          } else {
            let url = `/api/calificar?cedula=${ced}`;
            if (fechaACalificar) {
              url += `&fecha=${encodeURIComponent(fechaACalificar)}`;
            }
            const res = await fetch(url);
            data = await res.json();
            cacheIESS.set(cacheKey, data);
          }

          const isAcred = data.estadoFinal === 'ACREDITADO';
          if (isAcred) {
            acreditadosCount++;
            statAcreditados.textContent = acreditadosCount;
          } else {
            noAcreditadosCount++;
            statNoAcreditados.textContent = noAcreditadosCount;
          }

          const segInfo = (data.iess && data.iess.tipoSeguro && data.iess.codigoSeguro)
            ? {
                codigo: data.iess.codigoSeguro,
                nombre: data.iess.tipoSeguro,
                subsistema: data.iess.subSistema || data.iess.entidad,
                badgeClass: `badge-seguro ${data.iess.codigoSeguro.toLowerCase().replace(/[^a-z]/g, '')}`
              }
            : clasificarTipoSeguroCliente(data.iess?.tipoAfiliacion, data.iess?.observacion, isAcred);

          rowData = {
            indice: currentIndex + 1,
            cedula: ced,
            paciente: (data.iess && data.iess.nombres) || 'No especificado',
            estado: isAcred ? 'ACREDITADO' : 'NO ACREDITADO',
            tipoSeguro: segInfo.nombre,
            codigoSeguro: segInfo.codigo,
            badgeSeguroClass: segInfo.badgeClass,
            subsistema: segInfo.subsistema,
            afiliacion: (data.iess && data.iess.tipoAfiliacion) || '---',
            fechaCalificada: data.fechaCalificada || fechaACalificar || 'Hoy',
            observacion: (data.iess && data.iess.observacion) || 'Sin observación'
          };
        } catch (err) {
          noAcreditadosCount++;
          statNoAcreditados.textContent = noAcreditadosCount;
          rowData = {
            indice: currentIndex + 1,
            cedula: ced,
            paciente: 'Error de Red',
            estado: 'ERROR',
            tipoSeguro: 'ERROR DE CONEXIÓN',
            codigoSeguro: 'ERR',
            badgeSeguroClass: 'badge-seguro invalido',
            subsistema: 'ERROR',
            afiliacion: '---',
            fechaCalificada: fechaACalificar || 'Hoy',
            observacion: err.message
          };
        }
      }

      bulkResults.push(rowData);
      agregarFilaTabla(rowData);

      completados++;
      actualizarBarraProgreso(completados, total);
    }
  }

  // Lanzar workers simultáneos
  const workers = [];
  const activeWorkers = Math.min(CONCURRENCIA, total);
  for (let w = 0; w < activeWorkers; w++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  // Ordenar resultados por índice original
  bulkResults.sort((a, b) => a.indice - b.indice);

  btnStartBulk.style.display = 'inline-block';
  btnStopBulk.style.display = 'none';
  if (bulkResults.length > 0) {
    btnExportExcel.style.display = 'block';
  }
});

btnStopBulk.addEventListener('click', () => {
  bulkAborted = true;
  btnStopBulk.textContent = 'Deteniendo...';
});

function actualizarBarraProgreso(actual, total) {
  bulkProgressText.textContent = `${actual} / ${total}`;
  const pct = total > 0 ? Math.round((actual / total) * 100) : 0;
  bulkProgressFill.style.width = `${pct}%`;
}

function agregarFilaTabla(row) {
  if (bulkTableBody.children.length > 100) {
    bulkTableBody.removeChild(bulkTableBody.firstElementChild);
  }

  const tr = document.createElement('tr');

  let badgeClass = 'badge-status';
  if (row.estado === 'ACREDITADO') badgeClass += ' acreditado';
  else if (row.estado === 'NO ACREDITADO') badgeClass += ' no-acreditado';
  else badgeClass += ' invalido';

  const esCampesino = row.codigoSeguro === 'CA' || row.codigoSeguro === 'CB' || (row.codigoSeguro && row.codigoSeguro.includes('SSC'));
  const colorTextoSeguro = esCampesino ? '#15803d' : '#1e40af';

  tr.innerHTML = `
    <td>${row.indice}</td>
    <td><strong>${row.cedula}</strong></td>
    <td>${row.paciente}</td>
    <td><span class="${badgeClass}">${row.estado}</span></td>
    <td><span class="${row.badgeSeguroClass || 'badge-seguro sg'}">${row.codigoSeguro || '---'}</span></td>
    <td><strong style="color: ${colorTextoSeguro}; font-size: 0.82rem;">${row.tipoSeguro || row.afiliacion}</strong></td>
    <td><span style="font-size: 0.82rem; font-weight: 600; color: #1e3a8a;">${row.afiliacion || '---'}</span></td>
    <td><span style="font-size: 0.82rem; color: #166534; font-weight: 500;">${row.observacion || '---'}</span></td>
    <td><small style="font-weight: 600; color: var(--slate-700);">${row.fechaCalificada || 'Hoy'}</small></td>
  `;

  bulkTableBody.appendChild(tr);
  tr.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ==========================================
// 6. EXPORTAR A EXCEL (.XLSX)
// ==========================================
btnExportExcel.addEventListener('click', () => {
  if (bulkResults.length === 0) return;

  const dataExport = bulkResults.map(r => ({
    'N°': r.indice,
    'Cédula': r.cedula,
    'Apellidos y Nombres': r.paciente,
    'Estado Calificación': r.estado,
    'Código Seguro': r.codigoSeguro || '---',
    'Tipo de Seguro': r.tipoSeguro || r.afiliacion,
    'Tipo de Afiliación': r.afiliacion || '---',
    'Observación': r.observacion || '---',
    'Fecha Calificada': r.fechaCalificada || 'Hoy',
    'Subsistema': r.subsistema || 'IESS',
    'Contingencia': 'Enfermedad (14)',
    'Fecha de Reporte': new Date().toLocaleDateString('es-EC')
  }));

  const ws = XLSX.utils.json_to_sheet(dataExport);

  // Anchos de columna óptimos para que ningún texto se corte al abrir en Excel
  ws['!cols'] = [
    { wch: 6 },   // N°
    { wch: 14 },  // Cédula
    { wch: 38 },  // Apellidos y Nombres
    { wch: 18 },  // Estado Calificación
    { wch: 14 },  // Código Seguro (CA, CB, SG)
    { wch: 48 },  // Tipo de Seguro
    { wch: 32 },  // Tipo de Afiliación (ej. Afiliado Seguro Campesino)
    { wch: 45 },  // Observación (ej. Cédula Registrada con Derecho)
    { wch: 16 },  // Fecha Calificada
    { wch: 30 },  // Subsistema
    { wch: 18 },  // Contingencia
    { wch: 16 }   // Fecha de Reporte
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Calificación IESS');

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Calificacion_IESS_Lote_${fechaArchivo}.xlsx`);
});
