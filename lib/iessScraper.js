import { solveAltcha } from './altchaSolver.js';

const IESS_URL = 'https://app.iess.gob.ec/gestion-calificacion-derecho-web/public/formulariosContacto.jsf';

/**
 * Consulta la calificación de derecho por contingencia Enfermedad en el IESS
 * @param {string} cedula 10 dígitos numéricos
 * @returns {Promise<Object>} Resultado consolidado con estado, nombres, afiliación y observación
 */
export async function consultarIESS(cedula, fecha = null) {
  try {
    // 1. GET Inicial: Obtener cookies de sesión, ViewState y Reto Altcha
    const getRes = await fetch(IESS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!getRes.ok) {
      throw new Error(`Servidor del IESS respondió con error HTTP ${getRes.status}`);
    }

    const rawCookies = getRes.headers.getSetCookie ? getRes.headers.getSetCookie() : [getRes.headers.get('set-cookie') || ''];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).filter(Boolean).join('; ');
    const html = await getRes.text();

    const viewStateMatch = html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]+)"/);
    if (!viewStateMatch) {
      throw new Error('No se encontró ViewState en el formulario del IESS');
    }
    let viewState = viewStateMatch[1];

    const altchaMatch = html.match(/challengejson="([^"]+)"/i);
    if (!altchaMatch) {
      throw new Error('No se encontró el reto Altcha en el portal del IESS');
    }
    const challengeRaw = altchaMatch[1].replace(/&quot;/g, '"');
    const altchaSolved = solveAltcha(JSON.parse(challengeRaw));

    // 2. Simulación de Blur en cédula (Ciclo PrimeFaces)
    const blurParams = new URLSearchParams();
    blurParams.append('javax.faces.partial.ajax', 'true');
    blurParams.append('javax.faces.source', 'formConsulta:cedula_text');
    blurParams.append('javax.faces.partial.execute', 'formConsulta:cedula_text');
    blurParams.append('javax.faces.partial.render', 'formConsulta:cedula_text formConsulta:btnAceptar formConsulta:generalMessages');
    blurParams.append('javax.faces.behavior.event', 'blur');
    blurParams.append('javax.faces.partial.event', 'blur');
    blurParams.append('formConsulta', 'formConsulta');
    blurParams.append('formConsulta:cedula_text', cedula);
    blurParams.append('javax.faces.ViewState', viewState);

    const blurRes = await fetch(IESS_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'Cookie': cookieHeader
      },
      body: blurParams.toString()
    });
    const blurXml = await blurRes.text();
    const newVs = blurXml.match(/<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[(.*?)\]\]><\/update>/);
    if (newVs) viewState = newVs[1];

    // 3. Simulación de selección de contingencia Enfermedad (14)
    const changeParams = new URLSearchParams();
    changeParams.append('javax.faces.partial.ajax', 'true');
    changeParams.append('javax.faces.source', 'formConsulta:contingencia_select');
    changeParams.append('javax.faces.partial.execute', 'formConsulta:contingencia_select');
    changeParams.append('javax.faces.partial.render', 'formConsulta:gridTriaje formConsulta:btnAceptar');
    changeParams.append('javax.faces.behavior.event', 'valueChange');
    changeParams.append('javax.faces.partial.event', 'change');
    changeParams.append('formConsulta', 'formConsulta');
    changeParams.append('formConsulta:cedula_text', cedula);
    changeParams.append('formConsulta:contingencia_select_focus', '');
    changeParams.append('formConsulta:contingencia_select_input', '14'); // 14 = Enfermedad
    changeParams.append('javax.faces.ViewState', viewState);

    const changeRes = await fetch(IESS_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'Cookie': cookieHeader
      },
      body: changeParams.toString()
    });
    const changeXml = await changeRes.text();
    const newVs2 = changeXml.match(/<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[(.*?)\]\]><\/update>/);
    if (newVs2) viewState = newVs2[1];

    // 4. Submit final de Aceptar con Altcha resuelto y fecha específica
    let fechaStr;
    const fechaTrim = fecha ? String(fecha).trim() : '';
    const m1 = fechaTrim.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    const m2 = fechaTrim.match(/\b(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})\b/);
    if (m1) {
      fechaStr = `${String(m1[1]).padStart(2, '0')}/${String(m1[2]).padStart(2, '0')}/${m1[3]}`;
    } else if (m2) {
      fechaStr = `${String(m2[3]).padStart(2, '0')}/${String(m2[2]).padStart(2, '0')}/${m2[1]}`;
    } else {
      const today = new Date();
      fechaStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    }

    const submitParams = new URLSearchParams();
    submitParams.append('javax.faces.partial.ajax', 'true');
    submitParams.append('javax.faces.source', 'formConsulta:btnAceptar');
    submitParams.append('javax.faces.partial.execute', '@all');
    submitParams.append('javax.faces.partial.render', 'formConsulta');
    submitParams.append('formConsulta:btnAceptar', 'formConsulta:btnAceptar');
    submitParams.append('formConsulta', 'formConsulta');
    submitParams.append('formConsulta:cedula_text', cedula);
    submitParams.append('formConsulta:fec_calendar_input', fechaStr);
    submitParams.append('formConsulta:contingencia_select_focus', '');
    submitParams.append('formConsulta:contingencia_select_input', '14');
    submitParams.append('altcha', altchaSolved);
    submitParams.append('javax.faces.ViewState', viewState);

    const submitRes = await fetch(IESS_URL, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'Cookie': cookieHeader,
        'Origin': 'https://app.iess.gob.ec',
        'Referer': IESS_URL
      },
      body: submitParams.toString()
    });

    const submitXml = await submitRes.text();
    return parsearResultadoFinalIESS(submitXml, cedula, fechaStr);
  } catch (error) {
    return {
      exito: false,
      entidad: 'IESS',
      contingencia: 'Enfermedad',
      cedula,
      acreditado: null,
      mensaje: `Fallo de comunicación con IESS: ${error.message}`
    };
  }
}

/**
 * Parsea el XML devuelto por PrimeFaces con los campos de calificación
 */
function parsearResultadoFinalIESS(xml, cedula, fechaStr = null) {
  // Comprobar estado de cobertura en los labels o texto
  const tieneCobertura = /CON COBERTURA IESS/i.test(xml);
  const sinCobertura = /SIN COBERTURA/i.test(xml);

  // Extraer nombres (input readonly de apellidos y nombres)
  let nombres = '';
  const nombresMatch = xml.match(/<input[^>]+value="([A-ZÁÉÍÓÚÑ\s]{4,60})"[^>]+readonly/i);
  // Buscar entre inputs el que tenga nombres
  const allInputsWithValues = [...xml.matchAll(/<input[^>]+value="([^"]+)"/g)].map(m => m[1]);
  for (const val of allInputsWithValues) {
    if (/[A-ZÁÉÍÓÚÑ]{3,}\s+[A-ZÁÉÍÓÚÑ]{3,}/.test(val) && !val.includes('de octubre') && !val.includes('Enfermedad') && !val.includes('Afiliado')) {
      nombres = val.trim();
      break;
    }
  }

  // Extraer tipo de afiliación
  let tipoAfiliacion = '';
  for (const val of allInputsWithValues) {
    if (/Afiliado|Jubilado|Pensionista|Seguro|Voluntario/i.test(val)) {
      tipoAfiliacion = val.trim();
      break;
    }
  }

  // Extraer observación (textarea)
  let observacion = '';
  const textareaMatch = xml.match(/<textarea[^>]*>([^<]+)<\/textarea>/i);
  if (textareaMatch) {
    observacion = textareaMatch[1].trim();
  }

  // Determinar acreditación
  const acreditado = tieneCobertura || (!sinCobertura && /DERECHO/i.test(xml));

  if (!observacion) {
    observacion = acreditado
      ? 'Asegurado con cobertura médica vigente para contingencia de Enfermedad.'
      : 'Asegurado sin cobertura médica para Enfermedad en el IESS.';
  }

  // Clasificación especializada de seguro: Seguro Social Campesino (CA, CB, Jubilado SSC) vs Seguro General
  const clasificacion = clasificarTipoSeguro(tipoAfiliacion, observacion, acreditado);

  return {
    exito: true,
    entidad: clasificacion.subsistema,
    subSistema: clasificacion.subsistema,
    contingencia: 'Enfermedad (Código 14)',
    cedula,
    nombres: nombres || 'Asegurado registrado en IESS',
    tipoAfiliacion: tipoAfiliacion || 'Seguro General',
    tipoSeguro: clasificacion.nombre,
    codigoSeguro: clasificacion.codigo,
    acreditado,
    estadoTexto: acreditado ? `ACREDITADO (${clasificacion.codigo})` : 'SIN COBERTURA',
    observacion
  };
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
export function clasificarTipoSeguro(tipoAfiliacion = '', observacion = '', acreditado = true) {
  const afil = String(tipoAfiliacion || '').trim();
  const obs = String(observacion || '').trim();
  const combo = `${afil} ${obs}`.toUpperCase();

  if (!acreditado) {
    return {
      codigo: 'SIN_COBERTURA',
      nombre: 'SIN COBERTURA ACTIVA',
      subsistema: 'NO ACREDITADO'
    };
  }

  // 1. SEGURO SOCIAL CAMPESINO (SSC)
  const esCampesino = /CAMPESINO|SSC/i.test(combo);
  if (esCampesino) {
    if (/JEFE DE FAMILIA/i.test(combo)) {
      return {
        codigo: 'CA',
        nombre: 'SEGURO SOCIAL CAMPESINO - CA (JEFE DE FAMILIA / TITULAR)',
        subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)'
      };
    }
    if (/JUBILAD/i.test(combo)) {
      return {
        codigo: 'JUB-SSC',
        nombre: 'JUBILADO SEGURO SOCIAL CAMPESINO (SSC)',
        subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)'
      };
    }
    // Si no es jefe de familia ni jubilado, es beneficiario (CB)
    return {
      codigo: 'CB',
      nombre: 'SEGURO SOCIAL CAMPESINO - CB (BENEFICIARIO / DEPENDIENTE)',
      subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)'
    };
  }

  // 2. JUBILADOS SEGURO GENERAL
  if (/JUBILAD/i.test(combo)) {
    return {
      codigo: 'JUB-SG',
      nombre: 'JUBILADO SEGURO GENERAL',
      subsistema: 'SEGURO GENERAL (IESS)'
    };
  }

  // 3. MONTEPÍO / PENSIONISTA
  if (/MONTEP[IÍ]O|PENSIONISTA/i.test(combo)) {
    return {
      codigo: 'MONTEPIO',
      nombre: 'PENSIONISTA / MONTEPÍO (IESS)',
      subsistema: 'SEGURO GENERAL (IESS)'
    };
  }

  // 4. AFILIADO VOLUNTARIO
  if (/VOLUNTARI/i.test(combo)) {
    return {
      codigo: 'VOL',
      nombre: 'AFILIADO VOLUNTARIO (IESS)',
      subsistema: 'SEGURO GENERAL (IESS)'
    };
  }

  // 5. DEPENDIENTES (CÓNYUGE / HIJOS MENORES - EXTENSIÓN DE COBERTURA)
  if (/C[OÓ]NYUGE|HIJO|DEPENDIENTE|EXTENSI[OÓ]N/i.test(combo)) {
    return {
      codigo: 'DEP-SG',
      nombre: 'DEPENDIENTE POR EXTENSIÓN DE COBERTURA (IESS)',
      subsistema: 'SEGURO GENERAL (IESS)'
    };
  }

  // 6. SEGURO GENERAL TIEMPO COMPLETO / PARCIAL
  if (/TIEMPO COMPLETO/i.test(combo)) {
    return {
      codigo: 'SG',
      nombre: 'AFILIADO SEGURO GENERAL TIEMPO COMPLETO',
      subsistema: 'SEGURO GENERAL (IESS)'
    };
  }
  if (/TIEMPO PARCIAL|MEDIO TIEMPO/i.test(combo)) {
    return {
      codigo: 'SG-TP',
      nombre: 'AFILIADO SEGURO GENERAL TIEMPO PARCIAL',
      subsistema: 'SEGURO GENERAL (IESS)'
    };
  }

  // 7. SEGURO GENERAL POR DEFECTO
  return {
    codigo: 'SG',
    nombre: afil || 'SEGURO GENERAL',
    subsistema: 'SEGURO GENERAL (IESS)'
  };
}
