"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, @typescript-eslint/no-unused-vars --
   Código del prototipo v136 portado tal cual (lo revisó Diego línea por línea): se respeta
   su forma (efectos que sincronizan estado, helpers del prototipo que acá no se usan). */
// Modal de CARGA DE FACTURA (Etapa 4, punto 1): es ModalNuevaCarga del prototipo
// v136 / ModalCargaGastos_etapa4.jsx tal cual lo revisó Diego, con datos reales.
// Cambios respecto del prototipo (todo lo demás — comportamiento, textos, grilla,
// anchos — queda igual):
//   - maestros reales: proveedores, conceptos de caja (con su rubro) e insumos del 25;
//   - PDV reales; la regla de apertura por concepto se precarga como reparto (REGLA);
//   - "ya está cargada" se busca en la base (MaxiRest o Lazarillo) y no deja duplicar;
//   - "Guardar" escribe en la base (POST /api/facturas).
//   - Quedan para los próximos pasos: Gastos Varios, registrar el pago, editar una
//     factura existente, Repetir / precargar estructura, subir factura (lectura),
//     alta de proveedor y "guardar como regla".
import React, { useState, useRef, useEffect } from "react";

const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const TIPOS_CPB = ["FcA", "FcB", "FcC", "Ticket", "NC-A"];
const TIPOS_PERCEPCION = ["Perc. IIBB PBA", "Perc. IIBB CABA", "Perc. IVA RG 3337", "Perc. Ganancias"];
const ALICUOTAS = [21, 10.5, 27, 0];
// reparto efectivo de una linea: [{pdv, frac}] (sin reparto = 100% a su PDV)
const repartoDe = (l, pdvDefault) => {
  const r = (l.reparto || []).filter((x) => x.pdv && parseFloat(x.pct) > 0);
  const tot = r.reduce((a, x) => a + parseFloat(x.pct), 0);
  if (r.length >= 2 && tot > 0) return r.map((x) => ({ pdv: x.pdv, frac: parseFloat(x.pct) / tot }));
  return [{ pdv: l.pdvDest || pdvDefault, frac: 1 }];
};
const txtReparto = (l) => (l.reparto || []).filter((x) => parseFloat(x.pct) > 0).map((x) => `${x.pdv.replace("Ramos Mejía", "RM").replace("San Justo", "SJ")} ${fmtNum(parseFloat(x.pct))}%`).join(" · ");

// ============ HELPERS ============
const $pct = (e, v) => (v ? (e / v * 100).toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%" : "—");
const $fmt = (n) => (n ? "$ " + Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
// Importe en celda de ANCHO FIJO: entra completo -> tal cual; si no entra -> sin centavos y más chico;
// si ni así entra (valores absurdos) -> en millones / mil millones / billones. Nunca "..." (no se distingue mil de millón).
// El valor exacto va SIEMPRE en el tooltip cuando lo que se ve no es el exacto.
const Imp = ({ v, sufijo = "", strong, max = 16 }) => {
  const n = Number(v) || 0;
  const exacto = $fmt(n);
  const lim = max - sufijo.length;
  let txt = exacto, size;
  if (exacto.length > lim) {
    txt = "$ " + n.toLocaleString("es-AR", { maximumFractionDigits: 0 });
    size = 11.5;
    if (txt.length > lim) {
      const abs = Math.abs(n);
      const [div, u] = abs >= 1e12 ? [1e12, " bill."] : abs >= 1e9 ? [1e9, " mil mill."] : [1e6, " mill."];
      txt = "$ " + (n / div).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + u;
      size = 10.5;
    }
  }
  const aprox = txt !== exacto;
  return (
    <span title={aprox ? exacto + sufijo : undefined}
      style={{ display: "inline-block", maxWidth: "100%", overflow: "hidden", fontSize: size, fontWeight: strong ? 700 : undefined, whiteSpace: "nowrap", cursor: aprox ? "help" : undefined, borderBottom: aprox ? "1px dotted #bbb" : undefined }}>
      {txt}{sufijo}
    </span>
  );
};
// Grilla de registros del modal de carga: nombre flexible (se lee completo), importes en px fijos
const GRID_LIN = "minmax(0, 1fr) 78px 124px 130px 54px 124px 140px 50px";
const dmy = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a.slice(2)}`; };
const C = { neg: "#111", gris: "#8a8a8a", verde: "#159457", nar: "#e08900", rojo: "#c62828", cel: "#0d6fa8", borde: "#e8e8e6", fondo: "#f6f6f4" };
const card = { background: "#fff", borderRadius: 14, border: `1px solid ${C.borde}` };
const btn = (dark) => ({ padding: "9px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", border: dark ? "none" : `1px solid ${C.borde}`, background: dark ? "#111" : "#fff", color: dark ? "#fff" : "#333" });
const inp = { padding: "8px 10px", borderRadius: 9, border: "1px solid #ccc", fontSize: 13.5, width: "100%", boxSizing: "border-box", background: "#fff" };
const lab = { fontSize: 11.5, fontWeight: 700, color: C.gris, textTransform: "uppercase", letterSpacing: 0.4, display: "block", marginBottom: 4 };
const soloNum = (v) => v.replace(/[^0-9.,]/g, "").replace(/,/g, ".");
const fechaValida = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return false;
  const d = new Date(s + "T00:00:00");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
};
const MESES12 = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const pad2 = (n) => String(n).padStart(2, "0");
const dmy4 = (iso) => { const [y, m, d] = String(iso).split("-"); return `${d}/${m}/${y}`; };
function FechaInput({ iso, onISO, style: st, title, inputRef }) {
  const [txt, setTxt] = useState(iso ? dmy4(iso) : "");
  useEffect(() => { setTxt(iso ? dmy4(iso) : ""); }, [iso]);
  const commit = () => {
    let s = txt.trim();
    if (/^\d{6,8}$/.test(s)) s = s.slice(0, 2) + "/" + s.slice(2, 4) + "/" + s.slice(4);
    const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (!m) { setTxt(iso ? dmy4(iso) : ""); return; }
    let d = Number(m[1]), mo = Math.min(Math.max(Number(m[2]), 1), 12), y = Number(m[3]);
    if (y < 100) y += 2000;
    const ult = new Date(y, mo, 0).getDate();
    d = Math.min(Math.max(d, 1), ult);
    setTxt(`${pad2(d)}/${pad2(mo)}/${y}`);
    onISO(`${y}-${pad2(mo)}-${pad2(d)}`);
  };
  return (
    <input ref={inputRef} style={st} value={txt} placeholder="dd/mm/aaaa" title={title}
      onChange={(e) => {
        let v = e.target.value.replace(/[^\d\/\-.]/g, "");
        if (/^\d+$/.test(v)) {
          const d = v.slice(0, 8);
          v = d.length > 4 ? d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4) : d.length > 2 ? d.slice(0, 2) + "/" + d.slice(2) : d;
        }
        setTxt(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
  );
}
function FechaTriple({ iso, onISO, error, inputRef }) {
  const des = (v) => (v ? [v.slice(8, 10), v.slice(5, 7), v.slice(0, 4)] : ["", "", ""]);
  const [dmyv, setDmyvState] = useState(des(iso));
  // ref con el valor más reciente: el onBlur del campo que se abandona corre antes del re-render
  // (al saltar el foco en el mismo evento) y con el estado viejo leía "1" en vez de "15" -> "01"
  const ultimo = useRef(dmyv);
  const setDmyv = (v) => { ultimo.current = v; setDmyvState(v); };
  useEffect(() => { setDmyv(des(iso)); }, [iso]);
  const mRef = useRef(null); const yRef = useRef(null);
  const st = (w) => ({ ...inp, width: w, textAlign: "center", padding: "8px 4px", border: error ? `1.6px solid ${C.rojo}` : inp.border });
  const emitir = (d, m, y) => {
    if (!d || !m || !y) { onISO(""); return; }
    let yy = Number(y); if (yy < 100) yy += 2000;
    const mm = Math.min(Math.max(Number(m), 1), 12);
    const dd = Math.min(Math.max(Number(d), 1), new Date(yy, mm, 0).getDate());
    setDmyv([pad2(dd), pad2(mm), String(yy)]);
    onISO(`${yy}-${pad2(mm)}-${pad2(dd)}`);
  };
  const cambiar = (ix, v, max, sig) => {
    v = v.replace(/\D/g, "").slice(0, max);
    const nv = ultimo.current.map((x, i) => (i === ix ? v : x));
    setDmyv(nv);
    if (v.length === max && sig && sig.current) setTimeout(() => sig.current && sig.current.focus(), 0);
  };
  const blur = (ix) => {
    const nv = [...ultimo.current];
    if (ix < 2 && nv[ix]) nv[ix] = pad2(Number(nv[ix]));
    if (ix === 2 && nv[2] && nv[2].length <= 2) nv[2] = String(Number(nv[2]) + 2000);
    setDmyv(nv);
    emitir(nv[0], nv[1], nv[2]);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input ref={inputRef} style={st(44)} value={dmyv[0]} placeholder="dd" onChange={(e) => cambiar(0, e.target.value, 2, mRef)} onBlur={() => blur(0)} onFocus={(e) => e.target.select()} />
      <span style={{ color: "#bbb" }}>/</span>
      <input ref={mRef} style={st(44)} value={dmyv[1]} placeholder="mm" onChange={(e) => cambiar(1, e.target.value, 2, yRef)} onBlur={() => blur(1)} onFocus={(e) => e.target.select()} />
      <span style={{ color: "#bbb" }}>/</span>
      <input ref={yRef} style={st(60)} value={dmyv[2]} placeholder="aaaa" onChange={(e) => cambiar(2, e.target.value, 4, null)} onBlur={() => blur(2)} onFocus={(e) => e.target.select()} />
    </span>
  );
}
function BtnEliminar({ onConfirmar, style: st }) {
  const [pedir, setPedir] = useState(false);
  if (!pedir) return <span onClick={() => setPedir(true)} style={{ fontSize: 11.5, color: C.gris, cursor: "pointer", ...st }}>eliminar</span>;
  return (
    <span style={{ fontSize: 11.5, ...st }}>
      <span style={{ color: C.rojo, fontWeight: 700 }}>¿Eliminar?</span>{" "}
      <span onClick={() => { setPedir(false); onConfirmar(); }} style={{ color: C.rojo, fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Sí</span>
      {" · "}
      <span onClick={() => setPedir(false)} style={{ color: C.gris, cursor: "pointer" }}>No</span>
    </span>
  );
}
const corregirFecha = (s) => {
  const m = String(s || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Math.min(Math.max(Number(m[2]), 1), 12);
  const ult = new Date(y, mo, 0).getDate();
  const d = Math.min(Math.max(Number(m[3]), 1), ult);
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};
const parseImp = (v) => parseFloat(String(v).replace(/\./g, "").replace(",", ".")) || 0;
const fmtImp = (v) => {
  let s = String(v);
  if (!s.includes(",")) {
    const ult = s.lastIndexOf(".");
    if (ult >= 0) {
      const dec = s.slice(ult + 1).replace(/[^\d]/g, "");
      if (dec.length < 3) s = s.slice(0, ult).replace(/\./g, "") + "," + dec;
    }
  }
  const limpio = s.replace(/[^\d,]/g, "");
  const partes = limpio.split(",");
  const ent = (partes[0] || "").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return partes.length > 1 ? ent + "," + partes.slice(1).join("").slice(0, 2) : ent;
};
const fmtNum = (n) => (n || n === 0 ? Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 }) : "");
const enterAvanza = (e) => {
  if (e.key !== "Enter") return;
  const t = e.target;
  if (t.tagName !== "INPUT" && t.tagName !== "SELECT") return;
  e.preventDefault();
  const campos = Array.from(e.currentTarget.querySelectorAll("input, select")).filter((el) => !el.disabled && el.offsetParent !== null);
  const i = campos.indexOf(t);
  if (i >= 0 && i + 1 < campos.length) campos[i + 1].focus();
};

function Badge({ estado }) {
  const col = estado === "PAGA" ? C.verde : estado === "PARCIAL" ? C.nar : C.rojo;
  return <span style={{ background: col, color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6 }}>{estado}</span>;
}
function Dot({ estado }) {
  if (estado === "PAGA") return null;
  return <span title={estado} style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, background: estado === "PARCIAL" ? C.nar : C.rojo, marginRight: 7 }} />;
}
function Chev({ abierto }) {
  return <span style={{ display: "inline-block", width: 0, height: 0, marginRight: 8, verticalAlign: "middle",
    borderLeft: abierto ? "5px solid transparent" : "6px solid #888", borderRight: abierto ? "5px solid transparent" : "none",
    borderTop: abierto ? "6px solid #888" : "5px solid transparent", borderBottom: abierto ? "none" : "5px solid transparent" }} />;
}

function Combo({ opciones, valor, onElegir, placeholder, onCrear, ancho, autoFocus }) {
  const [texto, setTexto] = useState(valor || "");
  const [abierto, setAbierto] = useState(false);
  useEffect(() => { setTexto(valor || ""); }, [valor]);
  const inputRef = useRef(null);
  const avanzar = () => setTimeout(() => {
    const el = inputRef.current; if (!el) return;
    const root = el.closest('[data-card="1"]') || document;
    const campos = Array.from(root.querySelectorAll("input, select")).filter((x) => !x.disabled && x.offsetParent !== null);
    const i = campos.indexOf(el);
    if (i >= 0 && i + 1 < campos.length) campos[i + 1].focus();
  }, 0);
  const buscando = texto.trim() !== "" && texto !== (valor || "");
  const filtradas = (buscando ? opciones.filter((o) => o.toLowerCase().includes(texto.toLowerCase())) : opciones).slice(0, 12);
  const hayExacta = opciones.some((o) => o.toLowerCase() === texto.toLowerCase());
  return (
    <div style={{ position: "relative", width: ancho || "100%" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2.6" strokeLinecap="round"
        style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      <input ref={inputRef} style={{ ...inp, paddingLeft: 27 }} value={texto} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && abierto && filtradas[0]) { setTexto(filtradas[0]); setAbierto(false); onElegir(filtradas[0]); } }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => {
          setAbierto(false);
          if (onCrear) return; // con alta habilitada (proveedor) se maneja desde la lista
          const exacta = opciones.find((o) => o.toLowerCase() === texto.trim().toLowerCase());
          if (exacta && exacta !== valor) { setTexto(exacta); onElegir(exacta); }
          else if (!exacta) setTexto(valor || ""); // solo se aceptan ítems de la lista
        }, 180)} />
      {abierto && (filtradas.length > 0 || (onCrear && texto.trim())) && (
        <div style={{ position: "absolute", top: "105%", left: 0, right: 0, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.10)", zIndex: 80, maxHeight: 230, overflow: "auto" }}>
          {filtradas.map((o) => (
            <div key={o} onMouseDown={() => { setTexto(o); setAbierto(false); onElegir(o); avanzar(); }}
              style={{ padding: "8px 12px", fontSize: 13.5, cursor: "pointer", borderBottom: "1px solid #f4f4f2" }}>{o}</div>
          ))}
          {onCrear && texto.trim() && !hayExacta && (
            <div onMouseDown={() => { setAbierto(false); onCrear(texto.trim()); }}
              style={{ padding: "8px 12px", fontSize: 13.5, cursor: "pointer", color: C.cel, fontWeight: 600 }}>+ Crear «{texto.trim()}»</div>
          )}
        </div>
      )}
    </div>
  );
}

function ModalNuevaCarga({ ctx = {}, maestros, pdvsRef, pdvActual, reglaDe, onCerrar, onGuardado }) {
  // ── Adaptación a datos reales (lo único que cambia respecto del prototipo v136) ──
  const HOY = hoyISO();
  const PDVS = pdvsRef.map((p) => p.nombre);
  const idPdv = (nombre) => (pdvsRef.find((p) => p.nombre === nombre) || {}).id;
  const MAESTRO_CONCEPTOS = maestros.conceptos.map((c) => ({ rubro: c.rubro, concepto: c.nombre, codigo: c.codigo }));
  const codConcepto = (nombre) => (MAESTRO_CONCEPTOS.find((c) => c.concepto === nombre) || {}).codigo;
  const nomConcepto = (cod) => (MAESTRO_CONCEPTOS.find((c) => c.codigo === cod) || {}).concepto || "";
  const MAESTRO_INSUMOS = maestros.insumos.map((i) => ({ codigo: i.codigo, nombre: i.nombre, medida: i.medida, concepto: nomConcepto(i.codCga), unit: i.unit, alic: i.alic }));
  const conceptoDeInsumo = (nombre) => (MAESTRO_INSUMOS.find((i) => i.nombre === nombre) || {}).concepto || "";
  const medidaDe = (nombre) => (MAESTRO_INSUMOS.find((i) => i.nombre === nombre) || {}).medida || "";
  const proveedores = maestros.proveedores.map((p) => ({ ...p, nombre: p.nombre || p.razon || p.codigo }));
  // Regla de apertura por concepto (la que el Panel ya usa) como reparto precargado con la marca REGLA.
  const reglaDeItem = (l, item) => reglaDe(codConcepto(l.tipo === "insumo" ? conceptoDeInsumo(item) || l.conc : item), PDVS);
  const [guardando, setGuardando] = useState(false);
  const agregarRef = useRef(null);
  const [errFecha, setErrFecha] = useState(false);
  const [errores, setErrores] = useState([]);
  const [editPago, setEditPago] = useState(false);
  const [ep, setEp] = useState(null);
  const modo = "factura"; // Gastos Varios: va con la carga de pagos (próximo paso)
  const fechaDefault = HOY;

  // factura
  const rde = ctx.repetirDe || null;
  const ede = ctx.editarDe || null; // editar una factura existente desde la cta cte
  const partesComp = (comp) => { const m = String(comp || "").match(/^(\S+)\s+(\d+)-(\d+)$/); return m ? [m[1], m[2], m[3]] : [String(comp || "").split(" ")[0], "", ""]; };
  const lineasDe = (f) => (f.lineas && f.lineas.length
    ? f.lineas.map((l) => ({ ...l, editando: false, foco: false, precargada: false }))
    : [{ tipo: "concepto", item: f.concepto, neto: fmtNum(Math.round(f.importe / 1.21 * 100) / 100), cant: "", unit: "", alic: 21, conc: "", pdvDest: f.pdv, editando: false, foco: false }]);
  const tipoRef = useRef(null);
  const fechaRef = useRef(null);
  useEffect(() => { if (rde && tipoRef.current) tipoRef.current.focus(); }, []);
  const [origenPre, setOrigenPre] = useState(rde ? rde.comp : null);
  const [prov, setProv] = useState(ctx.prov || (rde && rde.prov) || (ede && ede.prov) || "");
  const [altaProv, setAltaProv] = useState(null); // {nombre, razon, cuit, tel, dir}
  const [tipoCpb, setTipoCpb] = useState((rde && (rde.tipoCpb || (rde.comp || "").split(" ")[0])) || (ede && (ede.tipoCpb || partesComp(ede.comp)[0])) || "");
  const [compPref, setCompPref] = useState(ede ? partesComp(ede.comp)[1] : "");
  const [compNum, setCompNum] = useState(ede ? partesComp(ede.comp)[2] : "");
  const pad = (v, n) => (v.trim() === "" ? "" : v.replace(/\D/g, "").slice(-n).padStart(n, "0"));
  const [fecha, setFecha] = useState(ede ? ede.fecha : fechaDefault);
  const [pdv, setPdv] = useState(ede ? ede.pdv : pdvActual || PDVS[0]);
  const [obs, setObs] = useState(ede ? ede.obs || "" : "");
  const [lineas, setLineas] = useState(ede ? lineasDe(ede) : rde ? rde.lineas.map((l) => ({ ...l, editando: false, foco: false, precargada: true })) : ctx.concepto ? [{ tipo: "concepto", item: ctx.concepto, neto: "", cant: "", unit: "", alic: 21, conc: "", pdvDest: pdvActual || PDVS[0], editando: true, foco: false }] : []);
  const netoDe = (l) => l.tipo === "insumo" ? (parseFloat(l.cant) || 0) * parseImp(l.unit) : parseImp(l.neto);
  const [percepciones, setPercepciones] = useState(((rde || ede) ? ((rde || ede).percepciones || []) : []).map((p) => ({ ...p })));
  const [impIntG, setImpIntG] = useState(ede && ede.impInt > 0 && !(ede.lineas || []).some((l) => parseImp(l.impint) > 0) ? fmtNum(ede.impInt) : "");
  const [leida, setLeida] = useState(false);
  const [existente, setExistente] = useState(!!ede);
  const [editId, setEditId] = useState(ede ? ede.id : null);

  // gasto vario
  const [detalle, setDetalle] = useState("");
  const [fechaV, setFechaV] = useState(fechaDefault);
  const [pdvV, setPdvV] = useState(PDVS[0]);
  const [rubroV, setRubroV] = useState(ctx.rubro || "");
  const [conceptoV, setConceptoV] = useState(ctx.concepto || "");
  const [importeV, setImporteV] = useState("");

  // pago
  const [pagarAhora, setPagarAhora] = useState(false);
  const formas = [];
  const [formaId, setFormaId] = useState(0);
  const [fechaPago, setFechaPago] = useState(fechaDefault);
  const [pagadoPor, setPagadoPor] = useState(PDVS[0]);
  const [enCuotas, setEnCuotas] = useState(false);
  const [nCuotas, setNCuotas] = useState(12);

  const rubroDe = (con) => (MAESTRO_CONCEPTOS.find((m) => m.concepto === con) || {}).rubro || "";
  const conceptosDe = (rub) => MAESTRO_CONCEPTOS.filter((m) => !rub || m.rubro === rub).map((m) => m.concepto);
  const rubros = [...new Set(MAESTRO_CONCEPTOS.map((m) => m.rubro))];

  const netoTotal = lineas.reduce((a, l) => a + netoDe(l), 0);
  const ivaTotal = lineas.reduce((a, l) => a + netoDe(l) * l.alic / 100, 0);
  const percTotal = percepciones.reduce((a, p) => a + parseImp(p.importe), 0);
  const impIntLineas = lineas.reduce((a, l) => a + parseImp(l.impint), 0);
  const impIntTotal = impIntLineas > 0 ? impIntLineas : parseImp(impIntG);
  const totalFactura = netoTotal + ivaTotal + percTotal + impIntTotal;
  const total = modo === "factura" ? totalFactura : parseImp(importeV);

  const setLinea = (i, campo, v) => setLineas((ls) => ls.map((l, ix) => ix === i ? { ...l, [campo]: v } : l));
  const ultConLineas = () => null; // "Precargar esa estructura": va con Repetir (próximo paso)
  const cuerpoVisible = existente || !!origenPre || !!(prov && tipoCpb && compNum && fecha);
  useEffect(() => {
    if (modo === "factura" && cuerpoVisible && lineas.length === 0 && !existente)
      setLineas([{ tipo: "concepto", item: ctx.concepto || "", neto: "", cant: "", unit: "", alic: 21, conc: "", pdvDest: pdvActual || PDVS[0], editando: true }]);
  }, [cuerpoVisible]);
  const precargarDe = (f) => {
    setTipoCpb(f.tipoCpb || (f.comp || "").split(" ")[0] || "");
    setTimeout(() => tipoRef.current && tipoRef.current.focus(), 40);
    setFecha(fechaDefault);
    setOrigenPre(f.comp);
    setLineas(f.lineas.map((l) => ({ ...l, editando: false, foco: false, precargada: true })));
    setPercepciones((f.percepciones || []).map((p) => ({ ...p })));
    const tieneImpLinea = f.lineas.some((l) => parseImp(l.impint) > 0);
    setImpIntG(!tieneImpLinea && f.impInt > 0 ? fmtNum(f.impInt) : "");
  };
  // Deteccion de factura ya cargada: mismo proveedor + tipo + prefijo-numero en el local (de MaxiRest o de Lazarillo).
  // Por ahora avisa y no deja guardar (no se duplica); editarla llega con "Ver / Editar".
  const compBuscado = tipoCpb && compPref && compNum ? `${tipoCpb} ${pad(compPref, 4)}-${pad(compNum, 8)}` : "";
  const [yaCargada, setYaCargada] = useState(null);
  useEffect(() => {
    setYaCargada(null);
    const p = proveedores.find((x) => x.nombre === prov);
    const pdvSel = pdvsRef.find((x) => x.nombre === (pdvActual || PDVS[0]));
    if (!p || !compBuscado || !pdvSel) return;
    let vivo = true;
    fetch(`/api/facturas/existe?proveedorId=${p.id}&localId=${pdvSel.localId}&tipo=${encodeURIComponent(tipoCpb)}&prefijo=${pad(compPref, 4)}&numero=${pad(compNum, 8)}`)
      .then((r) => r.json()).then((d) => { if (vivo && d && d.existe) setYaCargada(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [prov, compBuscado]);
  const factExistente = null;
  const pagadoExistente = 0;
  const estadoExistente = "";

  const guardar = () => {
    let fAct = modo === "factura" ? fecha : fechaV;
    if (!fechaValida(fAct)) {
      const c = corregirFecha(fAct);
      if (c) { fAct = c; if (modo === "factura") setFecha(c); else setFechaV(c); }
    }
    const faltan = [];
    if (modo === "factura") {
      if (!prov) faltan.push("Elegí el proveedor.");
      if (!tipoCpb) faltan.push("Elegí el tipo de comprobante (o usá Generar, que arma un Ticket interno).");
      else if (!compPref || !compNum || parseInt(compPref + compNum, 10) === 0) faltan.push("Falta el Nº de comprobante.");
      if (!fechaValida(fAct)) faltan.push("Falta una fecha de factura válida.");
      if (lineas.filter((l) => netoDe(l) > 0).length === 0) faltan.push("Agregá al menos un registro con importe.");
      if (lineas.some((l) => l.precargada)) faltan.push("Hay registros precargados sin revisar: tocá el ⚠ de cada uno para abrirlo y verificar el importe.");
    } else {
      if (!fechaValida(fAct)) faltan.push("Falta una fecha del gasto válida.");
      if (total <= 0) faltan.push("Poné el importe del gasto.");
    }
    if (yaCargada) faltan.push("Esta factura ya está cargada: no se vuelve a cargar.");
    const sinConc = lineas.filter((l) => l.tipo === "insumo" && l.item && !codConcepto(l.conc || conceptoDeInsumo(l.item)));
    if (sinConc.length) faltan.push(`Elegí el concepto de caja de: ${sinConc.map((l) => l.item).join(", ")}.`);
    if (lineas.some((l) => l.editando && l.item && netoDe(l) > 0)) setLineas((ls) => ls.map((x) => ({ ...x, editando: false })));
    if (faltan.length) { setErrores(faltan); setErrFecha(!fechaValida(fAct)); return; }
    setErrores([]);
    setErrFecha(false);
    const p = proveedores.find((x) => x.nombre === prov);
    const pdvBase = idPdv(pdvActual || PDVS[0]);
    const registros = lineas.filter((l) => l.item && netoDe(l) > 0).map((l) => {
      const esIns = l.tipo === "insumo";
      const ins = esIns ? MAESTRO_INSUMOS.find((x) => x.nombre === l.item) || {} : {};
      const regla = reglaDeItem(l, l.item);
      const igualRegla = regla && l.reparto && regla.length === l.reparto.length && regla.every((r, k) => r.pdv === l.reparto[k].pdv && Math.abs(parseFloat(r.pct) - parseFloat(l.reparto[k].pct)) < 0.01);
      const reparto = l.reparto && !igualRegla ? l.reparto.filter((x) => parseFloat(x.pct) > 0).map((x) => ({ puntoDeVentaId: idPdv(x.pdv), pct: parseFloat(x.pct) })) : null;
      return {
        tipo: l.tipo,
        conceptoCodigo: esIns ? codConcepto(l.conc || conceptoDeInsumo(l.item)) : codConcepto(l.item),
        insumoCodigo: esIns ? ins.codigo : null,
        nombre: l.item,
        medida: esIns ? ins.medida : null,
        cantidad: esIns ? parseFloat(l.cant) || null : null,
        neto: Math.round(netoDe(l) * 100) / 100,
        alicuota: l.alic,
        impInt: parseImp(l.impint),
        // Igual a la regla de apertura: va al PDV de gestión y la regla la reparte como a cualquier compra.
        puntoDeVentaId: igualRegla ? pdvBase : idPdv(l.pdvDest || pdvActual || PDVS[0]),
        reparto,
      };
    });
    const payload = {
      proveedorId: p ? p.id : null, tipo: tipoCpb, prefijo: pad(compPref, 4), numero: pad(compNum, 8), fecha: fAct,
      observacion: obs || null, registros,
      percepciones: percepciones.filter((x) => parseImp(x.importe) > 0).map((x) => ({ tipo: x.tipo, importe: parseImp(x.importe) })),
      impIntGeneral: impIntLineas > 0 ? 0 : parseImp(impIntG),
    };
    setGuardando(true);
    fetch("/api/facturas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
      .then(({ ok, d }) => {
        setGuardando(false);
        if (!ok) { setErrores([(d && d.error) || "No se pudo guardar la factura.", ...((d && d.detalle) || [])]); return; }
        onGuardado(d);
      })
      .catch(() => { setGuardando(false); setErrores(["Error de red: no se guardó."]); });
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(40,40,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }} onClick={onCerrar}>
      <div style={{ ...card, width: "min(1120px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: "22px 26px" }} onClick={(e) => e.stopPropagation()} onKeyDown={enterAvanza} data-card="1">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>{"Carga de factura"}</h2>
          <button onClick={onCerrar} style={{ border: "none", background: "none", fontSize: 20, color: "#999", cursor: "pointer" }}>×</button>
        </div>

        <div style={{ margin: "12px 0 14px" }} />

        {modo === "factura" ? (
          <>
            {yaCargada && (
              <div style={{ border: "1.5px solid #f0c179", background: "#fdf8ef", borderRadius: 11, padding: "12px 14px", fontSize: 13, color: "#8a5a00", marginBottom: 12 }}>
                ⚠ Esta factura <b>ya está cargada</b> ({yaCargada.origen === "lazarillo" ? "en Lazarillo" : "desde MaxiRest"}{yaCargada.fecha ? ` · ${dmy(yaCargada.fecha)}` : ""} · {$fmt(yaCargada.total)}). No se vuelve a cargar: <b>nunca se duplica</b>. Para corregirla vas a poder abrirla y editarla desde Detalle de compras.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 1fr 1fr", gap: 10 }}>
              <div><span style={lab}>Proveedor</span>
                <Combo opciones={proveedores.map((p) => p.nombre)} valor={prov} placeholder="Buscar proveedor..." autoFocus
                  onElegir={setProv} /></div>
              <div><span style={lab}>Tipo</span>
                <select ref={tipoRef} style={inp} value={tipoCpb} onChange={(e) => setTipoCpb(e.target.value)}>
                  <option value="">Elegir…</option>
                  {TIPOS_CPB.map((t) => <option key={t}>{t}</option>)}
                </select></div>
              <div><span style={lab}>Nº comprobante</span>
                {tipoCpb === "" ? (
                  <button title="Genera un comprobante interno tipo Ticket: hora y minutos + fecha de hoy"
                    onClick={() => { const ahora = new Date();
                      setTipoCpb("Ticket");
                      setCompPref(String(ahora.getHours()).padStart(2, "0") + String(ahora.getMinutes()).padStart(2, "0"));
                      setCompNum(String(ahora.getDate()).padStart(2, "0") + String(ahora.getMonth() + 1).padStart(2, "0") + ahora.getFullYear());
                      setTimeout(() => fechaRef.current && fechaRef.current.focus(), 40); }}
                    style={{ ...btn(false), padding: "9px 16px", fontSize: 13, whiteSpace: "nowrap" }}>Generar</button>
                ) : (
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input style={{ ...inp, width: 74 }} value={compPref} placeholder="0001" maxLength={4}
                      onChange={(e) => setCompPref(e.target.value.replace(/\D/g, ""))} onBlur={() => setCompPref(pad(compPref, 4))} />
                    <span style={{ color: "#999" }}>-</span>
                    <input style={inp} value={compNum} placeholder="00000000" maxLength={8}
                      onChange={(e) => setCompNum(e.target.value.replace(/\D/g, ""))} onBlur={() => setCompNum(pad(compNum, 8))} />
                  </div>
                )}</div>
              <div><span style={lab}>Fecha de factura</span><FechaTriple inputRef={fechaRef} error={errFecha} iso={fecha}
                  onISO={(v) => { setFecha(v); setErrFecha(false); if (lineas.length === 0 && prov) setLineas([{ tipo: "concepto", item: "", neto: "", cant: "", unit: "", alic: 21, conc: "", pdvDest: pdvActual || PDVS[0], editando: true }]); }} />
                {errFecha && modo === "factura" && <div style={{ fontSize: 11, color: C.rojo, fontWeight: 700, marginTop: 3 }}>Falta una fecha válida.</div>}</div>
            </div>

            {altaProv && (
              <div style={{ border: `1.5px solid ${C.cel}`, borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Nuevo proveedor: {altaProv.nombre}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input style={inp} placeholder="Razón social" value={altaProv.razon} onChange={(e) => setAltaProv({ ...altaProv, razon: e.target.value })} />
                  <input style={inp} placeholder="CUIT" value={altaProv.cuit} onChange={(e) => setAltaProv({ ...altaProv, cuit: e.target.value })} />
                  <input style={inp} placeholder="Teléfono" value={altaProv.tel} onChange={(e) => setAltaProv({ ...altaProv, tel: e.target.value })} />
                  <input style={inp} placeholder="Dirección" value={altaProv.dir} onChange={(e) => setAltaProv({ ...altaProv, dir: e.target.value })} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button style={btn(true)} onClick={() => { setProv(altaProv.nombre); setAltaProv(null); }}>Crear y usar</button>
                  <button style={btn(false)} onClick={() => setAltaProv(null)}>Cancelar</button>
                </div>
              </div>
            )}

            {origenPre && !existente && (
              <div style={{ marginTop: 12, border: "1.5px solid #f0d5a8", background: "#fdf8ee", borderRadius: 11, padding: "10px 14px", fontSize: 12.5, color: "#8a6d2f" }}>
                ⚠ Estás generando un comprobante <b>nuevo</b> con la estructura de <b>{origenPre}</b>: los importes son los de esa factura. Revisá cada registro contra el comprobante real, completá el Nº y confirmá la fecha (viene con la de hoy).
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <span style={lab}>Observaciones</span>
              <input style={inp} value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Opcional" />
            </div>

            {!cuerpoVisible && (
              <div style={{ marginTop: 16, border: "1px dashed #d8d8d4", borderRadius: 12, padding: "14px 16px", fontSize: 12.5, color: "#999" }}>
                Completá {[!prov && "proveedor", !tipoCpb && "tipo", !compNum && "Nº", !fecha && "fecha"].filter(Boolean).join(" · ")} y se despliega la carga de registros.
              </div>
            )}
            {cuerpoVisible && (<>
            {(() => {
              const uf = !existente && !origenPre && prov && !lineas.some((l) => netoDe(l) > 0) ? ultConLineas(prov) : null;
              if (!uf) return null;
              return (
                <div style={{ marginTop: 12, border: "1.5px solid #bfe0f0", background: "#f3fafd", borderRadius: 11, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12.5, color: "#2a6b86" }}><b>{prov}</b> suele repetir la estructura — última del {dmy(uf.fecha)}: {uf.lineas.map((l) => l.item).join(" · ")} · {$fmt(uf.importe)}</span>
                  <button style={{ ...btn(false), padding: "6px 12px", fontSize: 12.5, borderColor: "#5bc2ea", color: "#2a88ad", marginLeft: "auto" }}
                    onClick={() => precargarDe(uf)}>Precargar esa estructura</button>
                </div>
              );
            })()}
            <div style={{ marginTop: 16, background: "#fafaf8", border: "1px solid #ececea", borderRadius: 12, padding: "12px 14px 14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: GRID_LIN, gap: 8, fontSize: 10.5, fontWeight: 700, color: C.gris, margin: "6px 0 4px" }}>
                <span>CONCEPTO / INSUMO</span><span style={{ textAlign: "center" }}>CANT.</span><span style={{ textAlign: "center" }}>UNIT. $</span><span style={{ textAlign: "center" }}>TOTAL NETO $</span><span style={{ textAlign: "center" }}>IVA %</span><span style={{ textAlign: "center" }}>IVA $</span><span style={{ textAlign: "center" }}>SUBTOTAL c/IMPUESTOS</span><span />
              </div>
              {lineas.map((l, i) => {
                const esIns = l.tipo === "insumo";
                const neto = netoDe(l);
                const ivaUnit = esIns ? parseImp(l.unit) * l.alic / 100 : 0;
                const ivaLinea = neto * l.alic / 100;
                const med = esIns ? medidaDe(l.item) : "";
                const repartoOk = !l.reparto || Math.abs(l.reparto.reduce((a, x) => a + (parseFloat(x.pct) || 0), 0) - 100) < 0.01;
                if (!l.editando) return (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: GRID_LIN, gap: 8, alignItems: "center", padding: "8px 0", borderBottom: "1px solid #f2f2f0", fontSize: 13 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
                      <span style={{ fontSize: 9.5, fontWeight: 700, color: esIns ? C.cel : "#999", border: `1.2px solid ${esIns ? C.cel : "#ccc"}`, borderRadius: 6, padding: "2px 0", width: 74, textAlign: "center", flexShrink: 0 }}>{esIns ? "INSUMO" : "CONCEPTO"}</span>
                      <span style={{ display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
                        <span title={l.item} style={{ color: C.neg, fontWeight: 600, lineHeight: 1.2, overflowWrap: "anywhere" }}>{l.item}</span>
                        <span title={l.reparto ? txtReparto(l) : undefined} style={{ color: l.reparto ? "#2a88ad" : "#aaa", fontWeight: 400, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.reparto ? "⇄ " + txtReparto(l) : (l.pdvDest || pdvActual || PDVS[0])}</span>
                      </span>
                    </span>
                    <span style={{ color: "#555", textAlign: "center" }}>{esIns ? `${l.cant} ${med}` : <span style={{ color: "#ddd" }}>—</span>}</span>
                    <span style={{ color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}>{esIns ? <Imp v={parseImp(l.unit)} sufijo=" /u" max={17} /> : <span style={{ color: "#ddd" }}>—</span>}</span>
                    <span style={{ color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}><Imp v={neto} max={17} /></span>
                    <span style={{ color: "#555", textAlign: "center" }}>{l.alic}%</span>
                    <span style={{ color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}>{esIns ? <Imp v={ivaUnit} sufijo=" /u" max={17} /> : <Imp v={ivaLinea} max={17} />}</span>
                    <span style={{ textAlign: "center", minWidth: 0, overflow: "hidden" }}><Imp v={neto + ivaLinea + parseImp(l.impint)} strong max={17} />{parseImp(l.impint) > 0 && <span style={{ display: "block", fontWeight: 400, fontSize: 10.5, color: "#999" }}>incl. {$fmt(parseImp(l.impint))} imp.int.</span>}</span>
                    <span style={{ display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
                      {/* registro precargado (repetir factura): el ⚠ reemplaza al lápiz, hacen lo mismo (abrir para revisar) */}
                      {l.precargada
                        ? <span title="Importe copiado de la última factura — tocá para abrir el registro y revisarlo"
                            onClick={() => setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, editando: true, precargada: false } : x))}
                            style={{ cursor: "pointer", fontSize: 13, color: "#d99a1f", fontWeight: 700 }}>⚠</span>
                        : <span onClick={() => setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, editando: true, precargada: false } : x))} title="Editar" style={{ cursor: "pointer", color: C.gris }}>✎</span>}
                      <span onClick={() => setLineas((ls) => ls.filter((_, ix) => ix !== i))} title="Eliminar" style={{ cursor: "pointer", color: C.gris }}>×</span>
                    </span>
                  </div>
                );
                return (
                  <div key={i} style={{ background: "#fbfbfa", border: `1px solid ${C.borde}`, borderRadius: 10, padding: "10px 10px 8px", marginBottom: 8 }}>
                    <div style={{ display: "grid", gridTemplateColumns: GRID_LIN, gap: 8, alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, gridColumn: esIns ? "auto" : "1 / span 3" }}>
                        <span style={{ display: "inline-flex", flexDirection: "column", border: `1px solid ${C.borde}`, borderRadius: 7, overflow: "hidden", flexShrink: 0 }}>
                          {[["concepto", "CONC."], ["insumo", "INSUMO"]].map(([k, t]) => (
                            <span key={k} title={"Pasar la línea a " + k}
                              onClick={() => { if (l.tipo === k) return; setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, tipo: k, item: "", neto: "", cant: "", unit: "", conc: "", pdvDest: pdvActual || PDVS[0] } : x)); }}
                              style={{ padding: "2px 7px", fontSize: 8.5, fontWeight: 700, cursor: "pointer", background: l.tipo === k ? (k === "insumo" ? C.cel : "#111") : "#fff", color: l.tipo === k ? "#fff" : "#999", textAlign: "center" }}>{t}</span>
                          ))}
                        </span>
                        <div style={{ flex: 1 }}>
                          <Combo opciones={esIns ? MAESTRO_INSUMOS.map((x) => x.nombre) : conceptosDe(null)} valor={l.item} autoFocus={l.foco !== false}
                            placeholder={esIns ? "Buscar insumo..." : "Buscar concepto..."}
                            onElegir={(v) => {
                              const mi = esIns ? MAESTRO_INSUMOS.find((x) => x.nombre === v) : null;
                              const ult = mi && mi.unit ? { unit: fmtNum(Math.round(mi.unit * 100) / 100), alic: mi.alic != null ? mi.alic : l.alic } : null;
                              const regla = reglaDeItem(l, v);
                              const rep = regla ? regla.map((r) => ({ ...r })) : undefined;
                              setLineas((ls) => ls.map((x, ix) => ix !== i ? x : (esIns
                                ? { ...x, item: v, reparto: rep, conc: conceptoDeInsumo(v) || (ult && ult.conc) || "", unit: ult ? ult.unit : "", ntot: "", alic: ult ? ult.alic : x.alic, impint: ult && ult.impint ? ult.impint : "" }
                                : { ...x, item: v, reparto: rep, neto: ult ? ult.neto : "", alic: ult ? ult.alic : x.alic, impint: ult && ult.impint ? ult.impint : "" })));
                            }} />
                        </div>
                      </div>
                      {esIns ? (
                        <div style={{ position: "relative" }}>
                          <input style={{ ...inp, padding: "8px 26px 8px 6px", textAlign: "center" }} placeholder="0" value={l.cant}
                            onChange={(e) => {
                              const cant = soloNum(e.target.value); const c = parseFloat(cant) || 0;
                              setLineas((ls) => ls.map((x, ix) => {
                                if (ix !== i) return x;
                                if (parseImp(x.unit) > 0) return { ...x, cant, ntot: c > 0 ? fmtNum(c * parseImp(x.unit)) : x.ntot };
                                if (parseImp(x.ntot) > 0 && c > 0) return { ...x, cant, unit: fmtNum(parseImp(x.ntot) / c) };
                                return { ...x, cant };
                              }));
                            }} />
                          <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 700, color: C.gris, pointerEvents: "none" }}>{med || ""}</span>
                        </div>
                      ) : null}
                      {esIns
                        ? <input style={{ ...inp, padding: "8px 6px", textAlign: "center" }} placeholder="Unit. $" value={l.unit} title={l.unit ? "$ " + l.unit : undefined}
                            onChange={(e) => {
                              const unit = fmtImp(e.target.value); const u = parseImp(unit); const c = parseFloat(l.cant) || 0;
                              setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, unit, ntot: c > 0 && u > 0 ? fmtNum(c * u) : "" } : x));
                            }} />
                        : null}
                      {esIns
                        ? <input style={{ ...inp, padding: "8px 6px", textAlign: "center" }} placeholder="Total $" value={l.ntot || ""}
                            title={l.ntot ? "$ " + l.ntot + " — total neto de la línea: con la cantidad puesta, el unitario se calcula solo" : "Total neto de la línea: si lo cargás con la cantidad puesta, el unitario se calcula solo"}
                            onChange={(e) => {
                              const ntot = fmtImp(e.target.value); const t = parseImp(ntot); const c = parseFloat(l.cant) || 0;
                              setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, ntot, unit: c > 0 && t > 0 ? fmtNum(t / c) : x.unit } : x));
                            }} />
                        : <input style={{ ...inp, padding: "8px 6px", textAlign: "center" }} placeholder="Neto $" value={l.neto} title={l.neto ? "$ " + l.neto : undefined} onChange={(e) => setLinea(i, "neto", fmtImp(e.target.value))} />}
                      <select style={inp} value={l.alic} onChange={(e) => setLinea(i, "alic", parseFloat(e.target.value))}>
                        {ALICUOTAS.map((a) => <option key={a} value={a}>{a}%</option>)}
                      </select>
                      <span style={{ fontSize: 12.5, color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}>{neto > 0 ? (esIns ? <Imp v={ivaUnit} sufijo=" /u" max={17} /> : <Imp v={ivaLinea} max={17} />) : ""}</span>
                      <span style={{ fontSize: 12.5, textAlign: "center", minWidth: 0, overflow: "hidden" }}>{neto > 0 ? <Imp v={neto + ivaLinea + parseImp(l.impint)} strong max={17} /> : ""}</span>
                      <span style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button type="button" onClick={() => { if (l.item && neto > 0 && repartoOk) { setLinea(i, "editando", false); setTimeout(() => agregarRef.current && agregarRef.current.focus(), 40); } }} title={repartoOk ? "Confirmar (Enter)" : "El reparto por PDV tiene que sumar 100%"}
                          style={{ cursor: "pointer", fontWeight: 700, color: l.item && neto > 0 && repartoOk ? C.verde : "#ccc", fontSize: 16, background: "none", border: "none", padding: 0 }}>✓</button>
                        <button type="button" onClick={() => setLineas((ls) => ls.filter((_, ix) => ix !== i))} title="Eliminar" style={{ cursor: "pointer", color: C.gris, background: "none", border: "none", padding: 0, fontSize: 14 }}>×</button>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0 0 2px" }}>
                      {esIns && (
                        <>
                          <span style={{ color: C.gris, fontWeight: 700, fontSize: 10.5 }}>CONCEPTO DE CAJA</span>
                          <select style={{ ...inp, width: 185, padding: "5px 8px", fontSize: 12.5 }} value={l.conc}
                            onChange={(e) => setLinea(i, "conc", e.target.value)}>
                            <option value="">—</option>
                            {conceptosDe(null).map((c) => <option key={c}>{c}</option>)}
                          </select>
                        </>
                      )}
                      <span style={{ color: C.gris, fontWeight: 700, fontSize: 10.5, marginLeft: esIns ? 8 : 0 }}>PDV DEL REGISTRO</span>
                      {!l.reparto ? (<>
                        <select style={{ ...inp, width: 200, padding: "5px 8px", fontSize: 12.5 }} value={l.pdvDest || pdvActual || PDVS[0]}
                          onChange={(e) => setLinea(i, "pdvDest", e.target.value)}>
                          {PDVS.map((p) => <option key={p}>{p}</option>)}
                        </select>
                        <span onClick={() => setLinea(i, "reparto", [{ pdv: l.pdvDest || pdvActual || PDVS[0], pct: 100 }, { pdv: PDVS.find((p) => p !== (l.pdvDest || pdvActual || PDVS[0])) || PDVS[1], pct: 0 }])}
                          title="Repartir este registro entre varios PDV por porcentaje" style={{ fontSize: 11.5, color: C.cel, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>⇄ repartir por PDV</span>
                      </>) : (() => {
                        const tot = l.reparto.reduce((a, x) => a + (parseFloat(x.pct) || 0), 0);
                        const ok = Math.abs(tot - 100) < 0.01;
                        const regla = reglaDeItem(l, l.item);
                        const igualRegla = regla && regla.length === l.reparto.length && regla.every((r, k) => r.pdv === l.reparto[k].pdv && Math.abs(parseFloat(r.pct) - parseFloat(l.reparto[k].pct)) < 0.01);
                        return (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", border: `1px solid ${ok ? "#bfe0f0" : "#f0c179"}`, background: ok ? "#f3fafd" : "#fdf8ef", borderRadius: 9, padding: "4px 8px" }}>
                            {l.reparto.map((r, k) => (
                              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                                <select style={{ ...inp, width: 160, padding: "3px 6px", fontSize: 12 }} value={r.pdv}
                                  onChange={(e) => setLinea(i, "reparto", l.reparto.map((x, kx) => kx === k ? { ...x, pdv: e.target.value } : x))}>
                                  {PDVS.map((p) => <option key={p}>{p}</option>)}
                                </select>
                                <input style={{ ...inp, width: 54, padding: "3px 4px", fontSize: 12, textAlign: "center" }} value={r.pct}
                                  onChange={(e) => setLinea(i, "reparto", l.reparto.map((x, kx) => kx === k ? { ...x, pct: soloNum(e.target.value) } : x))} />
                                <span style={{ fontSize: 11, color: "#777" }}>%</span>
                                {l.reparto.length > 2 && <span onClick={() => setLinea(i, "reparto", l.reparto.filter((_, kx) => kx !== k))} style={{ cursor: "pointer", color: C.gris, fontSize: 13 }}>×</span>}
                              </span>
                            ))}
                            {l.reparto.length < PDVS.length && <span onClick={() => setLinea(i, "reparto", [...l.reparto, { pdv: PDVS.find((p) => !l.reparto.some((x) => x.pdv === p)) || PDVS[0], pct: 0 }])} style={{ fontSize: 12, color: C.cel, fontWeight: 700, cursor: "pointer" }}>+ PDV</span>}
                            <span style={{ fontSize: 11, fontWeight: 700, color: ok ? C.verde : C.nar }}>{ok ? "= 100%" : `suma ${fmtNum(tot)}%`}</span>
                            {regla && igualRegla && <span title="Este reparto es la regla guardada para este concepto/insumo" style={{ fontSize: 10, fontWeight: 700, color: "#2a88ad", background: "#e7f3fa", borderRadius: 5, padding: "1px 6px" }}>REGLA</span>}
                            <span onClick={() => setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, reparto: undefined, pdvDest: l.reparto[0].pdv } : x))} title="Volver a un solo PDV" style={{ cursor: "pointer", color: C.gris, fontSize: 11.5 }}>un solo PDV</span>
                          </span>
                        );
                      })()}
                      <span style={{ color: C.gris, fontWeight: 700, fontSize: 10.5, marginLeft: 8 }}>IMP. INTERNOS $</span>
                      <input style={{ ...inp, width: 110, padding: "5px 8px", fontSize: 12.5, textAlign: "center" }} placeholder="0"
                        value={l.impint || ""} onChange={(e) => setLinea(i, "impint", fmtImp(e.target.value))} title="Impuesto interno de este registro (opcional)" />
                    </div>
                  </div>
                );
              })}
              {(() => {
                const enEd = lineas.find((l) => l.editando);
                const confirmable = !enEd || !!(enEd.item && netoDe(enEd) > 0 && (!enEd.reparto || Math.abs(enEd.reparto.reduce((a, x) => a + (parseFloat(x.pct) || 0), 0) - 100) < 0.01));
                return (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <button ref={agregarRef} title={!confirmable ? "Completá el registro en edición para agregar otro" : enEd ? "Confirmar este registro y agregar otro" : "Agregar registro"}
                  disabled={!confirmable}
                  onClick={() => { if (confirmable) setLineas((ls) => {
                    // el registro nuevo nace con el mismo tipo que el ultimo cargado (venis cargando insumos -> insumo)
                    const ult = ls[ls.length - 1];
                    return [...ls.map((x) => ({ ...x, editando: false })), { tipo: ult ? ult.tipo : "concepto", item: "", neto: "", cant: "", unit: "", alic: ult ? ult.alic : 21, conc: "", pdvDest: (ult && ult.pdvDest) || pdvActual || PDVS[0], editando: true }];
                  }); }}
                  style={{ width: 30, height: 30, borderRadius: 15, border: `1.5px solid ${C.borde}`, background: "#fff", fontSize: 18, fontWeight: 700, color: "#444", cursor: !confirmable ? "not-allowed" : "pointer", opacity: !confirmable ? 0.35 : 1, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>+</button>
                {!confirmable && <span style={{ fontSize: 11.5, color: "#999" }}>Completá el registro en edición para agregar otro</span>}
              </div>
                );
              })()}

            <div style={{ marginTop: 14 }}>
              <span style={lab}>Percepciones</span>
              {percepciones.map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.9fr 24px", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <select style={inp} value={p.tipo} onChange={(e) => setPercepciones((ps) => ps.map((x, ix) => ix === i ? { ...x, tipo: e.target.value } : x))}>
                    {TIPOS_PERCEPCION.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <input style={inp} placeholder="Importe $" value={p.importe} onChange={(e) => setPercepciones((ps) => ps.map((x, ix) => ix === i ? { ...x, importe: fmtImp(e.target.value) } : x))} />
                  <span onClick={() => setPercepciones((ps) => ps.filter((_, ix) => ix !== i))} style={{ color: C.gris, cursor: "pointer", textAlign: "center" }}>×</span>
                </div>
              ))}
              <button style={btn(false)} onClick={() => setPercepciones((ps) => [...ps, { tipo: TIPOS_PERCEPCION[0], importe: "" }])}>+ Agregar percepción</button>
            </div>

            <div style={{ marginTop: 14 }}>
              <span style={lab}>Impuestos internos</span>
              {impIntLineas > 0
                ? <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}><b>{$fmt(impIntLineas)}</b> <span style={{ color: "#999", fontSize: 12 }}>· suma de los impuestos internos cargados por registro</span></div>
                : <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
                    <input style={{ ...inp, width: 140, textAlign: "center" }} placeholder="Importe $" value={impIntG} onChange={(e) => setImpIntG(fmtImp(e.target.value))} />
                    <span style={{ color: "#999", fontSize: 12 }}>general de la factura — o cargalos registro por registro y acá va la suma</span>
                  </div>}
            </div>

            </div>

            <div style={{ display: "flex", gap: 22, marginTop: 16, padding: "12px 14px", background: "#f6f6f4", borderRadius: 10, fontSize: 13.5, borderTop: "2px solid #e6e6e2" }}>
              <span>Neto <b>{$fmt(netoTotal)}</b></span>
              <span>IVA <b>{$fmt(ivaTotal)}</b></span>
              <span>Percepciones <b>{$fmt(percTotal)}</b></span>
              {impIntTotal > 0 && <span>Imp. internos <b>{$fmt(impIntTotal)}</b></span>}
              <span style={{ marginLeft: "auto" }}>TOTAL <b style={{ fontSize: 15 }}>{$fmt(totalFactura)}</b></span>
            </div>
            </>)}

          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={lab}>Rubro</span>
              <Combo opciones={rubros} valor={rubroV} placeholder="Buscar rubro..." autoFocus={!ctx.concepto} onElegir={(r) => { setRubroV(r); if (rubroDe(conceptoV) !== r) setConceptoV(""); }} /></div>
            <div><span style={lab}>Concepto</span>
              <Combo opciones={conceptosDe(rubroV)} valor={conceptoV} placeholder="Buscar concepto..." onElegir={(c) => { setConceptoV(c); setRubroV(rubroDe(c) || rubroV); }} /></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={lab}>Detalle</span>
              <input style={inp} autoFocus={!!ctx.concepto} value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: devolución seña cancha" /></div>
            <div><span style={lab}>Importe</span><input style={inp} value={importeV} onChange={(e) => setImporteV(fmtImp(e.target.value))} /></div>
            <div><span style={lab}>Fecha del gasto</span>
              <FechaInput style={{ ...inp, border: errFecha ? `1.6px solid ${C.rojo}` : inp.border }} iso={fechaV}
                onISO={(v) => { setFechaV(v); setErrFecha(false); }} />
              {errFecha && modo === "vario" && <div style={{ fontSize: 11, color: C.rojo, fontWeight: 700, marginTop: 3 }}>Falta una fecha válida.</div>}</div>
            <div><span style={lab}>PDV del gasto</span>
              <select style={inp} value={pdvV} onChange={(e) => setPdvV(e.target.value)}>{PDVS.map((p) => <option key={p}>{p}</option>)}</select></div>
          </div>
        )}

        {errores.length > 0 && (
          <div style={{ border: `1.5px solid ${C.rojo}`, background: "#fdf3f3", borderRadius: 11, padding: "10px 14px", marginTop: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.rojo, marginBottom: 4 }}>No se puede guardar todavía:</div>
            {errores.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: C.rojo }}>• {e}</div>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {(modo !== "factura" || cuerpoVisible) && <button style={{ ...btn(true), opacity: guardando || yaCargada ? 0.5 : 1 }} disabled={guardando || !!yaCargada} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>}
          <button style={btn(false)} onClick={onCerrar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

export default ModalNuevaCarga;
