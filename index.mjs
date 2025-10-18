// vE3 — extractor service (Express + pdfjs + optional GPT schema) 
import express from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ---- Config (inline defaults) ----
const PORT = process.env.PORT || 10000;
const USE_GPT = (process.env.OPENAI_USE_GPT || "false").toLowerCase() === "true";
const PRIMARY_MODEL = process.env.OPENAI_PRIMARY_MODEL || "gpt-4o-mini";
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || "gpt-5-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Lazy load OpenAI only if needed
let openai = null;
async function ensureOpenAI() {
  if (!USE_GPT) return null;
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY ausente.");
  if (!openai) {
    const pkg = await import("openai");
    openai = new pkg.default({ apiKey: OPENAI_API_KEY });
  }
  return openai;
}

// ---- PDF text extraction via pdfjs-dist ----
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import pdfjsWorker from "pdfjs-dist/legacy/build/pdf.worker.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Multer config (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const app = express();
app.use(express.json({ limit: "2mb" }));

// Simple in-memory logs
const LOGS = [];
function log(level, msg, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, ...meta };
  LOGS.push(entry);
  if (LOGS.length > 500) LOGS.shift();
  console.log(`[${entry.ts}] ${level}: ${msg}`);
}

// Health
app.get("/health", (req, res) => {
  res.json({ ok: true, versao: "vE3", use_gpt: USE_GPT, primary: PRIMARY_MODEL, fallback: FALLBACK_MODEL });
});

// Logs (last N)
app.get("/logs", (req, res) => {
  const n = Math.max(1, Math.min(200, parseInt(req.query.n || "50", 10)));
  res.json(LOGS.slice(-n));
});

// --- Utils ---
async function pdfToText(buffer) {
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const pdf = await loadingTask.promise;
  const maxPages = Math.min(pdf.numPages, 5); // segurança
  let full = "";
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(it => (typeof it.str === "string" ? it.str : "")).join(" ");
    full += strings + "\n";
  }
  return full;
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Heurística básica (fallback) — preenche só o essencial sem “inventar”
function heuristicExtract(txt) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const get = (rgx) => {
    const m = txt.match(rgx);
    return m ? clean(m[1]) : null;
  };

  // Exemplos de padrões; mantemos conservador para não errar
  const unidade = get(/Unidade\s+Consumidora[:\s]+(\d{6,})/i);
  const venc = get(/Vencimento[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
  const emissao = get(/Emiss[aã]o[:\s]+(\d{2}\/\d{2}\/\d{4})/i);
  const mesref = get(/Refer[eê]ncia[:\s]+([A-Z]{3}\/\d{4})/i) || get(/M[eê]s\s*\/\s*Ano\s*[:\s]+([A-Z]{3}\/\d{4})/i);

  let total = get(/Total\s*a\s*pagar[:\sR$\-]*([\d\.,]+)/i);
  if (total) total = parseFloat(total.replace(/\./g, "").replace(",", "."));

  return {
    unidade_consumidora: unidade,
    total_a_pagar: total ?? null,
    data_vencimento: venc,
    data_emissao: emissao,
    mes_ano_referencia: mesref,
  };
}

// GPT schema
function buildSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      unidade_consumidora: { type: ["string", "null"] },
      total_a_pagar: { type: ["number", "null"] },
      data_vencimento: { type: ["string", "null"], pattern: "^\\d{2}/\\d{2}/\\d{4}$" },
      data_leitura_anterior: { type: ["string", "null"], pattern: "^\\d{2}/\\d{2}/\\d{4}$" },
      data_leitura_atual: { type: ["string", "null"], pattern: "^\\d{2}/\\d{2}/\\d{4}$" },
      data_proxima_leitura: { type: ["string", "null"], pattern: "^\\d{2}/\\d{2}/\\d{4}$" },
      data_emissao: { type: ["string", "null"], pattern: "^\\d{2}/\\d{2}/\\d{4}$" },
      apresentacao: { type: ["string", "null"], pattern: "^\\d{2}/\\d{2}/\\d{4}$" },
      mes_ano_referencia: { type: ["string", "null"] },
      leitura_anterior: { type: ["number", "null"] },
      leitura_atual: { type: ["number", "null"] },
      beneficio_tarifario_bruto: { type: ["number", "null"] },
      beneficio_tarifario_liquido: { type: ["number", "null"] },
      icms: { type: ["number", "null"] },
      pis_pasep: { type: ["number", "null"] },
      cofins: { type: ["number", "null"] },
      fatura_debito_automatico: { type: ["string", "boolean", "null"], enum: ["yes", "no", true, false, null] },
      credito_recebido: { type: ["number", "null"] },
      saldo_kwh: { type: ["number", "null"] },
      excedente_recebido: { type: ["number", "null"] },
      ciclo_geracao: { type: ["string", "null"] },
      informacoes_para_o_cliente: { type: ["string", "null"] },
      uc_geradora: { type: ["string", "null"] },
      uc_geradora_producao: { type: ["number", "null"] },
      cadastro_rateio_geracao_uc: { type: ["string", "null"] },
      cadastro_rateio_geracao_percentual: { type: ["number", "null"] },
      injecoes_scee: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            uc: { type: ["string", "null"] },
            quant_kwh: { type: ["number", "null"] },
            preco_unit_com_tributos: { type: ["number", "null"] },
            tarifa_unitaria: { type: ["number", "null"] }
          },
          required: ["uc", "quant_kwh", "preco_unit_com_tributos", "tarifa_unitaria"]
        },
        default: []
      },
      consumo_scee_quant: { type: ["number", "null"] },
      consumo_scee_preco_unit_com_tributos: { type: ["number", "null"] },
      consumo_scee_tarifa_unitaria: { type: ["number", "null"] },
      media: { type: ["number", "null"] },
      parc_injet_s_desc_percentual: { type: ["number", "null"] },
      observacoes: { type: ["string", "null"] },
      hash_pdf: { type: "string" },
      health: { type: "string" },
      tokens_gpt_req: { type: ["number", "null"] },
      tokens_gpt_mes: { type: ["number", "null"] }
    },
    required: [
      "unidade_consumidora","total_a_pagar","data_vencimento","data_leitura_anterior","data_leitura_atual",
      "data_proxima_leitura","data_emissao","apresentacao","mes_ano_referencia","leitura_anterior","leitura_atual",
      "beneficio_tarifario_bruto","beneficio_tarifario_liquido","icms","pis_pasep","cofins","fatura_debito_automatico",
      "credito_recebido","saldo_kwh","excedente_recebido","ciclo_geracao","informacoes_para_o_cliente","uc_geradora",
      "uc_geradora_producao","cadastro_rateio_geracao_uc","cadastro_rateio_geracao_percentual","injecoes_scee",
      "consumo_scee_quant","consumo_scee_preco_unit_com_tributos","consumo_scee_tarifa_unitaria","media",
      "parc_injet_s_desc_percentual","observacoes","hash_pdf","health","tokens_gpt_req","tokens_gpt_mes"
    ]
  };
}

function buildPrompt() {
  return `Você é um extrator de faturas Equatorial extremamente conservador.
- Extraia exatamente o que estiver no texto.
- Se um campo não existir com clareza, retorne null (não invente).
- Datas no formato DD/MM/AAAA.
- "beneficio_tarifario_liquido" é sempre negativo quando houver valor.
- "fatura_debito_automatico": "yes" ou "no".
- "mes_ano_referencia" como "MMM/AAAA" (ex: SET/2025).
- "injecoes_scee": liste cada UC e seus valores; se ausente, lista vazia.
- "hash_pdf": calcule com SHA-256 do conteúdo (já fornecido).
- "health": "ok".`;
}

async function extractWithGPT(text, hash) {
  const client = await ensureOpenAI();
  if (!client) return null;

  const schema = buildSchema();
  const prompt = buildPrompt();

  // Try primary, then fallback
  const models = [PRIMARY_MODEL, FALLBACK_MODEL];
  for (const model of models) {
    try {
      const resp = await client.responses.create({
        model,
        input: [
          { role: "system", content: "Você responde apenas em JSON conforme o schema." },
          { role: "user", content: [{ type: "input_text", text: prompt + "\n\nTEXTO DA FATURA:\n" + text + "\n\nHASH:\n" + hash }] }
        ],
        text: {
          format: {
            name: "extrator_equatorial_vE3",
            schema,
          }
        }
      });
      const out = resp.output_text ? JSON.parse(resp.output_text) : null;
      if (out) {
        out.hash_pdf = hash;
        out.health = "ok";
        out.tokens_gpt_req = resp.usage?.output_tokens ?? null;
        out.tokens_gpt_mes = null; // opcional
        return out;
      }
    } catch (e) {
      log("error", "Falha GPT", { model, err: String(e) });
      continue;
    }
  }
  return null;
}

// POST /extract-pdf (field: fatura)
app.post("/extract-pdf", upload.single("fatura"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Arquivo 'fatura' ausente (multipart/form-data)." });
    }

    const buffer = req.file.buffer;
    const hash = hashBuffer(buffer);
    const text = await pdfToText(buffer);

    let result = null;
    if (USE_GPT) {
      result = await extractWithGPT(text, hash);
    }
    if (!result) {
      // fallback heurístico mínimo
      const base = heuristicExtract(text);
      result = {
        unidade_consumidora: base.unidade_consumidora ?? null,
        total_a_pagar: base.total_a_pagar ?? null,
        data_vencimento: base.data_vencimento ?? null,
        data_leitura_anterior: null,
        data_leitura_atual: null,
        data_proxima_leitura: null,
        data_emissao: base.data_emissao ?? null,
        apresentacao: null,
        mes_ano_referencia: base.mes_ano_referencia ?? null,
        leitura_anterior: null,
        leitura_atual: null,
        beneficio_tarifario_bruto: null,
        beneficio_tarifario_liquido: null,
        icms: null,
        pis_pasep: null,
        cofins: null,
        fatura_debito_automatico: null,
        credito_recebido: null,
        saldo_kwh: null,
        excedente_recebido: null,
        ciclo_geracao: null,
        informacoes_para_o_cliente: null,
        uc_geradora: null,
        uc_geradora_producao: null,
        cadastro_rateio_geracao_uc: null,
        cadastro_rateio_geracao_percentual: null,
        injecoes_scee: [],
        consumo_scee_quant: null,
        consumo_scee_preco_unit_com_tributos: null,
        consumo_scee_tarifa_unitaria: null,
        media: null,
        parc_injet_s_desc_percentual: null,
        observacoes: null,
        hash_pdf: hash,
        health: "heuristic",
        tokens_gpt_req: null,
        tokens_gpt_mes: null,
      };
    }

    log("info", "extraido", { hash: result.hash_pdf, unidade: result.unidade_consumidora });
    res.json(result);
  } catch (err) {
    log("error", "Falha geral", { err: String(err) });
    res.status(500).json({ error: "Falha ao processar a fatura." });
  }
});

app.listen(PORT, () => {
  log("info", `🚀 Servidor rodando na porta ${PORT}`);
});