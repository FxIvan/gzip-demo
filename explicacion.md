# ⚡ Gzip en GCS — Guía completa

Demo de compresión JSON con Gzip en Google Cloud Storage usando React + Vite + Node.js + Express.

---

## 📁 Estructura del proyecto

```
elecciones-demo/
├── backend/
│   ├── server.js        # API Express con compresión gzip
│   ├── package.json
│   └── .env.example
└── frontend/
    ├── src/
    │   ├── App.jsx      # UI con comparación de carga
    │   └── App.css
    ├── index.html
    ├── vite.config.js
    └── package.json
```

---

## 🚀 Instalación y uso

```bash
# Terminal 1 — Backend
cd backend
npm install
cp .env.example .env    # completá GCS_PROJECT_ID y GCS_BUCKET_NAME
npm run dev             # http://localhost:3001

# Terminal 2 — Frontend
cd frontend
npm install
npm run dev             # http://localhost:5173
```

---

## 🔌 Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/elecciones/guardar` | Genera datos, los comprime y los sube a GCS |
| `GET`  | `/api/elecciones/:archivo` | Sirve el archivo con `Content-Encoding: gzip` |
| `GET`  | `/api/benchmark?distritos=N` | Compara tamaños y tiempos de compresión |

### POST `/api/elecciones/guardar`

```json
// Request
{ "distritos": 200 }

// Response
{
  "ok": true,
  "archivo": "resultados-2025.json",
  "bucket": "mi-bucket",
  "stats": {
    "originalFormateado": "512.00 KB",
    "comprimidoFormateado": "58.20 KB",
    "reduccion": "88.6%"
  }
}
```

### GET `/api/benchmark?distritos=200`

```json
{
  "comparacion": {
    "json":  { "formateado": "512.00 KB" },
    "gzip":  { "formateado": "58.20 KB" }
  },
  "resultado": {
    "reduccionPorcentaje": "88.6%",
    "factorCompresion": "8.80x",
    "tiempoComprimirMs": "14.32ms",
    "tiempoDescomprimirMs": "1.87ms"
  }
}
```

---

## ✅ Ventajas de Gzip

- **70–90% menos tamaño** en archivos JSON con datos repetitivos (coordenadas GeoJSON, strings largos)
- **Menos costo** de transferencia en GCS — pagás por bytes transferidos
- **Carga más rápida** para usuarios con conexión lenta o móvil
- **Transparente para el frontend** — el browser descomprime solo, `fetch()` no cambia nada
- **Soporte universal** — todos los browsers modernos y Postman lo manejan automáticamente

## ❌ Desventajas de Gzip

- **CPU extra** en el servidor para comprimir al guardar (generalmente despreciable: 10–30ms)
- **No sirve para archivos pequeños** — si el JSON pesa menos de 1KB, el overhead del header gzip no justifica la compresión
- **No sirve para contenido ya comprimido** — imágenes (JPEG, PNG), videos (MP4), ZIPs. Comprimirlos de nuevo no reduce nada
- **Complejidad operativa** — hay que acordarse de usar `decompress: false` al leer desde GCS para no recibir el buffer ya descomprimido

---

## ❓ ¿Por qué no se usa en todos lados si es tan bueno?

Se usa muchísimo, pero hay escenarios donde no conviene:

**Archivos pequeños** → el header gzip (20 bytes) representa un porcentaje alto del payload.

**Datos ya comprimidos** → imágenes, videos y ZIPs no se reducen más. Solo gastan CPU.

**Latencia ultra baja** → sistemas de trading de alta frecuencia o videojuegos en tiempo real donde 2ms importan.

**Simplicidad** → proyectos pequeños donde el JSON pesa pocos KB no necesitan esta complejidad.

---

## 🌐 Plataformas que lo usan (verificable en DevTools)

Abrí **DevTools → Network → cualquier request JSON → Headers de respuesta** y buscá `content-encoding`:

| Plataforma | Encoding | Cómo verificarlo |
|---|---|---|
| **GitHub** | `gzip` | Abrí github.com, filtrá XHR en Network |
| **Mercado Libre** | `gzip` | Hacé una búsqueda, filtrá fetch en Network |
| **Infobae** | `gzip` | Cargá la home, filtrá fetch en Network |
| **Twitter / X** | `br` (Brotli) | Abrí el timeline, filtrá XHR |
| **Facebook** | `br` (Brotli) | Abrí el feed, filtrá fetch |
| **Google Maps** | `br` (Brotli) | Mové el mapa, filtrá XHR |

> **Brotli (`br`)** es el sucesor de gzip — comprime un 15–20% más pero es más lento para comprimir.
> Se usa para archivos estáticos. Gzip sigue siendo el estándar para contenido dinámico generado en tiempo real.

---

## 🔬 Cómo fluye el dato — de punta a punta

```
GUARDAR
────────────────────────────────────────────────────
Tu objeto JS
    ↓  JSON.stringify()
String JSON          ← esto guardarías sin gzip
    ↓  zlib.gzip()
Buffer binario       ← esto guardás en GCS
    ↓  bucket.file().save(buffer, { contentEncoding: "gzip" })
GCS almacena el binario con los metadata correctos


SERVIR AL FRONTEND
────────────────────────────────────────────────────
GCS  →  bucket.file().download({ decompress: false })
                ↓
        buffer binario comprimido (viaja por la red)
                ↓
Express  →  res.writeHead({ "Content-Encoding": "gzip" })
                ↓
Browser / Postman detecta el header → descomprime automáticamente
                ↓
Tu fetch() recibe el JSON normal, sin saber que vino comprimido
```

> **Clave:** el archivo nunca existe como `.json` en disco.
> Nace como objeto JS → se comprime en memoria → se guarda el binario en GCS.
> Al leerlo, el binario viaja por la red y el cliente lo descomprime solo.
> Ni el código que guarda ni el `fetch()` del frontend necesitan saber nada de gzip.

---

## 🔑 Variables de entorno

```bash
# .env
GCS_PROJECT_ID=mi-proyecto-123
GCS_BUCKET_NAME=mi-bucket-elecciones

# Solo si NO usás Application Default Credentials (ADC)
# En GCP (Cloud Run, GCE, etc.) no hace falta
# GOOGLE_APPLICATION_CREDENTIALS=/ruta/al/service-account.json
```

---

## 🏗 Aplicar en GCS real

```js
import { Storage } from "@google-cloud/storage";

const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID });
const bucket  = storage.bucket(process.env.GCS_BUCKET_NAME);

// Guardar comprimido
const buffer = await gzip(Buffer.from(JSON.stringify(datos)));
await bucket.file("resultados.json").save(buffer, {
  metadata: { contentEncoding: "gzip", contentType: "application/json" }
});

// Leer sin que GCS descomprima (decompress: false es clave)
const [bufferComprimido] = await bucket.file("resultados.json").download({ decompress: false });
```