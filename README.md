# ⚡ GZip Bucket Demo

Demo que muestra cómo comprimir JSON con Gzip antes de guardarlo en GCS, logrando reducciones de **70-90%** en el tamaño de transferencia.

## Estructura

```
gzip-demo/
├── backend/          # Node.js + Express
│   ├── server.js     # API con compresión gzip y bucket simulado
│   └── package.json
└── frontend/         # React + Vite
    ├── src/
    │   ├── App.jsx   # UI principal
    │   └── App.css
    ├── index.html
    ├── vite.config.js
    └── package.json
```

## Instalación y uso

### Backend
```bash
cd backend
npm install
npm run dev
# Corre en http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Corre en http://localhost:5173
```

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/upload` | Recibe JSON, lo comprime con gzip y lo guarda |
| GET | `/api/download/:filename` | Devuelve el archivo con Content-Encoding: gzip |
| GET | `/api/bucket` | Lista todos los archivos del bucket simulado |
| DELETE | `/api/bucket/:filename` | Elimina un archivo del bucket |

## Cómo funciona

1. **Upload**: El frontend envía el JSON → el backend lo comprime con `zlib.gzip()` → lo guarda en memoria
2. **Download**: El backend responde con `Content-Encoding: gzip` → el browser descomprime automáticamente
3. El frontend no necesita hacer nada especial — `fetch()` + `res.json()` funciona igual de siempre

## Aplicar en Google Cloud Storage real

```bash
# Comprimir localmente
gzip -k mi-archivo.json

# Subir con metadata correcta
gsutil -h "Content-Encoding:gzip" \
       -h "Content-Type:application/json" \
       cp mi-archivo.json.gz gs://mi-bucket/ruta/mi-archivo.json
```
