import express from "express";
import cors from "cors";
import zlib from "zlib";
import { promisify } from "util";
import { Storage } from "@google-cloud/storage";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// GCS REAL
// El SDK usa las credenciales del servidor automáticamente
// (GOOGLE_APPLICATION_CREDENTIALS o ADC en GCP)
// ─────────────────────────────────────────────────────────────
const storage = new Storage({ projectId: process.env.GCS_PROJECT_ID });
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME);

async function subirABucket(nombreArchivo, objetoJS) {
  // 1. Convertís tu objeto JS a string JSON
  const jsonString = JSON.stringify(objetoJS);

  // 2. Comprimís ese string con gzip → obtenés un Buffer binario
  const bufferComprimido = await gzip(Buffer.from(jsonString, "utf-8"));

  // 3. Guardás el buffer en GCS con los headers correctos
  await bucket.file(nombreArchivo).save(bufferComprimido, {
    metadata: {
      contentEncoding: "gzip",
      contentType: "application/json",
    },
  });

  return {
    tamañoOriginal: Buffer.byteLength(jsonString),
    tamañoComprimido: bufferComprimido.byteLength,
  };
}

async function leerDeBucket(nombreArchivo) {
  const archivo = bucket.file(nombreArchivo);

  // decompress: false → GCS nos da el buffer comprimido tal cual está guardado
  // Sin esto, GCS lo descomprime automáticamente y nosotros le mandamos
  // Content-Encoding: gzip al cliente sobre algo que ya viene descomprimido
  const [buffer] = await archivo.download({ decompress: false });
  const [metadata] = await archivo.getMetadata();

  return {
    buffer,
    tamañoComprimido: buffer.byteLength,
    tamañoOriginal: parseInt(metadata?.size) || null,
  };
}

// ─────────────────────────────────────────────────────────────
// SIMULACIÓN: así llegan los datos de elecciones
// En producción vendría de una DB, un webhook, un servicio externo, etc.
// ─────────────────────────────────────────────────────────────
function generarResultadosElecciones(cantidadDistritos = 100) {
  const partidos = [
    { id: 1, nombre: "ALIANZA LA LIBERTAD AVANZA", color: "#62388E" },
    { id: 2, nombre: "ALIANZA UNION POR LA PATRIA", color: "#0087FE" },
    { id: 3, nombre: "JUNTOS POR EL CAMBIO", color: "#FFD700" },
    { id: 4, nombre: "FRENTE DE IZQUIERDA", color: "#CC0000" },
  ];

  const provincias = [
    "Buenos Aires", "Córdoba", "Santa Fe", "Mendoza", "Tucumán",
    "Entre Ríos", "Salta", "Chaco", "Misiones", "Corrientes",
  ];

  return {
    eleccion: {
      tipo: "LEGISLATIVAS",
      año: 2025,
      fechaActualizacion: new Date().toISOString(),
      mesasEscrutadas: Math.floor(Math.random() * 1000) + 8000,
      mesasTotales: 10000,
    },
    distritos: Array.from({ length: cantidadDistritos }, (_, i) => {
      const votos = partidos.map(() => Math.random());
      const total = votos.reduce((a, b) => a + b, 0);
      const porcentajes = votos.map((v) => +((v / total) * 100).toFixed(2));
      const ganadorIdx = porcentajes.indexOf(Math.max(...porcentajes));

      return {
        id: i + 1,
        nombre: `Distrito ${i + 1}`,
        provincia: provincias[i % provincias.length],
        geometry: {
          type: "Polygon",
          coordinates: [
            Array.from({ length: 10 }, () => [
              +(Math.random() * 20 - 70).toFixed(14),
              +(Math.random() * 20 - 40).toFixed(14),
            ]),
          ],
        },
        resultados: {
          ganador: partidos[ganadorIdx].nombre,
          colorGanador: partidos[ganadorIdx].color,
          partidos: partidos.map((p, j) => ({
            ...p,
            votos: Math.floor(porcentajes[j] * 1000),
            porcentaje: porcentajes[j],
          })),
        },
      };
    }),
  };
}

// ─────────────────────────────────────────────────────────────
// ENDPOINT 1: Genera datos y los guarda en GCS comprimidos
// ─────────────────────────────────────────────────────────────
app.post("/api/elecciones/guardar", async (req, res) => {
  try {
    const { distritos = 100 } = req.body;

    console.log(`\n[GUARDAR] Generando resultados para ${distritos} distritos...`);

    // En producción: const datos = await obtenerDatosDeDB();
    const datos = generarResultadosElecciones(distritos);

    const nombreArchivo = `resultados-2025.json`;
    const stats = await subirABucket(nombreArchivo, datos);

    const reduccion = (((stats.tamañoOriginal - stats.tamañoComprimido) / stats.tamañoOriginal) * 100).toFixed(1);

    console.log(`[GUARDAR] ✅ ${formatBytes(stats.tamañoOriginal)} → ${formatBytes(stats.tamañoComprimido)} (-${reduccion}%)`);

    res.json({
      ok: true,
      archivo: nombreArchivo,
      bucket: process.env.GCS_BUCKET_NAME,
      stats: {
        original: stats.tamañoOriginal,
        comprimido: stats.tamañoComprimido,
        originalFormateado: formatBytes(stats.tamañoOriginal),
        comprimidoFormateado: formatBytes(stats.tamañoComprimido),
        reduccion: `${reduccion}%`,
      },
    });
  } catch (err) {
    console.error("[GUARDAR ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ENDPOINT 2: Sirve el archivo desde GCS con gzip
// ─────────────────────────────────────────────────────────────
app.get("/api/elecciones/:archivo", async (req, res) => {
  try {
    const archivo = await leerDeBucket(req.params.archivo);

    const clienteAceptaGzip = req.headers["accept-encoding"]?.includes("gzip");

    if (clienteAceptaGzip) {
      // Browser / cliente con gzip: enviamos el buffer comprimido directo
      // El cliente lo descomprime automáticamente
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "X-Compressed-Size": archivo.tamañoComprimido,
      });
      res.end(archivo.buffer);
      console.log(`[SERVIR] gzip → ${formatBytes(archivo.tamañoComprimido)}`);
    } else {
      // Postman sin gzip o cliente legacy: descomprimimos en el servidor
      const descomprimido = await gunzip(archivo.buffer);
      res.set({
        "Content-Type": "application/json",
        "X-Compressed-Size": archivo.tamañoComprimido,
      });
      res.end(descomprimido);
      console.log(`[SERVIR] json plano → ${formatBytes(descomprimido.byteLength)}`);
    }
  } catch (err) {
    // Archivo no encontrado en GCS
    if (err.code === 404) {
      return res.status(404).json({ error: "Archivo no encontrado en el bucket" });
    }
    console.error("[SERVIR ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

app.listen(3001, () => {
  console.log("🚀 Backend en http://localhost:3001");
  console.log(`📦 Bucket: ${process.env.GCS_BUCKET_NAME}`);
  console.log(`🔑 Proyecto: ${process.env.GCS_PROJECT_ID}\n`);
});