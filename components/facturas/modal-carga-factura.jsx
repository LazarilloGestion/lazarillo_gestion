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
import { useMediosPago } from "@/hooks/use-medios-pago";
import { mediosParaElegir } from "@/lib/medios-pago/abm";
import { fechaDelPeriodo, moverPeriodo, nombrePeriodo, periodoDe } from "@/lib/gastos-varios/periodo";
import { factorEnvase } from "@/lib/facturas/insumos";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useFetchQuery } from "@/hooks/use-fetch-query";
import { MEDIO_ADELANTOS, validarSueldo } from "@/lib/empleados/carga";

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
const GRID_LIN = "minmax(0, 1fr) 78px 124px 130px 76px 124px 140px 50px";
const dmy = (iso) => { const [a, m, d] = iso.split("-"); return `${d}/${m}/${a.slice(2)}`; };
const C = { neg: "#111", gris: "#8a8a8a", verde: "#159457", nar: "#e08900", rojo: "#c62828", cel: "#0d6fa8", borde: "#e8e8e6", fondo: "#f6f6f4" };
const card = { background: "#fff", borderRadius: 14, border: `1px solid ${C.borde}` };
const btn = (dark) => ({ padding: "9px 16px", borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: "pointer", border: dark ? "none" : `1px solid ${C.borde}`, background: dark ? "#111" : "#fff", color: dark ? "#fff" : "#333" });
const inp = { padding: "8px 10px", borderRadius: 9, border: "1px solid #ccc", fontSize: 13.5, width: "100%", height: 38, boxSizing: "border-box", background: "#fff" };
// Desplegables con el mismo alto, borde y flecha que los campos (el select nativo de Mac
// ignora el padding y quedaba más bajo y desalineado — FALLA de Diego, 27/10/2026).
const FLECHA = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")";
const sel = { ...inp, appearance: "none", WebkitAppearance: "none", MozAppearance: "none", backgroundImage: FLECHA, backgroundRepeat: "no-repeat", backgroundPosition: "right 9px center", paddingRight: 24, cursor: "pointer" };
// Fila de abajo de cada registro (concepto de caja, PDV, imp. internos): todo a 32px.
const chico = { height: 32, fontSize: 12.5, padding: "5px 8px" };
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
function FechaInput({ iso, onISO, style: st, title, inputRef, tabIndex }) {
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
    <input ref={inputRef} style={st} value={txt} placeholder="dd/mm/aaaa" title={title} tabIndex={tabIndex}
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
  // FALLA de Diego (tickets guardados en noviembre): con el campo lleno y el cursor
  // adentro (clic en el mes "10" y tipear "10"), el dígito se insertaba y se cortaba a 2
  // → "110" → "11". Ahora: clic selecciona todo y, si el campo ya estaba lleno, lo
  // tipeado reemplaza en vez de insertarse.
  const cambiar = (ix, e, max, sig) => {
    const crudo = e.target.value.replace(/\D/g, "");
    const tipeado = String((e.nativeEvent && e.nativeEvent.data) || "").replace(/\D/g, "");
    const previo = ultimo.current[ix] || "";
    const v = crudo.length > max && previo.length >= max && tipeado ? tipeado.slice(0, max) : crudo.slice(0, max);
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
      <input ref={inputRef} style={st(44)} value={dmyv[0]} placeholder="dd" onChange={(e) => cambiar(0, e, 2, mRef)} onClick={(e) => e.target.select()} onBlur={() => blur(0)} onFocus={(e) => e.target.select()} />
      <span style={{ color: "#bbb" }}>/</span>
      <input ref={mRef} style={st(44)} value={dmyv[1]} placeholder="mm" onChange={(e) => cambiar(1, e, 2, yRef)} onClick={(e) => e.target.select()} onBlur={() => blur(1)} onFocus={(e) => e.target.select()} />
      <span style={{ color: "#bbb" }}>/</span>
      <input ref={yRef} style={st(60)} value={dmyv[2]} placeholder="aaaa" onChange={(e) => cambiar(2, e, 4, null)} onClick={(e) => e.target.select()} onBlur={() => blur(2)} onFocus={(e) => e.target.select()} />
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
  // Los campos fuera del tabulador (la fecha del gasto vario) tampoco reciben el Enter.
  const campos = Array.from(e.currentTarget.querySelectorAll("input, select")).filter((el) => !el.disabled && el.offsetParent !== null && el.tabIndex !== -1);
  const i = campos.indexOf(t);
  if (i >= 0 && i + 1 < campos.length) campos[i + 1].focus();
};

// Insumo que vino bonificado (importe 0): se carga igual, con su cantidad.
const Bonif = () => <span title="Insumo bonificado: importe $ 0, se registra la cantidad" style={{ fontSize: 10, fontWeight: 700, color: C.verde, border: `1.2px solid ${C.verde}`, borderRadius: 6, padding: "1px 6px" }}>BONIFICADO</span>;
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

function Combo({ opciones, valor, onElegir, placeholder, onCrear, ancho, autoFocus, estilo }) {
  const [texto, setTexto] = useState(valor || "");
  const [abierto, setAbierto] = useState(false);
  // Opción marcada con las flechas (Diego 27/10: tipear "carn" + ↓ tiene que navegar la lista).
  const [activo, setActivo] = useState(0);
  const listaRef = useRef(null);
  useEffect(() => { setTexto(valor || ""); }, [valor]);
  // El blur resuelve 180 ms después: tiene que leer el valor de ESE momento (si en el medio
  // se precargó otro registro en la misma fila, el viejo lo borraba).
  const valorRef = useRef(valor);
  useEffect(() => { valorRef.current = valor; }, [valor]);
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
  const conCrear = !!(onCrear && texto.trim() && !hayExacta);
  const total = filtradas.length + (conCrear ? 1 : 0);
  const marcado = Math.min(activo, Math.max(0, total - 1));
  const elegir = (idx) => {
    if (idx < filtradas.length) { const o = filtradas[idx]; setTexto(o); setAbierto(false); onElegir(o); avanzar(); }
    else if (conCrear) { setAbierto(false); onCrear(texto.trim()); }
  };
  useEffect(() => {
    const el = listaRef.current && listaRef.current.children[marcado];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [marcado, abierto]);
  return (
    <div style={{ position: "relative", width: ancho || "100%" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#aaa" strokeWidth="2.6" strokeLinecap="round"
        style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
        <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      <input ref={inputRef} style={{ ...inp, ...estilo, paddingLeft: 27 }} value={texto} placeholder={placeholder} autoFocus={autoFocus}
        onChange={(e) => { setTexto(e.target.value); setAbierto(true); setActivo(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); if (!abierto) { setAbierto(true); setActivo(0); } else setActivo(Math.min(marcado + 1, total - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActivo(Math.max(marcado - 1, 0)); }
          else if (e.key === "Escape" && abierto) { e.preventDefault(); e.stopPropagation(); setAbierto(false); }
          else if (e.key === "Enter" && abierto && total > 0) { e.preventDefault(); e.stopPropagation(); elegir(marcado); }
          // Tab con la lista abierta elige la opción marcada y deja que el Tab siga al próximo campo (Diego 27/10).
          else if (e.key === "Tab" && abierto && marcado < filtradas.length) { const o = filtradas[marcado]; setTexto(o); setAbierto(false); if (o !== valor) onElegir(o); }
        }}
        // No se despliega solo al entrar (Diego 27/10): se abre al tipear, con ↓ o con un click.
        onMouseDown={() => setAbierto(true)}
        onBlur={() => setTimeout(() => {
          setAbierto(false);
          if (onCrear) return; // con alta habilitada (proveedor) se maneja desde la lista
          const actual = valorRef.current;
          if (actual !== valor) return; // cambió el valor mientras tanto: manda el nuevo
          const exacta = opciones.find((o) => o.toLowerCase() === texto.trim().toLowerCase());
          if (exacta && exacta !== actual) { setTexto(exacta); onElegir(exacta); }
          else if (!exacta) setTexto(actual || ""); // solo se aceptan ítems de la lista
        }, 180)} />
      {abierto && total > 0 && (
        <div ref={listaRef} style={{ position: "absolute", top: "105%", left: 0, right: 0, background: "#fff", border: `1px solid ${C.borde}`, borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,.10)", zIndex: 80, maxHeight: 230, overflow: "auto" }}>
          {filtradas.map((o, ix) => (
            <div key={o} onMouseDown={(e) => { e.preventDefault(); elegir(ix); }} onMouseEnter={() => setActivo(ix)}
              style={{ padding: "8px 12px", fontSize: 13.5, cursor: "pointer", borderBottom: "1px solid #f4f4f2", background: ix === marcado ? "#eef7fc" : "#fff" }}>{o}</div>
          ))}
          {conCrear && (
            <div onMouseDown={(e) => { e.preventDefault(); elegir(filtradas.length); }} onMouseEnter={() => setActivo(filtradas.length)}
              style={{ padding: "8px 12px", fontSize: 13.5, cursor: "pointer", color: C.cel, fontWeight: 600, background: marcado === filtradas.length ? "#eef7fc" : "#fff" }}>+ Crear «{texto.trim()}»</div>
          )}
        </div>
      )}
    </div>
  );
}

// Arma el "editarDe" del prototipo (la factura en el formato del modal) desde lo
// que devuelve GET /api/facturas/[rowId] (FacturaInput con códigos e ids).
export function edeDesdeFactura(rowId, f, { maestros, pdvsRef }) {
  const nomPdv = (id) => (pdvsRef.find((p) => p.id === id) || {}).nombre || "";
  const nomCon = (cod) => (maestros.conceptos.find((c) => String(c.codigo).trim() === String(cod).trim()) || {}).nombre || "";
  const nomIns = (cod) => (maestros.insumos.find((i) => String(i.codigo) === String(cod)) || {}).nombre || "";
  const p = maestros.proveedores.find((x) => x.id === f.proveedorId) || {};
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    id: rowId,
    prov: p.nombre || p.razon || p.codigo || "",
    tipoCpb: f.tipo,
    comp: `${f.tipo} ${String(f.prefijo).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`,
    fecha: f.fecha,
    obs: f.observacion || "",
    pdv: nomPdv((f.registros[0] || {}).puntoDeVentaId),
    impInt: f.impIntGeneral || 0,
    percepciones: (f.percepciones || []).map((x) => ({ tipo: x.tipo, importe: fmtNum(x.importe) })),
    lineas: f.registros.map((r) => {
      const comun = {
        alic: r.alicuota, pdvDest: nomPdv(r.puntoDeVentaId), impint: r.impInt ? fmtNum(r.impInt) : "",
        reparto: r.reparto && r.reparto.length >= 2 ? r.reparto.map((x) => ({ pdv: nomPdv(x.puntoDeVentaId), pct: x.pct })) : undefined,
      };
      if (r.tipo === "insumo") {
        const cant = r.cantidad || 0;
        return { ...comun, tipo: "insumo", item: nomIns(r.insumoCodigo) || r.nombre, codIns: r.insumoCodigo, medida: r.medida,
          cant: cant ? String(cant) : "", unit: cant ? fmtNum(r2(r.neto / cant)) : "", ntot: fmtNum(r.neto), neto: "", conc: nomCon(r.conceptoCodigo) };
      }
      return { ...comun, tipo: "concepto", item: nomCon(r.conceptoCodigo) || r.nombre, neto: fmtNum(r.neto), cant: "", unit: "", conc: "" };
    }),
  };
}

// vista: "nueva" (alta) | "ver" (solo lectura, con Editar / Eliminar) | "editar".
// embebido: sin overlay propio (va adentro de un Dialog, p.ej. desde Detalle de compras).
/** @param {any} props */
function ModalNuevaCarga(props) {
  const { ctx = {}, maestros, pdvsRef, pdvActual, reglaDe, onCerrar, onGuardado,
    vista = "nueva", editRowId = null, editable = false, aviso = null, onEditar, onEliminado, onRepetir, embebido = false,
    reglaEmpleadoDe = () => null } = props;
  const soloVer = vista === "ver";
  // ── Adaptación a datos reales (lo único que cambia respecto del prototipo v136) ──
  const HOY = hoyISO();
  const PDVS = pdvsRef.map((p) => p.nombre);
  const idPdv = (nombre) => (pdvsRef.find((p) => p.nombre === nombre) || {}).id;
  const MAESTRO_CONCEPTOS = maestros.conceptos.map((c) => ({ rubro: c.rubro, concepto: c.nombre, codigo: c.codigo }));
  const codConcepto = (nombre) => (MAESTRO_CONCEPTOS.find((c) => c.concepto === nombre) || {}).codigo;
  const nomConcepto = (cod) => (MAESTRO_CONCEPTOS.find((c) => c.codigo === cod) || {}).concepto || "";
  const MAESTRO_INSUMOS = maestros.insumos.map((i) => ({ codigo: i.codigo, nombre: i.nombre, medida: i.medida, concepto: nomConcepto(i.codCga), unit: i.unit, alic: i.alic, envases: i.envases || [] }));
  const conceptoDeInsumo = (nombre) => (MAESTRO_INSUMOS.find((i) => i.nombre === nombre) || {}).concepto || "";
  const medidaDe = (nombre) => (MAESTRO_INSUMOS.find((i) => i.nombre === nombre) || {}).medida || "";
  // Medida de la línea: la de la factura (X8, Pack… si en MaxiRest se cargó en envases; ahí el
  // precio es por envase) y, si es un envase, cuántas unidades del insumo trae (Diego 28/10/2026).
  const medidaLinea = (l) => {
    const ins = MAESTRO_INSUMOS.find((i) => i.nombre === l.item);
    const med = l.medida || (ins && ins.medida) || "";
    const f = ins ? factorEnvase({ medida: ins.medida || "", envases: ins.envases }, med) : null;
    return { med, base: (ins && ins.medida) || "", factor: f && f > 1 ? f : null };
  };
  const proveedores = maestros.proveedores.map((p) => ({ ...p, nombre: p.nombre || p.razon || p.codigo }));
  // Regla de apertura por concepto (la que el Panel ya usa) como reparto precargado con la marca REGLA.
  // La regla tiene que estar vigente en la FECHA DE LA FACTURA (no hoy): si no, el modal
  // marcaba REGLA y el motor después no la aplicaba (revisión 27/10/2026).
  const reglaDeItem = (l, item) => reglaDe(codConcepto(l.tipo === "insumo" ? conceptoDeInsumo(item) || l.conc : item), PDVS, fecha);
  const [guardando, setGuardando] = useState(false);
  const [futuraOk, setFuturaOk] = useState(""); // fecha futura ya confirmada con un segundo Guardar
  const [borrando, setBorrando] = useState(false);
  const [pagosAlBorrar, setPagosAlBorrar] = useState(null); // la factura está paga: confirmar
  const eliminar = (conPagos) => {
    setBorrando(true);
    fetch(`/api/facturas/${editRowId}${conPagos ? "?conPagos=1" : ""}`, { method: "DELETE" })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
      .then(({ ok, d }) => {
        setBorrando(false);
        if (!ok && d && d.tienePagos) { setPagosAlBorrar(d.tienePagos); return; }
        if (!ok) { setErrores([(d && d.error) || "No se pudo eliminar."]); return; }
        if (onEliminado) onEliminado(d);
      })
      .catch(() => { setBorrando(false); setErrores(["Error de red: no se eliminó."]); });
  };
  const agregarRef = useRef(null);
  const [errFecha, setErrFecha] = useState(false);
  const [errores, setErrores] = useState([]);
  const [editPago, setEditPago] = useState(false);
  const [ep, setEp] = useState(null);
  // Factura o Gastos Varios (solo al cargar uno nuevo; ver / editar es siempre factura).
  const [modo, setModo] = useState(vista === "nueva" && (ctx.modo === "vario" || ctx.modo === "empleado") ? ctx.modo : "factura");
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
  const [prov, setProv] = useState(ctx.prov || (ctx.proveedorId && (proveedores.find((p) => p.id === ctx.proveedorId) || {}).nombre) || (rde && rde.prov) || (ede && ede.prov) || "");
  const [altaProv, setAltaProv] = useState(null); // {nombre, razon, cuit, tel, dir}
  // ctx.tipoCpb / prefijo / numero / fecha: precarga desde "Sin carga ARCA" (Diego 28/10/2026).
  const [tipoCpb, setTipoCpb] = useState((rde && (rde.tipoCpb || (rde.comp || "").split(" ")[0])) || (ede && (ede.tipoCpb || partesComp(ede.comp)[0])) || ctx.tipoCpb || "");
  const [compPref, setCompPref] = useState(ede ? partesComp(ede.comp)[1] : ctx.prefijo || "");
  const [compNum, setCompNum] = useState(ede ? partesComp(ede.comp)[2] : ctx.numero || "");
  const pad = (v, n) => (v.trim() === "" ? "" : v.replace(/\D/g, "").slice(-n).padStart(n, "0"));
  const [fecha, setFecha] = useState(ede ? ede.fecha : ctx.fecha || fechaDefault);
  const [pdv, setPdv] = useState(ede ? ede.pdv : pdvActual || PDVS[0]);
  const [obs, setObs] = useState(ede ? ede.obs || "" : "");
  // Precarga (Repetir / última factura): el primer registro queda abierto para corregir el
  // neto; al confirmarlo se abre el siguiente (Diego 27/10). Los demás quedan con ⚠.
  const abrirPrecarga = (ls) => ls.map((l, ix) => ({ ...l, editando: ix === 0, foco: false, precargada: ix !== 0 }));
  const [lineas, setLineas] = useState(ede ? lineasDe(ede) : rde ? abrirPrecarga(rde.lineas) : ctx.concepto ? [{ tipo: "concepto", item: ctx.concepto, neto: "", cant: "", unit: "", alic: 21, conc: "", pdvDest: pdvActual || PDVS[0], editando: true, foco: false }] : []);
  // Insumo: el total neto de la línea (lo que dice la factura) manda si está; si no, cant × unitario.
  const netoDe = (l) => l.tipo === "insumo" ? (l.ntot !== undefined && l.ntot !== "" ? parseImp(l.ntot) : (parseFloat(l.cant) || 0) * parseImp(l.unit)) : parseImp(l.neto);
  const [percepciones, setPercepciones] = useState(((rde || ede) ? ((rde || ede).percepciones || []) : []).map((p) => ({ ...p })));
  const [impIntG, setImpIntG] = useState(() => { const b = ede || rde; return b && b.impInt > 0 && !(b.lineas || []).some((l) => parseImp(l.impint) > 0) ? fmtNum(b.impInt) : ""; });
  const [leida, setLeida] = useState(false);
  const [existente, setExistente] = useState(!!ede);
  const [editId, setEditId] = useState(ede ? ede.id : null);

  // gasto vario: primero el PERÍODO (mes); la fecha va al 15 y el tabulador la saltea (Diego, 27/10/2026).
  const [detalle, setDetalle] = useState("");
  // Desde "Sin carga" llega el período, el concepto y el importe del último mes.
  const [periodoV, setPeriodoV] = useState(ctx.periodo || periodoDe(HOY));
  const [fechaV, setFechaV] = useState(fechaDelPeriodo(ctx.periodo || periodoDe(HOY)));
  const elegirPeriodo = (p) => { setPeriodoV(p); setFechaV(fechaDelPeriodo(p)); setErrFecha(false); };
  const periodosV = Array.from({ length: 15 }, (_, i) => moverPeriodo(periodoDe(HOY), 2 - i)); // 2 meses adelante, 12 atrás
  const [pdvV, setPdvV] = useState(pdvActual || PDVS[0]);
  // Un gasto vario casi siempre se carga ya pagado: arranca tildado (sin pago queda IMPAGO).
  const [pagarV, setPagarV] = useState(true);
  const [parecidoV, setParecidoV] = useState(null); // ya hay uno parecido: confirmar
  const concCtx = MAESTRO_CONCEPTOS.find((c) => c.concepto === ctx.concepto || (ctx.conceptoCodigo && c.codigo === ctx.conceptoCodigo));
  const [rubroV, setRubroV] = useState(ctx.rubro || (concCtx && concCtx.rubro) || "");
  const [conceptoV, setConceptoV] = useState(ctx.concepto || (concCtx && concCtx.concepto) || "");
  const [importeV, setImporteV] = useState(ctx.importe > 0 ? fmtNum(ctx.importe) : "");
  // Desde una celda vacía del Panel: el importe es el del mes anterior y queda marcado hasta que lo toques (Diego 29/10).
  const [importeRevisar, setImporteRevisar] = useState(!!ctx.importeAnterior && ctx.importe > 0);

  // pago
  // "Registrar el pago ahora" (Etapa 4, paso 4): arranca destildado; sin pago la factura queda IMPAGA.
  const [pagarAhora, setPagarAhora] = useState(false);
  const formas = [];
  const [formaId, setFormaId] = useState(0);
  const [fechaPago, setFechaPago] = useState(ctx.fechaPago || hoyISO());
  const [pagadoPor, setPagadoPor] = useState(pdvActual || PDVS[0]);
  const { data: mediosData } = useMediosPago();
  const mediosPago = mediosParaElegir(mediosData);
  const [medioPagoSel, setMedioPago] = useState("");
  const medioPago = medioPagoSel || (mediosPago[0] && mediosPago[0].nombre) || "";
  const pidePagoId = !!(mediosPago.find((m) => m.nombre === medioPago) || {}).pideId;
  const [refPago, setRefPago] = useState("");
  const [importePago, setImportePago] = useState(""); // vacío = el total de la factura
  const [enCuotas, setEnCuotas] = useState(false);
  const [nCuotas, setNCuotas] = useState(12);

  const rubroDe = (con) => (MAESTRO_CONCEPTOS.find((m) => m.concepto === con) || {}).rubro || "";
  const conceptosDe = (rub) => MAESTRO_CONCEPTOS.filter((m) => !rub || m.rubro === rub).map((m) => m.concepto);
  const rubros = [...new Set(MAESTRO_CONCEPTOS.map((m) => m.rubro))];

  const netoTotal = lineas.reduce((a, l) => a + netoDe(l), 0);
  // IVA redondeado por línea, igual que lo guarda el servidor y lo trae MaxiRest.
  const ivaDe = (l) => Math.round(netoDe(l) * l.alic) / 100;
  const ivaTotal = lineas.reduce((a, l) => a + ivaDe(l), 0);
  const percTotal = percepciones.reduce((a, p) => a + parseImp(p.importe), 0);
  const impIntLineas = lineas.reduce((a, l) => a + parseImp(l.impint), 0);
  const impIntTotal = impIntLineas > 0 ? impIntLineas : parseImp(impIntG);
  const totalFactura = netoTotal + ivaTotal + percTotal + impIntTotal;
  const total = modo === "factura" ? totalFactura : parseImp(importeV);

  // Un registro se puede confirmar con producto, importe, reparto que sume 100% y —si es
  // insumo— concepto de caja (antes dejaba seguir sin concepto: FALLA de Diego, 27/10/2026).
  const faltaDe = (l) => {
    if (!l.item) return "Elegí el concepto o insumo";
    // Insumo bonificado: importe 0 con cantidad (Diego, 27/10/2026); un concepto sí necesita importe.
    if (l.tipo === "insumo" ? !(parseFloat(l.cant) > 0) : !(netoDe(l) > 0)) return l.tipo === "insumo" ? "Poné la cantidad" : "Poné el importe";
    if (l.tipo === "insumo" && !codConcepto(l.conc)) return "Elegí el concepto de caja del insumo";
    if (l.reparto && Math.abs(l.reparto.reduce((a, x) => a + (parseFloat(x.pct) || 0), 0) - 100) >= 0.01) return "El reparto por PDV tiene que sumar 100%";
    return null;
  };
  const setLinea = (i, campo, v) => setLineas((ls) => ls.map((l, ix) => ix === i ? { ...l, [campo]: v } : l));
  // "Precargar esa estructura" (Repetir): la última factura de este proveedor en el local,
  // de MaxiRest o de Lazarillo, con el mismo formato del modal (Diego, 27/10/2026).
  const [ultFact, setUltFact] = useState(null);
  useEffect(() => {
    setUltFact(null);
    if (vista !== "nueva" || rde) return;
    const p = proveedores.find((x) => x.nombre === prov);
    const pdvSel = pdvsRef.find((x) => x.nombre === (pdvActual || PDVS[0]));
    if (!p || !pdvSel) return;
    let vivo = true;
    fetch(`/api/facturas/ultima?proveedorId=${p.id}&localId=${pdvSel.localId}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo || !d || !d.ultima) return;
        const e = edeDesdeFactura(d.ultima.rowId, d.ultima.factura, { maestros, pdvsRef });
        setUltFact({ ...e, importe: d.ultima.totalFilas });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [prov]);
  const ultConLineas = () => ultFact;
  // Precargada la estructura y después se cambia el proveedor: se saca la precarga (era de otro
  // proveedor) y vuelve a aparecer la opción de precargar la del nuevo (Diego, 28/10/2026).
  const provAnterior = useRef(prov);
  useEffect(() => {
    if (provAnterior.current === prov) return;
    provAnterior.current = prov;
    if (origenPre && !existente) {
      setOrigenPre(null);
      setLineas([]);
      setPercepciones([]);
      setImpIntG("");
    }
  }, [prov]);
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
    setLineas(abrirPrecarga(f.lineas));
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
    // Editando: el mismo proveedor y Nº de la factura que se edita no cuenta como "ya cargada".
    if (ede && `${prov}|${compBuscado}` === `${ede.prov}|${ede.comp}`) return;
    const p = proveedores.find((x) => x.nombre === prov);
    const pdvSel = pdvsRef.find((x) => x.nombre === (pdvActual || PDVS[0]));
    if (!p || !compBuscado || !pdvSel) return;
    let vivo = true;
    fetch(`/api/facturas/existe?proveedorId=${p.id}&localId=${pdvSel.localId}&tipo=${encodeURIComponent(tipoCpb)}&prefijo=${pad(compPref, 4)}&numero=${pad(compNum, 8)}&fecha=${fecha || ""}`)
      .then((r) => r.json()).then((d) => { if (vivo && d && d.existe) setYaCargada(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [prov, compBuscado, fecha]);
  const factExistente = null;
  const pagadoExistente = 0;
  const estadoExistente = "";

  // Gasto vario: POST /api/gastos-varios (Ticket interno de "Gastos Varios", con su pago).
  const guardarVario = (forzar) => {
    let fAct = fechaV;
    if (!fechaValida(fAct)) { const c = corregirFecha(fAct); if (c) { fAct = c; setFechaV(c); } }
    const faltan = [];
    if (!codConcepto(conceptoV)) faltan.push("Elegí el concepto del gasto.");
    if (!(parseImp(importeV) > 0)) faltan.push("Poné el importe del gasto.");
    if (!fechaValida(fAct)) faltan.push("Falta una fecha del gasto válida.");
    if (pagarV) {
      if (!medioPago) faltan.push("Elegí el medio de pago (se dan de alta en Medios de pago, en el menú).");
      if (!fechaValida(fechaPago)) faltan.push("Falta una fecha de pago válida.");
    }
    // El 15 del período puede ser posterior a hoy y está bien; otra fecha futura se confirma.
    if (fechaValida(fAct) && fAct > HOY && fAct !== fechaDelPeriodo(periodoV) && futuraOk !== fAct) {
      faltan.push(`La fecha del gasto (${dmy4(fAct)}) es posterior a hoy. Revisala; si está bien, tocá Guardar de nuevo.`);
      setFuturaOk(fAct);
    }
    if (faltan.length) { setErrores(faltan); setErrFecha(!fechaValida(fAct)); return; }
    setErrores([]); setErrFecha(false); setParecidoV(null);
    const payload = {
      pdvId: idPdv(pdvV), conceptoCodigo: codConcepto(conceptoV), detalle: detalle.trim() || null,
      importe: Math.round(parseImp(importeV) * 100) / 100, fecha: fAct, forzar: !!forzar,
      pago: pagarV ? { fecha: fechaPago, medio: medioPago, referencia: pidePagoId && refPago.trim() ? refPago.trim() : null, pdvPagaId: idPdv(pagadoPor) } : null,
    };
    setGuardando(true);
    fetch("/api/gastos-varios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
      .then(({ ok, d }) => {
        setGuardando(false);
        if (!ok && d && d.parecido) { setParecidoV(d.parecido); return; }
        if (!ok) { setErrores([(d && d.error) || "No se pudo guardar el gasto.", ...((d && d.detalle) || [])]); return; }
        onGuardado({ ...d, gastoVario: true, concepto: conceptoV });
      })
      .catch(() => { setGuardando(false); setErrores(["Error de red: no se guardó."]); });
  };

  const guardar = () => {
    if (modo === "vario") { guardarVario(false); return; }
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
      // Un registro abierto a medio completar (p. ej. reparto que no suma 100%) no se guarda igual.
      lineas.filter((l) => l.editando && (l.item || netoDe(l) > 0)).forEach((l) => { const f = faltaDe(l); if (f) faltan.push(`${l.item || "Registro"}: ${f}.`); });
    } else {
      if (!fechaValida(fAct)) faltan.push("Falta una fecha del gasto válida.");
      if (total <= 0) faltan.push("Poné el importe del gasto.");
    }
    if (yaCargada) faltan.push("Esta factura ya está cargada: no se vuelve a cargar.");
    if (modo === "factura" && vista === "nueva" && pagarAhora) {
      if (!medioPago) faltan.push("Elegí el medio de pago (se dan de alta en Medios de pago, en el menú).");
      if (!fechaValida(fechaPago)) faltan.push("Falta una fecha de pago válida.");
    }
    // Fecha posterior a hoy: casi siempre es un error de tipeo (pasó con un ticket guardado en noviembre).
    if (fechaValida(fAct) && fAct > HOY && futuraOk !== fAct && !(ede && ede.fecha === fAct)) {
      faltan.push(`La fecha de factura (${dmy4(fAct)}) es posterior a hoy. Revisala; si está bien, tocá Guardar de nuevo.`);
      setFuturaOk(fAct);
    }
    const sinConc = lineas.filter((l) => l.tipo === "insumo" && l.item && !codConcepto(l.conc || conceptoDeInsumo(l.item)));
    if (sinConc.length) faltan.push(`Elegí el concepto de caja de: ${sinConc.map((l) => l.item).join(", ")}.`);
    if (lineas.some((l) => l.editando && !faltaDe(l))) setLineas((ls) => ls.map((x) => ({ ...x, editando: false })));
    if (faltan.length) { setErrores(faltan); setErrFecha(!fechaValida(fAct)); return; }
    setErrores([]);
    setErrFecha(false);
    const p = proveedores.find((x) => x.nombre === prov);
    const pdvBase = idPdv(pdvActual || PDVS[0]);
    const registros = lineas.filter((l) => l.item && (netoDe(l) > 0 || (l.tipo === "insumo" && parseFloat(l.cant) > 0))).map((l) => {
      const esIns = l.tipo === "insumo";
      const ins = esIns ? MAESTRO_INSUMOS.find((x) => x.nombre === l.item) || {} : {};
      const regla = reglaDeItem(l, l.item);
      const igualRegla = regla && l.reparto && regla.length === l.reparto.length && regla.every((r, k) => r.pdv === l.reparto[k].pdv && Math.abs(parseFloat(r.pct) - parseFloat(l.reparto[k].pct)) < 0.01);
      const reparto = l.reparto && !igualRegla ? l.reparto.filter((x) => parseFloat(x.pct) > 0).map((x) => ({ puntoDeVentaId: idPdv(x.pdv), pct: parseFloat(x.pct) })) : null;
      return {
        tipo: l.tipo,
        conceptoCodigo: esIns ? codConcepto(l.conc || conceptoDeInsumo(l.item)) : codConcepto(l.item),
        insumoCodigo: esIns ? ins.codigo || l.codIns || null : null,
        nombre: l.item,
        // La de la línea primero: si se cargó en envases (X8) el precio es por envase y no hay que perderla.
        medida: esIns ? l.medida || ins.medida || null : null,
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
      // Pago en la misma transacción que la factura (sin importe: la salda entera).
      ...(vista === "nueva" && pagarAhora ? { pago: {
        fecha: fechaPago, medio: medioPago, referencia: pidePagoId && refPago.trim() ? refPago.trim() : null,
        pdvPagaId: idPdv(pagadoPor), ...(parseImp(importePago) > 0 ? { importe: parseImp(importePago) } : {}),
      } } : {}),
    };
    setGuardando(true);
    fetch(vista === "editar" ? `/api/facturas/${editRowId}` : "/api/facturas", { method: vista === "editar" ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => null) }))
      .then(({ ok, d }) => {
        setGuardando(false);
        if (!ok) { setErrores([(d && d.error) || "No se pudo guardar la factura.", ...((d && d.detalle) || [])]); return; }
        onGuardado(d);
      })
      .catch(() => { setGuardando(false); setErrores(["Error de red: no se guardó."]); });
  };

  return (
    <div style={embebido ? { display: "contents" } : { position: "fixed", inset: 0, background: "rgba(40,40,40,.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 55 }} onClick={embebido ? undefined : onCerrar}>
      <div style={embebido ? { padding: "22px 26px" } : { ...card, width: "min(1120px, 96vw)", maxHeight: "92vh", overflow: "auto", padding: "22px 26px" }} onClick={(e) => e.stopPropagation()} onKeyDown={enterAvanza} data-card="1">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ fontSize: 17, margin: 0 }}>{vista === "ver" ? `Factura ${ede ? ede.comp : ""}` : vista === "editar" ? `Editar factura ${ede ? ede.comp : ""}` : modo === "vario" ? "Carga de gasto vario" : modo === "empleado" ? "Carga de empleados" : "Carga de factura"}</h2>
          <button onClick={onCerrar} style={{ border: "none", background: "none", fontSize: 20, color: "#999", cursor: "pointer" }}>×</button>
        </div>

        {vista === "nueva" && !rde ? (
          <div style={{ display: "inline-flex", gap: 4, background: C.fondo, borderRadius: 11, padding: 4, margin: "12px 0 14px" }}>
            {[["factura", "Factura"], ["vario", "Gastos Varios"], ["empleado", "Empleados"]].map(([k, t]) => (
              <button key={k} type="button" tabIndex={-1} onClick={() => { setModo(k); setErrores([]); setErrFecha(false); setParecidoV(null); }}
                style={{ border: "none", borderRadius: 8, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                  background: modo === k ? "#fff" : "transparent", color: modo === k ? C.neg : C.gris, boxShadow: modo === k ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>{t}</button>
            ))}
          </div>
        ) : <div style={{ margin: "12px 0 14px" }} />}
        {aviso && <div style={{ border: "1.5px solid #bfe0f0", background: "#f3fafd", borderRadius: 11, padding: "10px 14px", fontSize: 12.5, color: "#2a6b86", marginBottom: 12 }}>{aviso}</div>}
        {modo === "empleado" ? (
          <CargaEmpleado pdvId={idPdv(pdvActual || PDVS[0])} pdvsRef={pdvsRef} conceptos={maestros.conceptos} mediosPago={mediosPago}
            reglaEmpleadoDe={reglaEmpleadoDe} onGuardado={onGuardado} onCerrar={onCerrar} />
        ) : (<>
        <fieldset disabled={soloVer} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>

        {modo === "factura" ? (
          <>
            {yaCargada && (
              <div style={{ border: "1.5px solid #f0c179", background: "#fdf8ef", borderRadius: 11, padding: "12px 14px", fontSize: 13, color: "#8a5a00", marginBottom: 12 }}>
                ⚠ Esta factura <b>ya está cargada</b> ({yaCargada.origen === "lazarillo" ? "en Lazarillo" : "desde MaxiRest"}{yaCargada.fecha ? ` · ${dmy(yaCargada.fecha)}` : ""} · {$fmt(yaCargada.total)}). No se vuelve a cargar: <b>nunca se duplica</b>. Para corregirla vas a poder abrirla y editarla desde Detalle de compras.
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.7fr 1fr 1fr", gap: 10 }}>
              <div><span style={lab}>Proveedor</span>
                <Combo opciones={proveedores.map((p) => p.nombre)} valor={prov} placeholder="Buscar proveedor..." autoFocus={vista === "nueva"}
                  onElegir={setProv} /></div>
              <div><span style={lab}>Tipo</span>
                <select ref={tipoRef} style={sel} value={tipoCpb} onChange={(e) => setTipoCpb(e.target.value)}>
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
                const ivaLinea = ivaDe(l);
                const { med, base: medBase, factor: fEnv } = esIns ? medidaLinea(l) : { med: "", base: "", factor: null };
                const cantN = parseFloat(l.cant) || 0;
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
                    <span style={{ color: "#555", textAlign: "center" }}>{!esIns ? <span style={{ color: "#ddd" }}>—</span>
                      : fEnv ? <span title={`${l.cant} envases ${med} de ${fEnv} ${medBase}`}>{l.cant} × {med}<span style={{ display: "block", fontSize: 10.5, color: "#999" }}>= {fmtNum(Math.round(cantN * fEnv * 100) / 100)} {medBase}</span></span>
                      : `${l.cant} ${med}`}</span>
                    <span style={{ color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}>{!esIns ? <span style={{ color: "#ddd" }}>—</span>
                      : fEnv ? <span><Imp v={parseImp(l.unit)} sufijo={" /" + med} max={17} /><span style={{ display: "block", fontSize: 10.5, color: "#2a88ad", fontWeight: 600 }}><Imp v={parseImp(l.unit) / fEnv} sufijo={" /" + (medBase || "u")} max={17} /></span></span>
                      : <Imp v={parseImp(l.unit)} sufijo=" /u" max={17} />}</span>
                    <span style={{ color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}><Imp v={neto} max={17} /></span>
                    <span style={{ color: "#555", textAlign: "center" }}>{l.alic}%</span>
                    <span style={{ color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}>{esIns ? <Imp v={ivaUnit} sufijo={fEnv ? " /" + med : " /u"} max={17} /> : <Imp v={ivaLinea} max={17} />}</span>
                    <span style={{ textAlign: "center", minWidth: 0, overflow: "hidden" }}>{esIns && neto === 0 ? <Bonif /> : <Imp v={neto + ivaLinea + parseImp(l.impint)} strong max={17} />}{parseImp(l.impint) > 0 && <span style={{ display: "block", fontWeight: 400, fontSize: 10.5, color: "#999" }}>incl. {$fmt(parseImp(l.impint))} imp.int.</span>}</span>
                    <span style={{ display: soloVer ? "none" : "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
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
                          <Combo opciones={esIns ? MAESTRO_INSUMOS.map((x) => x.nombre) : conceptosDe(null)} valor={l.item} autoFocus={l.foco !== false && l.foco !== "neto"}
                            placeholder={esIns ? "Buscar insumo..." : "Buscar concepto..."}
                            onElegir={(v) => {
                              const mi = esIns ? MAESTRO_INSUMOS.find((x) => x.nombre === v) : null;
                              const ult = mi && mi.unit ? { unit: fmtNum(Math.round(mi.unit * 100) / 100), alic: mi.alic != null ? mi.alic : l.alic } : null;
                              const regla = reglaDeItem(l, v);
                              const rep = regla ? regla.map((r) => ({ ...r })) : undefined;
                              setLineas((ls) => ls.map((x, ix) => ix !== i ? x : (esIns
                                ? { ...x, item: v, medida: undefined, reparto: rep, conc: conceptoDeInsumo(v) || (ult && ult.conc) || "", unit: ult ? ult.unit : "", ntot: "", alic: ult ? ult.alic : x.alic, impint: ult && ult.impint ? ult.impint : "" }
                                : { ...x, item: v, reparto: rep, neto: ult ? ult.neto : "", alic: ult ? ult.alic : x.alic, impint: ult && ult.impint ? ult.impint : "" })));
                            }} />
                        </div>
                      </div>
                      {esIns ? (
                        <div style={{ position: "relative" }}>
                          <input style={{ ...inp, padding: "8px 26px 8px 6px", textAlign: "center" }} placeholder="0" value={l.cant} autoFocus={l.foco === "neto"}
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
                        : <input style={{ ...inp, padding: "8px 6px", textAlign: "center" }} placeholder="Neto $" value={l.neto} autoFocus={l.foco === "neto"} title={l.neto ? "$ " + l.neto : undefined} onChange={(e) => setLinea(i, "neto", fmtImp(e.target.value))} />}
                      <select style={{ ...sel, padding: "8px 20px 8px 8px", backgroundPosition: "right 7px center" }} value={l.alic} onChange={(e) => setLinea(i, "alic", parseFloat(e.target.value))}>
                        {ALICUOTAS.map((a) => <option key={a} value={a}>{a}%</option>)}
                      </select>
                      <span style={{ fontSize: 12.5, color: "#555", textAlign: "center", minWidth: 0, overflow: "hidden" }}>{neto > 0 ? (esIns ? <Imp v={ivaUnit} sufijo=" /u" max={17} /> : <Imp v={ivaLinea} max={17} />) : ""}</span>
                      <span style={{ fontSize: 12.5, textAlign: "center", minWidth: 0, overflow: "hidden" }}>{neto > 0 ? <Imp v={neto + ivaLinea + parseImp(l.impint)} strong max={17} /> : esIns && parseFloat(l.cant) > 0 && l.item ? <Bonif /> : ""}</span>
                      <span style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                        <button type="button" onClick={() => {
                          if (faltaDe(l)) return;
                          // Si quedan registros precargados sin revisar, se abre el siguiente con el foco en el importe.
                          const j = lineas.findIndex((x, ix) => ix > i && x.precargada);
                          setLineas((ls) => ls.map((x, ix) => ix === i ? { ...x, editando: false } : ix === j ? { ...x, editando: true, precargada: false, foco: "neto" } : x));
                          if (j < 0) setTimeout(() => agregarRef.current && agregarRef.current.focus(), 40);
                        }} title={faltaDe(l) || "Confirmar (Enter)"}
                          style={{ cursor: "pointer", fontWeight: 700, color: !faltaDe(l) ? C.verde : "#ccc", fontSize: 16, background: "none", border: "none", padding: 0 }}>✓</button>
                        <button type="button" onClick={() => setLineas((ls) => ls.filter((_, ix) => ix !== i))} title="Eliminar" style={{ cursor: "pointer", color: C.gris, background: "none", border: "none", padding: 0, fontSize: 14 }}>×</button>
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", margin: "8px 0 0 2px" }}>
                      {esIns && (
                        <>
                          <span style={{ color: C.gris, fontWeight: 700, fontSize: 10.5 }}>CONCEPTO DE CAJA</span>
                          <Combo opciones={conceptosDe(null)} valor={l.conc} placeholder="Buscar concepto..." ancho={230} estilo={{ ...chico, border: l.conc ? inp.border : `1.6px solid ${C.nar}` }}
                            onElegir={(v) => {
                              // cambia el concepto: el reparto precargado pasa a ser el de la regla del concepto nuevo
                              const regla = reglaDe(codConcepto(v), PDVS, fecha);
                              setLineas((ls) => ls.map((x, ix) => ix !== i ? x : { ...x, conc: v, reparto: regla ? regla.map((r) => ({ ...r })) : (x.reparto && !reglaDeItem(x, x.item) ? x.reparto : undefined) }));
                            }} />
                        </>
                      )}
                      <span style={{ color: C.gris, fontWeight: 700, fontSize: 10.5, marginLeft: esIns ? 8 : 0 }}>PDV DEL REGISTRO</span>
                      {!l.reparto ? (<>
                        <select style={{ ...sel, ...chico, width: 200, paddingRight: 24 }} value={l.pdvDest || pdvActual || PDVS[0]}
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
                                <select style={{ ...sel, width: 160, height: 28, padding: "3px 22px 3px 6px", fontSize: 12 }} value={r.pdv}
                                  onChange={(e) => setLinea(i, "reparto", l.reparto.map((x, kx) => kx === k ? { ...x, pdv: e.target.value } : x))}>
                                  {PDVS.map((p) => <option key={p}>{p}</option>)}
                                </select>
                                <input style={{ ...inp, width: 54, height: 28, padding: "3px 4px", fontSize: 12, textAlign: "center" }} value={r.pct}
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
                      <input style={{ ...inp, ...chico, width: 110, textAlign: "center" }} placeholder="0"
                        value={l.impint || ""} onChange={(e) => setLinea(i, "impint", fmtImp(e.target.value))} title="Impuesto interno de este registro (opcional)" />
                    </div>
                  </div>
                );
              })}
              {(() => {
                const enEd = lineas.find((l) => l.editando);
                const falta = enEd ? faltaDe(enEd) : null;
                const confirmable = !falta;
                return (
              <div style={{ display: soloVer ? "none" : "flex", gap: 10, alignItems: "center" }}>
                <button ref={agregarRef} title={!confirmable ? `${falta} para agregar otro registro` : enEd ? "Confirmar este registro y agregar otro" : "Agregar registro"}
                  disabled={!confirmable}
                  onClick={() => { if (confirmable) setLineas((ls) => {
                    // el registro nuevo nace con el mismo tipo que el ultimo cargado (venis cargando insumos -> insumo)
                    const ult = ls[ls.length - 1];
                    return [...ls.map((x) => ({ ...x, editando: false })), { tipo: ult ? ult.tipo : "concepto", item: "", neto: "", cant: "", unit: "", alic: ult ? ult.alic : 21, conc: "", pdvDest: (ult && ult.pdvDest) || pdvActual || PDVS[0], editando: true }];
                  }); }}
                  style={{ width: 30, height: 30, borderRadius: 15, border: `1.5px solid ${C.borde}`, background: "#fff", fontSize: 18, fontWeight: 700, color: "#444", cursor: !confirmable ? "not-allowed" : "pointer", opacity: !confirmable ? 0.35 : 1, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>+</button>
                {!confirmable && <span style={{ fontSize: 11.5, color: "#999" }}>{falta} para agregar otro registro</span>}
              </div>
                );
              })()}

            <div style={{ marginTop: 14 }}>
              <span style={lab}>Percepciones</span>
              {percepciones.map((p, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.9fr 24px", gap: 8, alignItems: "center", marginBottom: 8 }}>
                  <select style={sel} value={p.tipo} onChange={(e) => setPercepciones((ps) => ps.map((x, ix) => ix === i ? { ...x, tipo: e.target.value } : x))}>
                    {TIPOS_PERCEPCION.map((t) => <option key={t}>{t}</option>)}
                  </select>
                  <input style={inp} placeholder="Importe $" value={p.importe} onChange={(e) => setPercepciones((ps) => ps.map((x, ix) => ix === i ? { ...x, importe: fmtImp(e.target.value) } : x))} />
                  <span onClick={() => setPercepciones((ps) => ps.filter((_, ix) => ix !== i))} style={{ color: C.gris, cursor: "pointer", textAlign: "center", visibility: soloVer ? "hidden" : "visible" }}>×</span>
                </div>
              ))}
              {!soloVer && <button style={btn(false)} onClick={() => setPercepciones((ps) => [...ps, { tipo: TIPOS_PERCEPCION[0], importe: "" }])}>+ Agregar percepción</button>}
              {soloVer && percepciones.length === 0 && <div style={{ fontSize: 12.5, color: "#aaa" }}>—</div>}
            </div>

            <div style={{ marginTop: 14 }}>
              <span style={lab}>Impuestos internos</span>
              {impIntLineas > 0
                ? <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}><b>{$fmt(impIntLineas)}</b> <span style={{ color: "#999", fontSize: 12 }}>· suma de los impuestos internos cargados por registro</span></div>
                : soloVer ? <div style={{ fontSize: 13, color: impIntG ? "#555" : "#aaa", marginTop: 4 }}>{impIntG ? <b>$ {impIntG}</b> : "—"}</div>
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

            {/* ── Pago al pie (Etapa 4): "Registrar el pago ahora" ── */}
            {vista === "nueva" && (
              <div style={{ marginTop: 12, border: `1.5px solid ${pagarAhora ? "#bae6fd" : C.borde}`, background: pagarAhora ? "#f0f9ff" : "#fff", borderRadius: 11, padding: "10px 14px" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
                  <input type="checkbox" checked={pagarAhora} onChange={(e) => setPagarAhora(e.target.checked)} style={{ width: 15, height: 15 }} />
                  Registrar el pago ahora
                  {!pagarAhora && <span style={{ fontSize: 12, fontWeight: 400, color: "#999" }}>— si no, la factura queda IMPAGA</span>}
                </label>
                {pagarAhora && (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 140px 1fr" + (pidePagoId ? " 160px" : ""), gap: 10, marginTop: 10, alignItems: "end" }}>
                      <div><span style={lab}>Importe</span>
                        <input style={{ ...inp, textAlign: "right" }} value={importePago} placeholder={fmtNum(Math.round(totalFactura * 100) / 100)}
                          title="Vacío = el total de la factura" onChange={(e) => setImportePago(fmtImp(e.target.value))} /></div>
                      <div><span style={lab}>Medio</span>
                        <select style={inp} value={medioPago} onChange={(e) => setMedioPago(e.target.value)}>
                          {mediosPago.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                        </select></div>
                      <div><span style={lab}>Fecha de pago</span>
                        <FechaInput style={inp} iso={fechaPago} onISO={(v) => setFechaPago(v)} /></div>
                      <div><span style={lab}>Paga</span>
                        <select style={inp} value={pagadoPor} onChange={(e) => setPagadoPor(e.target.value)}>{PDVS.map((x) => <option key={x}>{x}</option>)}</select></div>
                      {pidePagoId && <div><span style={lab}>ID</span>
                        <input style={{ ...inp, fontFamily: "monospace" }} value={refPago} placeholder="opcional"
                          onChange={(e) => setRefPago(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} /></div>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "#888", marginTop: 6 }}>
                      {parseImp(importePago) > 0 && parseImp(importePago) < totalFactura - 0.005 ? "Paga una parte: la factura queda PARCIAL."
                        : parseImp(importePago) > totalFactura + 0.005 ? `Salda la factura y ${$fmt(parseImp(importePago) - totalFactura)} quedan a cuenta del proveedor.`
                        : "Salda la factura entera. Se guarda junto con la factura (si el pago no se puede registrar, no se guarda nada)."}
                    </div>
                  </>
                )}
              </div>
            )}
            </>)}

          </>
        ) : (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><span style={lab}>Período</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" tabIndex={-1} title="Mes anterior" onClick={() => elegirPeriodo(moverPeriodo(periodoV, -1))} style={{ ...btn(false), padding: "0 12px", height: 38 }}>‹</button>
                <select style={{ ...sel, fontWeight: 700 }} autoFocus value={periodoV} onChange={(e) => elegirPeriodo(e.target.value)}>
                  {(periodosV.includes(periodoV) ? periodosV : [periodoV, ...periodosV]).map((x) => <option key={x} value={x}>{nombrePeriodo(x)}</option>)}
                </select>
                <button type="button" tabIndex={-1} title="Mes siguiente" onClick={() => elegirPeriodo(moverPeriodo(periodoV, 1))} style={{ ...btn(false), padding: "0 12px", height: 38 }}>›</button>
              </div></div>
            <div><span style={lab}>Fecha del gasto <span style={{ textTransform: "none", fontWeight: 400, letterSpacing: 0 }}>· va al 15, cambiala si querés</span></span>
              <FechaInput tabIndex={-1} style={{ ...inp, color: fechaV === fechaDelPeriodo(periodoV) ? C.gris : C.neg, border: errFecha ? `1.6px solid ${C.rojo}` : inp.border }} iso={fechaV}
                onISO={(v) => { setFechaV(v); setErrFecha(false); }} />
              {errFecha && <div style={{ fontSize: 11, color: C.rojo, fontWeight: 700, marginTop: 3 }}>Falta una fecha válida.</div>}</div>
            {/* Primero el concepto (el rubro se completa solo), después el rubro (Diego, 28/10/2026). */}
            <div><span style={lab}>Concepto</span>
              <Combo opciones={conceptosDe(rubroV)} valor={conceptoV} placeholder="Buscar concepto..." onElegir={(c) => { setConceptoV(c); setRubroV(rubroDe(c) || rubroV); }} /></div>
            <div><span style={lab}>Rubro</span>
              <Combo opciones={rubros} valor={rubroV} placeholder="Buscar rubro..." onElegir={(r) => { setRubroV(r); if (rubroDe(conceptoV) !== r) setConceptoV(""); }} /></div>
            <div style={{ gridColumn: "1 / -1" }}><span style={lab}>Detalle</span>
              <input style={inp} value={detalle} maxLength={200} onChange={(e) => setDetalle(e.target.value)} placeholder="Ej: ferretería, flete, devolución seña cancha" /></div>
            <div><span style={lab}>Importe{importeRevisar && <span style={{ textTransform: "none", fontWeight: 700, letterSpacing: 0, color: "#b45309" }}> · el de {nombrePeriodo(ctx.importeAnterior)}, corregilo</span>}</span>
              <input style={{ ...inp, textAlign: "right", fontWeight: 700, ...(importeRevisar ? { border: "1.6px solid #f59e0b", background: "#fffbeb" } : {}) }} value={importeV} placeholder="0,00"
                onChange={(e) => { setImporteV(fmtImp(e.target.value)); setImporteRevisar(false); }} /></div>
            <div><span style={lab}>PDV del gasto</span>
              <select style={sel} value={pdvV} onChange={(e) => setPdvV(e.target.value)}>{PDVS.map((p) => <option key={p}>{p}</option>)}</select></div>
          </div>

          {/* ── Pago del gasto: tildado de entrada; sin pago queda IMPAGO (Impagas y cta cte de Gastos Varios) ── */}
          <div style={{ marginTop: 12, border: `1.5px solid ${pagarV ? "#bae6fd" : C.borde}`, background: pagarV ? "#f0f9ff" : "#fff", borderRadius: 11, padding: "10px 14px" }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
              <input type="checkbox" checked={pagarV} onChange={(e) => setPagarV(e.target.checked)} style={{ width: 15, height: 15 }} />
              Pagado
              {!pagarV && <span style={{ fontSize: 12, fontWeight: 400, color: "#999" }}>— queda IMPAGO: aparece en Impagas y lo pagás después desde la cta cte de Gastos Varios</span>}
            </label>
            {pagarV && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr" + (pidePagoId ? " 160px" : ""), gap: 10, marginTop: 10, alignItems: "end" }}>
                <div><span style={lab}>Medio</span>
                  <select style={sel} value={medioPago} onChange={(e) => setMedioPago(e.target.value)}>
                    {mediosPago.map((m) => <option key={m.id} value={m.nombre}>{m.nombre}</option>)}
                  </select></div>
                <div><span style={lab}>Fecha de pago</span>
                  <FechaInput style={inp} iso={fechaPago} onISO={(v) => setFechaPago(v)} /></div>
                <div><span style={lab}>Paga</span>
                  <select style={sel} value={pagadoPor} onChange={(e) => setPagadoPor(e.target.value)}>{PDVS.map((x) => <option key={x}>{x}</option>)}</select></div>
                {pidePagoId && <div><span style={lab}>ID</span>
                  <input style={{ ...inp, fontFamily: "monospace" }} value={refPago} placeholder="opcional"
                    onChange={(e) => setRefPago(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} /></div>}
              </div>
            )}
          </div>
          {parecidoV && (
            <div style={{ border: "1.5px solid #f0c179", background: "#fdf8ef", borderRadius: 11, padding: "12px 14px", fontSize: 13, color: "#8a5a00", marginTop: 12 }}>
              ⚠ Ya hay un gasto <b>parecido</b> en {nombrePeriodo(periodoDe(parecidoV.fecha))}: {dmy(parecidoV.fecha)} · {$fmt(parecidoV.importe)}
              {parecidoV.observac ? ` · ${parecidoV.observac}` : ""} ({parecidoV.origen === "lazarillo" ? "cargado en Lazarillo" : "de MaxiRest"}).
              {" "}¿Es otro gasto? <span onClick={() => guardarVario(true)} style={{ fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Sí, cargarlo igual</span>
              {" · "}<span onClick={() => setParecidoV(null)} style={{ cursor: "pointer", color: C.gris }}>No</span>
            </div>
          )}
          </>
        )}

        </fieldset>
        {errores.length > 0 && (
          <div style={{ border: `1.5px solid ${C.rojo}`, background: "#fdf3f3", borderRadius: 11, padding: "10px 14px", marginTop: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.rojo, marginBottom: 4 }}>No se puede guardar todavía:</div>
            {errores.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: C.rojo }}>• {e}</div>)}
          </div>
        )}
        {soloVer ? (
          <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center" }}>
            {editable && <button style={btn(true)} onClick={onEditar}>Editar</button>}
            {onRepetir && <button style={btn(false)} onClick={onRepetir} title="Cargar una factura nueva con esta misma estructura">⟳ Repetir</button>}
            <button style={btn(false)} onClick={onCerrar}>Cerrar</button>
            {editable && <span style={{ marginLeft: "auto" }}>{borrando ? <span style={{ fontSize: 12, color: C.gris }}>Eliminando…</span>
              : pagosAlBorrar ? (
                <span style={{ fontSize: 12.5, color: C.rojo, display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: 560 }}>
                  <span>⚠ Está paga: <b>{$fmt(pagosAlBorrar.importe)}</b> en {pagosAlBorrar.total} pago{pagosAlBorrar.total === 1 ? "" : "s"}.
                    {pagosAlBorrar.internos > 0 && <> Se eliminan también {pagosAlBorrar.internos === 1 ? "el pago cargado" : `los ${pagosAlBorrar.internos} pagos cargados`} en el Panel.</>}
                    {pagosAlBorrar.lazarillo > 0 && <> {pagosAlBorrar.lazarillo === 1 ? "El pago al proveedor cargado en el Panel vuelve" : `Los ${pagosAlBorrar.lazarillo} pagos al proveedor cargados en el Panel vuelven`} a quedar a cuenta.</>}
                    {pagosAlBorrar.maxirest > 0 && <> {pagosAlBorrar.maxirest === 1 ? "El pago" : "Los pagos"} de MaxiRest {pagosAlBorrar.maxirest === 1 ? "queda" : "quedan"} como “solo 80”.</>}
                    {" "}¿Eliminar igual?</span>
                  <span onClick={() => { setPagosAlBorrar(null); eliminar(true); }} style={{ fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Sí, eliminar</span>
                  <span onClick={() => setPagosAlBorrar(null)} style={{ color: C.gris, cursor: "pointer" }}>No</span>
                </span>
              ) : <BtnEliminar onConfirmar={() => eliminar(false)} style={{ fontSize: 13, color: C.rojo }} />}</span>}
          </div>
        ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          {(modo !== "factura" || cuerpoVisible) && <button style={{ ...btn(true), opacity: guardando || yaCargada ? 0.5 : 1 }} disabled={guardando || !!yaCargada} onClick={guardar}>{guardando ? "Guardando…" : "Guardar"}</button>}
          <button style={btn(false)} onClick={onCerrar}>Cancelar</button>
        </div>
        )}
        </>)}
      </div>
    </div>
  );
}

// ============ EMPLEADOS (Diego 28/10/2026) ============
// Sueldo: empleado → período + fecha de pago (hoy) → TOTAL → apertura por concepto de personal,
// cada concepto con sus formas de pago (los adelantos del período se descuentan como forma
// "Adelantos"). Adelanto: concepto fijo. PDV: la regla del empleado; si se cambia, aplica al total.
const ADEL = MEDIO_ADELANTOS;
const periodoHoy = (n = 0) => moverPeriodo(hoyISO().slice(0, 7), n);
function CargaEmpleado({ pdvId, pdvsRef, conceptos, mediosPago, reglaEmpleadoDe, onGuardado, onCerrar }) {
  const queryClient = useQueryClient();
  const [sub, setSub] = useState("sueldo");
  const [codigo, setCodigo] = useState("");
  const [periodo, setPeriodo] = useState(periodoHoy(-1));
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [total, setTotal] = useState("");
  const [lineas, setLineas] = useState(null); // null = se arma sola con el total
  const [importeA, setImporteA] = useState("");
  const [medioA, setMedioA] = useState("");
  const [reparto, setReparto] = useState(null); // null = la regla del empleado
  const [editRep, setEditRep] = useState(false);
  const [errores, setErrores] = useState([]);
  const [parecido, setParecido] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const { data: nomina } = useFetchQuery(["empleados", pdvId], pdvId ? `/api/empleados?pdvId=${pdvId}` : null, { staleTime: 10 * 60_000 });
  const empleados = (nomina && nomina.empleados) || [];
  const etiqueta = (e) => [e.nombre, e.apellido].filter(Boolean).join(" ") + ` (${e.codigo})`;
  const emp = empleados.find((e) => e.codigo === codigo);
  const { data: cuenta } = useFetchQuery(["empleado-cuenta", pdvId, codigo], pdvId && codigo ? `/api/empleados/cuenta?pdvId=${pdvId}&codigo=${encodeURIComponent(codigo)}` : null, { staleTime: 30_000 });
  const delPeriodo = cuenta && cuenta.periodos.find((p) => p.periodo === periodo);
  const adelantos = delPeriodo ? Math.round(delPeriodo.adelantos * 100) / 100 : 0;
  const yaSueldo = delPeriodo && delPeriodo.sueldo > 0.005 ? delPeriodo.sueldo : 0;
  const medios = mediosPago.map((m) => m.nombre);
  const medioDef = medios[0] || "Efectivo";
  // Conceptos de personal (rubros de personal), sin el de adelantos que es fijo.
  const codAdel = nomina && nomina.conceptoAdelanto ? nomina.conceptoAdelanto.codigo : null;
  const opcCon = conceptos.filter((c) => /personal/i.test(c.rubro) && c.codigo !== codAdel);
  const codDe = (nombre) => (opcCon.find((c) => c.nombre === nombre) || {}).codigo;
  const conceptoDef = (opcCon.find((c) => /^liquidaci[oó]n sueldo$/i.test(c.nombre)) || opcCon[0] || {}).nombre || "";
  const totalN = parseImp(total);
  // Mientras no se toque la apertura, sale sola del total: un concepto, adelantos + el resto en el medio por defecto.
  const auto = () => [{ concepto: conceptoDef, importe: total, pagos: [
    ...(adelantos > 0 ? [{ medio: ADEL, importe: fmtNum(adelantos) }] : []),
    ...(totalN - adelantos > 0.004 ? [{ medio: medioDef, importe: fmtNum(Math.round((totalN - adelantos) * 100) / 100) }] : []),
  ] }];
  const ls = lineas || auto();
  const tocar = (f) => setLineas(f(ls.map((l) => ({ ...l, pagos: l.pagos.map((p) => ({ ...p })) }))));
  const regla = emp ? reglaEmpleadoDe(emp.nombre, emp.codigo, fechaPago) : null;
  const pdvNombre = (id) => (pdvsRef.find((p) => p.id === id) || {}).nombre || "?";
  const repVista = reparto || regla;
  const corto = (n) => n.replace("Ramos Mejía", "RM").replace("San Justo", "SJ");

  const payload = (forzar) => {
    const rep = reparto && reparto.filter((x) => parseFloat(x.pct) > 0).length >= 2
      ? reparto.filter((x) => parseFloat(x.pct) > 0).map((x) => ({ puntoDeVentaId: (pdvsRef.find((p) => p.nombre === x.pdv) || {}).id, pct: parseFloat(x.pct) }))
      : null;
    return sub === "sueldo"
      ? { tipo: "sueldo", pdvId, codigo, periodo, fechaPago, total: totalN, reparto: rep, forzar: !!forzar,
          conceptos: ls.map((l) => ({ conceptoCodigo: codDe(l.concepto), importe: parseImp(l.importe), pagos: l.pagos.filter((p) => parseImp(p.importe) > 0).map((p) => ({ medio: p.medio, importe: parseImp(p.importe) })) })) }
      : { tipo: "adelanto", pdvId, codigo, periodo, fechaPago, importe: parseImp(importeA), medio: medioA || medioDef, reparto: rep, forzar: !!forzar };
  };
  const faltan = () => {
    const out = [];
    if (!emp) out.push("Elegí el empleado.");
    if (!fechaValida(fechaPago)) out.push("Falta una fecha de pago válida.");
    if (sub === "adelanto") { if (!(parseImp(importeA) > 0)) out.push("Falta el importe del adelanto."); return out; }
    if (!(totalN > 0)) { out.push("Falta el total del sueldo."); return out; }
    if (ls.some((l) => !codDe(l.concepto))) out.push("Elegí el concepto de cada renglón.");
    const p = payload(false);
    if (!out.length) out.push(...validarSueldo(p, adelantos));
    return out;
  };
  const limpiar = () => { setCodigo(""); setTotal(""); setLineas(null); setImporteA(""); setReparto(null); setEditRep(false); setParecido(null); setErrores([]); };
  const guardar = async (otro, forzar) => {
    const f = faltan();
    if (f.length) { setErrores(f); return; }
    setErrores([]); setGuardando(true);
    try {
      const r = await fetch("/api/empleados", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(forzar)) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 409 && d.parecido) { setParecido({ ...d.parecido, error: d.error, otro }); return; }
      if (!r.ok) { setErrores([d.error || "No se pudo guardar.", ...(d.detalle || [])]); return; }
      setParecido(null);
      for (const k of ["pivot", "detalle", "impagas", "actividad", "sin-carga", "empleado-cuenta", "m-anual", "m-resumen"]) void queryClient.invalidateQueries({ queryKey: [k] });
      const nombre = emp ? etiqueta(emp) : "";
      if (otro) { limpiar(); toast.success(sub === "sueldo" ? "Sueldo cargado" : "Adelanto cargado", { description: `${nombre} · $ ${d.total.toLocaleString("es-AR", { minimumFractionDigits: 2 })}` }); }
      else onGuardado({ empleado: true, tipo: sub, nombre, total: d.total });
    } catch { setErrores(["Error de red: no se guardó."]); }
    finally { setGuardando(false); }
  };
  const anular = async (id) => {
    const r = await fetch(`/api/empleados/${id}`, { method: "DELETE" });
    if (!r.ok) { toast.error("No se pudo anular"); return; }
    toast.success("Carga anulada");
    for (const k of ["pivot", "detalle", "impagas", "actividad", "sin-carga", "empleado-cuenta"]) void queryClient.invalidateQueries({ queryKey: [k] });
  };

  const sumaCon = Math.round(ls.reduce((s, l) => s + parseImp(l.importe), 0) * 100) / 100;
  const sumaPag = Math.round(ls.reduce((s, l) => s + l.pagos.reduce((a, p) => a + parseImp(p.importe), 0), 0) * 100) / 100;
  const ok = (a, b) => Math.abs(a - b) < 0.005;
  const tabsSub = (
    <div style={{ display: "inline-flex", gap: 4, background: C.fondo, borderRadius: 10, padding: 3, marginBottom: 12 }}>
      {[["sueldo", "Sueldo"], ["adelanto", "Adelanto"]].map(([k, t]) => (
        <button key={k} type="button" tabIndex={-1} onClick={() => { setSub(k); setErrores([]); setParecido(null); setPeriodo(periodoHoy(k === "sueldo" ? -1 : 0)); }}
          style={{ border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", background: sub === k ? "#fff" : "transparent", color: sub === k ? C.neg : C.gris, boxShadow: sub === k ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>{t}</button>
      ))}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 16, alignItems: "start" }}>
      <div>
        {tabsSub}
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr", gap: 10 }}>
          <div><span style={lab}>Empleado</span>
            <Combo opciones={empleados.map(etiqueta)} valor={emp ? etiqueta(emp) : ""} placeholder={nomina ? "Buscar empleado..." : "Cargando nómina…"} autoFocus
              onElegir={(t) => { const e = empleados.find((x) => etiqueta(x) === t); setCodigo(e ? e.codigo : ""); setLineas(null); setReparto(null); setEditRep(false); setParecido(null); }} /></div>
          <div><span style={lab}>Período</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" tabIndex={-1} onClick={() => { setPeriodo(moverPeriodo(periodo, -1)); setLineas(null); }} style={{ ...btn(false), padding: "0 12px", height: 38 }}>‹</button>
              <div style={{ ...inp, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{nombrePeriodo(periodo)}</div>
              <button type="button" tabIndex={-1} onClick={() => { setPeriodo(moverPeriodo(periodo, 1)); setLineas(null); }} style={{ ...btn(false), padding: "0 12px", height: 38 }}>›</button>
            </div></div>
          <div><span style={lab}>Fecha de pago</span><FechaInput style={inp} iso={fechaPago} onISO={setFechaPago} /></div>
        </div>

        {/* PDV: la regla del empleado (aplica sobre el total); se puede cambiar para esta carga. */}
        {emp && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: "#2a6b86", background: "#f3fafd", border: "1px solid #bfe0f0", borderRadius: 9, padding: "7px 12px" }}>
            {!editRep ? (
              <span>PDV: {repVista ? <b>⇄ {repVista.map((x) => `${corto(x.pdv)} ${fmtNum(parseFloat(x.pct))}%`).join(" · ")}</b> : <b>{pdvNombre(pdvId)}</b>}
                {" "}<span style={{ color: "#888" }}>{reparto ? "· cambiado para esta carga" : regla ? "· regla del empleado" : "· sin regla"}</span>
                {" "}<span onClick={() => { setReparto((reparto || regla || [{ pdv: pdvNombre(pdvId), pct: 100 }]).map((x) => ({ ...x }))); setEditRep(true); }} style={{ fontWeight: 700, cursor: "pointer", textDecoration: "underline", marginLeft: 6 }}>Cambiar</span>
                {reparto && <span onClick={() => setReparto(null)} style={{ cursor: "pointer", color: "#888", marginLeft: 8 }}>volver a la regla</span>}</span>
            ) : (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                {pdvsRef.map((p) => { const x = (reparto || []).find((r) => r.pdv === p.nombre); return (
                  <label key={p.id} style={{ display: "inline-flex", gap: 5, alignItems: "center" }}>{corto(p.nombre)}
                    <input style={{ ...inp, width: 64, height: 30, textAlign: "right" }} value={x ? x.pct : ""} placeholder="0"
                      onChange={(e) => { const v = e.target.value.replace(/[^0-9.]/g, ""); setReparto((rs) => [...(rs || []).filter((r) => r.pdv !== p.nombre), ...(v ? [{ pdv: p.nombre, pct: v }] : [])]); }} />%</label>); })}
                <span style={{ fontWeight: 700, color: Math.abs((reparto || []).reduce((s, x) => s + (parseFloat(x.pct) || 0), 0) - 100) < 0.01 ? C.verde : C.rojo }}>
                  {fmtNum((reparto || []).reduce((s, x) => s + (parseFloat(x.pct) || 0), 0))}%</span>
                <button type="button" style={{ ...btn(false), padding: "4px 10px" }} onClick={() => { setEditRep(false); const r = (reparto || []).filter((x) => parseFloat(x.pct) > 0);
                  if (r.length < 2 && (!r.length || r[0].pdv === pdvNombre(pdvId)) && !regla) setReparto(null); else setReparto(r); }}>Listo</button>
                <span style={{ color: "#888" }}>Aplica sobre el total (todos los conceptos), solo en esta carga.</span>
              </div>
            )}
          </div>
        )}

        {sub === "adelanto" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
            <div><span style={lab}>Importe</span><input style={{ ...inp, textAlign: "right", fontWeight: 700 }} value={importeA} placeholder="0,00" onChange={(e) => setImporteA(fmtImp(e.target.value))} /></div>
            <div><span style={lab}>Forma de pago</span>
              <select style={sel} value={medioA || medioDef} onChange={(e) => setMedioA(e.target.value)}>{medios.map((m) => <option key={m}>{m}</option>)}</select></div>
            <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#888" }}>Concepto fijo: <b>{nomina && nomina.conceptoAdelanto ? nomina.conceptoAdelanto.nombre : "Adelanto Sueldo"}</b> · va a la cuenta del empleado en {nombrePeriodo(periodo)} y se descuenta del sueldo.</div>
          </div>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 12 }}>
              <div><span style={lab}>Total del sueldo</span><input style={{ ...inp, textAlign: "right", fontWeight: 700, fontSize: 15 }} value={total} placeholder="0,00"
                onChange={(e) => { setTotal(fmtImp(e.target.value)); }} /></div>
              <div><span style={lab}>Adelantos del período</span><div style={{ ...inp, display: "flex", alignItems: "center", color: adelantos ? C.rojo : C.gris, fontWeight: 700 }}>{adelantos ? `− ${$fmt(adelantos)}` : "—"}</div></div>
              <div><span style={lab}>A pagar</span><div style={{ ...inp, display: "flex", alignItems: "center", fontWeight: 700, fontSize: 15 }}>{totalN ? $fmt(Math.max(0, totalN - adelantos)) : "—"}</div></div>
            </div>
            {yaSueldo > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: "#8a5a00" }}>⚠ {nombrePeriodo(periodo)} ya tiene sueldo cargado ({$fmt(yaSueldo)}). Mirá la cuenta a la derecha antes de cargar.</div>}
            <span style={{ ...lab, marginTop: 14 }}>Apertura por concepto y forma de pago</span>
            <div style={{ border: `1px solid ${C.borde}`, borderRadius: 11, padding: "6px 10px" }}>
              {ls.map((l, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.2fr) 130px minmax(0, 2fr) 24px", gap: 8, alignItems: "start", padding: "6px 0", borderBottom: i < ls.length - 1 ? "1px solid #f2f2f0" : "none" }}>
                  <Combo opciones={opcCon.map((c) => c.nombre)} valor={l.concepto} placeholder="Concepto..." onElegir={(v) => tocar((x) => { x[i].concepto = v; return x; })} />
                  <input style={{ ...inp, textAlign: "right" }} value={l.importe} placeholder="0,00" onChange={(e) => { const v = fmtImp(e.target.value); tocar((x) => { x[i].importe = v; if (x[i].pagos.length === 1 && x[i].pagos[0].medio !== ADEL) x[i].pagos[0].importe = v; return x; }); }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {l.pagos.map((p, k) => (
                      <div key={k} style={{ display: "flex", gap: 6 }}>
                        <select style={{ ...sel, ...chico, flex: 1 }} value={p.medio} onChange={(e) => tocar((x) => { x[i].pagos[k].medio = e.target.value; return x; })}>
                          {[...(adelantos > 0 ? [ADEL] : []), ...medios].map((m) => <option key={m}>{m}</option>)}</select>
                        <input style={{ ...inp, ...chico, width: 120, textAlign: "right" }} value={p.importe} placeholder="0,00" onChange={(e) => { const v = fmtImp(e.target.value); tocar((x) => { x[i].pagos[k].importe = v; return x; }); }} />
                        <span onClick={() => tocar((x) => { x[i].pagos.splice(k, 1); return x; })} style={{ cursor: "pointer", color: C.gris, alignSelf: "center" }}>×</span>
                      </div>))}
                    <span onClick={() => tocar((x) => { const rest = parseImp(x[i].importe) - x[i].pagos.reduce((a, p) => a + parseImp(p.importe), 0); x[i].pagos.push({ medio: medioDef, importe: rest > 0 ? fmtNum(Math.round(rest * 100) / 100) : "" }); return x; })}
                      style={{ fontSize: 12, fontWeight: 600, color: "#2a88ad", cursor: "pointer" }}>+ forma de pago</span>
                  </div>
                  <span onClick={() => tocar((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))} title="Quitar concepto" style={{ cursor: "pointer", color: C.gris, paddingTop: 9 }}>×</span>
                </div>))}
              <span onClick={() => tocar((x) => [...x, { concepto: "", importe: "", pagos: [{ medio: medioDef, importe: "" }] }])} style={{ fontSize: 12.5, fontWeight: 600, color: "#2a88ad", cursor: "pointer", display: "inline-block", padding: "6px 0" }}>+ Agregar concepto</span>
            </div>
            {totalN > 0 && (
              <div style={{ display: "flex", gap: 16, fontSize: 12.5, marginTop: 8 }}>
                <span>Conceptos: <b style={{ color: ok(sumaCon, totalN) ? C.verde : C.rojo }}>{$fmt(sumaCon)} de {$fmt(totalN)} {ok(sumaCon, totalN) ? "✓" : "✗"}</b></span>
                <span>Formas de pago: <b style={{ color: ok(sumaPag, totalN) ? C.verde : C.rojo }}>{$fmt(sumaPag)} {ok(sumaPag, totalN) ? "✓" : "✗"}</b></span>
              </div>
            )}
          </>
        )}

        {parecido && (
          <div style={{ border: "1.5px solid #f0c179", background: "#fdf8ef", borderRadius: 11, padding: "10px 14px", fontSize: 13, color: "#8a5a00", marginTop: 12 }}>
            ⚠ {parecido.error}: {$fmt(parecido.importe)}{parecido.fecha ? ` · ${dmy(parecido.fecha)}` : ""} ({parecido.origen === "lazarillo" ? "cargado en Lazarillo" : "de MaxiRest"}). Nunca se duplica: ¿es otro?{" "}
            <span onClick={() => guardar(parecido.otro, true)} style={{ fontWeight: 700, cursor: "pointer", textDecoration: "underline" }}>Sí, cargarlo igual</span>
            {" · "}<span onClick={() => setParecido(null)} style={{ cursor: "pointer", color: C.gris }}>No</span>
          </div>
        )}
        {errores.length > 0 && (
          <div style={{ border: `1.5px solid ${C.rojo}`, background: "#fdf3f3", borderRadius: 11, padding: "10px 14px", marginTop: 12 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: C.rojo, marginBottom: 4 }}>No se puede guardar todavía:</div>
            {errores.map((e, i) => <div key={i} style={{ fontSize: 12.5, color: C.rojo }}>• {e}</div>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={{ ...btn(true), opacity: guardando ? 0.5 : 1 }} disabled={guardando} onClick={() => guardar(false)}>{guardando ? "Guardando…" : "Guardar"}</button>
          <button style={btn(false)} disabled={guardando} onClick={() => guardar(true)}>Guardar y cargar otro empleado</button>
          <button style={btn(false)} onClick={onCerrar}>Cancelar</button>
        </div>
      </div>

      {/* Cuenta del empleado por período */}
      <div style={{ ...card, padding: "12px 14px", fontSize: 12.5 }}>
        <div style={{ fontWeight: 700, fontSize: 13.5 }}>Cuenta {emp ? `· ${[emp.nombre, emp.apellido].filter(Boolean).join(" ")}` : "del empleado"}</div>
        <div style={{ color: C.gris, marginBottom: 6 }}>por período · últimos 12 meses</div>
        {!emp ? <div style={{ color: C.gris }}>Elegí un empleado.</div> : !cuenta ? <div style={{ color: C.gris }}>Cargando…</div>
          : !cuenta.periodos.length ? <div style={{ color: C.gris }}>Sin sueldos ni adelantos cargados.</div>
          : cuenta.periodos.slice(0, 6).map((p) => (
            <div key={p.periodo} style={{ marginTop: 8, background: p.periodo === periodo ? "#f3fafd" : "transparent", borderRadius: 8, padding: "4px 6px" }}>
              <div style={{ fontWeight: 700 }}>{nombrePeriodo(p.periodo)}</div>
              {p.movimientos.map((m, k) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "1px dashed #eee", padding: "2px 0" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dmy(m.fecha)} · {m.concepto}{m.origen === "lazarillo" ? " ·L" : ""}</span>
                  <b style={{ color: m.cod === cuenta.codigoAdelanto ? C.rojo : C.neg, whiteSpace: "nowrap" }}>{$fmt(m.importe)}</b></div>))}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}><span>{p.sueldo > 0.005 ? "Total del período" : "A descontar del sueldo"}</span>
                <b>{$fmt(p.sueldo > 0.005 ? p.sueldo + p.adelantos : p.adelantos)}</b></div>
              {cuenta.cargas.filter((c) => c.periodo === p.periodo).map((c) => (
                <div key={c.id} style={{ fontSize: 11.5, color: C.gris, display: "flex", justifyContent: "space-between" }}>
                  <span>Cargado en Lazarillo: {c.tipo} {$fmt(c.total)}</span>
                  <BtnEliminar onConfirmar={() => anular(c.id)} style={{ fontSize: 11.5, color: C.rojo }} /></div>))}
            </div>))}
      </div>
    </div>
  );
}

export default ModalNuevaCarga;
