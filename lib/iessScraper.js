import { solveAltcha } from './altchaSolver.js';

const IESS_URL = 'https://app.iess.gob.ec/gestion-calificacion-derecho-web/public/formulariosContacto.jsf';

/**
 * Consulta la calificación de derecho por contingencia Enfermedad en el IESS
 * @param {string} cedula 10 dígitos numéricos
 * @returns {Promise<Object>} Resultado consolidado con estado, nombres, afiliación y observación
 */
export async function consultarIESS(cedula) {
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

    // 4. Submit final de Aceptar con Altcha resuelto
    const today = new Date();
    const fechaStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

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
    return parsearResultadoFinalIESS(submitXml, cedula);
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
function parsearResultadoFinalIESS(xml, cedula) {
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
      ? 'Asegurado con cobertura médica vigente para contingencia de Enfermedad en el IESS.'
      : 'Asegurado sin cobertura médica para Enfermedad en el IESS.';
  }

  return {
    exito: true,
    entidad: 'IESS',
    contingencia: 'Enfermedad (Código 14)',
    cedula,
    nombres: nombres || 'Asegurado registrado en IESS',
    tipoAfiliacion: tipoAfiliacion || 'Seguro General',
    acreditado,
    estadoTexto: acreditado ? 'CON COBERTURA IESS' : 'SIN COBERTURA',
    observacion
  };
}
