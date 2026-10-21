import { validarCedulaEcuador } from '../lib/cedulaValidator.js';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { cedula } = req.query;
  const resultado = validarCedulaEcuador(cedula);
  return res.status(200).json(resultado);
}
