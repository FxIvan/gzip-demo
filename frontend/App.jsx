import { useState } from "react";
import "./App.css";

const API = "http://localhost:3001/api";

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes)) return "—";
  const sizes = ["B", "KB", "MB"];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function CompareBar({ labelA, valueA, labelB, valueB }) {
  if (!valueA || !valueB) return null;
  const total = Math.max(valueA, valueB);
  const pctA = ((valueA / total) * 100).toFixed(1);
  const pctB = ((valueB / total) * 100).toFixed(1);
  return (
    <div className="compare-bar">
      <div className="compare-bar__row">
        <span className="compare-bar__label">{labelA}</span>
        <div className="compare-bar__track">
          <div className="compare-bar__fill compare-bar__fill--red" style={{ width: `${pctA}%` }} />
        </div>
        <span className="compare-bar__val compare-bar__val--red">{formatBytes(valueA)}</span>
      </div>
      <div className="compare-bar__row">
        <span className="compare-bar__label">{labelB}</span>
        <div className="compare-bar__track">
          <div className="compare-bar__fill compare-bar__fill--green" style={{ width: `${pctB}%` }} />
        </div>
        <span className="compare-bar__val compare-bar__val--green">{formatBytes(valueB)}</span>
      </div>
    </div>
  );
}

function TimingBar({ labelA, msA, labelB, msB }) {
  if (!msA || !msB) return null;
  const total = Math.max(msA, msB);
  const pctA = ((msA / total) * 100).toFixed(1);
  const pctB = ((msB / total) * 100).toFixed(1);
  return (
    <div className="compare-bar">
      <div className="compare-bar__row">
        <span className="compare-bar__label">{labelA}</span>
        <div className="compare-bar__track">
          <div className="compare-bar__fill compare-bar__fill--red" style={{ width: `${pctA}%` }} />
        </div>
        <span className="compare-bar__val compare-bar__val--red">{msA}ms</span>
      </div>
      <div className="compare-bar__row">
        <span className="compare-bar__label">{labelB}</span>
        <div className="compare-bar__track">
          <div className="compare-bar__fill compare-bar__fill--green" style={{ width: `${pctB}%` }} />
        </div>
        <span className="compare-bar__val compare-bar__val--green">{msB}ms</span>
      </div>
    </div>
  );
}

export default function App() {
  const [distritos, setDistritos] = useState(150);
  const [log, setLog] = useState([]);

  const [guardando, setGuardando]       = useState(false);
  const [statsGuardado, setStatsGuardado] = useState(null);

  const [cargandoGzip, setCargandoGzip]   = useState(false);
  const [resultadoGzip, setResultadoGzip] = useState(null);

  const [cargandoPlano, setCargandoPlano]   = useState(false);
  const [resultadoPlano, setResultadoPlano] = useState(null);

  const [benchmark, setBenchmark]             = useState(null);
  const [cargandoBenchmark, setCargandoBenchmark] = useState(false);

  const addLog = (msg, tipo = "info") =>
    setLog((prev) => [{ msg, tipo, t: new Date().toLocaleTimeString() }, ...prev].slice(0, 20));

  // ── Paso 1: guardar en GCS ─────────────────────────────────
  const handleGuardar = async () => {
    setGuardando(true);
    setStatsGuardado(null);
    setResultadoGzip(null);
    setResultadoPlano(null);
    setBenchmark(null);
    addLog(`Guardando ${distritos} distritos en GCS comprimido...`);
    try {
      const res = await fetch(`${API}/elecciones/guardar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ distritos }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStatsGuardado(data.stats);
      addLog(`✅ Guardado: ${data.stats.originalFormateado} → ${data.stats.comprimidoFormateado} (${data.stats.reduccion} menos)`, "success");
    } catch (err) {
      addLog(`❌ ${err.message}`, "error");
    } finally {
      setGuardando(false);
    }
  };

  // ── Paso 2a: cargar con gzip ───────────────────────────────
  const handleCargarGzip = async () => {
    setCargandoGzip(true);
    setResultadoGzip(null);
    addLog("Cargando con gzip...");
    const t0 = performance.now();
    try {
      const res = await fetch(`${API}/elecciones/resultados-2025.json`);
      if (!res.ok) throw new Error("Archivo no encontrado — guardalo primero");
      await res.json();
      const ms = Math.round(performance.now() - t0);
      const bytes = +res.headers.get("X-Compressed-Size");
      setResultadoGzip({ ms, bytes });
      addLog(`✅ Gzip: ${formatBytes(bytes)} en ${ms}ms`, "success");
    } catch (err) {
      addLog(`❌ ${err.message}`, "error");
    } finally {
      setCargandoGzip(false);
    }
  };

  // ── Paso 2b: cargar JSON plano ─────────────────────────────
  const handleCargarPlano = async () => {
    setCargandoPlano(true);
    setResultadoPlano(null);
    addLog("Cargando JSON plano (sin compresión)...");
    const t0 = performance.now();
    try {
      // Accept-Encoding: identity → el servidor descomprime y manda JSON plano
      const res = await fetch(`${API}/elecciones/resultados-2025.json`, {
        headers: { "Accept-Encoding": "identity" },
      });
      if (!res.ok) throw new Error("Archivo no encontrado — guardalo primero");
      const data = await res.json();
      const ms = Math.round(performance.now() - t0);
      const bytes = new TextEncoder().encode(JSON.stringify(data)).length;
      setResultadoPlano({ ms, bytes });
      addLog(`✅ JSON plano: ${formatBytes(bytes)} en ${ms}ms`, "success");
    } catch (err) {
      addLog(`❌ ${err.message}`, "error");
    } finally {
      setCargandoPlano(false);
    }
  };

  // ── Benchmark ──────────────────────────────────────────────
  const handleBenchmark = async () => {
    setCargandoBenchmark(true);
    setBenchmark(null);
    addLog(`Ejecutando benchmark con ${distritos} distritos...`);
    try {
      const res = await fetch(`${API}/benchmark?distritos=${distritos}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBenchmark(data);
      addLog(`✅ Benchmark: ${data.resultado.reduccionPorcentaje} reducción, factor ${data.resultado.factorCompresion}`, "success");
    } catch (err) {
      addLog(`❌ ${err.message}`, "error");
    } finally {
      setCargandoBenchmark(false);
    }
  };

  const ambos = resultadoGzip && resultadoPlano;
  const ahorroBytes = ambos ? resultadoPlano.bytes - resultadoGzip.bytes : null;
  const ahorroMs    = ambos ? resultadoPlano.ms - resultadoGzip.ms : null;
  const reduccionPct = ambos
    ? (((resultadoPlano.bytes - resultadoGzip.bytes) / resultadoPlano.bytes) * 100).toFixed(1)
    : null;

  return (
    <div className="app">

      {/* Header */}
      <header className="header">
        <div className="header__logo">
          <span className="header__icon">🗳</span>
          <div>
            <h1>Elecciones 2025 — Gzip Demo</h1>
            <p>Comparación real: JSON plano vs comprimido</p>
          </div>
        </div>
        <div className="header__slider">
          <label>Distritos: <strong>{distritos}</strong></label>
          <input type="range" min={10} max={500} value={distritos}
            onChange={(e) => setDistritos(+e.target.value)} />
        </div>
      </header>

      <main className="main">

        {/* ── Col izquierda ──────────────────────────────── */}
        <div className="col">

          {/* Paso 1 */}
          <div className="card">
            <div className="step-badge">Paso 1 — Guardar en GCS</div>
            <h2>Comprimir y subir</h2>
            <p className="desc">
              El backend recibe los datos de elecciones y los guarda en GCS
              comprimidos con <code>gzip</code>. Vos solo pasás el objeto JS.
            </p>
            <button className="btn btn--primary" onClick={handleGuardar} disabled={guardando}>
              {guardando ? "⏳ Comprimiendo y subiendo..." : "⬆ Guardar en GCS"}
            </button>

            {statsGuardado && (
              <>
                <CompareBar
                  labelA="JSON plano"    valueA={statsGuardado.original}
                  labelB="Guardado gzip" valueB={statsGuardado.comprimido}
                />
                <div className="badge-row">
                  <span className="badge badge--green">−{statsGuardado.reduccion} de tamaño</span>
                  <span className="badge badge--gray">✓ listo para consumir</span>
                </div>
              </>
            )}
          </div>

          {/* Paso 2 */}
          <div className="card">
            <div className="step-badge step-badge--blue">Paso 2 — Cargar y comparar</div>
            <h2>Diferencia en carga real</h2>
            <p className="desc">
              Cargá el mismo archivo de las dos formas para ver la diferencia 
              real de tamaño y tiempo de respuesta.
            </p>

            <div className="btn-pair">
              <button className="btn btn--gzip" onClick={handleCargarGzip}
                disabled={cargandoGzip || !statsGuardado}>
                {cargandoGzip ? "⏳ Cargando..." : "⬇ Cargar con Gzip"}
              </button>
              <button className="btn btn--plain" onClick={handleCargarPlano}
                disabled={cargandoPlano || !statsGuardado}>
                {cargandoPlano ? "⏳ Cargando..." : "⬇ Cargar JSON plano"}
              </button>
            </div>

            {!statsGuardado && (
              <p className="hint">⬆ Primero guardá los datos en el Paso 1</p>
            )}

            {/* Tabla comparativa */}
            {(resultadoGzip || resultadoPlano) && (
              <div className="compare-table">
                <div className="compare-table__header">
                  <span></span>
                  <span>Bytes recibidos</span>
                  <span>Tiempo total</span>
                </div>
                <div className="compare-table__row">
                  <span><span className="dot dot--green" /> Gzip</span>
                  <span className="val--green">
                    {resultadoGzip ? formatBytes(resultadoGzip.bytes) : <span className="pending">pendiente</span>}
                  </span>
                  <span className="val--green">
                    {resultadoGzip ? `${resultadoGzip.ms}ms` : <span className="pending">pendiente</span>}
                  </span>
                </div>
                <div className="compare-table__row">
                  <span><span className="dot dot--red" /> JSON plano</span>
                  <span className="val--red">
                    {resultadoPlano ? formatBytes(resultadoPlano.bytes) : <span className="pending">pendiente</span>}
                  </span>
                  <span className="val--red">
                    {resultadoPlano ? `${resultadoPlano.ms}ms` : <span className="pending">pendiente</span>}
                  </span>
                </div>
                {ambos && (
                  <div className="compare-table__diff">
                    <span>✅ Gzip ahorra</span>
                    <span className="val--green">{formatBytes(ahorroBytes)} menos</span>
                    <span className="val--green">
                      {ahorroMs > 0 ? `${ahorroMs}ms más rápido` : "tiempo similar"}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Barras visuales de comparación */}
            {ambos && (
              <div className="comparison-visual">
                <p className="comparison-visual__title">📦 Tamaño transferido</p>
                <CompareBar
                  labelA="JSON plano" valueA={resultadoPlano.bytes}
                  labelB="Gzip"       valueB={resultadoGzip.bytes}
                />
                <p className="comparison-visual__title" style={{ marginTop: "1rem" }}>⏱ Tiempo de respuesta</p>
                <TimingBar
                  labelA="JSON plano" msA={resultadoPlano.ms}
                  labelB="Gzip"       msB={resultadoGzip.ms}
                />
                <div className="winner-box">
                  <span className="winner-box__icon">🏆</span>
                  <p>
                    Gzip transfirió <strong>{reduccionPct}% menos datos</strong> 
                    {ahorroMs > 0 && <> y fue <strong>{ahorroMs}ms más rápido</strong></>}.
                    Ahorraste <strong>{formatBytes(ahorroBytes)}</strong> por request.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Col derecha ────────────────────────────────── */}
        <div className="col">

          {/* Benchmark */}
          <div className="card">
            <div className="step-badge step-badge--dark">Benchmark del servidor</div>
            <h2>Análisis de compresión</h2>
            <p className="desc">
              Mide cuánto reduce el JSON y cuánto tarda en comprimir/descomprimir 
              en el servidor. Usá el slider de arriba para cambiar la cantidad de distritos.
            </p>
            <button className="btn btn--primary" onClick={handleBenchmark} disabled={cargandoBenchmark}>
              {cargandoBenchmark ? "⏳ Analizando..." : "🔬 Ejecutar benchmark"}
            </button>

            {benchmark && (
              <div className="benchmark-results">
                <CompareBar
                  labelA="JSON plano" valueA={benchmark.comparacion.json.bytes}
                  labelB="Gzip"       valueB={benchmark.comparacion.gzip.bytes}
                />

                <div className="pills-grid">
                  <div className="pill pill--green">
                    <span className="pill__label">Reducción</span>
                    <span className="pill__value">{benchmark.resultado.reduccionPorcentaje}</span>
                  </div>
                  <div className="pill pill--blue">
                    <span className="pill__label">Factor</span>
                    <span className="pill__value">{benchmark.resultado.factorCompresion}</span>
                  </div>
                  <div className="pill">
                    <span className="pill__label">Tiempo comprimir</span>
                    <span className="pill__value">{benchmark.resultado.tiempoComprimirMs}</span>
                  </div>
                  <div className="pill">
                    <span className="pill__label">Tiempo descomprimir</span>
                    <span className="pill__value">{benchmark.resultado.tiempoDescomprimirMs}</span>
                  </div>
                  <div className="pill pill--green">
                    <span className="pill__label">Bytes ahorrados</span>
                    <span className="pill__value">{benchmark.resultado.reduccionFormateada}</span>
                  </div>
                  <div className="pill">
                    <span className="pill__label">Distritos</span>
                    <span className="pill__value">{benchmark.configuracion.distritos}</span>
                  </div>
                </div>

                <div className="conclusion-box">
                  <p>{benchmark.resultado.conclusion}</p>
                </div>
              </div>
            )}
          </div>

          {/* Log */}
          <div className="card card--log">
            <div className="log-header">
              <span className="log-title">📋 Activity log</span>
              <button className="btn-clear" onClick={() => setLog([])}>limpiar</button>
            </div>
            {log.length === 0
              ? <p className="log-empty">Sin actividad...</p>
              : log.map((e, i) => (
                <div key={i} className={`log-entry log-entry--${e.tipo}`}>
                  <span className="log-t">{e.t}</span>
                  <span>{e.msg}</span>
                </div>
              ))
            }
          </div>

        </div>
      </main>
    </div>
  );
}