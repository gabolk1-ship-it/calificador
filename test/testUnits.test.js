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
  // Cédula válida de prueba en Ecuador (Pichincha)
  const cedulaValida = '1710034065';
  const res = validarCedulaEcuador(cedulaValida);
  assert.strictEqual(res.valido, true);
  assert.strictEqual(res.provincia, 17);
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
