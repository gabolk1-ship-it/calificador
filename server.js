import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarCedulaEcuador, normalizarCedula } from './lib/cedulaValidator.js';
import { consultarIESS } from './lib/iessScraper.js';
import { consultarMSP } from './lib/mspScraper.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
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

  // Endpoint 1: Validación individual de cédula
  if (pathname.startsWith('/api/validar/')) {
    const cedula = pathname.replace('/api/validar/', '');
    const resultado = validarCedulaEcuador(cedula);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(resultado));
    return;
  }

  // Endpoint 2: Cargar automáticamente el archivo REPRE de C:\DATOSMIS
  if (pathname === '/api/cargar-datosmis') {
    try {
      const dirDatosMis = 'C:\\DATOSMIS';
      if (!fs.existsSync(dirDatosMis)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exito: false, mensaje: 'Carpeta C:\\DATOSMIS no encontrada' }));
        return;
      }

      const files = fs.readdirSync(dirDatosMis)
        .filter(f => f.toUpperCase().startsWith('REPRE08') && f.toUpperCase().endsWith('.CSV'))
        .sort((a, b) => {
          const statA = fs.statSync(path.join(dirDatosMis, a)).mtimeMs;
          const statB = fs.statSync(path.join(dirDatosMis, b)).mtimeMs;
          return statB - statA;
        });

      if (files.length === 0) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ exito: false, mensaje: 'No se encontraron archivos REPRE08 en C:\\DATOSMIS' }));
        return;
      }

      const latestFile = files[0];
      const filePath = path.join(dirDatosMis, latestFile);
      const content = fs.readFileSync(filePath, 'latin1');
      const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);

      const header = lines[0].split(';').map(h => h.replace(/["']/g, '').trim().toUpperCase());
      const docIndex = header.indexOf('NRO_DOCUMENTO');

      const cedulas = [];
      let conCeroRecuperado = 0;

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(';');
        const val = docIndex !== -1 && parts[docIndex] ? parts[docIndex] : '';
        const digits = val.replace(/["']/g, '').trim().replace(/\D/g, '');
        if (digits.length === 9 || digits.length === 10) {
          const norm = normalizarCedula(digits);
          if (validarCedulaEcuador(norm).valido) {
            if (digits.length === 9) conCeroRecuperado++;
            cedulas.push(norm);
          }
        }
      }

      const unicas = [...new Set(cedulas)];

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        exito: true,
        archivo: latestFile,
        ruta: filePath,
        totalAtenciones: cedulas.length,
        unicasCount: unicas.length,
        conCeroRecuperado,
        cedulas: unicas
      }));
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exito: false, mensaje: err.message }));
      return;
    }
  }

  // Endpoint 3: Calificar en IESS + MSP (Contingencia Enfermedad = 14)
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

  // Endpoint 4: Health check
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

  // Endpoint 5: Archivos estáticos de la PWA
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
  console.log(`🏥 Calificador IESS/MSP activo en http://localhost:${PORT}`);
});
