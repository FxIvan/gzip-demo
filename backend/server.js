import express from "express";
import cors from "cors";
import zlib from "zlib";
import { promisify } from "util";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// SIMULACIÓN DEL BUCKET GCS (en memoria)
// En producción esto sería: @google-cloud/storage → bucket.file().save()
// ─────────────────────────────────────────────────────────────
const gcsBucket = new Map();

async function subirABucket(nombreArchivo, objetoJS) {
  // 1. Convertís tu objeto JS a string JSON
  const jsonString = JSON.stringify(objetoJS);

  // 2. Comprimís ese string con gzip → obtenés un Buffer binario
  const bufferComprimido = await gzip(Buffer.from(jsonString, "utf-8"));

  // 3. Guardás el buffer en GCS con los headers correctos
  // En GCS real sería:
  //   await bucket.file(nombreArchivo).save(bufferComprimido, {
  //     metadata: { contentEncoding: "gzip", contentType: "application/json" }
  //   });
  gcsBucket.set(nombreArchivo, {
    buffer: bufferComprimido,
    contentEncoding: "gzip",
    contentType: "application/json",
    guardadoEn: new Date().toISOString(),
    tamañoOriginal: Buffer.byteLength(jsonString),
    tamañoComprimido: bufferComprimido.byteLength,
  });

  return {
    tamañoOriginal: Buffer.byteLength(jsonString),
    tamañoComprimido: bufferComprimido.byteLength,
  };
}

async function leerDeBucket(nombreArchivo) {
  // En GCS real sería:
  //   const [buffer] = await bucket.file(nombreArchivo).download();
  const archivo = gcsBucket.get(nombreArchivo);
  if (!archivo) return null;
  return archivo;
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
      // Generamos porcentajes que sumen ~100
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
          // Coordenadas con muchos decimales (como el GeoJSON real)
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
// ENDPOINT 1: Simula recibir datos nuevos y guardarlos en GCS
// En producción esto lo llamaría un cron job, un webhook, etc.
// ─────────────────────────────────────────────────────────────
app.post("/api/elecciones/guardar", async (req, res) => {
  try {
    const { distritos = 100 } = req.body;

    console.log(`\n[GUARDAR] Generando resultados para ${distritos} distritos...`);

    // Acá normalmente tendrías: const datos = await obtenerDatosDeDB();
    // Nosotros lo simulamos:
    const datos = generarResultadosElecciones(distritos);

    const nombreArchivo = `resultados-2025.json`;

    // Guardamos en GCS comprimido (no necesitás hacer nada especial, 
    // solo pasarle el objeto JS a la función)
    const stats = await subirABucket(nombreArchivo, datos);

    const reduccion = (((stats.tamañoOriginal - stats.tamañoComprimido) / stats.tamañoOriginal) * 100).toFixed(1);

    console.log(`[GUARDAR] ✅ ${formatBytes(stats.tamañoOriginal)} → ${formatBytes(stats.tamañoComprimido)} (-${reduccion}%)`);

    res.json({
      ok: true,
      archivo: nombreArchivo,
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
// ENDPOINT 2: El front consume este endpoint para obtener los datos
// ─────────────────────────────────────────────────────────────
app.get("/api/elecciones/:archivo", async (req, res) => {
  try {
    const archivo = await leerDeBucket(req.params.archivo);

    if (!archivo) {
      return res.status(404).json({ error: "Archivo no encontrado en el bucket" });
    }

    const clienteAceptaGzip = req.headers["accept-encoding"]?.includes("gzip");

    if (clienteAceptaGzip) {
      // Cliente soporta gzip (browser, Postman con decompress desactivado)
      // Usamos res.end() para que Express NO toque el buffer
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "X-Original-Size": archivo.tamañoOriginal,
        "X-Compressed-Size": archivo.tamañoComprimido,
      });
      res.end(archivo.buffer);
      console.log(`[SERVIR] gzip → ${formatBytes(archivo.tamañoComprimido)}`);
    } else {
      // Postman con "Automatically decode response" o cliente sin gzip
      // Descomprimimos en el servidor y enviamos JSON plano
      const descomprimido = await gunzip(archivo.buffer);
      res.set({
        "Content-Type": "application/json",
        "X-Original-Size": archivo.tamañoOriginal,
        "X-Compressed-Size": archivo.tamañoComprimido,
      });
      res.end(descomprimido);
      console.log(`[SERVIR] json plano → ${formatBytes(archivo.tamañoOriginal)}`);
    }
  } catch (err) {
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
  console.log("\nFlujo:");
  console.log("  POST /api/elecciones/guardar  → genera datos y los sube comprimidos al bucket");
  console.log("  GET  /api/elecciones/:archivo → sirve el archivo con Content-Encoding: gzip\n");
});