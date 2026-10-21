import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarCedulaEcuador } from './lib/cedulaValidator.js';
import { consultarIESS } from './lib/iessScraper.js';
import { consultarMSP } from './lib/mspScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3080;

// Tipos MIME comunes
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = reqUrl.pathname;

  // 1. Endpoint: Validación de cédula
  if (pathname.startsWith('/api/validar/')) {
    const cedula = pathname.replace('/api/validar/', '');
    const resultado = validarCedulaEcuador(cedula);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resultado));
    return;
  }

  // 2. Endpoint: Calificar en IESS + MSP (Contingencia Enfermedad = 14)
  if (pathname === '/api/calificar') {
    const cedula = reqUrl.searchParams.get('cedula');

    if (!cedula) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exito: false, mensaje: 'El parámetro "cedula" es requerido' }));
      return;
    }

    const validacion = validarCedulaEcuador(cedula);
    if (!validacion.valido) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exito: false,
        cedula,
        valido: false,
        mensaje: validacion.mensaje
      }));
      return;
    }

    const inicio = Date.now();

    // Consulta concurrente a IESS (Enfermedad) y MSP (RPIS)
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

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      exito: true,
      cedula: validacion.cedula,
      contingencia: 'Enfermedad',
      estadoFinal,
      duracionMs,
      timestamp: new Date().toISOString(),
      iess: resIESS,
      msp: resMSP
    }));
    return;
  }

  // 3. Endpoint: Health check
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      servicio: 'Calificador de Derecho IESS - MSP (Enfermedad)',
      version: '1.0.0',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // 4. Servir archivos estáticos de la PWA
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Acceso denegado');
    return;
  }

  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
      return;
    }
  } catch (err) {
    console.error(err);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Página no encontrada');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`🏥 Calificador de Derecho IESS/MSP (0 Dependencias Externas)`);
  console.log(`🌐 Acceso local en PC: http://localhost:${PORT}`);
  console.log(`📱 Acceso móvil: http://<IP-DE-ESTA-PC>:${PORT}`);
  console.log(`⚡ Contingencia fija: ENFERMEDAD (Código 14)`);
  console.log(`=======================================================`);
});
