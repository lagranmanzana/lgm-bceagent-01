# lgm-bceagent-01

BCEagent es un asistente comercial para La Gran Manzana Lab, basado en la arquitectura de `doctor-mvp`.

## Stack

- Node.js
- Express
- OpenAI API
- Google Sheets API
- Frontend estático en `public/index.html`
- Despliegue recomendado en Render
- Embebible en WordPress mediante iframe

## Archivos principales

```txt
lgm-bceagent-01/
├─ server.js
├─ package.json
├─ knowledge.md
├─ conversations_template.csv
├─ wordpress_embed_snippet.html
├─ .env.example
└─ public/
   └─ index.html
```

## Variables de entorno necesarias en Render

```env
OPENAI_API_KEY=sk-xxxx
GOOGLE_SHEET_ID=1wtEQVq9YQcKMn4RLdXii96x-MMs_hIZthUVkCwspVjo
GOOGLE_SHEET_TAB=conversations
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

## Google Sheets

La pestaña debe llamarse:

```txt
conversations
```

Cabeceras esperadas:

```csv
session_id,conversation_datetime,user_message_count,detected_topic,user_intent,requested_meeting,meeting_scroll_triggered,source_url,transcript
```

Importante: comparte la hoja con el email de la service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`) con permisos de editor.

## Despliegue en Render

- Build Command: `npm install`
- Start Command: `node server.js`
- Instance: Free para MVP

## WordPress

Usa el contenido de `wordpress_embed_snippet.html` en un bloque HTML personalizado.

Cambia:

```html
src="https://TU-URL-DE-RENDER.onrender.com"
```

por la URL real de Render.

El embed de HubSpot Meetings debe ir fuera del iframe, dentro de:

```html
<div id="reservar-cita"></div>
```

Cuando el usuario responda afirmativamente a la propuesta de cita, BCEagent enviará un `postMessage` al WordPress padre y hará scroll automático a `#reservar-cita`.

## Endpoints

- `GET /` — sirve el chat.
- `GET /health` — comprobación simple.
- `POST /chat` — conversación con BCEagent.
- `POST /track` — actualización de métricas de conversación cuando el usuario solicita reunión.
