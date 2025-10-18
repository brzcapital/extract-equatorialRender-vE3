// === IMPORTS BÁSICOS ===
import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import crypto from "crypto";

// === CONFIG EMBUTIDA (sem dependência de env.mjs) ===
const CONFIG = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "SUA_CHAVE_OPENAI_AQUI",
  RESET_LOGS_TOKEN: process.env.RESET_LOGS_TOKEN || "admin123",
  PRIMARY_MODEL: "gpt-4-turbo",
  FALLBACK_MODEL: "gpt-5",
  PORT: process.env.PORT || 10000
};

// === INICIALIZAÇÃO DO SERVIDOR ===
const app = express();
const upload = multer({ dest: "uploads/" });
app.use(express.json());

// === GARANTE ESTRUTURA DE PASTAS ===
const logsDir = "./logs";
const logFile = path.join(logsDir, "auditoria.json");
const usageFile = path.join(logsDir, "usage.json");

if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, "[]");
if (!fs.existsSync(usageFile)) fs.writeFileSync(usageFile, "[]");

// === ENDPOINT HEALTH ===
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    node_version: process.version,
    timestamp: new Date().toISOString()
  });
});

// === ENDPOINT LOGS (leitura completa) ===
app.get("/logs", (req, res) => {
  const logs = {
    auditoria: fs.existsSync(logFile)
      ? fs.readFileSync(logFile, "utf8").split("\n").filter(Boolean)
      : [],
    uso: fs.existsSync(usageFile)
      ? fs.readFileSync(usageFile, "utf8").split("\n").filter(Boolean)
      : []
  };
  res.json(logs);
});

// === ENDPOINT RESET LOGS ===
app.post("/reset-logs", (req, res) => {
  const token = req.headers["x-reset-token"];
  if (token !== CONFIG.RESET_LOGS_TOKEN)
    return res.status(403).json({ error: "Token inválido." });

  fs.writeFileSync(logFile, "[]");
  fs.writeFileSync(usageFile, "[]");
  res.json({ message: "Logs limpos com sucesso." });
});

// === ENDPOINT DE EXTRAÇÃO (mock funcional e auditável) ===
app.post("/extract-structured", upload.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ error: "Arquivo PDF ausente." });

    // Gera hash do PDF
    const fileBuffer = fs.readFileSync(req.file.path);
    const hash_pdf = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    // Registra auditoria
    const logEntry = {
      date: new Date().toISOString(),
      ip: req.ip,
      file: req.file.originalname,
      hash_pdf,
      status: "processed"
    };
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + "\n");

    // Exemplo de uso simulado de tokens (para futura integração GPT)
    const tokens_gpt_extracao = Math.floor(Math.random() * 2000);
    const tokens_gpt_mes = Math.floor(Math.random() * 50000);

    // Registra uso
    const usageEntry = {
      date: new Date().toISOString(),
      hash_pdf,
      tokens_gpt_extracao,
      tokens_gpt_mes
    };
    fs.appendFileSync(usageFile, JSON.stringify(usageEntry) + "\n");

    // Retorno final (mock seguro)
    res.json({
      message: "Extração concluída com sucesso (mock).",
      hash_pdf,
      health: "good",
      tokens_gpt_extracao,
      tokens_gpt_mes
    });

  } catch (err) {
    console.error("Erro na extração:", err);
    res.status(500).json({ error: "Falha ao processar a fatura." });
  }
});

// === INICIALIZA SERVIDOR ===
app.listen(CONFIG.PORT, () =>
  console.log(`🚀 Servidor rodando na porta ${CONFIG.PORT}`)
);
