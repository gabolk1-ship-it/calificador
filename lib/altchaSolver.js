import crypto from 'node:crypto';

/**
 * Solucionador de Proof-of-Work (PoW) para el captcha Altcha del IESS
 * @param {Object} challengeData { algorithm, challenge, salt, signature }
 * @param {number} maxIterations Máximo número de intentos (por defecto 2,000,000)
 * @returns {string} Payload en base64 listo para enviar en el campo `altcha`
 */
export function solveAltcha(challengeData, maxIterations = 2000000) {
  const { algorithm, challenge, salt, signature } = challengeData;

  if (algorithm && algorithm !== 'SHA-256') {
    throw new Error(`Algoritmo Altcha no soportado: ${algorithm}`);
  }

  const saltBuffer = Buffer.from(salt, 'utf-8');

  for (let num = 0; num <= maxIterations; num++) {
    const hash = crypto
      .createHash('sha256')
      .update(saltBuffer)
      .update(String(num))
      .digest('hex');

    if (hash === challenge) {
      const solution = {
        algorithm: algorithm || 'SHA-256',
        challenge,
        number: num,
        salt,
        signature
      };
      return Buffer.from(JSON.stringify(solution)).toString('base64');
    }
  }

  throw new Error(`No se pudo resolver el reto Altcha dentro del límite de ${maxIterations} iteraciones`);
}
