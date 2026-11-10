import test from 'node:test';
import assert from 'node:assert';
import { validarCedulaEcuador } from '../lib/cedulaValidator.js';
import { solveAltcha } from '../lib/altchaSolver.js';
import crypto from 'node:crypto';

test('Validador de Cédula: detecta formato incorrecto', () => {
  assert.strictEqual(validarCedulaEcuador('123').valido, false);
  assert.strictEqual(validarCedulaEcuador('171003406A').valido, false);
  assert.strictEqual(validarCedulaEcuador('9999999999').valido, false); // Provincia 99 no existe
});

test('Validador de Cédula: algoritmo Módulo 10 funciona con cédulas válidas', () => {
  // Cédula tradicional (Pichincha)
  const cedulaValida = '1710034065';
  const res = validarCedulaEcuador(cedulaValida);
  assert.strictEqual(res.valido, true);
  assert.strictEqual(res.provincia, 17);

  // Cédula de series nuevas (3er dígito >= 6 emitidas por Registro Civil para menores)
  const cedulaNueva = '1761031838';
  const resNueva = validarCedulaEcuador(cedulaNueva);
  assert.strictEqual(resNueva.valido, true);
  assert.strictEqual(resNueva.provincia, 17);
});

test('Solucionador Altcha: resuelve reto SHA-256 en menos de 200ms', () => {
  const salt = 'testsalt12345';
  const targetNumber = 4521;
  const challenge = crypto.createHash('sha256').update(salt + targetNumber).digest('hex');

  const start = Date.now();
  const base64Solved = solveAltcha({
    algorithm: 'SHA-256',
    challenge,
    salt,
    signature: 'sig_test_123'
  });
  const duracion = Date.now() - start;

  assert.ok(duracion < 200, `Altcha tardó ${duracion}ms, debe ser < 200ms`);
  const parsed = JSON.parse(Buffer.from(base64Solved, 'base64').toString('utf-8'));
  assert.strictEqual(parsed.number, targetNumber);
  assert.strictEqual(parsed.challenge, challenge);
});

test('Clasificador de Seguro: clasifica CA, CB y SG correctamente', async () => {
  const { clasificarTipoSeguro, determinarGrupoEtario } = await import('../lib/iessScraper.js');

  // Jefe de familia SSC
  const cCA = clasificarTipoSeguro('Afiliado Seguro Campesino', 'Jefe de Familia del SSC', true);
  assert.strictEqual(cCA.codigo, 'CA');
  assert.strictEqual(cCA.subsistema, 'SEGURO SOCIAL CAMPESINO (SSC)');

  // Beneficiario dependiente SSC
  const cCB = clasificarTipoSeguro('Afiliado Seguro Campesino', 'Cédula Registrada con Derecho', true);
  assert.strictEqual(cCB.codigo, 'CB');
  assert.strictEqual(cCB.subsistema, 'SEGURO SOCIAL CAMPESINO (SSC)');

  // Seguro General
  const cSG = clasificarTipoSeguro('Seguro General', 'Cédula Registrada con Derecho', true);
  assert.strictEqual(cSG.codigo, 'SG');
  assert.strictEqual(cSG.subsistema, 'SEGURO GENERAL OBLIGATORIO (SGO)');

  // No asumir Seguro General cuando la descripción es de otra entidad o régimen
  const cOtro = clasificarTipoSeguro('Pescadores Artesanales', 'Activo', true);
  assert.strictEqual(cOtro.codigo, 'IESS');
  assert.strictEqual(cOtro.nombre, 'Pescadores Artesanales');
  assert.strictEqual(cOtro.subsistema, 'IESS');

  // Hijos menores de 18 años (extensión de cobertura)
  const cAG = clasificarTipoSeguro('Dependiente hijo menor de 18 años de afiliado/pensionista', 'Con Cobertura', true);
  assert.strictEqual(cAG.codigo, 'AG');
  assert.strictEqual(cAG.subsistema, 'EXTENSIÓN DE COBERTURA (IESS)');

  // Afiliado Voluntario
  const cCV = clasificarTipoSeguro('Afiliado Voluntario', 'Con Cobertura', true);
  assert.strictEqual(cCV.codigo, 'CV');
  assert.strictEqual(cCV.subsistema, 'SEGURO DE AFILIACIÓN VOLUNTARIA');

  // Detección de menores (niños)
  // Caso 1: Cédula de niño en SSC con serie 176...
  const gMenorSSC = determinarGrupoEtario('1761031838', 'CB', 'Cédula Registrada con Derecho', 'Afiliado Seguro Campesino');
  assert.strictEqual(gMenorSSC.esMenor, true);
  assert.strictEqual(gMenorSSC.grupoEtario, 'Menor de edad (Niño)');
  assert.strictEqual(gMenorSSC.esMenorTexto, 'SÍ');

  // Caso 2: Cédula tradicional adulto jefe de familia
  const gAdultoCA = determinarGrupoEtario('1708683873', 'CA', 'Jefe de Familia del SSC', 'Afiliado Seguro Campesino');
  assert.strictEqual(gAdultoCA.esMenor, false);
  assert.strictEqual(gAdultoCA.grupoEtario, 'Adulto');
  assert.strictEqual(gAdultoCA.esMenorTexto, 'NO');

  // Caso 3: Cédula extensión cobertura hijos menores
  const gMenorSG = determinarGrupoEtario('1750000000', 'AG', 'Hijo menor de 18 años', 'Extensión Cobertura');
  assert.strictEqual(gMenorSG.esMenor, true);
  assert.strictEqual(gMenorSG.grupoEtario, 'Menor de edad (Niño)');
  assert.strictEqual(gMenorSG.esMenorTexto, 'SÍ');
});


