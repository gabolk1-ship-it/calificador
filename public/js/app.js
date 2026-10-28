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
const resAfiliacion = document.getElementById('res-afiliacion');
const resTiempo = document.getElementById('res-tiempo');
const mspDesc = document.getElementById('msp-desc');

// Elementos Modo Masivo
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const bulkTextarea = document.getElementById('bulk-textarea');
const bulkCounterLive = document.getElementById('bulk-counter-live');

function actualizarContadorLive() {
  if (!bulkCounterLive) return;
  const raw = bulkTextarea.value.trim();
  if (!raw) {
    bulkCounterLive.textContent = '0 cédulas detectadas';
    return;
  }
  const tokens = raw.split(/[\r\n,;\s]+/).map(t => t.trim().replace(/\D/g, '')).filter(t => t.length === 9 || t.length === 10);
  const unicas = new Set(tokens);
  bulkCounterLive.textContent = unicas.size + ' cédulas detectadas (listas para calificar)';
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

// Extrae y normaliza cédula desde texto escaneado o celda
function extraerCedulaDeTexto(texto) {
  if (!texto) return null;
  const str = String(texto).trim();

  // 1. Intentar normalización directa si es solo dígitos
  const normal = normalizarCedula(str);
  if (normal.length === 10 && validarCedulaCliente(normal)) {
    return normal;
  }

  // 2. Buscar secuencias de 10 o 9 dígitos en texto complejo
  const matches = str.match(/\b\d{9,10}\b/g) || [];
  for (const m of matches) {
    const cand = normalizarCedula(m);
    if (validarCedulaCliente(cand)) return cand;
  }

  // 3. Fallback: remover caracteres no numéricos
  const soloNum = str.replace(/\D/g, '');
  if (soloNum.length === 9 || soloNum.length === 10) {
    const cand = normalizarCedula(soloNum);
    if (validarCedulaCliente(cand)) return cand;
  }

  return null;
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
let isTorchOn = false;

if (btnToggleTorch) {
  btnToggleTorch.addEventListener('click', async () => {
    if (!html5QrCode) return;
    try {
      isTorchOn = !isTorchOn;
      await html5QrCode.applyVideoConstraints({
        advanced: [{ torch: isTorchOn }]
      });
      btnToggleTorch.textContent = isTorchOn ? '💡 Apagar' : '💡 Linterna';
      btnToggleTorch.classList.toggle('active', isTorchOn);
    } catch (e) {
      console.warn('Torch no soportado:', e);
    }
  });
}

btnCamera.addEventListener('click', async () => {
  if (scannerContainer.style.display === 'block') {
    cerrarCamara();
    return;
  }

  scannerContainer.style.display = 'block';

  try {
    if (!html5QrCode) {
      const formats = [];
      if (window.Html5QrcodeSupportedFormats) {
        formats.push(
          Html5QrcodeSupportedFormats.PDF_417,
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128
        );
      }
      html5QrCode = new Html5Qrcode("reader", {
        // Aceleración por hardware con Google BarcodeDetector API si está disponible
        useBarCodeDetectorIfSupported: true,
        // Limitar formatos exclusivamente a PDF417 de cédula para ahorrar 70% CPU y decodificar al instante
        formatsToSupport: formats.length > 0 ? formats : undefined,
        verbose: false
      });
    }

    const config = {
      fps: 24, // 24 cuadros/segundo para respuesta instantánea
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        // Cuadro rectangular ancho (2.2:1) óptimo para el código PDF417 de la cédula ecuatoriana
        const w = Math.min(viewfinderWidth * 0.92, 360);
        const h = Math.max(Math.min(w * 0.45, 140), 90);
        return { width: Math.round(w), height: Math.round(h) };
      },
      aspectRatio: 1.6
    };

    // Preferir cámara trasera en resolución HD y autoenfoque continuo
    const cameraConstraints = {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    };

    await html5QrCode.start(
      cameraConstraints,
      config,
      (decodedText) => {
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
      },
      () => {}
    );

    // Si el dispositivo tiene linterna/flash, mostrar el botón
    try {
      const capabilities = html5QrCode.getRunningTrackCameraCapabilities();
      if (capabilities && capabilities.torchFeature && capabilities.torchFeature().isSupported()) {
        if (btnToggleTorch) btnToggleTorch.style.display = 'inline-block';
      }
    } catch (_) {}

  } catch (err) {
    // Si la resolución HD falla en algún dispositivo específico, intentar fallback estándar
    try {
      await html5QrCode.start(
        { facingMode: "environment" },
        { fps: 20, qrbox: { width: 290, height: 130 } },
        (decodedText) => {
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
        },
        () => {}
      );
    } catch (fallbackErr) {
      alert(`No se pudo acceder a la cámara: ${fallbackErr.message || fallbackErr}`);
      cerrarCamara();
    }
  }
});

btnStopCamera.addEventListener('click', cerrarCamara);

async function cerrarCamara() {
  if (html5QrCode && html5QrCode.isScanning) {
    try {
      if (isTorchOn) {
        try {
          await html5QrCode.applyVideoConstraints({ advanced: [{ torch: false }] });
        } catch (_) {}
        isTorchOn = false;
        if (btnToggleTorch) {
          btnToggleTorch.textContent = '💡 Linterna';
          btnToggleTorch.classList.remove('active');
        }
      }
      await html5QrCode.stop();
    } catch (e) {}
  }
  scannerContainer.style.display = 'none';
  if (btnToggleTorch) btnToggleTorch.style.display = 'none';
}

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
    if (vBadge) vBadge.textContent = 'v' + nativeV;
    if (fVersion) fVersion.textContent = nativeV;
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
    const res = await fetch(`/api/calificar?cedula=${cedula}`);
    const data = await res.json();
    loader.style.display = 'none';
    mostrarResultadoIndividual(data);
  } catch (error) {
    loader.style.display = 'none';
    alert(`Error al consultar: ${error.message}`);
  }
}

function mostrarResultadoIndividual(data) {
  resultContainer.style.display = 'block';

  resCedula.textContent = data.cedula || '---';
  resNombres.textContent = (data.iess && data.iess.nombres) || 'No especificado';
  resAfiliacion.textContent = (data.iess && data.iess.tipoAfiliacion) || 'Seguro General';
  resTiempo.textContent = `${data.duracionMs || 0} ms`;

  if (data.estadoFinal === 'ACREDITADO') {
    statusBanner.className = 'status-banner acreditado';
    statusTitle.innerHTML = '🟢 ACREDITADO';
    statusDesc.textContent = (data.iess && data.iess.observacion) || 'Asegurado con cobertura médica vigente para Enfermedad.';
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
  validationHint.textContent = '';
  btnConsultar.disabled = true;
  cedulaInput.focus();
});

// ==========================================
// 5. MODO MASIVO (SOPORTE DE 4000+ CÉDULAS)
// ==========================================

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
    procesarArchivoSeleccionado(files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files.length > 0) {
    procesarArchivoSeleccionado(e.target.files[0]);
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

      bulkTextarea.value = data.cedulas.join('\n');
      actualizarContadorLive();

      alert(`¡Archivo cargado automáticamente!\n\n` +
            `• Archivo leído: ${data.archivo}\n` +
            `• Total registros de atención médica: ${data.totalAtenciones}\n` +
            `• Pacientes únicos listos: ${data.unicasCount}\n` +
            `• Cédulas con '0' inicial restaurado: ${data.conCeroRecuperado}\n\n` +
            `Ya están en pantalla listos para pulsar "Iniciar Calificación Masiva".`);

      btnLoadDatosmis.disabled = false;
      btnLoadDatosmis.innerHTML = `<span>✓ Cargado: ${data.archivo} (${data.unicasCount} pacientes)</span>`;
    } catch (err) {
      alert(`No se pudo cargar desde el servidor local: ${err.message}`);
      btnLoadDatosmis.disabled = false;
      btnLoadDatosmis.innerHTML = textoOriginal;
    }
  });
}

function procesarArchivoSeleccionado(file) {
  const ext = file.name.split('.').pop().toLowerCase();

  if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

        const cedulasExtraidas = [];
        let corregidasConCero = 0;

        rows.forEach(r => {
          if (!Array.isArray(r)) return;
          r.forEach(cell => {
            if (cell === null || cell === undefined) return;
            const raw = String(cell).trim();
            // Limpiar
            const digits = raw.replace(/\D/g, '');
            if (digits.length === 9 || digits.length === 10) {
              const normal = normalizarCedula(digits);
              if (normal.length === 10) {
                if (digits.length === 9) corregidasConCero++;
                cedulasExtraidas.push(normal);
              }
            }
          });
        });

        const unicas = [...new Set(cedulasExtraidas)];
        bulkTextarea.value = unicas.join('\n');
        alert(`¡Listo! Se cargaron ${unicas.length} cédulas desde "${file.name}".\n(Se restauró automáticamente el '0' a la izquierda en ${corregidasConCero} cédulas que Excel había recortado).`);
      } catch (err) {
        alert(`Error al leer archivo Excel: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // CSV o TXT
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const rawLines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
      const cedulasExtraidas = [];
      let corregidasConCero = 0;

      // Detectar si tiene cabecera CSV (con delimitador ';' o ',')
      if (rawLines.length > 0) {
        const firstLine = rawLines[0];
        const delim = firstLine.includes(';') ? ';' : ',';
        const headers = firstLine.split(delim).map(h => h.replace(/["']/g, '').trim().toUpperCase());
        
        let colIndex = -1;
        // Buscar nombres típicos de columna de cédula
        const posiblesHeaders = ['NRO_DOCUMENTO', 'NUMERO_DOCUMENTO', 'CEDULA', 'IDENTIFICACION', 'DOCUMENTO', 'NRO_DOC'];
        for (const ph of posiblesHeaders) {
          const idx = headers.indexOf(ph);
          if (idx !== -1) {
            colIndex = idx;
            break;
          }
        }

        if (colIndex !== -1) {
          // Extraer directamente de la columna identificada
          for (let i = 1; i < rawLines.length; i++) {
            const cols = rawLines[i].split(delim);
            if (cols.length > colIndex) {
              const rawVal = cols[colIndex].replace(/["']/g, '').trim();
              const digits = rawVal.replace(/\D/g, '');
              if (digits.length === 9 || digits.length === 10) {
                const normal = normalizarCedula(digits);
                if (validarCedulaCliente(normal)) {
                  if (digits.length === 9) corregidasConCero++;
                  cedulasExtraidas.push(normal);
                }
              }
            }
          }
        } else {
          // Búsqueda genérica en todo el texto
          rawLines.forEach(line => {
            const tokens = line.split(/[;,\t]/);
            tokens.forEach(tok => {
              const digits = tok.replace(/["']/g, '').trim().replace(/\D/g, '');
              if (digits.length === 9 || digits.length === 10) {
                const normal = normalizarCedula(digits);
                if (validarCedulaCliente(normal)) {
                  if (digits.length === 9) corregidasConCero++;
                  cedulasExtraidas.push(normal);
                }
              }
            });
          });
        }
      }

      const totalAtenciones = cedulasExtraidas.length;
      const unicas = [...new Set(cedulasExtraidas)];
      bulkTextarea.value = unicas.join('\n');
      actualizarContadorLive();

      alert(`¡Archivo cargado con éxito!\n\n` +
            `• Archivo: ${file.name}\n` +
            `• Total registros de atención: ${totalAtenciones}\n` +
            `• Pacientes únicos a calificar: ${unicas.length}\n` +
            `• Cédulas restauradas con el '0' inicial: ${corregidasConCero}\n\n` +
            `Al procesar los pacientes únicos evitarás consultar duplicados al IESS y el lote terminará el doble de rápido.`);
    };
    reader.readAsText(file, 'latin1'); // latin1 / iso-8859-1 compatible con exportaciones hospitalarias con tildes
  }
}

// Iniciar Procesamiento Masivo con Pool Paralelo
btnStartBulk.addEventListener('click', async () => {
  const rawText = bulkTextarea.value.trim();
  if (!rawText) {
    alert('Por favor sube un archivo o pega tus cédulas en el recuadro.');
    return;
  }

  // Dividir por líneas o comas y normalizar cada número (reparando los que tienen 9 dígitos)
  const tokens = rawText.split(/[\r\n,;\s]+/).map(t => t.trim()).filter(Boolean);
  const cedulas = [];
  let recuperadas = 0;

  tokens.forEach(t => {
    const digits = t.replace(/\D/g, '');
    if (digits.length === 9 || digits.length === 10) {
      const norm = normalizarCedula(digits);
      if (norm.length === 10) {
        if (digits.length === 9) recuperadas++;
        cedulas.push(norm);
      }
    } else if (digits.length > 0) {
      cedulas.push(digits); // Para que se marque como inválida
    }
  });

  const cedulasUnicas = [...new Set(cedulas)];

  if (cedulasUnicas.length === 0) {
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

  const total = cedulasUnicas.length;
  let completados = 0;
  let acreditadosCount = 0;
  let noAcreditadosCount = 0;
  let invalidosCount = 0;

  statTotal.textContent = total;
  statAcreditados.textContent = 0;
  statNoAcreditados.textContent = 0;
  statInvalidos.textContent = 0;
  actualizarBarraProgreso(0, total);

  // Concurrencia de 4 peticiones paralelas para máxima velocidad
  const CONCURRENCIA = 4;
  let indiceActual = 0;

  async function worker() {
    while (indiceActual < cedulasUnicas.length && !bulkAborted) {
      const currentIndex = indiceActual++;
      const ced = cedulasUnicas[currentIndex];
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
          afiliacion: '---',
          observacion: 'Dígito verificador incorrecto o provincia no válida'
        };
      } else {
        try {
          const res = await fetch(`/api/calificar?cedula=${ced}`);
          const data = await res.json();

          const isAcred = data.estadoFinal === 'ACREDITADO';
          if (isAcred) {
            acreditadosCount++;
            statAcreditados.textContent = acreditadosCount;
          } else {
            noAcreditadosCount++;
            statNoAcreditados.textContent = noAcreditadosCount;
          }

          rowData = {
            indice: currentIndex + 1,
            cedula: ced,
            paciente: (data.iess && data.iess.nombres) || 'No especificado',
            estado: isAcred ? 'ACREDITADO' : 'NO ACREDITADO',
            afiliacion: (data.iess && data.iess.tipoAfiliacion) || 'Seguro General',
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
            afiliacion: '---',
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
  // Para no sobrecargar la memoria con 4000 filas en pantalla,
  // mantenemos visibles las últimas 100 filas mientras todas se guardan para el Excel
  if (bulkTableBody.children.length > 100) {
    bulkTableBody.removeChild(bulkTableBody.firstElementChild);
  }

  const tr = document.createElement('tr');

  let badgeClass = 'badge-status';
  if (row.estado === 'ACREDITADO') badgeClass += ' acreditado';
  else if (row.estado === 'NO ACREDITADO') badgeClass += ' no-acreditado';
  else badgeClass += ' invalido';

  tr.innerHTML = `
    <td>${row.indice}</td>
    <td><strong>${row.cedula}</strong></td>
    <td>${row.paciente}</td>
    <td><span class="${badgeClass}">${row.estado}</span></td>
    <td>${row.afiliacion}</td>
    <td><small>${row.observacion}</small></td>
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
    'Tipo de Afiliación': r.afiliacion,
    'Observación IESS': r.observacion,
    'Contingencia': 'Enfermedad (14)',
    'Fecha de Consulta': new Date().toLocaleDateString('es-EC')
  }));

  const ws = XLSX.utils.json_to_sheet(dataExport);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Calificación IESS');

  const fechaArchivo = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `Calificacion_IESS_Lote_${fechaArchivo}.xlsx`);
});
