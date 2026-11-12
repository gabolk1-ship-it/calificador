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

  // 1. Extraer nombres directamente asociando al label "Apellidos y Nombres:"
  let nombres = '';
  const nomLabelMatch = xml.match(/<label[^>]*>\s*Apellidos y Nombres:\s*<\/label>[\s\S]*?<input[^>]+value="([^"]+)"/i);
  if (nomLabelMatch) {
    nombres = nomLabelMatch[1].trim();
  } else {
    // Buscar entre inputs el que tenga nombres
    const allInputsWithValues = [...xml.matchAll(/<input[^>]+value="([^"]+)"/g)].map(m => m[1]);
    for (const val of allInputsWithValues) {
      if (/[A-ZÁÉÍÓÚÑ]{3,}\s+[A-ZÁÉÍÓÚÑ]{3,}/.test(val) && !val.includes('de octubre') && !val.includes('Enfermedad') && !val.includes('Afiliado')) {
        nombres = val.trim();
        break;
      }
    }
  }

  // 2. Extraer tipo de afiliación directamente asociando al label "Tipo de Afiliación:"
  let tipoAfiliacion = '';
  const afilLabelMatch = xml.match(/<label[^>]*>\s*Tipo de Afiliaci[oó]n:\s*<\/label>[\s\S]*?<input[^>]+value="([^"]*)"/i);
  if (afilLabelMatch) {
    tipoAfiliacion = afilLabelMatch[1].trim();
  } else {
    const allInputsWithValues = [...xml.matchAll(/<input[^>]+value="([^"]+)"/g)].map(m => m[1]);
    for (const val of allInputsWithValues) {
      if (/Afiliado|Jubilado|Pensionista|Seguro|Voluntario|Dependiente|Cónyuge|Hijo|Montepío|Campesino/i.test(val)) {
        tipoAfiliacion = val.trim();
        break;
      }
    }
  }

  // 3. Extraer observación (textarea)
  let observacion = '';
  const obsLabelMatch = xml.match(/<label[^>]*>\s*Observaci[oó]n:\s*<\/label>[\s\S]*?<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
  if (obsLabelMatch) {
    observacion = obsLabelMatch[1].trim();
  } else {
    const textareaMatch = xml.match(/<textarea[^>]*>([^<]+)<\/textarea>/i);
    if (textareaMatch) {
      observacion = textareaMatch[1].trim();
    }
  }

  // Determinar acreditación
  const acreditado = tieneCobertura || (!sinCobertura && /DERECHO/i.test(xml));

  if (!observacion) {
    observacion = acreditado
      ? 'Asegurado con cobertura médica vigente para contingencia de Enfermedad.'
      : 'Asegurado sin cobertura médica para Enfermedad en el IESS.';
  }

  // Clasificación especializada de seguro basada estrictamente en la descripción real (sin asumir Seguro General)
  const clasificacion = clasificarTipoSeguro(tipoAfiliacion, observacion, acreditado);
  const grupoEtarioInfo = determinarGrupoEtario(cedula, clasificacion.codigo, observacion, tipoAfiliacion);

  return {
    exito: true,
    entidad: clasificacion.subsistema,
    subSistema: clasificacion.subsistema,
    contingencia: 'Enfermedad (Código 14)',
    cedula,
    nombres: nombres || 'Asegurado registrado en IESS',
    tipoAfiliacion: clasificacion.nombre,
    tipoAfiliacionWebIESS: tipoAfiliacion || (acreditado ? 'Asegurado con Cobertura IESS' : 'Sin Afiliación Activa'),
    tipoSeguro: clasificacion.nombre,
    codigoSeguro: clasificacion.codigo,
    acreditado,
    estadoTexto: acreditado ? `ACREDITADO (${clasificacion.codigo})` : 'SIN COBERTURA',
    observacion,
    esMenor: grupoEtarioInfo.esMenor,
    grupoEtario: grupoEtarioInfo.grupoEtario,
    esMenorTexto: grupoEtarioInfo.esMenorTexto,
    detalleGrupoEtario: grupoEtarioInfo.detalle
  };
}

/**
 * Clasifica de forma precisa el Tipo de Seguro médico según la normativa IESS y catálogo oficial de prestaciones hospitalarias (REPRE08 / AS400):
 * - CB: Jefe de Familia / Cabeza del Seguro Social Campesino (JEFE FAMILIA SEG.SOC.CAMPESINO)
 * - CA: Familiar / Beneficiario dependiente del Seguro Social Campesino (FAMILIAR SEG.SOCIAL CAMPESINO)
 * - JC: Jubilado del Seguro Social Campesino (JUBILADO DEL SEG.SOC.CAMPESINO)
 * - SG: Afiliado del Seguro General (AFILIADO DEL SEGURO GENERAL)
 * - AG: Hijos de afiliado menores de 18 años (HIJOS DE AFILIADO <18 AÑOS)
 * - HJ: Hijos de pensionista menores de 18 años (HIJO DE PENSIONISTA <18 AÑOS)
 * - JU: Jubilado / Pensionista del Seguro General (PENSIONISTA DEL SEGURO GENERAL)
 * - MO: Montepío Viudez (MONTEPIO VIUDA COTIZANTE 4.15%)
 * - MH: Montepío Orfandad (MONTEPIO ORFANDAD)
 * - CY: Cónyuge de afiliado (EXT.COBERTURA CONYUGE AFILIADO)
 * - CJ: Cónyuge de pensionista (EXT.COBER.CONYUGE PENSIONISTA)
 * - CV: Afiliado Voluntario (AFILIADO VOLUNTARIO)
 * - JR: Pensionista de Riesgos del Trabajo (PENSIONISTA DE RIESGOS/TRABAJO)
 * - TNRH: Trabajo No Remunerado del Hogar
 * Nota: Nunca asume "Seguro General" si la descripción no lo especifica explícitamente.
 */
export function clasificarTipoSeguro(tipoAfiliacion = '', observacion = '', acreditado = true) {
  const afil = String(tipoAfiliacion || '').trim();
  const obs = String(observacion || '').trim();
  const combo = `${afil} ${obs}`.toUpperCase();

  // 1. SIN COBERTURA
  if (!acreditado || /SIN COBERTURA|NO CALIFICA|FUERA DEL TIEMPO|NO TIENE DERECHO|NO ACREDITADO/i.test(combo)) {
    return {
      codigo: 'SIN_COBERTURA',
      nombre: obs ? `SIN COBERTURA (${obs})` : 'SIN COBERTURA ACTIVA',
      tipoAfiliacionOficial: obs ? `SIN COBERTURA (${obs})` : 'SIN COBERTURA ACTIVA',
      subsistema: 'NO ACREDITADO',
      badgeClass: 'badge-seguro invalido'
    };
  }

  // 2. SEGURO SOCIAL CAMPESINO (SSC) - Normativa oficial REPRE08: CB = Jefe Familia, CA = Familiar
  if (/CAMPESINO|SSC\b/i.test(combo)) {
    if (/JUBILAD/i.test(combo)) {
      return {
        codigo: 'JC',
        nombre: 'JUBILADO DEL SEG.SOC.CAMPESINO',
        tipoAfiliacionOficial: 'JUBILADO DEL SEG.SOC.CAMPESINO',
        subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)',
        badgeClass: 'badge-seguro jc'
      };
    }
    // CB = Jefe de familia según catálogo oficial REPRE08
    if (/JEFE DE FAMILIA/i.test(combo)) {
      return {
        codigo: 'CB',
        nombre: 'JEFE FAMILIA SEG.SOC.CAMPESINO',
        tipoAfiliacionOficial: 'JEFE FAMILIA SEG.SOC.CAMPESINO',
        subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)',
        badgeClass: 'badge-seguro cb'
      };
    }
    // CA = Familiar / Beneficiario dependiente según catálogo oficial REPRE08
    return {
      codigo: 'CA',
      nombre: 'FAMILIAR SEG.SOCIAL CAMPESINO',
      tipoAfiliacionOficial: 'FAMILIAR SEG.SOCIAL CAMPESINO',
      subsistema: 'SEGURO SOCIAL CAMPESINO (SSC)',
      badgeClass: 'badge-seguro ca'
    };
  }

  // 3. HIJOS MENORES DE 18 AÑOS (EXTENSIÓN DE COBERTURA)
  // IMPORTANTE: Se evalúa antes de pensionista porque la descripción de IESS suele decir "...de afiliado/pensionista"
  if (/HIJ[OA].*(?:MENOR|<18|18 A[ÑN]OS)|EXTENSI[OÓ]N.*HIJ[OA]|DEPENDIENTE HIJO/i.test(combo)) {
    if (/PENSIONISTA|JUBILAD/i.test(combo) && !/AFILIADO/i.test(combo)) {
      return {
        codigo: 'HJ',
        nombre: 'HIJO DE PENSIONISTA <18 AÑOS',
        tipoAfiliacionOficial: 'HIJO DE PENSIONISTA <18 AÑOS',
        subsistema: 'EXTENSIÓN DE COBERTURA (IESS)',
        badgeClass: 'badge-seguro hj'
      };
    }
    return {
      codigo: 'AG',
      nombre: 'HIJOS DE AFILIADO <18 AÑOS',
      tipoAfiliacionOficial: 'HIJOS DE AFILIADO <18 AÑOS',
      subsistema: 'EXTENSIÓN DE COBERTURA (IESS)',
      badgeClass: 'badge-seguro ag'
    };
  }

  // 4. CÓNYUGE (EXTENSIÓN DE COBERTURA)
  if (/C[OÓ]NYUGE/i.test(combo)) {
    if (/PENSIONISTA|JUBILAD/i.test(combo)) {
      return {
        codigo: 'CJ',
        nombre: 'EXT.COBER.CONYUGE PENSIONISTA',
        tipoAfiliacionOficial: 'EXT.COBER.CONYUGE PENSIONISTA',
        subsistema: 'EXTENSIÓN DE COBERTURA (IESS)',
        badgeClass: 'badge-seguro cj'
      };
    }
    return {
      codigo: 'CY',
      nombre: 'EXT.COBERTURA CONYUGE AFILIADO',
      tipoAfiliacionOficial: 'EXT.COBERTURA CONYUGE AFILIADO',
      subsistema: 'EXTENSIÓN DE COBERTURA (IESS)',
      badgeClass: 'badge-seguro cy'
    };
  }

  // 5. MONTEPÍO (ORFANDAD O VIUDEZ)
  if (/MONTEP[IÍ]O|ORFANDAD/i.test(combo)) {
    if (/ORFANDAD|HIJ[OA]/i.test(combo)) {
      return {
        codigo: 'MH',
        nombre: 'MONTEPIO ORFANDAD',
        tipoAfiliacionOficial: 'MONTEPIO ORFANDAD',
        subsistema: 'SISTEMA DE PENSIONES (IESS)',
        badgeClass: 'badge-seguro mh'
      };
    }
    return {
      codigo: 'MO',
      nombre: 'MONTEPIO VIUDA COTIZANTE 4.15%',
      tipoAfiliacionOficial: 'MONTEPIO VIUDA COTIZANTE 4.15%',
      subsistema: 'SISTEMA DE PENSIONES (IESS)',
      badgeClass: 'badge-seguro mo'
    };
  }

  // 6. RIESGOS DEL TRABAJO
  if (/RIESGOS? DEL TRABAJO/i.test(combo)) {
    return {
      codigo: 'JR',
      nombre: 'PENSIONISTA DE RIESGOS/TRABAJO',
      tipoAfiliacionOficial: 'PENSIONISTA DE RIESGOS/TRABAJO',
      subsistema: 'SEGURO GENERAL DE RIESGOS DEL TRABAJO (SGRT)',
      badgeClass: 'badge-seguro jr'
    };
  }

  // 7. JUBILADOS / PENSIONISTAS
  if (/JUBILAD|PENSIONES|PENSIONISTA/i.test(combo)) {
    return {
      codigo: 'JU',
      nombre: 'PENSIONISTA DEL SEGURO GENERAL',
      tipoAfiliacionOficial: 'PENSIONISTA DEL SEGURO GENERAL',
      subsistema: 'SISTEMA DE PENSIONES (IESS)',
      badgeClass: 'badge-seguro jub'
    };
  }

  // 8. AFILIADO VOLUNTARIO
  if (/VOLUNTARI/i.test(combo)) {
    return {
      codigo: 'CV',
      nombre: 'AFILIADO VOLUNTARIO',
      tipoAfiliacionOficial: 'AFILIADO VOLUNTARIO',
      subsistema: 'SEGURO DE AFILIACIÓN VOLUNTARIA',
      badgeClass: 'badge-seguro cv'
    };
  }

  // 9. TRABAJO NO REMUNERADO DEL HOGAR
  if (/TRABAJO NO REMUNERADO|HOGAR|AMA DE CASA/i.test(combo)) {
    return {
      codigo: 'TNRH',
      nombre: 'TRABAJO NO REMUNERADO DEL HOGAR',
      tipoAfiliacionOficial: 'TRABAJO NO REMUNERADO DEL HOGAR',
      subsistema: 'SEGURO TRABAJO NO REMUNERADO DEL HOGAR',
      badgeClass: 'badge-seguro tnrh'
    };
  }

  // 10. SEGURO GENERAL TIEMPO COMPLETO / PARCIAL (Solo si la descripción lo dice explícitamente)
  if (/TIEMPO COMPLETO|SEGURO GENERAL/i.test(combo)) {
    return {
      codigo: 'SG',
      nombre: 'AFILIADO DEL SEGURO GENERAL',
      tipoAfiliacionOficial: 'AFILIADO DEL SEGURO GENERAL',
      subsistema: 'SEGURO GENERAL OBLIGATORIO (SGO)',
      badgeClass: 'badge-seguro sg'
    };
  }
  if (/TIEMPO PARCIAL|MEDIO TIEMPO/i.test(combo)) {
    return {
      codigo: 'SG-TP',
      nombre: 'AFILIADO SEGURO GENERAL TIEMPO PARCIAL',
      tipoAfiliacionOficial: 'AFILIADO SEGURO GENERAL TIEMPO PARCIAL',
      subsistema: 'SEGURO GENERAL OBLIGATORIO (SGO)',
      badgeClass: 'badge-seguro sg'
    };
  }

  // 11. CASO GENERAL / POR DESCRIPCIÓN (NUNCA ASUMIR SEGURO GENERAL)
  if (afil) {
    return {
      codigo: 'IESS',
      nombre: afil,
      tipoAfiliacionOficial: afil,
      subsistema: 'IESS',
      badgeClass: 'badge-seguro sg'
    };
  }
  if (obs) {
    return {
      codigo: 'IESS',
      nombre: obs,
      tipoAfiliacionOficial: obs,
      subsistema: 'IESS',
      badgeClass: 'badge-seguro sg'
    };
  }

  return {
    codigo: 'ACTIVO',
    nombre: 'COBERTURA VIGENTE (DESCRIPCIÓN NO DISPONIBLE)',
    tipoAfiliacionOficial: 'COBERTURA VIGENTE (DESCRIPCIÓN NO DISPONIBLE)',
    subsistema: 'IESS',
    badgeClass: 'badge-seguro sg'
  };
}

/**
 * Determina si el asegurado es menor de edad (niño/dependiente) o adulto:
 * 1. Mención explícita en observación o afiliación (HIJO, MENOR, PEDIATRÍA).
 * 2. Cédulas con tercer dígito >= 6 emitidas por el Registro Civil del Ecuador
 *    a partir de 2012 para recién nacidos y menores cuando se agotaron las series 0-5.
 * 3. Dependientes por extensión de cobertura de hijos menores (AG, HJ).
 * 4. Para Seguro Campesino Familiar (CA): si la serie es >= 6 es un hijo menor dependiente.
 */
export function determinarGrupoEtario(cedula = '', codigoSeguro = '', observacion = '', tipoAfiliacion = '') {
  const digits = String(cedula || '').replace(/\D/g, '');
  const d3 = digits.length >= 3 ? parseInt(digits[2], 10) : 0;
  const combo = `${observacion} ${tipoAfiliacion}`.toUpperCase();

  const mencionaHijo = /HIJ[OA]|MENOR|<18|18 A[ÑN]OS|INFANT|PEDIATR/i.test(combo);
  const esSerieMenor = d3 >= 6; // Series 176..., 096..., etc.

  if (mencionaHijo || codigoSeguro === 'AG' || codigoSeguro === 'HJ' || (esSerieMenor && (codigoSeguro === 'CA' || codigoSeguro === 'CB' || codigoSeguro === 'MH')) || codigoSeguro === 'DEP-SG') {
    return {
      esMenor: true,
      grupoEtario: 'Menor de edad (Niño)',
      esMenorTexto: 'SÍ',
      detalle: 'Menor de edad / Beneficiario dependiente'
    };
  }

  if (esSerieMenor) {
    return {
      esMenor: true,
      grupoEtario: 'Menor de edad (Niño)',
      esMenorTexto: 'SÍ',
      detalle: 'Menor de edad (Serie Registro Civil reciente)'
    };
  }

  // Adultos
  if (codigoSeguro === 'CB') {
    return {
      esMenor: false,
      grupoEtario: 'Adulto',
      esMenorTexto: 'NO',
      detalle: 'Adulto (Jefe de Familia SSC)'
    };
  }

  if (codigoSeguro === 'CA') {
    return {
      esMenor: false,
      grupoEtario: 'Adulto (Familiar SSC)',
      esMenorTexto: 'NO',
      detalle: 'Beneficiario adulto (Cónyuge / Familiar SSC)'
    };
  }

  return {
    esMenor: false,
    grupoEtario: 'Adulto',
    esMenorTexto: 'NO',
    detalle: 'Adulto'
  };
}

