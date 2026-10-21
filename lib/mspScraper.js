/**
 * Conector optimizado para consulta de Cobertura en la Red Pública (MSP)
 * Incluye detector de disponibilidad y timeout ultrarrápido para no ralentizar lotes
 */

let mspEstadoCache = {
  disponible: null,
  ultimoChequeo: 0
};

export async function consultarMSP(cedula) {
  const MSP_URL = 'https://coresalud.msp.gob.ec/coresalud/app.php/publico/rpis/afiliacion/consulta';
  const ahora = Date.now();

  // Si sabemos que en los últimos 2 minutos el MSP no respondió (por firewall/fuera de red), no hacemos esperar
  if (mspEstadoCache.disponible === false && (ahora - mspEstadoCache.ultimoChequeo < 120000)) {
    return {
      exito: false,
      entidad: 'MSP / RPIS',
      disponible: false,
      cedula,
      mensaje: 'Servidor MSP fuera de red (se requiere intranet hospitalaria/RPIS)'
    };
  }

  const controller = new AbortController();
  // Timeout ultrarrápido de 800ms para no demorar la consulta principal
  const timeoutId = setTimeout(() => controller.abort(), 800);

  try {
    const res = await fetch(MSP_URL, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      mspEstadoCache = { disponible: false, ultimoChequeo: ahora };
      return {
        exito: false,
        entidad: 'MSP / RPIS',
        disponible: false,
        cedula,
        mensaje: `Error HTTP ${res.status}`
      };
    }

    mspEstadoCache = { disponible: true, ultimoChequeo: ahora };
    const html = await res.text();
    const tieneIESS = /IESS/i.test(html);
    const tieneISSFA = /ISSFA/i.test(html);
    const tieneISSPOL = /ISSPOL/i.test(html);

    let red = 'MSP (Cobertura Pública Universal)';
    if (tieneIESS) red = 'IESS (Seguro General / Campesino)';
    else if (tieneISSFA) red = 'ISSFA (Fuerzas Armadas)';
    else if (tieneISSPOL) red = 'ISSPOL (Policía Nacional)';

    return {
      exito: true,
      entidad: 'MSP / RPIS',
      disponible: true,
      cedula,
      redDetectada: red,
      mensaje: 'Consulta en RPIS exitosa'
    };
  } catch (error) {
    clearTimeout(timeoutId);
    mspEstadoCache = { disponible: false, ultimoChequeo: ahora };
    return {
      exito: false,
      entidad: 'MSP / RPIS',
      disponible: false,
      cedula,
      mensaje: 'Servidor MSP fuera de red (se requiere intranet hospitalaria/RPIS)'
    };
  }
}
