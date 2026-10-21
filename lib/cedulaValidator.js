/**
 * Normaliza y valida cédulas ecuatorianas de 10 dígitos.
 * Corrige automáticamente la pérdida del '0' inicial provocada por Excel.
 */
export function normalizarCedula(entrada) {
  if (!entrada) return '';
  let limpia = String(entrada).trim().replace(/\D/g, '');
  // Si Excel le cortó el 0 inicial (9 dígitos), se lo restituimos
  if (limpia.length === 9) {
    limpia = '0' + limpia;
  }
  return limpia;
}

export function validarCedulaEcuador(cedula) {
  if (!cedula) {
    return { valido: false, mensaje: 'La cédula es requerida' };
  }

  const limpia = normalizarCedula(cedula);

  if (limpia.length !== 10) {
    return { valido: false, mensaje: `Longitud inválida (${limpia.length} dígitos). Debe tener 10 dígitos.` };
  }

  // Provincia (dos primeros dígitos: 01 a 24, o 30 para exterior)
  const provincia = parseInt(limpia.substring(0, 2), 10);
  if ((provincia < 1 || provincia > 24) && provincia !== 30) {
    return { valido: false, mensaje: `Código de provincia (${provincia}) no corresponde a Ecuador` };
  }

  // Tercer dígito para personas naturales debe ser menor a 6
  const tercerDigito = parseInt(limpia[2], 10);
  if (tercerDigito >= 6) {
    return { valido: false, mensaje: 'Tercer dígito no corresponde a cédula de persona natural' };
  }

  // Algoritmo Módulo 10
  const coeficientes = [2, 1, 2, 1, 2, 1, 2, 1, 2];
  let suma = 0;

  for (let i = 0; i < 9; i++) {
    let valor = parseInt(limpia[i], 10) * coeficientes[i];
    if (valor >= 10) {
      valor -= 9;
    }
    suma += valor;
  }

  const digitoEsperado = (suma % 10 === 0) ? 0 : 10 - (suma % 10);
  const digitoReal = parseInt(limpia[9], 10);

  if (digitoEsperado !== digitoReal) {
    return { valido: false, mensaje: 'Dígito verificador incorrecto' };
  }

  return { valido: true, cedula: limpia, provincia };
}
