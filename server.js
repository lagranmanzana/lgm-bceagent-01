import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { google } from "googleapis";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const publicPath = path.join(__dirname, "public");
const knowledgePath = path.join(__dirname, "knowledge.md");
const knowledge = fs.existsSync(knowledgePath)
  ? fs.readFileSync(knowledgePath, "utf8")
  : "";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(publicPath));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SHEET_ID = process.env.GOOGLE_SHEET_ID || "1wtEQVq9YQcKMn4RLdXii96x-MMs_hIZthUVkCwspVjo";
const SHEET_TAB = process.env.GOOGLE_SHEET_TAB || "conversations";

const SHEET_HEADERS = [
  "session_id",
  "conversation_datetime",
  "user_message_count",
  "detected_topic",
  "user_intent",
  "requested_meeting",
  "meeting_scroll_triggered",
  "source_url",
  "transcript",
];

function hasSheetsConfig() {
  return Boolean(
    SHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY
  );
}

function getPrivateKey() {
  return (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
}

async function getSheetsClient() {
  if (!hasSheetsConfig()) return null;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: getPrivateKey(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  await auth.authorize();
  return google.sheets({ version: "v4", auth });
}

function normalizeBoolean(value) {
  return value === true || value === "true" ? "true" : "false";
}

function detectTopic(text = "") {
  const t = text.toLowerCase();
  const rules = [
    ["amazon", ["amazon", "vendor", "seller", "buy box", "sku", "asin"]],
    ["marketplaces", ["marketplace", "marketplaces", "miravia", "pccomponentes", "el corte inglés", "leroy", "aliexpress"]],
    ["hubspot_crm", ["hubspot", "crm", "pipeline", "workflow", "automatización", "automatizar", "lead"]],
    ["paid_media", ["ads", "ppc", "sem", "google ads", "meta ads", "campañas", "publicidad"]],
    ["ecommerce", ["ecommerce", "e-commerce", "shopify", "woocommerce", "prestashop", "tienda online"]],
    ["bcecopilot", ["bcecopilot", "copilot", "dashboard", "cuadro de mando", "bi", "margen", "rentabilidad"]],
    ["omnicanalidad", ["omnicanal", "omnicanalidad", "canales", "retail", "distribución", "b2b"]],
    ["pricing_margen", ["precio", "pricing", "margen", "rentabilidad", "erosión", "beneficio"]],
  ];

  for (const [topic, keywords] of rules) {
    if (keywords.some((k) => t.includes(k))) return topic;
  }
  return "general";
}

function detectIntent(text = "") {
  const t = text.toLowerCase();
  if (/\b(reuni[oó]n|cita|agenda|hablar|llamad|contact|diagn[oó]stico|presupuesto|precio|contratar|propuesta)\b/.test(t)) {
    return "meeting_or_commercial_intent";
  }
  if (/\b(c[uú]anto|precio|coste|tarifa|inversi[oó]n|vale)\b/.test(t)) return "pricing_question";
  if (/\b(c[oó]mo|qu[eé]|por qu[eé]|explica|informaci[oó]n|duda)\b/.test(t)) return "information";
  return "general";
}

async function ensureHeaders(sheets) {
  const range = `${SHEET_TAB}!A1:I1`;
  const result = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range }).catch(() => null);
  const firstRow = result?.data?.values?.[0] || [];
  if (firstRow.join(",") !== SHEET_HEADERS.join(",")) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range,
      valueInputOption: "RAW",
      requestBody: { values: [SHEET_HEADERS] },
    });
  }
}

async function upsertConversation(row) {
  const sheets = await getSheetsClient();
  if (!sheets) {
    console.warn("Google Sheets no configurado. Se omite guardado.");
    return { ok: false, reason: "missing_google_sheets_config" };
  }

  await ensureHeaders(sheets);

  const values = [
    row.session_id || "unknown_session",
    row.conversation_datetime || new Date().toISOString(),
    String(row.user_message_count || 0),
    row.detected_topic || "general",
    row.user_intent || "general",
    normalizeBoolean(row.requested_meeting),
    normalizeBoolean(row.meeting_scroll_triggered),
    row.source_url || "",
    row.transcript || "",
  ];

  const sessionId = values[0];
  const idRange = `${SHEET_TAB}!A2:A`;
  const idResult = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: idRange });
  const ids = idResult.data.values?.flat() || [];
  const existingIndex = ids.findIndex((id) => id === sessionId);

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_TAB}!A${rowNumber}:I${rowNumber}`,
      valueInputOption: "RAW",
      requestBody: { values: [values] },
    });
    return { ok: true, action: "updated" };
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_TAB}!A:I`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [values] },
  });
  return { ok: true, action: "appended" };
}

function buildSystemPrompt() {
  return `
Eres BCEagent, un agente de datos de negocio.

Objetivo:
- Ayudar al usuario a responder preguntas sobre sus datos de negocio.
- Para esta demo, prioriza los datos de rendimiento por canal incluidos en la base de conocimiento.
- Interpreta "este año" como enero-agosto de 2026 y compara con enero-agosto de 2025 cuando proceda.
- Responde de forma clara, ejecutiva y breve, destacando la cifra principal y después el contexto.
- Diferencia crecimiento absoluto de crecimiento porcentual.
- No inventes cifras que no estén incluidas en la base de conocimiento.
- NO propongas citas ni reuniones en esta demo de datos.

Base de conocimiento:
${knowledge}
`.trim();
}

app.get("/health", (_, res) => res.send("ok"));
app.get("/", (_, res) => res.sendFile(path.join(publicPath, "index.html")));

app.post("/chat", async (req, res) => {
  try {
    const {
      session_id,
      prompt,
      transcript = "",
      user_message_count = 0,
      requested_meeting = false,
      meeting_scroll_triggered = false,
      source_url = "",
    } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ reply: "Falta el mensaje del usuario." });
    }

    const detected_topic = detectTopic(`${prompt}\n${transcript}`);
    const user_intent = detectIntent(prompt);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.25,
      max_tokens: 450,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: `Transcripción previa:\n${transcript}\n\nÚltimo mensaje del usuario:\n${prompt}` },
      ],
    });

    let reply = completion.choices?.[0]?.message?.content || "No he podido generar respuesta ahora.";

    const fullTranscript = `${transcript}\nUsuario: ${prompt}\nBCEagent: ${reply}`.trim();

    await upsertConversation({
      session_id,
      conversation_datetime: new Date().toISOString(),
      user_message_count,
      detected_topic,
      user_intent,
      requested_meeting,
      meeting_scroll_triggered,
      source_url,
      transcript: fullTranscript,
    }).catch((err) => console.error("Sheets error:", err));

    res.json({ reply, detected_topic, user_intent });
  } catch (error) {
    console.error(error);
    res.status(500).json({ reply: "Error en el servidor. Inténtalo más tarde." });
  }
});

app.post("/track", async (req, res) => {
  try {
    const {
      session_id,
      transcript = "",
      user_message_count = 0,
      requested_meeting = false,
      meeting_scroll_triggered = false,
      source_url = "",
    } = req.body || {};

    await upsertConversation({
      session_id,
      conversation_datetime: new Date().toISOString(),
      user_message_count,
      detected_topic: detectTopic(transcript),
      user_intent: requested_meeting ? "meeting_request" : detectIntent(transcript),
      requested_meeting,
      meeting_scroll_triggered,
      source_url,
      transcript,
    });

    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`✅ BCEagent corriendo en http://localhost:${PORT}`);
});
