import { useState, useCallback } from "react";
import "./App.css";

const API = "http://localhost:3001/api";

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function generateSampleJSON(size = "medium") {
  const items = size === "small" ? 50 : size === "medium" ? 500 : 2000;
  return {
    metadata: { generated: new Date().toISOString(), source: "simulated-geojson", size },
    features: Array.from({ length: items }, (_, i) => ({
      type: "Feature",
      id: i + 1,
      geometry: {
        type: "Polygon",
        coordinates: [
          Array.from({ length: 12 }, () => [
            +(Math.random() * 20 - 70).toFixed(14),
            +(Math.random() * 20 - 40).toFixed(14),
          ]),
        ],
      },
      properties: {
        provincia: `Provincia ${Math.ceil(Math.random() * 24)}`,
        departamento: `Departamento ${i + 1}`,
        resultados: {
          color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
          votosPorcentaje: +(Math.random() * 100).toFixed(2),
          partidos: Array.from({ length: 3 }, (_, j) => ({
            nombre: `Partido ${j + 1}`,
            color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")}`,
            resultados: { votosPorcentaje: +(Math.random() * 60).toFixed(2) },
            candidato: { nombre: `Candidato ${i}-${j}` },
          })),
        },
      },
    })),
  };
}

// ─── Sub-components ────────────────────────────────────────────────────────

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card ${accent ? "accent" : ""}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

function BucketFile({ file, onDownload, onDelete, downloading }) {
  const pct = parseFloat(file.reduction);
  return (
    <div className="bucket-file">
      <div className="file-header">
        <span className="file-name">📄 {file.filename}</span>
        <span className="file-date">{new Date(file.uploadedAt).toLocaleTimeString()}</span>
      </div>
      <div className="file-bar-wrap">
        <div className="file-bar">
          <div className="bar-original" style={{ width: "100%" }}>
            <span>{file.originalFormatted}</span>
          </div>
        </div>
        <div className="file-bar">
          <div className="bar-compressed" style={{ width: `${100 - pct}%` }}>
            <span>{file.compressedFormatted}</span>
          </div>
        </div>
        <span className="reduction-badge">-{file.reduction}</span>
      </div>
      <div className="file-actions">
        <button
          className="btn btn-download"
          onClick={() => onDownload(file.filename)}
          disabled={downloading === file.filename}
        >
          {downloading === file.filename ? "⏳ Descargando..." : "⬇ Descargar"}
        </button>
        <button className="btn btn-delete" onClick={() => onDelete(file.filename)}>
          🗑 Eliminar
        </button>
      </div>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("upload");
  const [filename, setFilename] = useState("mapa-electoral-2025.json");
  const [jsonSize, setJsonSize] = useState("medium");
  const [customJson, setCustomJson] = useState("");
  const [useCustom, setUseCustom] = useState(false);

  const [uploadResult, setUploadResult] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const [bucketFiles, setBucketFiles] = useState([]);
  const [bucketLoading, setBucketLoading] = useState(false);

  const [downloadedData, setDownloadedData] = useState(null);
  const [downloadingFile, setDownloadingFile] = useState(null);
  const [downloadTime, setDownloadTime] = useState(null);

  const [log, setLog] = useState([]);

  const addLog = useCallback((msg, type = "info") => {
    const time = new Date().toLocaleTimeString();
    setLog((prev) => [{ msg, type, time }, ...prev].slice(0, 20));
  }, []);

  // Upload
  const handleUpload = async () => {
    setUploadLoading(true);
    setUploadError(null);
    setUploadResult(null);

    try {
      let data;
      if (useCustom) {
        data = JSON.parse(customJson);
      } else {
        data = generateSampleJSON(jsonSize);
      }

      addLog(`Subiendo "${filename}" (${jsonSize})...`, "info");
      const t0 = performance.now();

      const res = await fetch(`${API}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, data }),
      });

      const result = await res.json();
      const elapsed = (performance.now() - t0).toFixed(0);

      if (!res.ok) throw new Error(result.error);

      setUploadResult(result);
      addLog(
        `✅ Subido en ${elapsed}ms | ${result.stats.originalFormatted} → ${result.stats.compressedFormatted} (${result.stats.reduction})`,
        "success"
      );
    } catch (err) {
      setUploadError(err.message);
      addLog(`❌ Error: ${err.message}`, "error");
    } finally {
      setUploadLoading(false);
    }
  };

  // Load bucket list
  const loadBucket = async () => {
    setBucketLoading(true);
    try {
      const res = await fetch(`${API}/bucket`);
      const data = await res.json();
      setBucketFiles(data.files);
      addLog(`📦 Bucket: ${data.files.length} archivo(s)`, "info");
    } catch (err) {
      addLog(`❌ Error cargando bucket: ${err.message}`, "error");
    } finally {
      setBucketLoading(false);
    }
  };

  // Download
  const handleDownload = async (fname) => {
    setDownloadingFile(fname);
    setDownloadedData(null);
    const t0 = performance.now();
    try {
      addLog(`⬇ Descargando "${fname}" (gzip)...`, "info");
      const res = await fetch(`${API}/download/${encodeURIComponent(fname)}`);
      const json = await res.json();
      const elapsed = (performance.now() - t0).toFixed(0);
      const compressedSize = res.headers.get("X-Compressed-Size");
      const originalSize = res.headers.get("X-Original-Size");
      setDownloadedData(json);
      setDownloadTime(elapsed);
      addLog(
        `✅ Descargado en ${elapsed}ms | Wire: ${formatBytes(+compressedSize)} → Parseado: ${formatBytes(+originalSize)}`,
        "success"
      );
    } catch (err) {
      addLog(`❌ Error: ${err.message}`, "error");
    } finally {
      setDownloadingFile(null);
    }
  };

  // Delete
  const handleDelete = async (fname) => {
    try {
      await fetch(`${API}/bucket/${encodeURIComponent(fname)}`, { method: "DELETE" });
      addLog(`🗑 "${fname}" eliminado del bucket`, "info");
      loadBucket();
    } catch (err) {
      addLog(`❌ Error: ${err.message}`, "error");
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">⚡</span>
            <div>
              <h1>GZip Bucket Demo</h1>
              <p>Compresión JSON — React + Vite + Node/Express</p>
            </div>
          </div>
          <div className="header-tags">
            <span className="tag">GCS Simulado</span>
            <span className="tag tag-green">Gzip activo</span>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Left panel */}
        <section className="panel">
          <div className="tabs">
            <button className={`tab ${tab === "upload" ? "active" : ""}`} onClick={() => setTab("upload")}>
              ⬆ Upload
            </button>
            <button
              className={`tab ${tab === "bucket" ? "active" : ""}`}
              onClick={() => {
                setTab("bucket");
                loadBucket();
              }}
            >
              📦 Bucket
            </button>
          </div>

          {/* Upload Tab */}
          {tab === "upload" && (
            <div className="tab-content">
              <div className="form-group">
                <label>Nombre del archivo</label>
                <input
                  className="input"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="nombre.json"
                />
              </div>

              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={useCustom}
                    onChange={(e) => setUseCustom(e.target.checked)}
                    style={{ marginRight: 6 }}
                  />
                  Usar JSON personalizado
                </label>
              </div>

              {useCustom ? (
                <div className="form-group">
                  <label>JSON personalizado</label>
                  <textarea
                    className="input textarea"
                    value={customJson}
                    onChange={(e) => setCustomJson(e.target.value)}
                    placeholder='{"key": "value"}'
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label>Tamaño del JSON de prueba</label>
                  <div className="size-selector">
                    {["small", "medium", "large"].map((s) => (
                      <button
                        key={s}
                        className={`size-btn ${jsonSize === s ? "active" : ""}`}
                        onClick={() => setJsonSize(s)}
                      >
                        {s === "small" ? "🟢 Small (~50KB)" : s === "medium" ? "🟡 Medium (~500KB)" : "🔴 Large (~2MB)"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button className="btn btn-primary" onClick={handleUpload} disabled={uploadLoading}>
                {uploadLoading ? "⏳ Comprimiendo y subiendo..." : "⬆ Subir al Bucket"}
              </button>

              {uploadError && <div className="alert alert-error">❌ {uploadError}</div>}

              {uploadResult && (
                <div className="result-box">
                  <h3>✅ Subido exitosamente</h3>
                  <div className="stats-grid">
                    <StatCard label="Tamaño original" value={uploadResult.stats.originalFormatted} />
                    <StatCard label="Tamaño comprimido" value={uploadResult.stats.compressedFormatted} />
                    <StatCard label="Reducción" value={uploadResult.stats.reduction} accent />
                  </div>
                  <div className="how-it-works">
                    <strong>¿Cómo funciona?</strong>
                    <ol>
                      <li>El backend recibe el JSON y lo comprime con <code>zlib.gzip()</code></li>
                      <li>Lo guarda en memoria (simula GCS) con <code>Content-Encoding: gzip</code></li>
                      <li>Al descargar, el browser recibe el binario comprimido y lo descomprime automáticamente</li>
                    </ol>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Bucket Tab */}
          {tab === "bucket" && (
            <div className="tab-content">
              <div className="bucket-header">
                <span className="bucket-count">{bucketFiles.length} archivo(s)</span>
                <button className="btn btn-sm" onClick={loadBucket} disabled={bucketLoading}>
                  {bucketLoading ? "⏳" : "🔄 Actualizar"}
                </button>
              </div>

              {bucketFiles.length === 0 ? (
                <div className="empty-bucket">
                  <span>📭</span>
                  <p>El bucket está vacío. Sube un archivo primero.</p>
                </div>
              ) : (
                bucketFiles.map((f) => (
                  <BucketFile
                    key={f.filename}
                    file={f}
                    onDownload={handleDownload}
                    onDelete={handleDelete}
                    downloading={downloadingFile}
                  />
                ))
              )}

              {downloadedData && (
                <div className="result-box">
                  <h3>⬇ Datos descargados — {downloadTime}ms</h3>
                  <p className="preview-label">Preview del JSON recibido:</p>
                  <pre className="json-preview">
                    {JSON.stringify(downloadedData, null, 2).slice(0, 600)}...
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Right panel - Log */}
        <section className="panel panel-log">
          <div className="log-header">
            <h2>📋 Activity Log</h2>
            <button className="btn btn-sm" onClick={() => setLog([])}>Limpiar</button>
          </div>

          <div className="log-entries">
            {log.length === 0 && <p className="log-empty">Sin actividad aún...</p>}
            {log.map((entry, i) => (
              <div key={i} className={`log-entry log-${entry.type}`}>
                <span className="log-time">{entry.time}</span>
                <span className="log-msg">{entry.msg}</span>
              </div>
            ))}
          </div>

          <div className="explainer">
            <h3>🔬 Lo que ocurre en el wire</h3>
            <div className="flow">
              <div className="flow-step">
                <span className="flow-icon">📄</span>
                <div>
                  <strong>JSON original</strong>
                  <p>Texto plano, caracteres repetidos (coordenadas)</p>
                </div>
              </div>
              <div className="flow-arrow">↓ zlib.gzip()</div>
              <div className="flow-step">
                <span className="flow-icon">🗜</span>
                <div>
                  <strong>Buffer binario</strong>
                  <p>70-90% más liviano, guardado en GCS</p>
                </div>
              </div>
              <div className="flow-arrow">↓ Content-Encoding: gzip</div>
              <div className="flow-step">
                <span className="flow-icon">🌐</span>
                <div>
                  <strong>Browser recibe</strong>
                  <p>Descarga el binario comprimido y lo descomprime automáticamente</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
