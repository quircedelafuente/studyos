#!/usr/bin/env node
/**
 * Stub HTTP para desarrollo: acepta POST /transcribe con multipart (campo audio).
 * Ejecutar: node scripts/class-notes-companion-stub.mjs
 * Puerto: 16789 (o IESTUDIO_TRANSCRIBE_PORT)
 */
import http from "node:http";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.IESTUDIO_TRANSCRIBE_PORT ?? 16789);
const ALLOWED_ORIGIN = process.env.IESTUDIO_CORS_ORIGIN ?? "http://localhost:3000";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer((req, res) => {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/transcribe") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Usa POST /transcribe" }));
    return;
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const buf = Buffer.concat(chunks);
    if (buf.length < 10) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Cuerpo vacío o demasiado pequeño" }));
      return;
    }
    const text = `[Stub IEStudio] Transcripción simulada (${buf.length} bytes). id=${randomUUID().slice(0, 8)} — sustituye este servicio por WhisperX en local.`;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ text, language: "es" }));
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Companion stub: http://127.0.0.1:${PORT} (POST /transcribe)`);
  console.log(`CORS: ${ALLOWED_ORIGIN}`);
});
