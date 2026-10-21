import { validarCedulaEcuador } from '../lib/cedulaValidator.js';
import { consultarIESS } from '../lib/iessScraper.js';
import { consultarMSP } from '../lib/mspScraper.js';

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const { cedula } = req.query;

  if (!cedula) {
    return res.status(400).json({ exito: false, mensaje: 'El parámetro "cedula" es requerido' });
  }

  const validacion = validarCedulaEcuador(cedula);
  if (!validacion.valido) {
    return res.status(400).json({
      exito: false,
      cedula,
      valido: false,
      mensaje: validacion.mensaje
    });
  }

  const inicio = Date.now();

  const [resIESS, resMSP] = await Promise.all([
    consultarIESS(validacion.cedula),
    consultarMSP(validacion.cedula)
  ]);

  const duracionMs = Date.now() - inicio;

  let estadoFinal = 'INDETERMINADO';
  if (resIESS.acreditado === true) {
    estadoFinal = 'ACREDITADO';
  } else if (resIESS.acreditado === false) {
    estadoFinal = 'NO_ACREDITADO';
  } else {
    estadoFinal = 'REVISION_MANUAL';
  }

  return res.status(200).json({
    exito: true,
    cedula: validacion.cedula,
    contingencia: 'Enfermedad',
    estadoFinal,
    duracionMs,
    timestamp: new Date().toISOString(),
    iess: resIESS,
    msp: resMSP
  });
}
