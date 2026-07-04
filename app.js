// =========================================================================
    // MOTOR DE BÚSQUEDA AVANZADO Y NORMALIZACIÓN DE TEXTO
    // =========================================================================
    function normalizarTextoLocal(text) {
        if (!text) return "";
        return String(text).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
    }

    function multiWordMatch(query, target) {
        if (!query) return true;
        const targetNorm = normalizarTextoLocal(target);
        const queryTokens = normalizarTextoLocal(query).split(/\s+/);
        return queryTokens.every(token => targetNorm.includes(token));
    }

    // =========================================================================
    // MOTOR DETERMINÍSTICO DE FECHAS (FIX VENCIMIENTOS)
    // =========================================================================
    function parseFechaSeguraUI(str) {
        if (!str) return new Date(0);
        let partes = str.includes('-') ? str.split('-') : str.split('/');
        if (partes.length !== 3) return new Date(str); 

        let d, m, y;
        if (partes[0].length === 4) { // ISO: YYYY-MM-DD
            y = parseInt(partes[0]); m = parseInt(partes[1]) - 1; d = parseInt(partes[2]);
        } else { // Local: DD/MM/YYYY
            d = parseInt(partes[0]); m = parseInt(partes[1]) - 1; y = parseInt(partes[2]);
        }
        return new Date(y, m, d, 12, 0, 0);
    }

    function playAlertSound() {
       try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          const osc = ctx.createOscillator();
          const gainNode = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(880, ctx.currentTime); 
          gainNode.gain.setValueAtTime(0.08, ctx.currentTime); 
          osc.connect(gainNode);
          gainNode.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.2); 
       } catch(e) {}
    }

    function san(str) {
        if(!str) return '';
        var temp = document.createElement('div');
        temp.textContent = str;
        return temp.innerHTML;
    }

    function escJS(str) {
        return String(str)
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/\n/g, '\\n');
    }

    function showToast(title, desc, onClickFallback) {
       const container = document.getElementById('toast-container');
       const toast = document.createElement('div');
       toast.className = 'toast';
       toast.innerHTML = `<button class="toast-close" title="Cerrar">&times;</button><div class="toast-icon">🛎️</div><div class="toast-content"><span class="toast-title">${san(title)}</span><span class="toast-desc">${san(desc)}</span></div>`;
       const closeBtn = toast.querySelector('.toast-close');
       closeBtn.onclick = (e) => { e.stopPropagation(); toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); };
       if(onClickFallback) { toast.onclick = () => { onClickFallback(); toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }; }
       container.appendChild(toast);
       void toast.offsetWidth; 
       toast.classList.add('show');
       playAlertSound();
    }

    const idbName = "JLB_ERP_DB"; const idbStore = "kv_store";
    const idb = {
        async getDb() { return new Promise((resolve, reject) => { let request = indexedDB.open(idbName, 1); request.onupgradeneeded = e => { if (!e.target.result.objectStoreNames.contains(idbStore)) { e.target.result.createObjectStore(idbStore); } }; request.onsuccess = e => resolve(e.target.result); request.onerror = e => reject(e.target.error); }); },
        async get(key) { try { let db = await this.getDb(); return new Promise((resolve, reject) => { let tx = db.transaction(idbStore, "readonly"); let request = tx.objectStore(idbStore).get(key); request.onsuccess = e => resolve(e.target.result); request.onerror = e => reject(e.target.error); }); } catch(e) { return null; } },
        async set(key, value) { try { let db = await this.getDb(); return new Promise((resolve, reject) => { let tx = db.transaction(idbStore, "readwrite"); let request = tx.objectStore(idbStore).put(value, key); request.onsuccess = () => resolve(); request.onerror = e => reject(e.target.error); }); } catch(e) {} },
        async remove(key) { try { let db = await this.getDb(); return new Promise((resolve, reject) => { let tx = db.transaction(idbStore, "readwrite"); let request = tx.objectStore(idbStore).delete(key); request.onsuccess = () => resolve(); request.onerror = e => reject(e.target.error); }); } catch(e) {} }
    };

    let DATA = {}, ITEMS = [], ITEMS_REQ = [], TEMP_REQ_ITEMS = [];
    let currentUser = null, currentRole = null, filtroEquiposActual = 'Todos';
    let isSyncing = false, lastReqId = null; 
    let pollingTimer; 
    let kardexTimer;  
    let MAPA_PRESTAMOS = {}; 
    let lastActivityTime = Date.now();

    // Timers para Debouncing (Protección RAM)
    let debounceTimerStock, debounceTimerEquip, debounceTimerReq, debounceTimerProv, debounceTimerPrecios;

    function resetActivity() { lastActivityTime = Date.now(); }
    window.addEventListener('mousemove', resetActivity);
    window.addEventListener('keydown', resetActivity);
    window.addEventListener('touchstart', resetActivity);

    window.onload = async () => { document.getElementById('fecha').valueAsDate = new Date(); await verificarSesion(); }

    async function verificarSesion() {
      let savedUser = await idb.get('jlb_user');
      let savedRole = await idb.get('jlb_role');
      let loginTs = await idb.get('jlb_login_ts');
      
      if (savedUser && savedRole && loginTs && (Date.now() - loginTs < 43200000)) {
         currentUser = savedUser; currentRole = savedRole; iniciarApp();
      } else {
         await idb.remove('jlb_user'); await idb.remove('jlb_role'); await idb.remove('jlb_login_ts');
         document.getElementById('loginOverlay').style.display = 'flex';
      }
    }

    function intentarLogin() {
      const u = document.getElementById('loginUser').value;
      const p = document.getElementById('loginPass').value;
      const btn = document.getElementById('btnLoginBtn');
      const err = document.getElementById('loginError');
      if(!u || !p) { err.innerText = "Llene ambos campos"; err.style.display = 'block'; return; }
      btn.innerText = "Verificando..."; btn.disabled = true; err.style.display = 'none';

      google.script.run.withSuccessHandler(async (r) => {
         btn.innerText = "INGRESAR"; btn.disabled = false;
         if (r.ok) {
            await idb.set('jlb_user', r.user); await idb.set('jlb_role', r.role); await idb.set('jlb_login_ts', Date.now()); 
            currentUser = r.user; currentRole = r.role;
            try { new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
            document.getElementById('loginOverlay').style.display = 'none'; iniciarApp();
         } else { err.innerText = r.error; err.style.display = 'block'; }
      }).validarLogin(u, p);
    }

    async function cerrarSesion() { await idb.remove('jlb_user'); await idb.remove('jlb_role'); await idb.remove('jlb_login_ts'); await idb.remove('jlb_data_cache'); location.reload(); }

    function iniciarApp() {
      document.getElementById('mainAppContainer').style.display = 'block';
      document.getElementById('headerUserInfo').innerHTML = `👤 ${san(currentUser)} (${san(currentRole)}) <span class="logout-btn" onclick="cerrarSesion()">Salir</span>`;
      cambiarTipoMovimiento(); cargarTodo(); smartPoll();
      window.addEventListener('focus', () => { resetActivity(); if(!isUserBusy() && !isSyncing) sincronizarGlobalSilent(); });
  solicitarPermisoNotificaciones();
}

    function isUserBusy() {
       const modals = document.querySelectorAll('.modal-overlay');
       for(let m of modals) {
           if(window.getComputedStyle(m).display !== 'none') return true;
       }
       const active = document.activeElement;
       if(active && (active.tagName === 'INPUT' || active.tagName === 'SELECT' || active.tagName === 'TEXTAREA')) return true;
       return false;
    }

    function smartPoll() {
        clearTimeout(pollingTimer);
        const now = new Date(); const hour = now.getHours();
        let isWorkingHours = (hour >= 7 && hour < 18);
        if (!isWorkingHours) { pollingTimer = setTimeout(smartPoll, 600000); return; }
        
        let idleTime = Date.now() - lastActivityTime;
        let isIdle = idleTime > (30 * 60 * 1000); 
        let nextInterval = isIdle ? 180000 : 45000; 
        
        if (!isUserBusy()) {
            if(!isSyncing) sincronizarGlobalSilent();
        } else {
            nextInterval = 15000; 
        }
        
        pollingTimer = setTimeout(smartPoll, nextInterval);
    }
    
    function cambiarTipoMovimiento() {
        const tipo = document.getElementById('tipoMovimiento').value;
        const boxE = document.getElementById('boxEntrega'), boxR = document.getElementById('boxRecibe'), lblE = document.getElementById('lblEntrega'), lblR = document.getElementById('lblRecibe');
        if (tipo === "Entrada") {
            lblE.innerText = "Entrega (Técnico)"; lblR.innerText = "Recibe (Firma Automática)";
            boxE.innerHTML = `<select id="responsableSelect"></select>`;
            boxR.innerHTML = `<input type="text" id="responsableFirma" readonly title="Registrado automáticamente con su sesión" value="${san(currentUser)}" style="background-color: #f3f4f6; color: #6b7280; font-weight: 600;">`;
        } else {
            lblE.innerText = "Entrega (Firma Automática)"; lblR.innerText = "Recibe (Técnico)";
            boxE.innerHTML = `<input type="text" id="responsableFirma" readonly title="Registrado automáticamente con su sesión" value="${san(currentUser)}" style="background-color: #f3f4f6; color: #6b7280; font-weight: 600;">`;
            boxR.innerHTML = `<select id="responsableSelect"></select>`;
        }
        if(DATA && DATA.responsables) fill('responsableSelect', DATA.responsables);
    }

    async function cargarTodo() {
      let cachedStr = await idb.get('jlb_data_cache');
      if (cachedStr) {
         try {
            DATA = JSON.parse(cachedStr); precalcularPrestamos(); 
            fill('responsableSelect', DATA.responsables); fill('mantResp', DATA.responsables); fill('admInsUnd', DATA.unidadesCatalogo); fill('editUnidad', DATA.unidadesCatalogo); fill('mUnidad', DATA.unidadesCatalogo); fill('regResp', DATA.responsables); fill('mantEquipo', DATA.equipos);
            if (DATA.requerimientos && DATA.requerimientos.length > 0) lastReqId = DATA.requerimientos[0].id;
            loadNames(); renderHistorial(DATA.movimientos || []); renderStockList(DATA.insumosData || []); renderEquiposList(DATA.equiposData || []); renderHistRegen(DATA.regeneracion || []); renderMant(DATA.mantenimientos || []); renderReq(DATA.requerimientos || []); renderProvs(DATA.proveedores || []); checkStockRegen(); llenarDatalistRequerimientos();
            if(DATA.proyectos && DATA.proyectos.length > 0) document.getElementById('datalistProyectos').innerHTML = DATA.proyectos.map(p => `<option value="${san(p)}">`).join('');
         } catch(e) {}
      }
      sincronizarGlobalSilent();
    }

    function precalcularPrestamos() {
        MAPA_PRESTAMOS = {};
        if(!DATA.movimientos) return;
        for(let j = DATA.movimientos.length - 1; j >= 0; j--) {
            let m = DATA.movimientos[j]; let nomEq = String(m.item).trim().toLowerCase(); let cant = parseFloat(m.cantidad) || 1;
            if(!MAPA_PRESTAMOS[nomEq]) MAPA_PRESTAMOS[nomEq] = {};
            if(m.tipo === "Salida") { let persona = m.responsableRecibe || "Desconocido"; MAPA_PRESTAMOS[nomEq][persona] = (MAPA_PRESTAMOS[nomEq][persona] || 0) + cant; } else if (m.tipo === "Entrada") {
                let persona = m.responsableEntrega || "Desconocido";
                if(MAPA_PRESTAMOS[nomEq][persona]) { MAPA_PRESTAMOS[nomEq][persona] -= cant; if(MAPA_PRESTAMOS[nomEq][persona] <= 0) delete MAPA_PRESTAMOS[nomEq][persona]; } else {
                    let keys = Object.keys(MAPA_PRESTAMOS[nomEq]);
                    if(keys.length > 0) { MAPA_PRESTAMOS[nomEq][keys[0]] -= cant; if(MAPA_PRESTAMOS[nomEq][keys[0]] <= 0) delete MAPA_PRESTAMOS[nomEq][keys[0]]; }
                }
            }
        }
    }

    function go(id, btn) {
      document.querySelectorAll('.content-area').forEach(e=>e.classList.remove('active')); document.getElementById(id).classList.add('active'); document.querySelectorAll('.tab-pc').forEach(b=>b.classList.remove('active')); document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active')); if(btn) btn.classList.add('active');
      if(id === 'tab-req') { document.getElementById('searchReq').value = ''; renderReq(DATA.requerimientos || []); }
      if(id === 'tab-prov') renderProvs(DATA.proveedores || []);
      if(id === 'tab-reg') renderHistorial(DATA.movimientos || []);
      if(id === 'tab-regen') renderHistRegen(DATA.regeneracion || []);
      if(id === 'tab-mant') renderMant(DATA.mantenimientos || []);
      if(id === 'tab-adm') cargarBitacoraUI();
      if(id === 'tab-stock') { 
          filtrarStock(); 
          filtrarEquipos(); 
      }
    }

    function sincronizarGlobalSilent() {
    if (isSyncing) return;
    isSyncing = true;

    google.script.run
        .withFailureHandler(() => {
            isSyncing = false;
        })
        .withSuccessHandler(async (d) => {
            isSyncing = false;

            if (d) {

                let latestServerReqId =
                    (d.requerimientos && d.requerimientos.length > 0)
                        ? d.requerimientos[0].id
                        : null;

                if (
                    lastReqId !== null &&
                    latestServerReqId !== null &&
                    lastReqId !== latestServerReqId
                ) {
                    let existedBefore = DATA.requerimientos
                        ? DATA.requerimientos.some(r => String(r.id) === String(latestServerReqId))
                        : false;

                    if (!existedBefore) {
                        let req = d.requerimientos[0];

                        if (req.cliente !== "Guardando...") {
                            agregarAlerta(
                                '🛒',
                                'Nuevo Pedido',
                                'De: ' + req.cliente + ' · ' + req.prioridad,
                                'pedido'
                            );

                            notificar(
                                '🛒 Nuevo Pedido',
                                'De: ' + req.cliente + ' · ' + req.prioridad,
                                true
                            );

                            showToast(
                                "NUEVO PEDIDO RECIBIDO",
                                `De: ${req.cliente}<br>Prioridad: <b>${req.prioridad}</b>`,
                                () => {
                                    let btnPc = document.getElementById('btnTabReqPC');
                                    let btnMob = document.getElementById('btnNavReqMobile');

                                    go(
                                        'tab-req',
                                        window.innerWidth > 768 ? btnPc : btnMob
                                    );
                                }
                            );
                        }
                    }
                }

                if (latestServerReqId) {
                    lastReqId = latestServerReqId;
                }

                DATA = d;

                precalcularPrestamos();

                await idb.set(
                    'jlb_data_cache',
                    JSON.stringify(d)
                );

                // ───────── Alertas de stock bajo ─────────

                var _stockBajos = (d.insumosData || []).filter(function (i) {
                    return (
                        !i.eliminado &&
                        parseFloat(i.stock) <= parseFloat(i.min) &&
                        parseFloat(i.min) > 0
                    );
                });

                var _nombresLow = _stockBajos.map(function (i) {
                    return i.nombre;
                });

                var _nuevosLow = _nombresLow.filter(function (n) {
                    return _prevLowStock.indexOf(n) === -1;
                });

                if (_nuevosLow.length > 0) {

                    var _msgLow =
                        _nuevosLow.slice(0, 3).join(', ') +
                        (_nuevosLow.length > 3
                            ? ' y ' + (_nuevosLow.length - 3) + ' más'
                            : '');

                    agregarAlerta(
                        '⚠️',
                        'Stock Bajo',
                        _nuevosLow.length + ' insumo(s): ' + _msgLow,
                        'stock'
                    );

                    notificar(
                        '⚠️ Stock Bajo',
                        _msgLow
                    );
                }

                _prevLowStock = _nombresLow;

                if (typeof _renderNotifPanel === "function") {
                    _renderNotifPanel();
                }

                // ───────────────────────────────────────

                if (isUserBusy()) return;

                loadNames();
                checkStockRegen();
                llenarDatalistRequerimientos();

                if (DATA.proyectos && DATA.proyectos.length > 0) {
                    document.getElementById('datalistProyectos').innerHTML =
                        DATA.proyectos
                            .map(p => `<option value="${san(p)}">`)
                            .join('');
                }

                fill('mantEquipo', DATA.equipos);
                fill('responsableSelect', DATA.responsables);
                fill('mantResp', DATA.responsables);
                fill('custTecnico', DATA.responsables);
                fill('admInsUnd', DATA.unidadesCatalogo);
                fill('editUnidad', DATA.unidadesCatalogo);
                fill('mUnidad', DATA.unidadesCatalogo);

                if (document.getElementById('tab-stock').classList.contains('active')) {
                    filtrarEquipos();
                    filtrarStock();
                }

                if (document.getElementById('tab-req').classList.contains('active')) {
                    filtrarPedidos();
                }

                if (document.getElementById('tab-prov').classList.contains('active')) {
                    filtrarProv();
                }

                if (document.getElementById('tab-reg').classList.contains('active')) {
                    renderHistorial(DATA.movimientos || []);
                }

                if (document.getElementById('tab-regen').classList.contains('active')) {
                    renderHistRegen(DATA.regeneracion || []);
                    renderStockContenedores();
                    renderProcesosAbiertos();
                }

                if (document.getElementById('tab-mant').classList.contains('active')) {
                    renderMant(DATA.mantenimientos || []);
                }

                if (document.getElementById('tab-adm').classList.contains('active')) {
                    cargarBitacoraUI();
                }
            }
        })
        .cargarOpciones();
}

    function cargarBitacoraUI() {
        if(currentRole !== "Admin") return;
        const box = document.getElementById('listaBitacora'); box.innerHTML = '<div style="padding:15px; text-align:center; color:#9ca3af;">Actualizando bitácora...</div>';
        google.script.run.withSuccessHandler(data => {
            if(!data || data.length === 0) { box.innerHTML = '<div style="padding:15px; text-align:center; color:#9ca3af;">Sin registros de seguridad recientes.</div>'; return; }
            box.innerHTML = data.map(r => {
                let badgeClass = r.modulo === "PEDIDOS" ? "background:#dbeafe; color:#1e40af" : "background:#fef3c7; color:#a16207";
                return `<div class="audit-row"><div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span class="audit-mod" style="${badgeClass}">${san(r.modulo)} | ${san(r.accion)}</span><span class="audit-fecha">${san(r.fecha)}</span></div><div style="margin-bottom:4px;">Usuario: <span class="audit-user">${san(r.usuario)}</span> editó <b>${san(r.entidad || r.idRef)}</b></div><div style="color:#4b5563; line-height:1.4;">${san(r.detalle).replace(/\n/g, '<br>')}</div><div style="margin-top:4px; font-style:italic; color:#9ca3af;">Motivo: "${san(r.motivo)}"</div></div>`;
            }).join('');
        }).obtenerBitacoraParaAdmin();
    }

    function llenarDatalistRequerimientos() {
       const dl = document.getElementById('datalistInsumosReq'); if(!dl) return;
       let opts = []; if(DATA.insumos) opts = opts.concat(DATA.insumos); if(DATA.equipos) opts = opts.concat(DATA.equipos);
       dl.innerHTML = [...new Set(opts)].map(o => `<option value="${san(o)}">`).join('');
    }

    function guardar() {
      if(!ITEMS.length) return alert("Agrega items");
      const tipoMov = val('tipoMovimiento'); if(!tipoMov || tipoMov === "--") return alert("Seleccione Acción (Salida/Entrada)");
      const rEntrega = tipoMov === "Entrada" ? val('responsableSelect') : currentUser; const rRecibe = tipoMov === "Entrada" ? currentUser : val('responsableSelect');
      
      if (tipoMov === "Salida") {
          let faltantes = [];
          for (let i = 0; i < ITEMS.length; i++) {
              let item = ITEMS[i];
              let ins = DATA.insumosData ? DATA.insumosData.find(x => x.nombre === item.nom) : null;
              let eq  = DATA.equiposData ? DATA.equiposData.find(x => x.nombre === item.nom) : null;

              let stockActual = ins ? parseFloat(ins.stock) : (eq ? parseFloat(eq.stock) : 0);
              let cantReq = parseFloat(item.cant);

              if (cantReq > stockActual) {
                  faltantes.push({
                      nombre: item.nom,
                      faltante: cantReq - stockActual,
                      esInsumo: !!ins,
                      obj: ins || eq
                  });
              }
          }

          if (faltantes.length > 0) {
              let msg = "⚠️ ERROR: STOCK INSUFICIENTE EN SISTEMA\n\n";
              faltantes.forEach(f => msg += `- ${f.nombre}: Faltan ${f.faltante} (Físicamente disponible, pero no en sistema)\n`);
              msg += "\n¿Deseas hacer un AJUSTE EXPRESS para cuadrar el inventario a la realidad física y permitir la salida? (Esta acción quedará registrada bajo tu nombre en la Auditoría).";

              if (confirm(msg)) {
                  const btn = document.getElementById('btnGuardar');
                  btn.disabled = true;
                  btn.innerText = "Ajustando Stock...";

                  let promesasAjuste = faltantes.map(f => {
                      return new Promise((resolve) => {

                          if (!f.obj) {
                              f.obj = {
                                  nombre: f.nombre,
                                  stock: 0,
                                  unidad: 'Und',
                                  min: 0,
                                  estado: 'Bueno',
                                  ubicacion: 'Bodega'
                              };
                              f.esInsumo = true;
                          }

                          let stockBase = parseFloat(f.obj.stock) || 0;
                          let nuevoStock = stockBase + f.faltante;

                          if (f.esInsumo) {
                              let newData = {
                                  nombre: f.obj.nombre,
                                  unidad: f.obj.unidad || 'Und',
                                  stock: nuevoStock,
                                  min: f.obj.min || 0
                              };
                              google.script.run
                                  .withSuccessHandler(resolve)
                                  .withFailureHandler(() => resolve())
                                  .editarInsumo(f.nombre, newData, currentUser);
                          } else {
                              let newData = {
                                  nombre: f.obj.nombre,
                                  estado: f.obj.estado || 'Bueno',
                                  ubicacion: f.obj.ubicacion || 'Bodega',
                                  stock: nuevoStock
                              };
                              google.script.run
                                  .withSuccessHandler(resolve)
                                  .withFailureHandler(() => resolve())
                                  .editarEquipo(f.nombre, newData, currentUser);
                          }
                      });
                  });

                  Promise.all(promesasAjuste).then(() => {
                      faltantes.forEach(f => {
                          if (f.obj) f.obj.stock = (parseFloat(f.obj.stock) || 0) + f.faltante;

                          if (DATA.insumosData && !DATA.insumosData.find(x => x.nombre === f.nombre)) {
                              DATA.insumosData.push({
                                  nombre: f.obj.nombre,
                                  stock: f.obj.stock,
                                  unidad: f.obj.unidad || 'Und',
                                  min: f.obj.min || 0,
                                  eliminado: false
                              });
                          }
                      });

                      btn.disabled = false;
                      btn.innerText = "CONFIRMAR";

                      guardar();
                  });
                  return;
              } else {
                  return;
              }
          }
      }

      const btn = document.getElementById('btnGuardar'); btn.disabled=true; btn.innerText="Procesando...";
      const p = { fecha: val('fecha'), tipoMovimiento: tipoMov, responsable: rEntrega, responsableRecepcion: rRecibe, proyecto: val('proyecto'), sectorDestino: val('sectorDestino'), generarRemision: document.getElementById('generarRemision').checked, observaciones: val('obsGeneral'), items: JSON.stringify(ITEMS.map(i=>`${i.tipo}::${i.nom}::${i.cant}::${i.und}::${i.obs}`)) };
      const backupDATA = JSON.parse(JSON.stringify(DATA)); 
      if (!DATA.movimientos) DATA.movimientos = [];
      ITEMS.forEach(i => {
         DATA.movimientos.unshift({ fecha: p.fecha, tipo: p.tipoMovimiento, item: i.nom, cantidad: i.cant + " " + i.und, responsableEntrega: p.responsable, responsableRecibe: p.responsableRecepcion, proyecto: p.proyecto, id: "" });
         let ins = DATA.insumosData ? DATA.insumosData.find(x => x.nombre === i.nom) : null;
         if (ins) { if (p.tipoMovimiento === "Salida") ins.stock -= parseFloat(i.cant); if (p.tipoMovimiento === "Entrada") ins.stock += parseFloat(i.cant); }
      });
      precalcularPrestamos(); renderHistorial(DATA.movimientos); renderStockList(DATA.insumosData);
      google.script.run.withFailureHandler(err => { DATA = backupDATA; precalcularPrestamos(); renderHistorial(DATA.movimientos); renderStockList(DATA.insumosData); btn.disabled=false; btn.innerText="CONFIRMAR"; alert("Error de red. Cambios revertidos: " + err.message); }).withSuccessHandler(r => {
        btn.disabled=false; btn.innerText="CONFIRMAR"; const msg = document.getElementById('msgBox');
        if(r.ok) { msg.style.display='block'; msg.style.background='#dcfce7'; msg.style.color='#166534'; msg.innerHTML = `✅ Éxito. ` + (r.url ? `<a href="${r.url}" target="_blank"><b>Ver PDF</b></a>` : ''); if(r.alertas && r.alertas.length) { agregarAlerta('⚠️', 'Stock Bajo tras movimiento', r.alertas.join(', '), 'stock'); notificar('⚠️ Stock Bajo', r.alertas.join(', ')); }; ITEMS=[]; renderItems(); sincronizarGlobalSilent(); } else { alert("Error: "+r.error); }
      }).registrarMovimiento(p);
    }

    function renderHistorial(l) {
      const tb = document.getElementById('tablaHistorialBody'); if(!l || !l.length) { tb.innerHTML='<tr><td colspan="8" style="text-align:center">Sin datos</td></tr>'; return; }
      tb.innerHTML = l.map(r => `<tr><td>${san(r.fecha)}</td><td><span class="tag ${san(r.tipo).toLowerCase()}">${san(r.tipo)}</span></td><td>${san(r.item)}</td><td>${san(r.cantidad)}</td><td>${san(r.responsableEntrega || '-')}</td><td>${san(r.responsableRecibe || '-')}</td><td>${san(r.proyecto)}</td><td>${r.id ? `<button class="btn-icon" style="color:red" onclick="eliminarMov('${r.id}', '${san(r.item)}', '${san(r.cantidad)}', '${san(r.tipo)}')">🗑️</button>` : ''}</td></tr>`).join('');
    }

    function eliminarMov(id, nom, cant, tip) { 
       if(confirm("¿Eliminar este registro? Esta acción quedará auditada bajo su nombre.")) {
          let categoriaReal = "Insumo";
          if (DATA.equiposData && DATA.equiposData.some(e => e.nombre === nom)) { categoriaReal = "Equipo"; }
          const backupDATA = JSON.parse(JSON.stringify(DATA));
          if(DATA.movimientos) DATA.movimientos = DATA.movimientos.filter(x => String(x.id) !== String(id));
          precalcularPrestamos(); renderHistorial(DATA.movimientos);
          google.script.run.withFailureHandler(err => { DATA = backupDATA; precalcularPrestamos(); renderHistorial(DATA.movimientos); alert("Error de red: " + err.message); }).withSuccessHandler(r=>{ if(r.ok){sincronizarGlobalSilent();}else alert(r.error) }).eliminarMovimiento(id, categoriaReal, nom, cant, tip, currentUser); 
       }
    }

    function loadRegenInsumos() { let keys = DATA.insumos || []; if(!keys.length) keys.push("Sin insumos"); fill('regInsumo', keys); checkStockRegen(); }
    function checkStockRegen() { const nom = val('regInsumo'); const stock = DATA.mapaStockInsumos ? DATA.mapaStockInsumos[nom] : 0; const und = DATA.mapaUnidadesInsumos ? DATA.mapaUnidadesInsumos[nom] : 'Und'; document.getElementById('regUnd').value = und; document.getElementById('regStockInfo').style.display = 'block'; document.getElementById('regStockInfo').innerHTML = `📦 Stock Disponible: <b>${stock||0} ${und||''}</b>`; }
    
    function guardarRegen() {
       const trafo = val('regTrafo'), ins = val('regInsumo'), cant = val('regCant'), und = val('regUnd'), resp = val('regResp');
       if(!trafo) return alert("Falta número de Trafo"); if(!ins || !cant) return alert("Completa cantidad e insumo");
       const btn = document.getElementById('btnRegen'); btn.disabled = true; btn.innerText = "Guardando..."; const fechaStr = document.getElementById('fecha').value; 
       const backupDATA = JSON.parse(JSON.stringify(DATA));
       if(!DATA.regeneracion) DATA.regeneracion = [];
       DATA.regeneracion.unshift({ id: "...", fecha: fechaStr, trafo: trafo, insumo: ins, cant: cant + " " + und, resp: resp }); renderHistRegen(DATA.regeneracion);
       google.script.run.withFailureHandler(err => { DATA = backupDATA; renderHistRegen(DATA.regeneracion); btn.disabled=false; btn.innerText="REGISTRAR CONSUMO"; alert("Error: " + err.message); }).withSuccessHandler(r => {
          btn.disabled = false; btn.innerText = "REGISTRAR CONSUMO";
          if(r.ok) { alert(r.alerta ? "Guardado con Alerta: " + r.alerta : "✅ Consumo registrado"); document.getElementById('regTrafo').value = ""; document.getElementById('regCant').value = ""; sincronizarGlobalSilent(); } else { alert("Error: " + r.error); }
       }).registrarRegeneracion({ fecha: fechaStr, nroTrafo: trafo, insumo: ins, cantidad: cant, unidad: und, responsable: resp });
    }

    function renderHistRegen(l) {
       const tb = document.getElementById('tbRegen'); if(!l || !l.length) { tb.innerHTML='<tr><td colspan="5" style="text-align:center">Sin datos</td></tr>'; return; }
       tb.innerHTML = l.map(r => `<tr><td>${san(r.fecha)}</td><td>${san(r.trafo)}</td><td>${san(r.insumo)}</td><td>${san(r.cant)}</td><td>${san(r.resp)}</td></tr>`).join('');
    }

    function calcularProximoMant() {
        const fRealizado = document.getElementById('mantFechaRealizado').value;
        const frec = document.getElementById('mantFrecuencia').value;
        if (!fRealizado || !frec) return;
        const partes = fRealizado.split('-');
        let dBase = new Date(parseInt(partes[0]), parseInt(partes[1]) - 1, parseInt(partes[2]), 12, 0, 0);
        dBase.setMonth(dBase.getMonth() + parseInt(frec));
        const yyyy = dBase.getFullYear();
        const mm = String(dBase.getMonth() + 1).padStart(2, '0');
        const dd = String(dBase.getDate()).padStart(2, '0');
        document.getElementById('mantFechaProximo').value = `${yyyy}-${mm}-${dd}`;
    }

    function guardarMant() {
       const p = { equipo: val('mantEquipo'), tipo: val('mantTipo'), fechaRealizado: val('mantFechaRealizado'), fechaProximo: val('mantFechaProximo'), responsable: val('mantResp'), observaciones: val('mantObs') };
       if (!p.fechaRealizado || !p.fechaProximo) return alert("⚠️ ALERTA DE SEGURIDAD:\nNo puedes registrar un mantenimiento sin fecha de realización y frecuencia.");
       
       const btn = document.querySelector('#tab-mant .btn-primary'); btn.innerText = "Guardando..."; btn.disabled = true;
       const backupDATA = JSON.parse(JSON.stringify(DATA));
       if(!DATA.mantenimientos) DATA.mantenimientos = [];
       DATA.mantenimientos.unshift({ id: "...", fechaReg: "Ahora", equipo: p.equipo, tipo: p.tipo, fechaRealizado: p.fechaRealizado, fechaProximo: p.fechaProximo, responsable: p.responsable, observaciones: p.observaciones });
       renderMant(DATA.mantenimientos);
       google.script.run.withFailureHandler(err => { DATA = backupDATA; renderMant(DATA.mantenimientos); btn.disabled=false; btn.innerText="REGISTRAR"; alert("Error: " + err.message); }).withSuccessHandler(r => {
          btn.disabled = false; btn.innerText = "REGISTRAR";
          if(r.ok) { alert("Mantenimiento registrado"); document.getElementById('mantObs').value=""; document.getElementById('mantFechaRealizado').value=""; document.getElementById('mantFrecuencia').value=""; document.getElementById('mantFechaProximo').value=""; sincronizarGlobalSilent(); } else { alert("Error: " + r.error); }
       }).guardarMantenimiento(p);
    }

    function renderMant(list) {
       const tb = document.getElementById('tbMant'); if(!list || !list.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center">Sin registros</td></tr>'; return; }
       const ahora = new Date(); ahora.setHours(12,0,0,0);
       tb.innerHTML = list.map(m => {
          const fVenc = parseFechaSeguraUI(m.fechaProximo);
          const diffMs = fVenc.getTime() - ahora.getTime();
          const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
          let clase = "sem-verde"; let estadoTxt = "Al día"; if(diffDias < 0) { clase = "sem-rojo"; estadoTxt = "VENCIDO"; } else if(diffDias <= 15) { clase = "sem-amarillo"; estadoTxt = "Por vencer"; }
          return `<tr><td><span class="tag ${clase}">${estadoTxt}</span></td><td><b>${san(m.equipo)}</b></td><td>${san(m.tipo)}</td><td>${san(m.fechaProximo)}</td><td>${san(m.responsable)}</td><td><button class="btn-icon" style="color:red" onclick="delMant('${m.id}')">🗑️</button></td></tr>`;
       }).join('');
    }
    
    function delMant(id) { 
       if(confirm("¿Borrar registro?")) {
          const backupDATA = JSON.parse(JSON.stringify(DATA));
          if(DATA.mantenimientos) DATA.mantenimientos = DATA.mantenimientos.filter(x => String(x.id) !== String(id));
          renderMant(DATA.mantenimientos);
          google.script.run.withFailureHandler(e=>{DATA=backupDATA;renderMant(DATA.mantenimientos);}).withSuccessHandler(sincronizarGlobalSilent).eliminarMantenimiento(id); 
       }
    }

    function toggleFormReq() { const f = document.getElementById('formReqContainer'); f.style.display = (f.style.display === 'none' || f.style.display === '') ? 'block' : 'none'; }
    function toggleHistorialReq() { const div = document.getElementById('listaReqHistorial'); const arrow = document.getElementById('historialArrow'); if(div.style.display === 'none') { div.style.display = 'grid'; arrow.innerText = '▲'; } else { div.style.display = 'none'; arrow.innerText = '▼'; } }
    
    // =========================================================================
    // FILTROS REFACTORIZADOS CON MOTOR AVANZADO Y DEBOUNCE
    // =========================================================================
    function filtrarPedidos() {
       clearTimeout(debounceTimerReq);
       debounceTimerReq = setTimeout(() => {
           const txt = document.getElementById('searchReq').value;
           if (!DATA.requerimientos) return;
           if (txt.trim() === "") { renderReq(DATA.requerimientos); return; }
           const filtrados = DATA.requerimientos.filter(r => multiWordMatch(txt, r.cliente || '') || multiWordMatch(txt, String(r.id || '')) || multiWordMatch(txt, r.resumen || ''));
           renderReq(filtrados);
       }, 250);
    }
    
    function filtrarProv() { 
       clearTimeout(debounceTimerProv);
       debounceTimerProv = setTimeout(() => {
           const txt = document.getElementById('searchProv').value; 
           if(DATA.proveedores) { 
               const filtrados = DATA.proveedores.filter(p => multiWordMatch(txt, p.nombre || '') || multiWordMatch(txt, p.contacto || '') || multiWordMatch(txt, p.productos || '')); 
               renderProvs(filtrados); 
           }
       }, 250);
    }

    function filtrarStock() { 
       clearTimeout(debounceTimerStock);
       debounceTimerStock = setTimeout(() => {
           const txt = document.getElementById('searchStock').value; 
           if(DATA.insumosData) renderStockList(DATA.insumosData.filter(i => multiWordMatch(txt, i.nombre))); 
       }, 250);
    }
    
    function filtrarEquipos() { 
       clearTimeout(debounceTimerEquip);
       debounceTimerEquip = setTimeout(() => {
           const txt = document.getElementById('searchEquip').value; 
           if(DATA.equiposData) renderEquiposList(DATA.equiposData.filter(i => multiWordMatch(txt, i.nombre))); 
       }, 250);
    }

    // =========================================================================
    // REDONDEO SEGURO DE PRECIOS (FIX DECIMALES IEEE 754)
    // =========================================================================
    function parseSafeMonto(monto) {
        let val = parseFloat(monto) || 0;
        return Math.round((val + Number.EPSILON) * 100) / 100;
    }

    function filtrarPrecios() {
       clearTimeout(debounceTimerPrecios);
       debounceTimerPrecios = setTimeout(() => {
           const txt = document.getElementById('inputSearchPrecios').value; 
           const tb = document.getElementById('tbSearchPrecios');
           if(!txt || txt.trim().length < 2) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999">Escribe al menos 2 letras...</td></tr>'; return; }
           let resultados = [];
           if(DATA.requerimientos) { DATA.requerimientos.forEach(req => { if(req.itemsData && Array.isArray(req.itemsData)) { req.itemsData.forEach(item => { if(item.nom && multiWordMatch(txt, item.nom)) { resultados.push({ fecha: req.fecha, nom: item.nom, cant: item.cant + " " + item.und, precio: item.precio || 0, proveedor: item.proveedor || "-", cliente: req.cliente }); } }); } }); }
           if(!resultados.length) { tb.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#999">No se encontraron compras previas.</td></tr>'; return; }
           tb.innerHTML = resultados.map(r => `<tr><td style="font-size:11px">${san(r.fecha)}</td><td style="font-weight:600">${san(r.nom)}</td><td style="font-size:11px; text-align:center">${san(r.cant)}</td><td style="color:#059669; font-weight:bold">$${parseSafeMonto(r.precio).toLocaleString('es-CO')}</td><td style="font-size:11px">${san(r.proveedor)}</td><td style="font-size:11px; color:#666">${san(r.cliente)}</td></tr>`).join('');
       }, 250);
    }

    function addReqItem() { 
       const n = val('reqItemNom'), c = val('reqItemCant'), u = val('reqItemUnd'); 
       if(!n) return alert("Falta nombre"); 
       let nomNorm = n.trim().toLowerCase().replace(/[ \t]+/g, ' '); let itemDB = DATA.dbItems ? DATA.dbItems[nomNorm] : null;
       let p = itemDB ? itemDB.precio : 0; let prov = itemDB ? itemDB.prov : ""; let finalU = u || (itemDB ? itemDB.und : "Und");
       let esSugerido = p > 0; let tieneIva = document.getElementById('reqItemIva').checked;
       ITEMS_REQ.push({nom:n, cant:parseSafeMonto(c||1), und:finalU, precio:parseSafeMonto(p), proveedor:prov, listo:false, sugerido:esSugerido, iva:tieneIva}); 
       document.getElementById('reqItemNom').value=""; document.getElementById('reqItemCant').value=""; document.getElementById('reqItemUnd').value=""; document.getElementById('reqItemIva').checked=false;
       renderItemsReq(); 
    }
    
    function renderItemsReq() { 
       document.getElementById('listaItemsReq').innerHTML = ITEMS_REQ.length ? ITEMS_REQ.map((i,x) => {
          let sub = (parseFloat(i.precio)||0) * (parseFloat(i.cant)||1); if (i.iva) sub = sub * 1.19; 
          sub = parseSafeMonto(sub);
          let badgeP = i.sugerido ? `<span style="color:#dc2626; font-size:10px; margin-left:5px; font-weight:bold;">(Sugerido)</span>` : '';
          let badgeIva = i.iva ? `<span style="color:#0369a1; font-size:10px; margin-left:5px; font-weight:bold;">[+IVA]</span>` : '';
          return `<div class="badge-item"><div>- ${san(i.nom)} (${san(i.cant)} ${san(i.und)}) ${badgeIva} ${badgeP} <span style="color:#059669; font-weight:bold;">$${sub.toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:2})}</span></div><button class="btn-icon" style="color:#ef4444" onclick="ITEMS_REQ.splice(${x},1);renderItemsReq()">×</button></div>`;
       }).join('') : '<div style="color:#aaa;text-align:center;font-size:12px;padding:10px">Agrega ítems arriba</div>'; 
    }
    
    function guardarReq() { 
       if(document.getElementById('reqItemNom').value.trim() !== "") { addReqItem(); }
       if(!val('reqCliente')) return alert("Por favor ingresa el Cliente o Referencia."); if(!ITEMS_REQ.length) return alert("Debes agregar al menos un artículo a la lista usando el botón '+'."); 
       const btn = document.getElementById('btnGuardarReq'); btn.innerText = "Enviando..."; btn.disabled = true;
       const payload = { cliente: val('reqCliente'), prioridad: val('reqPrioridad'), itemsTexto: JSON.stringify(ITEMS_REQ) };
       const backupDATA = JSON.parse(JSON.stringify(DATA));
       if(!DATA.requerimientos) DATA.requerimientos = [];
       DATA.requerimientos.unshift({ id: "...", fecha: "Ahora", cliente: payload.cliente, prioridad: payload.prioridad, estado: "Pendiente", valor: 0, resumen: "Guardando...", itemsData: [...ITEMS_REQ], notas: "", editado: false, enviadoContabilidad: false });
       renderReq(DATA.requerimientos);
       google.script.run.withFailureHandler(err => { DATA=backupDATA; renderReq(DATA.requerimientos); alert("Error guardando: " + err.message); btn.disabled=false; btn.innerText="ENVIAR SOLICITUD"; }).withSuccessHandler(r=>{
           btn.innerText = "ENVIAR SOLICITUD"; btn.disabled = false;
           if(r.ok){ alert("Solicitud Enviada"); ITEMS_REQ=[]; renderItemsReq(); document.getElementById('reqCliente').value=''; toggleFormReq(); sincronizarGlobalSilent(); } else { alert("Error: " + r.error); }
       }).guardarRequerimiento(payload); 
    }

    function renderReq(l) { 
       if (!l || l.length === 0) { document.getElementById('listaReqActivos').innerHTML = '<div style="padding:20px; color:#666;">No hay coincidencias.</div>'; document.getElementById('listaReqHistorial').innerHTML = '<div style="padding:20px; color:#666;">No hay coincidencias.</div>'; return; }
       const activos = l.filter(r => !['Comprado', 'Terminado'].includes(r.estado)); const historial = l.filter(r => ['Comprado', 'Terminado'].includes(r.estado));
       const ordenPrio = { "Urgente": 0, "Alta": 1, "Media": 2, "Baja": 3 };
       activos.sort((a, b) => { const keyA = a.prioridad ? a.prioridad.split(' ')[0] : 'Media'; const keyB = b.prioridad ? b.prioridad.split(' ')[0] : 'Media'; return (ordenPrio[keyA]||9) - (ordenPrio[keyB]||9); });
       renderReqGrid('listaReqActivos', activos); renderReqGrid('listaReqHistorial', historial);
    }

function renderReqGrid(containerId, list) {
       const container = document.getElementById(containerId);
       if(!list.length) { container.innerHTML = '<div style="color:#999; padding:20px">Sección vacía.</div>'; return; }
       container.innerHTML = list.map(r => {
           try {
             const prio = (r.prioridad || "Media").split(' ')[0].toLowerCase(); const est = (r.estado || "Pendiente").toLowerCase().replace(/\s+/g, "-");
             let resumenChuleado = san(r.resumen || "Sin detalles").replace(/\n/g, '<br>').replace(/✅/g, '<span style="color:#10b981; font-weight:bold;">✅</span>');
             
             let totalCalculado = 0;
             if(r.itemsData && Array.isArray(r.itemsData)) {
                 r.itemsData.forEach(i => {
                     let hasIva = (i.iva === true || String(i.iva).toLowerCase() === "true");
                     totalCalculado += (parseFloat(i.precio) || 0) * (parseFloat(i.cant) || 1) * (hasIva ? 1.19 : 1);
                 });
             }
             totalCalculado = parseSafeMonto(totalCalculado);

             const colorTotal = r.itemsData && r.itemsData.some(i => i.sugerido) ? 'color: #dc2626;' : 'color: #059669;';
             const iconoAlerta = r.itemsData && r.itemsData.some(i => i.sugerido) ? `<span title="Contiene precios sugeridos">⚠️</span>` : '';
             
             return `<div class="req-card p-${prio}"><div class="req-header"><div><div class="req-title">${san(r.cliente)}</div><div class="req-date">${san(r.fecha)}</div></div><div style="text-align:right"><span class="tag ${prio}">${san(r.prioridad)}</span>${r.editado ? `<span class="tag editado">[⚠️ EDIT]</span>` : ''}</div></div><div class="req-summary">${resumenChuleado}</div><div><span class="status-badge st-${est}">${san(r.estado)}</span></div><div class="req-footer"><div class="req-total" style="${colorTotal}">${iconoAlerta}$${totalCalculado.toLocaleString('es-CO')}</div><div><button class="btn-icon" style="color:var(--primary)" onclick="openEditReq('${r.id}')">⚙️</button><button class="btn-icon" style="color:red" onclick="delReq('${r.id}')">🗑️</button></div></div></div>`;
           } catch(e) { return ''; }
       }).join('');
    }

    function openEditReq(id) {
       const req = DATA.requerimientos.find(x => String(x.id) === String(id)); if(!req) return alert("Pedido no encontrado.");
       document.getElementById('reqEditId').value = req.id; document.getElementById('reqEditCliente').value = req.cliente || ''; document.getElementById('reqEditPrioridad').value = req.prioridad ? req.prioridad.split(' ')[0] : 'Media'; document.getElementById('reqEditEstado').value = req.estado || 'Pendiente'; document.getElementById('reqEditNotas').value = req.notas || ''; document.getElementById('reqEditContabilidad').checked = req.enviadoContabilidad === true; document.getElementById('reqMotivoContainer').style.display = 'none'; document.getElementById('reqEditMotivo').value = '';
       try { TEMP_REQ_ITEMS = JSON.parse(JSON.stringify(req.itemsData || [])); window.ORIGINAL_REQ_ITEMS = JSON.parse(JSON.stringify(req.itemsData || [])); } catch(e) { TEMP_REQ_ITEMS = []; window.ORIGINAL_REQ_ITEMS = []; }
       renderEditTable(); document.getElementById('modalEditReq').style.display = 'flex';
    }

    function checkItemsChanged() {
       if(!window.ORIGINAL_REQ_ITEMS || !TEMP_REQ_ITEMS) return false;
       if(window.ORIGINAL_REQ_ITEMS.length !== TEMP_REQ_ITEMS.length) return true;
       for(let i=0; i<TEMP_REQ_ITEMS.length; i++) {
           let n = TEMP_REQ_ITEMS[i]; let o = window.ORIGINAL_REQ_ITEMS[i];
           if(!o || n.nom !== o.nom || n.cant !== o.cant || n.precio !== o.precio || n.listo !== o.listo || n.iva !== o.iva) return true;
       }
       return false;
    }

    function triggerAuditUI() {
        let changed = checkItemsChanged(); document.getElementById('reqMotivoContainer').style.display = changed ? 'block' : 'none'; document.querySelector('#modalEditReq .btn-primary').disabled = (changed && !val('reqEditMotivo').trim());
    }

    function addEditReqItem() {
       const n = val('reqEditItemNom'), c = val('reqEditItemCant'), u = val('reqEditItemUnd');
       if(!n) return alert("Falta nombre del artículo");
       let nomNorm = n.trim().toLowerCase().replace(/[ \t]+/g, ' '); let itemDB = DATA.dbItems ? DATA.dbItems[nomNorm] : null;
       let p = itemDB ? itemDB.precio : 0; let prov = itemDB ? itemDB.prov : ""; let finalU = u || (itemDB ? itemDB.und : "Und");
       let esSugerido = p > 0; let tieneIva = document.getElementById('reqEditItemIva').checked;
       TEMP_REQ_ITEMS.push({nom:n, cant:parseSafeMonto(c||1), und:finalU, precio:parseSafeMonto(p), proveedor:prov, listo:false, sugerido:esSugerido, iva:tieneIva});
       document.getElementById('reqEditItemNom').value = ""; document.getElementById('reqEditItemCant').value = ""; document.getElementById('reqEditItemUnd').value = ""; document.getElementById('reqEditItemIva').checked = false;
       renderEditTable(); triggerAuditUI();
    }

    function removeEditReqItem(idx) { TEMP_REQ_ITEMS.splice(idx, 1); renderEditTable(); triggerAuditUI(); }

   function renderEditTable() {
       const tb = document.getElementById('reqItemsTableBody'); let total = 0;
       if(!TEMP_REQ_ITEMS.length) { tb.innerHTML = '<tr><td colspan="7" style="text-align:center;">Sin detalles</td></tr>'; document.getElementById('reqEditTotalDisplay').innerHTML = "<span style='color:#059669'>$0</span>"; return; }
       tb.innerHTML = TEMP_REQ_ITEMS.map((item, idx) => {
          let hasIva = (item.iva === true || String(item.iva).toLowerCase() === "true");
          let isListo = (item.listo === true || String(item.listo).toLowerCase() === "true");
          total += (parseFloat(item.precio)||0) * (parseFloat(item.cant)||1) * (hasIva ? 1.19 : 1);
          return `<tr><td><input type="text" class="req-edit-input" value="${san(item.nom)}" onchange="updateItemNom(${idx}, this.value)"></td><td style="text-align:center"><input type="number" class="req-edit-input" style="width:60px" value="${item.cant}" onchange="updateItemCant(${idx}, this.value)"></td><td><input type="number" class="price-input" value="${item.precio||0}" onchange="updateItemPrice(${idx}, this.value)"></td><td style="text-align:center"><input type="checkbox" ${hasIva?'checked':''} onchange="updateItemIva(${idx}, this.checked)"></td><td><input type="text" class="prov-input" value="${san(item.proveedor||'')}" onchange="updateItemProv(${idx}, this.value)"></td><td style="text-align:center"><input type="checkbox" ${isListo?'checked':''} onchange="updateItemCheck(${idx}, this.checked)"></td><td><button class="btn-icon" style="color:red" onclick="removeEditReqItem(${idx})">🗑️</button></td></tr>`;
       }).join('');
       document.getElementById('reqEditTotalDisplay').innerHTML = `<b>$${parseSafeMonto(total).toLocaleString('es-CO',{minimumFractionDigits:0,maximumFractionDigits:2})}</b>`;
    }

    function updateItemNom(idx, val) { TEMP_REQ_ITEMS[idx].nom = val; triggerAuditUI(); renderEditTable(); }
    function updateItemCant(idx, val) { TEMP_REQ_ITEMS[idx].cant = parseSafeMonto(val)||0; renderEditTable(); triggerAuditUI(); }
    function updateItemPrice(idx, val) { TEMP_REQ_ITEMS[idx].precio = parseSafeMonto(val)||0; renderEditTable(); triggerAuditUI(); }
    function updateItemIva(idx, checked) { TEMP_REQ_ITEMS[idx].iva = checked; renderEditTable(); triggerAuditUI(); }
    function updateItemProv(idx, val) { TEMP_REQ_ITEMS[idx].proveedor = val; triggerAuditUI(); }
    function updateItemCheck(idx, checked) { TEMP_REQ_ITEMS[idx].listo = checked; triggerAuditUI(); }

function guardarGestionReq() {
       if(checkItemsChanged() && !val('reqEditMotivo').trim()) return alert("Escribe la justificación de los cambios.");
       const btn = document.querySelector('#modalEditReq .btn-primary'); btn.innerText = "Guardando..."; btn.disabled = true;
       
       let totalFinal = 0; 
       if(TEMP_REQ_ITEMS) { 
           TEMP_REQ_ITEMS.forEach(i => { 
               let hasIva = (i.iva === true || String(i.iva).toLowerCase() === "true"); 
               totalFinal += (parseFloat(i.precio) || 0) * (parseFloat(i.cant) || 1) * (hasIva ? 1.19 : 1); 
           }); 
       }
       totalFinal = parseSafeMonto(totalFinal);

       const backupDATA = JSON.parse(JSON.stringify(DATA)); 
       google.script.run
         .withFailureHandler(err => { 
             DATA = backupDATA; 
             renderReq(DATA.requerimientos); 
             btn.disabled = false; 
             btn.innerText = "GUARDAR CAMBIOS"; 
             alert("Error: " + err.message); 
         })
         .withSuccessHandler(r => { 
             btn.disabled = false;
             btn.innerText = "GUARDAR CAMBIOS";
             if(r.ok) { 
                 const reqId = val('reqEditId');
                 if(DATA.requerimientos) {
                     const reqLocal = DATA.requerimientos.find(x => String(x.id) === String(reqId));
                     if(reqLocal) {
                         reqLocal.valor = totalFinal;
                         reqLocal.estado = val('reqEditEstado');
                         reqLocal.cliente = val('reqEditCliente');
                         reqLocal.prioridad = val('reqEditPrioridad');
                         reqLocal.notas = val('reqEditNotas');
                         reqLocal.itemsData = JSON.parse(JSON.stringify(TEMP_REQ_ITEMS));
                         reqLocal.enviadoContabilidad = document.getElementById('reqEditContabilidad').checked;
                     }
                 }
                 document.getElementById('modalEditReq').style.display = 'none'; 
                 renderReq(DATA.requerimientos);
                 sincronizarGlobalSilent(); 
             } else { 
                 DATA = backupDATA;
                 renderReq(DATA.requerimientos);
                 alert(r.error); 
             } 
         })
         .actualizarDetallePedido(
             val('reqEditId'), 
             val('reqEditCliente'), 
             val('reqEditPrioridad'), 
             val('reqEditEstado'), 
             totalFinal, 
             JSON.stringify(TEMP_REQ_ITEMS), 
             val('reqEditNotas'), 
             val('reqEditMotivo'), 
             currentUser, 
             document.getElementById('reqEditContabilidad').checked
         );
    }
    
    function delReq(id){ if(confirm("¿Eliminar pedido?")) google.script.run.withSuccessHandler(sincronizarGlobalSilent).eliminarRequerimiento(id, currentUser); }

    function openSearchPrecios() { document.getElementById('inputSearchPrecios').value = ""; document.getElementById('tbSearchPrecios').innerHTML = '<tr><td colspan="6" style="text-align:center;">Busca un producto...</td></tr>'; document.getElementById('modalSearchPrecios').style.display = 'flex'; }

    function renderProvs(l) { 
       document.getElementById('listaProveedores').innerHTML = l.map((p, i) => `<div class="prov-card"><b>${san(p.nombre)}</b><br><span style="font-size:12px; color:#666">📞 ${san(p.contacto)}</span><div class="prov-actions"><button class="btn-icon" onclick="editProv(${i})">✏️</button><button class="btn-icon" style="color:red" onclick="delProv('${p.id}')">🗑️</button></div></div>`).join(''); 
    }

    function editProv(i){ document.getElementById('modalProv').style.display='flex'; if(i===null){document.getElementById('provId').value='';document.getElementById('provNombre').value='';document.getElementById('provTel').value='';document.getElementById('provProd').value='';document.getElementById('provNotas').value='';}else{const p=DATA.proveedores[i];document.getElementById('provId').value=p.id;document.getElementById('provNombre').value=p.nombre;document.getElementById('provTel').value=p.contacto;document.getElementById('provProd').value=p.productos;document.getElementById('provNotas').value=p.notas;} }
    function guardarProv(){ google.script.run.withSuccessHandler(()=>{ document.getElementById('modalProv').style.display='none'; sincronizarGlobalSilent(); }).guardarProveedor({id:val('provId'),nombre:val('provNombre'),contacto:val('provTel'),productos:val('provProd'),notas:val('provNotas')}); }
    function delProv(id){ if(confirm("¿Borrar?")) google.script.run.withSuccessHandler(sincronizarGlobalSilent).eliminarProveedor(id); }

    function t(list) { 
       const box = document.getElementById('listaStock'); if(!list || !list.length) { box.innerHTML = '<div style="padding:10px">Sin datos</div>'; return; } 
       box.innerHTML = list.filter(i => !i.eliminado).map((i) => `<div class="stock-list-item" onclick="loadKardex('${i.nombre.replace(/'/g, "\\'")}')"><div style="flex:1"><div style="font-weight:600;">${san(i.nombre)}</div><div style="font-size:11px; color:#666">Mín: ${san(i.min)}</div></div><div style="text-align:right"><div class="stock-val ${i.stock<=i.min?'stock-low':''}">${san(i.stock)} ${san(i.unidad)}</div><div class="stock-actions"><button class="btn-icon" onclick="event.stopPropagation(); prepareEdit('${i.nombre.replace(/'/g, "\\'")}')">✏️</button><button class="btn-icon" style="color:red" onclick="event.stopPropagation(); deleteInsumo('${i.nombre.replace(/'/g, "\\'")}')">🗑️</button></div></div></div>`).join(''); 
    }

    // =========================================================================
    // RESTAURACIÓN DEL FILTRO DE EQUIPOS Y CÁLCULO DE PRÉSTAMOS
    // =========================================================================
    function setFiltroEq(filtro, btn) { 
        filtroEquiposActual = filtro; 
        document.querySelectorAll('.filter-eq').forEach(b => b.classList.remove('active', 'btn-primary')); 
        document.querySelectorAll('.filter-eq').forEach(b => b.classList.add('btn-secondary')); 
        btn.classList.remove('btn-secondary'); 
        btn.classList.add('btn-primary'); 
        filtrarEquipos(); 
    }

    function obtenerPrestamosActivos(nombreEquipo) {
        let prestamos = {};
        if(!DATA.movimientos) return prestamos;
        for(let j = DATA.movimientos.length - 1; j >= 0; j--) {
            let m = DATA.movimientos[j];
            if(String(m.item).trim().toLowerCase() === String(nombreEquipo).trim().toLowerCase()) {
                let cant = parseFloat(m.cantidad) || 1;
                if(m.tipo === "Salida") {
                    let persona = m.responsableRecibe || "Desconocido";
                    prestamos[persona] = (prestamos[persona] || 0) + cant;
                } else if (m.tipo === "Entrada") {
                    let persona = m.responsableEntrega || "Desconocido";
                    if (prestamos[persona]) {
                        prestamos[persona] -= cant;
                        if(prestamos[persona] <= 0) delete prestamos[persona];
                    } else {
                        let keys = Object.keys(prestamos);
                        if (keys.length > 0) {
                            prestamos[keys[0]] -= cant;
                            if(prestamos[keys[0]] <= 0) delete prestamos[keys[0]];
                        }
                    }
                }
            }
        }
        return prestamos;
    }

    function renderEquiposList(list) { 
       const box = document.getElementById('listaEquipos'); 
       if(!list || !list.length) { box.innerHTML = '<div style="padding:10px">Sin equipos</div>'; return; } 
       const displayAction = "flex"; let html = '';
       
       const activas = list.filter(i => !i.eliminado);

       activas.forEach((i) => { 
          const safeName = escJS(i.nombre); 
          let prestamos = obtenerPrestamosActivos(i.nombre); 
          let totalPrestados = Object.values(prestamos).reduce((a,b)=>a+b, 0); 
          let stockDisp = parseFloat(i.stock) || 0;
          
          if(filtroEquiposActual === 'Disponibles' && stockDisp <= 0) return; 
          if(filtroEquiposActual === 'Fuera' && totalPrestados <= 0) return;
          
          let extraClass = ''; 
          let badgeEstado = '<span class="badge-bodega">🟢 DISPONIBLE</span>';
          
          if(stockDisp <= 0 && totalPrestados > 0) { 
              extraClass = 'eq-card-locked'; 
              badgeEstado = '<span class="badge-terreno">🔴 FUERA DE ALMACÉN</span>'; 
          } else if (stockDisp > 0 && totalPrestados > 0) { 
              badgeEstado = '<span class="badge-parcial">🟡 ASIG. PARCIAL</span>'; 
          } else if (stockDisp <= 0 && totalPrestados === 0) { 
              badgeEstado = '<span class="badge-terreno" style="background:#9ca3af">⚪ AGOTADO</span>'; 
          }
          
          let prestamosHtml = '';
          if(totalPrestados > 0) { 
              prestamosHtml = '<div style="margin-top:8px; font-size:11px; background:#f9fafb; padding:6px; border-radius:6px; border:1px dashed #d1d5db;"><div style="color:#4b5563; font-weight:600; margin-bottom:4px;">📍 Rastreo en Terreno:</div>'; 
              for(let persona in prestamos) { 
                  prestamosHtml += `<div style="color:#0369a1; padding-left:5px;">↳ ${san(persona)}: <b>${prestamos[persona]} Und</b></div>`; 
              } 
              prestamosHtml += '</div>'; 
          }
          
          html += `<div class="stock-list-item ${extraClass}" onclick="loadKardex('${safeName}')"><div style="flex:1">${badgeEstado}<div style="font-weight:600; font-size:14px; color:#0369a1; margin-top:4px;">${san(i.nombre)}</div><div style="font-size:11px; color:#666"><span class="eq-tag">${san(i.estado)}</span> <span class="eq-tag">${san(i.ubicacion)}</span></div>${prestamosHtml}</div><div style="text-align:right"><div class="stock-val" style="font-size:16px;">${stockDisp} <span style="font-size:10px;font-weight:normal">Disp.</span></div><div class="stock-actions" style="display:${displayAction}; margin-top:8px;"><button class="btn-icon" title="Editar" onclick="event.stopPropagation(); prepareEditEquipo('${safeName}')">✏️</button><button class="btn-icon" style="color:red" title="Eliminar" onclick="event.stopPropagation(); deleteEquipo('${safeName}')">🗑️</button></div></div></div>`;
       }); 
       box.innerHTML = html || '<div style="padding:10px; color:#666; text-align:center;">No hay equipos en este filtro</div>';
    }

    function prepareEdit(nombre){ const item=DATA.insumosData.find(i=>i.nombre===nombre); if(!item) return; document.getElementById('editOldName').value=item.nombre; document.getElementById('editNombre').value=item.nombre; document.getElementById('editUnidad').value=item.unidad; document.getElementById('editStock').value=item.stock; document.getElementById('editMin').value=item.min; document.getElementById('modalEditInsumo').style.display='flex'; }
    function guardarEdicionInsumo(){ google.script.run.withSuccessHandler(()=>{ document.getElementById('modalEditInsumo').style.display='none'; sincronizarGlobalSilent(); }).editarInsumo(val('editOldName'),{nombre:val('editNombre'),unidad:val('editUnidad'),stock:val('editStock'),min:val('editMin')},currentUser); }
    function deleteInsumo(nombre){ if(confirm("¿Eliminar?")) google.script.run.withSuccessHandler(sincronizarGlobalSilent).eliminarInsumo(nombre,currentUser); }
    function prepareEditEquipo(nombre){ const item=DATA.equiposData.find(i=>i.nombre===nombre); if(!item) return; document.getElementById('eqOldName').value=item.nombre; document.getElementById('eqNombre').value=item.nombre; document.getElementById('eqEstado').value=item.estado||'Bueno'; document.getElementById('eqUbi').value=item.ubicacion||'Bodega'; document.getElementById('eqStock').value=item.stock; document.getElementById('modalEditEquipo').style.display='flex'; }
    function guardarEdicionEquipo(){ google.script.run.withSuccessHandler(()=>{ document.getElementById('modalEditEquipo').style.display='none'; sincronizarGlobalSilent(); }).editarEquipo(val('eqOldName'),{nombre:val('eqNombre'),estado:val('eqEstado'),ubicacion:val('eqUbi'),stock:val('eqStock')},currentUser); }
    function deleteEquipo(nombre){ if(confirm("¿Eliminar?")) google.script.run.withSuccessHandler(sincronizarGlobalSilent).eliminarEquipo(nombre,currentUser); }

function loadKardex(nombre) { 
    document.getElementById('tituloKardex').innerText="Historial: "+nombre; 
    document.getElementById('tablaKardex').innerHTML='<tr><td colspan="5" style="text-align:center">Cargando...</td></tr>'; 
    google.script.run.withSuccessHandler(h=>{ 
        if(!h||h.length===0){ 
            document.getElementById('tablaKardex').innerHTML='<tr><td colspan="5" style="text-align:center">Sin movimientos</td></tr>'; 
            return; 
        } 
        document.getElementById('tablaKardex').innerHTML=h.map(r=>`<tr><td>${san(r.fecha)}</td><td>${san(r.ref)}</td><td style="font-size:11px">Entrega: <b>${san(r.respEntrega||'-')}</b><br>Recibe: <b>${san(r.respRecibe||'-')}</b></td><td><b>${san(r.cant)}</b></td><td><span class="tag ${r.tipo.toLowerCase()}">${san(r.tipo)}</span></td></tr>`).join(''); 
    }).obtenerKardexProducto(nombre);
}

function admAdd(t) {
  var d = {};
  if (t === 'responsable') {
    var nom = val('admRespNom');
    if (!nom || !nom.trim()) return alert("Ingresa un nombre");
    d = { nombre: nom.trim() };
  }
  if (t === 'insumo') {
    var nom = val('admInsNom');
    if (!nom || !nom.trim()) return alert("Ingresa un nombre");
    d = { nombre: nom.trim(), unidad: val('admInsUnd'), min: val('admInsMin'), stock: val('admInsStock') };
  }
  if (t === 'equipo') {
    var nom = val('admEquipNom');
    if (!nom || !nom.trim()) return alert("Ingresa un nombre");
    d = { nombre: nom.trim(), stock: val('admEquipStock') };
  }

  google.script.run
    .withSuccessHandler(function(r) {
      if (r && r.ok) {
        if (t === 'insumo' && DATA.insumosData) {
          DATA.insumosData.push({
            nombre: d.nombre,
            unidad: d.unidad || 'Und',
            stock: parseFloat(d.stock) || 0,
            min: parseFloat(d.min) || 0,
            eliminado: false
          });
          if (DATA.insumos) DATA.insumos.push(d.nombre);
          renderStockList(DATA.insumosData);
          filtrarStock();
        }
        if (t === 'equipo' && DATA.equiposData) {
          DATA.equiposData.push({
            nombre: d.nombre,
            estado: 'Bueno',
            ubicacion: 'Bodega',
            stock: parseFloat(d.stock) || 0,
            eliminado: false
          });
          if (DATA.equipos) DATA.equipos.push(d.nombre);
          renderEquiposList(DATA.equiposData);
          filtrarEquipos();
        }
        sincronizarGlobalSilent();
      } else if (r && r.eliminado) {
        // El item existe pero está marcado como eliminado — preguntar si reactivar
        var confirmar = confirm(
          "⚠️ \"" + d.nombre + "\" fue eliminado el " + r.fecha + ".\n\n" +
          "¿Deseas agregar una nueva unidad reactivando este registro?\n\n" +
          "El historial anterior quedará vinculado a este equipo."
        );
        if (!confirmar) return;

        // Reactivar: limpiar firma de eliminación y actualizar stock
        var reactivarDatos = (t === 'equipo')
          ? { nombre: d.nombre, estado: 'Bueno', ubicacion: 'Bodega', stock: parseFloat(d.stock) || 0 }
          : { nombre: d.nombre, unidad: d.unidad || 'Und', stock: parseFloat(d.stock) || 0, min: parseFloat(d.min) || 0 };

        var fnEditar = (t === 'equipo') ? 'editarEquipo' : 'editarInsumo';

        google.script.run
          .withSuccessHandler(function(res) {
            if (res && res.ok) {
              // Limpiar firma de eliminado en RAM también
              if (t === 'equipo' && DATA.equiposData) {
                var eqRam = DATA.equiposData.find(function(x) { return x.nombre === d.nombre; });
                if (eqRam) {
                  eqRam.eliminado = false;
                  eqRam.stock = parseFloat(d.stock) || 0;
                  eqRam.estado = 'Bueno';
                  eqRam.ubicacion = 'Bodega';
                } else {
                  DATA.equiposData.push({ nombre: d.nombre, estado: 'Bueno', ubicacion: 'Bodega', stock: parseFloat(d.stock) || 0, eliminado: false });
                }
                if (DATA.equipos && DATA.equipos.indexOf(d.nombre) === -1) DATA.equipos.push(d.nombre);
                renderEquiposList(DATA.equiposData);
                filtrarEquipos();
              }
              if (t === 'insumo' && DATA.insumosData) {
                var insRam = DATA.insumosData.find(function(x) { return x.nombre === d.nombre; });
                if (insRam) {
                  insRam.eliminado = false;
                  insRam.stock = parseFloat(d.stock) || 0;
                } else {
                  DATA.insumosData.push({ nombre: d.nombre, unidad: d.unidad || 'Und', stock: parseFloat(d.stock) || 0, min: parseFloat(d.min) || 0, eliminado: false });
                }
                if (DATA.insumos && DATA.insumos.indexOf(d.nombre) === -1) DATA.insumos.push(d.nombre);
                renderStockList(DATA.insumosData);
                filtrarStock();
              }
              sincronizarGlobalSilent();
            } else {
              alert("Error al reactivar: " + (res ? res.error : "Sin respuesta"));
            }
          })
          .withFailureHandler(function(err) {
            alert("Error de red al reactivar: " + err.message);
          })
          [fnEditar](d.nombre, reactivarDatos, currentUser);

      } else {
        alert("Error al agregar: " + (r ? r.error : "Sin respuesta"));
      }
    })
    .withFailureHandler(function(err) {
      alert("Error de red al agregar: " + err.message);
    })
    .agregarEntidad(t, d);
}

    function val(id){ return document.getElementById(id).value; }
    function fill(id,arr){ document.getElementById(id).innerHTML=arr&&arr.length?arr.map(x=>`<option>${san(x)}</option>`).join(''):'<option>Vacío</option>'; }
    function closeModalItem(){document.getElementById('modalItem').style.display='none';}

    function loadNames(){
        const t = val('mTipo');
        const opciones = t === 'Insumo' ? (DATA.insumos || []) : (DATA.equipos || []);
        fill('mUnidad', DATA.unidadesCatalogo || []);
        const input = document.getElementById('mNombreInput');
        if(input) {
            input.value = '';
            input.dataset.opciones = JSON.stringify(opciones);
        }
        const hidden = document.getElementById('mNombre');
        if(hidden) hidden.value = '';
        const box = document.getElementById('mNombreSugerencias');
        if(box) box.style.display = 'none';
    }

    function filtrarSugerenciasItem(query) {
        const box = document.getElementById('mNombreSugerencias');
        const hidden = document.getElementById('mNombre');
        if(hidden) hidden.value = '';
        const raw = document.getElementById('mNombreInput').dataset.opciones || '[]';
        let opciones = [];
        try { opciones = JSON.parse(raw); } catch(e) {}
        if(!query || query.trim().length === 0) { box.style.display = 'none'; return; }
        const filtradas = opciones.filter(o => normalizarTextoLocal(o).includes(normalizarTextoLocal(query)));
        if(!filtradas.length) { box.style.display = 'none'; return; }
        box.innerHTML = filtradas.map(o =>
            `<div data-val="${san(o)}"
                style="padding:10px 14px; cursor:pointer; font-size:14px; border-bottom:1px solid #f3f4f6; background:white;"
                onmousedown="seleccionarItemSugerido('${o.replace(/'/g, "\\'")}')"
                onmouseover="this.style.background='#eff6ff'"
                onmouseout="this.style.background='white'"
            >${san(o)}</div>`
        ).join('');
        box.style.display = 'block';
    }

    function seleccionarItemSugerido(nombre) {
        const input = document.getElementById('mNombreInput');
        const hidden = document.getElementById('mNombre');
        const box = document.getElementById('mNombreSugerencias');
        if(input) input.value = nombre;
        if(hidden) hidden.value = nombre;
        if(box) box.style.display = 'none';
    }

    function navegarSugerencias(e) {
        const box = document.getElementById('mNombreSugerencias');
        const items = box ? box.querySelectorAll('div') : [];
        if(!items.length) return;
        let actual = box.querySelector('div[data-focus="1"]');
        if(e.key === 'ArrowDown') {
            e.preventDefault();
            if(actual) { actual.removeAttribute('data-focus'); actual.style.background = 'white'; actual = actual.nextElementSibling || items[0]; }
            else { actual = items[0]; }
            actual.setAttribute('data-focus', '1'); actual.style.background = '#eff6ff';
        } else if(e.key === 'ArrowUp') {
            e.preventDefault();
            if(actual) { actual.removeAttribute('data-focus'); actual.style.background = 'white'; actual = actual.previousElementSibling || items[items.length - 1]; }
            else { actual = items[items.length - 1]; }
            actual.setAttribute('data-focus', '1'); actual.style.background = '#eff6ff';
        } else if(e.key === 'Enter') {
            e.preventDefault();
            if(actual) seleccionarItemSugerido(actual.dataset.val);
        } else if(e.key === 'Escape') {
            if(box) box.style.display = 'none';
        }
    }

    function openModalItem(){
        document.getElementById('modalItem').style.display = 'flex';
        loadNames();
    }

    function addItem(){
        const nom = document.getElementById('mNombre') ? document.getElementById('mNombre').value : '';
        if(!nom || !nom.trim()) return alert("Selecciona un ítem de la lista");
        ITEMS.push({tipo:val('mTipo'), nom:nom, cant:val('mCant'), und:val('mUnidad'), obs:val('mObs')});
        renderItems();
        closeModalItem();
    }

    function renderItems(){document.getElementById('listaItems').innerHTML=ITEMS.map((i,x)=>`<div class="badge-item"><b>${san(i.nom)}</b> (${san(i.cant)}) <button onclick="ITEMS.splice(${x},1);renderItems()">×</button></div>`).join('');}

    function AUDITOR_UI() {
        google.script.run.withSuccessHandler(server => {
            alert(`🕵️ INFORME FORENSE\n\n📦 Insumos DB: ${server.insumosActivos}\n🧰 Equipos DB: ${server.equiposActivos}`);
        }).AUDITORIA_DB_ESTADO();
    }

    document.addEventListener('keydown', function(e) { if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='q') AUDITOR_UI(); });
    // =====================================================================
// MÓDULO ACEITES v2 — UI Engine
// Agregar al final de Javascript.html
// =====================================================================

var _selectedContainers = {}; // Mapa local: { codigo: dataContenedor }

// ─── Navegación interna del tab Regeneración ─────────────────────────

function goRegen(panelId) {
  document.querySelectorAll('.regen-sub-panel').forEach(function(p) {
    p.classList.remove('active');
  });
  document.querySelectorAll('.regen-sub-tab').forEach(function(t) {
    t.classList.remove('active');
  });
  var panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');
  var tab = document.querySelector('.regen-sub-tab[data-regen="' + panelId + '"]');
  if (tab) tab.classList.add('active');

  if (panelId === 'regen-stock')  { renderStockContenedores(); }
  if (panelId === 'regen-nuevo')  {
    var fpEl = document.getElementById('npFecha');
    if (fpEl && !fpEl.value) fpEl.value = new Date().toISOString().split('T')[0];
    poblarSelectResp('npResp');
    renderSelectorContenedores();
  }
  if (panelId === 'regen-cerrar') {
    renderProcesosAbiertos();
    var cpEl = document.getElementById('cpFechaCierre');
    if (cpEl && !cpEl.value) cpEl.value = new Date().toISOString().split('T')[0];
  }
}

// ─── Panel 1: Stock de Contenedores ──────────────────────────────────

function renderStockContenedores() {
  var contenedores = DATA.contenedores || [];
  var tbody = document.getElementById('tbContenedores');
  if (!tbody) return;

  var litrosJLB = 0, litrosCliente = 0, enCampo = 0, vacios = 0;
  contenedores.forEach(function(c) {
    var eVacio = c.estado === 'VACÍO' || c.estado === 'VACIO';
    var eCampo = c.estado === 'EN_CAMPO';
    if (eCampo) enCampo++;
    if (eVacio) vacios++;
    if (!eCampo && !eVacio) {
      if (c.propiedad === 'JLB') litrosJLB += c.litrosActuales;
      else litrosCliente += c.litrosActuales;
    }
  });

  function setEl(id, val) { var e = document.getElementById(id); if (e) e.textContent = val; }
  setEl('statTotalL',   litrosJLB.toFixed(0)    + ' L');
  setEl('statClienteL', litrosCliente.toFixed(0) + ' L');
  setEl('statEnCampo',  enCampo);
  setEl('statVacios',   vacios);

  if (contenedores.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">' +
      'Sin contenedores. Usa "+ Registrar Contenedor".</td></tr>';
    return;
  }

  tbody.innerHTML = contenedores.map(function(c) {
    var pct = c.capacidad > 0 ? Math.round((c.litrosActuales / c.capacidad) * 100) : 0;
    var barColor = pct > 50 ? '#16a34a' : pct > 20 ? '#d97706' : '#dc2626';
    var eClass   = c.estado === 'LLENO' ? 'cb-lleno'
                 : c.estado === 'PARCIAL' ? 'cb-parcial'
                 : c.estado === 'EN_CAMPO' ? 'cb-campo' : 'cb-vacio';
    var pClass   = c.propiedad === 'JLB' ? 'cb-jlb' : 'cb-cliente';
    var refStr   = c.propiedad === 'CLIENTE' ? (c.clienteRef || '—') : (c.proveedor || '—');

    return '<tr>' +
      '<td><b>' + c.codigo + '</b></td>' +
      '<td style="font-size:12px">' + c.tipo + '</td>' +
      '<td style="font-size:12px">' + c.tipoAceite + '</td>' +
      '<td>' +
        '<div class="lbar-bg"><div class="lbar-fill" style="background:' + barColor + ';width:' + pct + '%"></div></div>' +
        '<b>' + c.litrosActuales + '</b><span style="color:#9ca3af;font-size:11px">/' + c.capacidad + 'L</span>' +
      '</td>' +
      '<td><span class="cont-badge ' + eClass + '">' + c.estado + '</span></td>' +
      '<td><span class="cont-badge ' + pClass + '">' + c.propiedad + '</span></td>' +
      '<td style="font-size:12px;color:#6b7280">' + refStr + '</td>' +
      '<td style="font-size:11px;color:#9ca3af">' + c.fechaIngreso + '</td>' +
    '</tr>';
  }).join('');
}

// ─── Modal: Registrar Nuevo Contenedor ───────────────────────────────

function abrirModalNuevoContenedor() {
  var hoy = new Date().toISOString().split('T')[0];
  ['ncCodigo','ncTipoAceite','ncClienteRef','ncProveedor','ncObs'].forEach(function(id) {
    var e = document.getElementById(id); if (e) e.value = '';
  });
  document.getElementById('ncTipo').value        = 'TAMBOR';
  document.getElementById('ncCapacidad').value   = '200';
  document.getElementById('ncPropiedad').value   = 'JLB';
  document.getElementById('ncFechaIngreso').value = hoy;
  toggleClienteRef_nc();
  document.getElementById('modalNuevoContenedor').style.display = 'flex';
}

function autoCapacidad_nc() {
  var tipo = document.getElementById('ncTipo').value;
  document.getElementById('ncCapacidad').value = tipo === 'ISOTANQUE' ? '1000' : '200';
}

function toggleClienteRef_nc() {
  var prop = document.getElementById('ncPropiedad').value;
  document.getElementById('ncClienteRefRow').style.display = prop === 'CLIENTE' ? 'block' : 'none';
  document.getElementById('ncProveedorRow').style.display  = prop === 'JLB'     ? 'block' : 'none';
}

function guardarContenedor() {
  var btn = document.getElementById('btnGuardarContenedor');
  var codigo     = (document.getElementById('ncCodigo').value || '').trim().toUpperCase();
  var tipoAceite = (document.getElementById('ncTipoAceite').value || '').trim();

  if (!codigo) {
    showToast('⚠️', 'Campo requerido', 'El código del contenedor es obligatorio.', '#dc2626');
    return;
  }
  if (!tipoAceite) {
    showToast('⚠️', 'Campo requerido', 'El tipo de aceite es obligatorio.', '#dc2626');
    return;
  }

  btn.disabled = true; btn.textContent = 'Guardando...';

  var payload = {
    codigo      : codigo,
    tipo        : document.getElementById('ncTipo').value,
    tipoAceite  : tipoAceite,
    capacidad   : parseFloat(document.getElementById('ncCapacidad').value) || 0,
    propiedad   : document.getElementById('ncPropiedad').value,
    clienteRef  : (document.getElementById('ncClienteRef').value || '').trim(),
    proveedor   : (document.getElementById('ncProveedor').value  || '').trim(),
    fechaIngreso: document.getElementById('ncFechaIngreso').value,
    obs         : (document.getElementById('ncObs').value || '').trim()
  };

  google.script.run
    .withSuccessHandler(function(r) {
      btn.disabled = false; btn.textContent = 'REGISTRAR';
      if (r.ok) {
        showToast('✅', 'Contenedor registrado', r.msg, '#16a34a');
        document.getElementById('modalNuevoContenedor').style.display = 'none';
        sincronizarGlobalSilent();
      } else {
        showToast('❌', 'Error', r.error, '#dc2626');
      }
    })
    .withFailureHandler(function(e) {
      btn.disabled = false; btn.textContent = 'REGISTRAR';
      showToast('❌', 'Error de conexión', e.message, '#dc2626');
    })
    .registrarContenedor(payload);
}

// ─── Panel 2: Nuevo Despacho (Fase 1) ────────────────────────────────

function renderSelectorContenedores() {
  var filtro = (document.getElementById('npTipoAceiteFilter').value || '').trim().toLowerCase();
  var disponibles = (DATA.contenedores || []).filter(function(c) {
    var ok = c.estado === 'LLENO' || c.estado === 'PARCIAL';
    return ok && (!filtro || c.tipoAceite.toLowerCase().indexOf(filtro) !== -1);
  });

  var grid = document.getElementById('npContenedoresGrid');
  if (!grid) return;

  if (disponibles.length === 0) {
    grid.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px;font-size:13px;grid-column:1/-1">' +
      (filtro ? 'Sin contenedores disponibles con ese tipo de aceite.' : 'No hay contenedores disponibles.') + '</div>';
    return;
  }

  grid.innerHTML = disponibles.map(function(c) {
    var sel    = !!_selectedContainers[c.codigo];
    var eCl    = c.estado === 'LLENO' ? 'cb-lleno' : 'cb-parcial';
    var pCl    = c.propiedad === 'JLB' ? 'cb-jlb' : 'cb-cliente';
    var refStr = c.propiedad === 'CLIENTE' && c.clienteRef
                 ? '<br><span style="color:#9333ea;font-size:11px">👤 ' + c.clienteRef + '</span>'
                 : '';

    var html = '<div style="margin-bottom:0">' +
      '<div class="cont-card' + (sel ? ' selected' : '') + '" onclick="toggleContainerSel(\'' + c.codigo + '\')">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">' +
            '<b style="font-size:14px">' + c.codigo + '</b>' +
            '<span class="cont-badge ' + eCl + '">' + c.estado + '</span>' +
            '<span class="cont-badge ' + pCl + '">' + c.propiedad + '</span>' +
            '<span style="font-size:10px;background:#f3f4f6;padding:2px 5px;border-radius:4px">' + c.tipo + '</span>' +
          '</div>' +
          '<div style="font-size:12px;color:#6b7280">' +
            c.tipoAceite + ' · <b>' + c.litrosActuales + ' L</b>' + refStr +
          '</div>' +
        '</div>' +
        '<span style="font-size:20px;flex-shrink:0">' + (sel ? '✅' : '⬜') + '</span>' +
      '</div>';

    if (sel) {
      html += '<div class="cont-litros-bar">' +
        '<span style="font-size:12px;font-weight:600;color:#92400e;white-space:nowrap">Litros a despachar:</span>' +
        '<input type="number" id="litros-' + c.codigo + '" ' +
          'value="' + c.litrosActuales + '" min="1" max="' + c.litrosActuales + '" ' +
          'style="width:80px;padding:5px 8px;border:1px solid #fcd34d;border-radius:5px;font-size:13px;font-weight:700;text-align:center" ' +
          'onclick="event.stopPropagation()">' +
        '<span style="font-size:11px;color:#92400e">/ ' + c.litrosActuales + ' L</span>' +
      '</div>';
    }

    html += '</div>';
    return html;
  }).join('');
}

function toggleContainerSel(codigo) {
  if (_selectedContainers[codigo]) {
    delete _selectedContainers[codigo];
  } else {
    var c = (DATA.contenedores || []).filter(function(x) { return x.codigo === codigo; })[0];
    if (c) _selectedContainers[codigo] = c;
  }
  renderSelectorContenedores();
  actualizarResumenSeleccion();
}

function actualizarResumenSeleccion() {
  var keys = Object.keys(_selectedContainers);
  var el   = document.getElementById('npResumenSeleccion');
  if (!el) return;
  if (keys.length === 0) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '📦 <b>' + keys.length + '</b> seleccionado(s): ' + keys.join(', ');
}

function poblarSelectResp(selectId) {
  var sel  = document.getElementById(selectId);
  if (!sel) return;
  var curr = sel.value;
  sel.innerHTML = (DATA.responsables || []).map(function(r) {
    return '<option' + (r === curr ? ' selected' : '') + '>' + r + '</option>';
  }).join('');
}

function guardarProceso() {
  var keys = Object.keys(_selectedContainers);
  if (keys.length === 0) {
    showToast('⚠️', 'Sin contenedores', 'Selecciona al menos un contenedor del grid.', '#dc2626');
    return;
  }
  var trafo = (document.getElementById('npTrafo').value || '').trim();
  if (!trafo) {
    showToast('⚠️', 'Trafo requerido', 'Ingresa el número de entrada del transformador.', '#dc2626');
    return;
  }

  var contenedores = keys.map(function(codigo) {
    var inp = document.getElementById('litros-' + codigo);
    return {
      codigo        : codigo,
      litrosDespacho: inp ? (parseFloat(inp.value) || 0) : (_selectedContainers[codigo].litrosActuales || 0)
    };
  });

  var btn = document.getElementById('btnGuardarProceso');
  btn.disabled = true; btn.textContent = 'Despachando...';

  var payload = {
    fecha      : document.getElementById('npFecha').value,
    trafo      : trafo,
    clienteRef : (document.getElementById('npCliente').value    || '').trim(),
    tipoTrabajo: document.getElementById('npTipoTrabajo').value,
    resp       : document.getElementById('npResp').value,
    obs        : (document.getElementById('npObs').value        || '').trim(),
    contenedores: contenedores
  };

  google.script.run
    .withSuccessHandler(function(r) {
      btn.disabled = false; btn.textContent = '🚀 DESPACHAR';
      if (r.ok) {
        showToast('🚀', 'Despacho registrado', r.msg, '#d97706');
        _selectedContainers = {};
        ['npTrafo','npCliente','npObs'].forEach(function(id) {
          var e = document.getElementById(id); if (e) e.value = '';
        });
        sincronizarGlobalSilent();
      } else {
        showToast('❌', 'Error', r.error, '#dc2626');
      }
    })
    .withFailureHandler(function(e) {
      btn.disabled = false; btn.textContent = '🚀 DESPACHAR';
      showToast('❌', 'Error de conexión', e.message, '#dc2626');
    })
    .crearProcesoAceite(payload);
}

// ─── Panel 3: Cerrar Proceso (Fase 2) ────────────────────────────────

function renderProcesosAbiertos() {
  var procesos = DATA.procesosAbiertos || [];
  var sel      = document.getElementById('cpProcesoSelect');
  if (!sel) return;

  sel.innerHTML = '<option value="">-- Selecciona el proceso a cerrar --</option>' +
    procesos.map(function(p) {
      return '<option value="' + p.idProceso + '">' +
        p.idProceso + ' · Trafo ' + p.trafo +
        (p.clienteRef ? ' · ' + p.clienteRef : '') +
        ' (' + p.fecha + ') [' + p.contenedores.length + ' cont.]' +
      '</option>';
    }).join('');

  document.getElementById('cpDetalleContainer').style.display = 'none';
}

function onProcesoSelect() {
  var idProceso = document.getElementById('cpProcesoSelect').value;
  var det       = document.getElementById('cpDetalleContainer');
  if (!idProceso) { det.style.display = 'none'; return; }

  var proceso = (DATA.procesosAbiertos || []).filter(function(p) {
    return p.idProceso === idProceso;
  })[0];
  if (!proceso) return;

  document.getElementById('cpProcesoInfo').innerHTML =
    '<div class="proc-chip">' +
    '⚡ <b>' + proceso.tipoTrabajo + '</b>' +
    ' · Trafo <b>' + proceso.trafo + '</b>' +
    (proceso.clienteRef ? ' · ' + proceso.clienteRef : '') +
    ' · Resp: ' + (proceso.resp || '—') +
    ' · Despacho: <b>' + proceso.fecha + '</b>' +
    '</div>';

  var tbody = document.getElementById('cpContenedoresBody');
  tbody.innerHTML = proceso.contenedores.map(function(c) {
    var propStr = c.propiedad === 'CLIENTE' ? ' · 👤 ' + (c.clienteRef || '') : '';
    return '<tr>' +
      '<td><b>' + c.codigo + '</b><br>' +
        '<span style="font-size:11px;color:#9ca3af">' + c.tipo + ' · ' + c.tipoAceite + propStr + '</span>' +
      '</td>' +
      '<td style="text-align:center;font-weight:700;color:#d97706">' + c.litrosDespacho + ' L</td>' +
      '<td style="text-align:center">' +
        '<input type="number" id="dev-' + c.codigo + '" value="0" min="0" max="' + c.litrosDespacho + '" ' +
          'style="width:85px;padding:7px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-weight:700;text-align:center" ' +
          'oninput="calcularConsumo(\'' + c.codigo + '\',' + c.litrosDespacho + ')">' +
      '</td>' +
      '<td id="cons-' + c.codigo + '" style="text-align:center;font-weight:700;color:#dc2626">' +
        c.litrosDespacho + ' L' +
      '</td>' +
    '</tr>';
  }).join('');

  det.style.display = 'block';
}

function calcularConsumo(codigo, litrosDespacho) {
  var inp = document.getElementById('dev-' + codigo);
  if (!inp) return;
  var devueltos = Math.min(parseFloat(inp.value) || 0, litrosDespacho);
  var consumido = Math.max(0, litrosDespacho - devueltos);
  var el        = document.getElementById('cons-' + codigo);
  if (el) {
    el.textContent = Math.round(consumido * 100) / 100 + ' L';
    el.style.color = consumido > 0 ? '#dc2626' : '#16a34a';
  }
}

function guardarCierreProceso() {
  var idProceso = document.getElementById('cpProcesoSelect').value;
  if (!idProceso) { showToast('⚠️', 'Sin proceso', 'Selecciona un proceso.', '#dc2626'); return; }

  var proceso = (DATA.procesosAbiertos || []).filter(function(p) {
    return p.idProceso === idProceso;
  })[0];
  if (!proceso) return;

  var detalles = proceso.contenedores.map(function(c) {
    var inp = document.getElementById('dev-' + c.codigo);
    return {
      codigoContenedor: c.codigo,
      litrosDevueltos : parseFloat(inp ? inp.value : 0) || 0
    };
  });

  var btn = document.getElementById('btnCerrarProceso');
  btn.disabled = true; btn.textContent = 'Cerrando...';

  google.script.run
    .withSuccessHandler(function(r) {
      btn.disabled = false; btn.textContent = '✅ CERRAR Y ACTUALIZAR STOCK';
      if (r.ok) {
        showToast('✅', 'Proceso cerrado', r.msg, '#16a34a');
        document.getElementById('cpProcesoSelect').value = '';
        document.getElementById('cpDetalleContainer').style.display = 'none';
        sincronizarGlobalSilent();
      } else {
        showToast('❌', 'Error', r.error, '#dc2626');
      }
    })
    .withFailureHandler(function(e) {
      btn.disabled = false; btn.textContent = '✅ CERRAR Y ACTUALIZAR STOCK';
      showToast('❌', 'Error de conexión', e.message, '#dc2626');
    })
    .cerrarProcesoAceite({
      idProceso  : idProceso,
      fechaCierre: document.getElementById('cpFechaCierre').value ||
                   new Date().toISOString().split('T')[0],
      detalles   : detalles
    });
}
// =====================================================================
// MÓDULO ESTADO TRAFO — Consulta desde caché de Producción
// Cubre inputs de ID simple (regTrafo, npTrafo)
// Y inputs de proyecto completo ("13647 / 104 - CLIENTE")
// =====================================================================

var _trafoCheckTimer = null;

// ─── Renderer compartido ─────────────────────────────────────────────
function pintarEstadoTrafo(el, r) {
  if (!r || !r.encontrado) {
    el.innerHTML =
      '<span style="background:#f3f4f6;color:#6b7280;padding:4px 10px;' +
      'border-radius:6px;font-size:12px;display:inline-block;margin-top:4px">' +
      '⚪ No encontrado en producción</span>';
    return;
  }

  var estado = (r.estado || '').toUpperCase();
  var estilo = { bg:'#f3f4f6', border:'#d1d5db', color:'#374151', icono:'⚪' };

  if      (estado.includes('ENTREGADO'))                         estilo = { bg:'#dcfce7', border:'#86efac', color:'#166534', icono:'✅' };
  else if (estado.includes('FINALIZADO'))                        estilo = { bg:'#d1fae5', border:'#6ee7b7', color:'#065f46', icono:'🏁' };
  else if (estado.includes('EN PROCESO'))                        estilo = { bg:'#dbeafe', border:'#93c5fd', color:'#1e40af', icono:'⚙️' };
  else if (estado.includes('RETORNO') || estado.includes('PRUEBAS')) estilo = { bg:'#e0e7ff', border:'#a5b4fc', color:'#4338ca', icono:'🔬' };
  else if (estado.includes('DIAGNOSTICO') && estado.includes('SIN')) estilo = { bg:'#fef3c7', border:'#fcd34d', color:'#92400e', icono:'⏸️' };
  else if (estado.includes('DIAGNOSTICO'))                       estilo = { bg:'#fef3c7', border:'#fcd34d', color:'#92400e', icono:'🔍' };
  else if (estado.includes('INGRESO'))                           estilo = { bg:'#fffbeb', border:'#fde68a', color:'#92400e', icono:'📥' };
  else if (estado.includes('EXTERNO'))                           estilo = { bg:'#fdf4ff', border:'#e9d5ff', color:'#7e22ce', icono:'🔄' };
  else if (estado.includes('SIN INGRESAR'))                      estilo = { bg:'#fee2e2', border:'#fca5a5', color:'#991b1b', icono:'⏳' };

  // Badge de aceite (útil para módulo regeneración)
  var aceiteHtml = '';
  if (r.statusAceite && r.statusAceite.trim() !== '') {
    var aEst = (r.statusAceite || '').toUpperCase();
    var aBg  = aEst === 'REALIZADO'     ? '#dcfce7'
             : aEst.includes('PARCIAL') ? '#fef3c7'
             : aEst === 'PENDIENTE'     ? '#fee2e2' : '#f3f4f6';
    var aCl  = aEst === 'REALIZADO'     ? '#166534'
             : aEst.includes('PARCIAL') ? '#92400e'
             : aEst === 'PENDIENTE'     ? '#991b1b' : '#6b7280';
    aceiteHtml =
      '<span style="background:' + aBg + ';color:' + aCl + ';padding:2px 7px;' +
      'border-radius:5px;font-size:10px;font-weight:700;margin-left:6px">' +
      '🛢️ ' + r.statusAceite + '</span>';
  }

  el.innerHTML =
    '<div style="background:' + estilo.bg + ';border:1px solid ' + estilo.border + ';' +
    'border-radius:8px;padding:8px 12px;margin-top:6px">' +
      '<div style="font-size:13px;font-weight:700;color:' + estilo.color + ';' +
      'display:flex;align-items:center;flex-wrap:wrap;gap:4px">' +
        estilo.icono + ' ' + (r.estado || '—') + aceiteHtml +
      '</div>' +
      '<div style="font-size:11px;color:#6b7280;margin-top:3px">' +
        '📋 <b>' + (r.etapa || '—') + '</b>' +
        ' &nbsp;·&nbsp; 👤 ' + (r.cliente || '—') +
      '</div>' +
    '</div>';
}

// ─── Parser de cadena de proyecto ────────────────────────────────────
// Convierte "13647 / 104 - CONSTRUCCIONES OBYCON S.A.S. 🔴 [ALERTA...]"
// en ["13647", "104"]
function extraerIdsDeProyecto(str) {
  if (!str) return [];
  var sinAlerta  = str.split('🔴')[0].trim();           // quitar alerta si existe
  var parteIds   = sinAlerta.split(' - ')[0].trim();    // "13647 / 104"
  return parteIds.split('/').map(function(x) {
    return x.trim();
  }).filter(function(x) { return x.length > 0; });
}

// ─── Para campos de proyecto completo ────────────────────────────────
// Uso: oninput="checkEstadoProyectoUI('proyecto','proyectoEstado')"
function checkEstadoProyectoUI(inputId, targetId) {
  var valor = (document.getElementById(inputId).value || '').trim();
  var el    = document.getElementById(targetId);
  if (!el) return;

  if (!valor || valor.length < 2) { el.innerHTML = ''; return; }

  clearTimeout(_trafoCheckTimer);
  el.innerHTML =
    '<span style="color:#9ca3af;font-size:12px;display:block;margin-top:4px">' +
    '🔍 Consultando producción...</span>';

  _trafoCheckTimer = setTimeout(function() {
    var ids = extraerIdsDeProyecto(valor);
    if (!ids.length) { el.innerHTML = ''; return; }

    // Intenta cada ID en orden hasta encontrar uno válido
    function intentarId(index) {
      if (index >= ids.length) {
        pintarEstadoTrafo(el, { encontrado: false });
        return;
      }
      google.script.run
        .withSuccessHandler(function(r) {
          if (!r || !r.encontrado) { intentarId(index + 1); return; }
          pintarEstadoTrafo(el, r);
        })
        .withFailureHandler(function() {
          el.innerHTML =
            '<span style="color:#dc2626;font-size:12px">⚠️ Error consultando producción</span>';
        })
        .obtenerEstadoTrafo(ids[index]);
    }
    intentarId(0);
  }, 600);
}

// ─── Para campos de número de trafo simple ───────────────────────────
// Uso: oninput="checkEstadoTrafoUI('regTrafo','regTrafoEstado')"
function checkEstadoTrafoUI(inputId, targetId) {
  var id = (document.getElementById(inputId).value || '').trim();
  var el = document.getElementById(targetId);
  if (!el) return;

  if (!id || id.length < 3) { el.innerHTML = ''; return; }

  clearTimeout(_trafoCheckTimer);
  el.innerHTML =
    '<span style="color:#9ca3af;font-size:12px;display:block;margin-top:4px">' +
    '🔍 Consultando producción...</span>';

  _trafoCheckTimer = setTimeout(function() {
    google.script.run
      .withSuccessHandler(function(r) { pintarEstadoTrafo(el, r); })
      .withFailureHandler(function() {
        el.innerHTML =
          '<span style="color:#dc2626;font-size:12px">⚠️ Error consultando producción</span>';
      })
      .obtenerEstadoTrafo(id);
  }, 600);
}
// ─── Nota de integración con sincronizarGlobalSilent() existente ─────
// En tu función sincronizarGlobalSilent() del Javascript.html existente,
// donde asignas los resultados de cargarOpciones() al objeto DATA,
// asegúrate de agregar estas dos líneas:
//
//   DATA.contenedores     = resultado.contenedores     || [];
//   DATA.procesosAbiertos = resultado.procesosAbiertos || [];
//
// Esto garantiza que el estado local refleje cambios inmediatamente
// después de cada despacho o cierre de proceso.

// =====================================================================
// MÓDULO CUSTODIA DE ACCESORIOS — UI Engine
// Agregar al final de Javascript.html
// =====================================================================

var _piezasSesion = [];       // Piezas pendientes de la sesión actual
var _firmaCtx     = null;     // Contexto canvas de firma
var _firmaTrazando = false;   // Estado de dibujo
var _tienesFirma  = false;    // Si el canvas tiene contenido

// ─── Navegación interna ───────────────────────────────────────────────

function goCust(panelId) {
  document.querySelectorAll('.cust-sub-panel').forEach(function(p) { p.classList.remove('active'); });
  document.querySelectorAll('.cust-sub-tab').forEach(function(t) { t.classList.remove('active'); });
  var panel = document.getElementById(panelId);
  if (panel) panel.classList.add('active');
  var tab = document.querySelector('.cust-sub-tab[data-cust="' + panelId + '"]');
  if (tab) tab.classList.add('active');
  if (panelId === 'cust-activa') renderCustodiaActiva();
  if (panelId === 'cust-registrar') {
    var f = document.getElementById('custFecha');
    if (f && !f.value) f.value = new Date().toISOString().split('T')[0];
    poblarSelectResp('custTecnico');
  }
}

// ─── Panel 1: Registrar Ingreso ───────────────────────────────────────

function abrirModalAgregarPieza() {
  ['piezaDesc','piezaObs'].forEach(function(id) {
    var e = document.getElementById(id); if (e) e.value = '';
  });
  document.getElementById('piezaCant').value = '1';
  document.getElementById('piezaEstado').value = 'BUENO';
  document.getElementById('modalAgregarPieza').style.display = 'flex';
  setTimeout(function() { document.getElementById('piezaDesc').focus(); }, 100);
}

function agregarPiezaSesion() {
  var desc = (document.getElementById('piezaDesc').value || '').trim();
  if (!desc) {
    showToast('⚠️', 'Campo requerido', 'La descripcion de la pieza es obligatoria.', '#dc2626');
    return;
  }
  var cant   = parseFloat(document.getElementById('piezaCant').value) || 1;
  var estado = document.getElementById('piezaEstado').value;
  var obs    = (document.getElementById('piezaObs').value || '').trim();

  _piezasSesion.push({ descripcion: desc, cantidad: cant, estadoIngreso: estado, obs: obs });

  // Aprender el término nuevo
  aprenderAccesorio(desc);

  document.getElementById('modalAgregarPieza').style.display = 'none';
  document.getElementById('piezaDescSug').style.display = 'none';

  // Limpiar campos para la siguiente pieza
  document.getElementById('piezaDesc').value  = '';
  document.getElementById('piezaCant').value  = '1';
  document.getElementById('piezaEstado').value = 'BUENO';
  document.getElementById('piezaObs').value   = '';

  renderPiezasSesion();
}

function renderPiezasSesion() {
  var cont = document.getElementById('listaPiezasSesion');
  var res  = document.getElementById('custResumenPiezas');
  if (!_piezasSesion.length) {
    cont.innerHTML = '<div style="color:#aaa;text-align:center;font-size:12px;padding:10px">Agrega piezas arriba</div>';
    res.style.display = 'none'; return;
  }
  cont.innerHTML = _piezasSesion.map(function(p, i) {
    var estCl = p.estadoIngreso === 'BUENO' ? '#16a34a'
              : p.estadoIngreso === 'DAÑADO' ? '#dc2626' : '#d97706';
    return '<div class="pieza-item">' +
      '<div style="flex:1">' +
        '<b style="font-size:13px">' + san(p.descripcion) + '</b>' +
        '<span style="font-size:11px;color:#6b7280;margin-left:8px">x' + p.cantidad + '</span>' +
        (p.obs ? '<div style="font-size:11px;color:#9ca3af;margin-top:2px">' + san(p.obs) + '</div>' : '') +
      '</div>' +
      '<span style="color:' + estCl + ';font-size:11px;font-weight:700;margin:0 12px">' + p.estadoIngreso + '</span>' +
      '<button class="btn-icon" style="color:#ef4444;font-size:14px" onclick="_piezasSesion.splice(' + i + ',1);renderPiezasSesion()">×</button>' +
    '</div>';
  }).join('');
  res.style.display = 'block';
  res.innerHTML = '📦 <b>' + _piezasSesion.length + '</b> pieza(s) listas para registrar';
}

// ─── Modal Firma ──────────────────────────────────────────────────────

function abrirModalFirma() {
  var trafo   = (document.getElementById('custTrafo').value || '').trim();
  var tecnico = document.getElementById('custTecnico').value;
  if (!trafo) { showToast('⚠️', 'Campo requerido', 'Ingresa el número de entrada del trafo.', '#dc2626'); return; }
  if (!_piezasSesion.length) { showToast('⚠️', 'Sin piezas', 'Agrega al menos una pieza antes de firmar.', '#dc2626'); return; }

  // Resumen en el modal
  document.getElementById('firmaSesionResumen').innerHTML =
    '<b>Trafo:</b> ' + san(trafo) +
    ' &nbsp;·&nbsp; <b>Técnico:</b> ' + san(tecnico) +
    ' &nbsp;·&nbsp; <b>' + _piezasSesion.length + ' pieza(s)</b>';

  document.getElementById('modalFirmaCustodia').style.display = 'flex';
  setTimeout(initFirmaCanvas, 100);
}

function initFirmaCanvas() {
  var canvas = document.getElementById('firmaCanvas');
  if (!canvas) return;
  _firmaCtx     = canvas.getContext('2d');
  _firmaTrazando = false;
  _tienesFirma  = false;
  _firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
  _firmaCtx.strokeStyle = '#1e40af';
  _firmaCtx.lineWidth   = 2.5;
  _firmaCtx.lineCap     = 'round';
  _firmaCtx.lineJoin    = 'round';
  canvas.classList.remove('firmado');
  document.getElementById('firmaStatus').textContent = 'Firma en el recuadro superior';

  function getPos(e) {
    var r = canvas.getBoundingClientRect();
    var sc = canvas.width / r.width;
    if (e.touches) return { x: (e.touches[0].clientX - r.left) * sc, y: (e.touches[0].clientY - r.top) * sc };
    return { x: (e.clientX - r.left) * sc, y: (e.clientY - r.top) * sc };
  }

  canvas.onmousedown = canvas.ontouchstart = function(e) {
    e.preventDefault(); _firmaTrazando = true;
    var p = getPos(e); _firmaCtx.beginPath(); _firmaCtx.moveTo(p.x, p.y);
  };
  canvas.onmousemove = canvas.ontouchmove = function(e) {
    e.preventDefault(); if (!_firmaTrazando) return;
    var p = getPos(e); _firmaCtx.lineTo(p.x, p.y); _firmaCtx.stroke();
    if (!_tienesFirma) {
      _tienesFirma = true;
      canvas.classList.add('firmado');
      document.getElementById('firmaStatus').textContent = '✅ Firma capturada';
    }
  };
  canvas.onmouseup = canvas.onmouseleave = canvas.ontouchend = function() { _firmaTrazando = false; };
}

function limpiarFirma() {
  var canvas = document.getElementById('firmaCanvas');
  if (!canvas || !_firmaCtx) return;
  _firmaCtx.clearRect(0, 0, canvas.width, canvas.height);
  _tienesFirma = false;
  canvas.classList.remove('firmado');
  document.getElementById('firmaStatus').textContent = 'Firma en el recuadro superior';
}

function guardarSesionConFirma() {
  if (!_tienesFirma) {
    showToast('⚠️', 'Firma requerida', 'El técnico debe firmar antes de guardar.', '#dc2626');
    return;
  }
  var canvas = document.getElementById('firmaCanvas');
  var firma  = canvas ? canvas.toDataURL('image/png') : '';
  var btn    = document.getElementById('btnGuardarSesionFirma');
  btn.disabled = true; btn.textContent = 'Guardando...';

  var payload = {
    idTrafo    : (document.getElementById('custTrafo').value || '').trim().toUpperCase(),
    fecha      : document.getElementById('custFecha').value,
    respEntrega: document.getElementById('custTecnico').value,
    respRecibe : currentUser,
    firmaBase64: firma,
    obs        : (document.getElementById('custObsSesion').value || '').trim(),
    piezas     : _piezasSesion
  };

  google.script.run
    .withSuccessHandler(function(r) {
      btn.disabled = false; btn.textContent = 'GUARDAR SESIÓN';
      if (r.ok) {
        showToast('✅', 'Sesión registrada', r.msg, '#7c3aed');
        document.getElementById('modalFirmaCustodia').style.display = 'none';
        _piezasSesion = [];
        renderPiezasSesion();
        document.getElementById('custTrafo').value        = '';
        document.getElementById('custTrafoEstado').innerHTML = '';
        document.getElementById('custObsSesion').value   = '';
        sincronizarGlobalSilent();
      } else {
        showToast('❌', 'Error', r.error, '#dc2626');
      }
    })
    .withFailureHandler(function(e) {
      btn.disabled = false; btn.textContent = 'GUARDAR SESIÓN';
      showToast('❌', 'Error de conexión', e.message, '#dc2626');
    })
    .registrarSesionCustodia(payload);
}

// ─── Panel 2: Buscar por trafo ────────────────────────────────────────

function buscarAccesoriosPorTrafo() {
  var id  = (document.getElementById('custBuscarTrafo').value || '').trim().toUpperCase();
  var res = document.getElementById('custResultadoBusqueda');
  if (!id) { showToast('⚠️', 'Campo requerido', 'Ingresa un número de trafo.', '#dc2626'); return; }
  res.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px">🔍 Buscando...</div>';

  google.script.run
    .withSuccessHandler(function(r) { renderDetalleTrafo(r, id, res); })
    .withFailureHandler(function(e) {
      res.innerHTML = '<div style="color:#dc2626;padding:10px">Error: ' + san(e.message) + '</div>';
    })
    .obtenerAccesoriosPorTrafo(id);
}

function renderDetalleTrafo(r, idTrafo, contenedor) {
  if (!r || (!r.piezas.length && !r.sesiones.length)) {
    contenedor.innerHTML = '<div style="color:#9ca3af;text-align:center;padding:20px">No se encontraron accesorios para el trafo <b>' + san(idTrafo) + '</b></div>';
    return;
  }
  var res = r.resumen;
  var html = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">' +
    statBox(res.EN_ALMACEN   || 0, 'En almacén',   '#dbeafe','#1e40af') +
    statBox(res.EN_ENSAMBLE  || 0, 'En ensamble',  '#fef9c3','#854d0e') +
    statBox(res.ENTREGADO    || 0, 'Entregados',   '#dcfce7','#166534') +
    statBox(res.FALTANTE     || 0, 'Faltantes',    '#fee2e2','#991b1b') +
  '</div>';

  // Sesiones
  if (r.sesiones.length) {
    html += '<div style="font-size:12px;font-weight:600;color:#6b7280;margin-bottom:8px">SESIONES DE ENTREGA</div>';
    html += r.sesiones.map(function(s) {
      return '<div style="background:#f5f3ff;border:1px solid #c4b5fd;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:12px">' +
        '<b>' + san(s.idSesion) + '</b>' +
        ' · ' + san(s.fecha) +
        ' · Técnico: <b>' + san(s.respEntrega) + '</b>' +
        ' · Recibió: ' + san(s.respRecibe) +
        (s.firmado ? ' · <span style="color:#16a34a;font-weight:700">✅ FIRMADO</span>' : ' · <span style="color:#dc2626">⚠ Sin firma</span>') +
        ' · ' + s.totalPiezas + ' pieza(s)' +
      '</div>';
    }).join('');
  }

  // Tabla de piezas
  html += '<div style="font-size:12px;font-weight:600;color:#6b7280;margin:12px 0 8px">PIEZAS</div>';
  html += '<div class="table-container"><table class="data-table" style="min-width:500px"><thead>' +
    '<tr><th>Descripción</th><th>Cant.</th><th>Estado ingreso</th><th>Estado actual</th><th>Fecha</th><th>Acción</th></tr>' +
  '</thead><tbody>' +
  r.piezas.map(function(p) {
    var estCl = {
      EN_ALMACEN:'est-almacen', EN_ENSAMBLE:'est-ensamble',
      ENTREGADO:'est-entregado', FALTANTE:'est-faltante', REEMPLAZADO:'est-reemplazado'
    }[p.estadoActual] || '';
    var ingCl = p.estadoIngreso === 'BUENO' ? 'color:#16a34a' : p.estadoIngreso === 'DAÑADO' ? 'color:#dc2626' : 'color:#d97706';
    return '<tr>' +
      '<td><b>' + san(p.descripcion) + '</b>' + (p.obs ? '<br><span style="font-size:11px;color:#9ca3af">' + san(p.obs) + '</span>' : '') + '</td>' +
      '<td style="text-align:center">' + p.cantidad + '</td>' +
      '<td><span style="font-size:11px;font-weight:600;' + ingCl + '">' + p.estadoIngreso + '</span></td>' +
      '<td><span class="' + estCl + '">' + p.estadoActual + '</span></td>' +
      '<td style="font-size:11px;color:#9ca3af">' + san(p.fechaIngreso) + '</td>' +
      '<td>' +
        '<select id="est-' + p.id + '" style="font-size:11px;padding:4px;border:1px solid #d1d5db;border-radius:4px">' +
          ['EN_ALMACEN','EN_ENSAMBLE','ENTREGADO','FALTANTE','REEMPLAZADO'].map(function(e) {
            return '<option' + (e === p.estadoActual ? ' selected' : '') + '>' + e + '</option>';
          }).join('') +
        '</select>' +
      '</td>' +
    '</tr>';
  }).join('') + '</tbody></table></div>' +
  '<button class="btn-primary" style="background:#7c3aed;margin-top:16px" onclick="guardarEstadosDesdeBusqueda(' + JSON.stringify(r.piezas.map(function(p){return p.id;})) + ')">GUARDAR CAMBIOS DE ESTADO</button>';

  contenedor.innerHTML = html;
}

function statBox(val, label, bg, color) {
  return '<div style="background:' + bg + ';border-radius:8px;padding:10px 14px;text-align:center;min-width:80px;flex:1">' +
    '<div style="font-size:20px;font-weight:800;color:' + color + '">' + val + '</div>' +
    '<div style="font-size:11px;color:' + color + ';margin-top:2px">' + label + '</div>' +
  '</div>';
}

function guardarEstadosDesdeBusqueda(ids) {
  var items = ids.map(function(id) {
    var sel = document.getElementById('est-' + id);
    return { id: id, nuevoEstado: sel ? sel.value : 'EN_ALMACEN', obs: '' };
  });
  google.script.run
    .withSuccessHandler(function(r) {
      if (r.ok) showToast('✅', 'Estados actualizados', r.msg, '#7c3aed');
      else showToast('❌', 'Error', r.error, '#dc2626');
      sincronizarGlobalSilent();
    })
    .withFailureHandler(function(e) { showToast('❌', 'Error', e.message, '#dc2626'); })
    .actualizarEstadoAccesorioLote({ items: items, resp: currentUser });
}

// ─── Panel 3: Custodia Activa ─────────────────────────────────────────

function renderCustodiaActiva() {
  var cont = document.getElementById('listaCustodiaActiva');
  if (!cont) return;
  var datos = DATA.custodia || [];
  if (!datos.length) {
    cont.innerHTML = '<div style="text-align:center;color:#9ca3af;padding:30px">No hay trafos con accesorios en custodia activa.</div>';
    return;
  }
  cont.innerHTML = datos.map(function(t) {
    var alerta = t.FALTANTE > 0
      ? '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700;margin-left:8px">⚠ ' + t.FALTANTE + ' FALTANTE(S)</span>'
      : '';
    return '<div class="trafo-cust-card" onclick="abrirDetalleCustodiaTrafo(\'' + san(t.idTrafo) + '\')">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<div>' +
          '<b style="font-size:15px;color:#5b21b6">Trafo ' + san(t.idTrafo) + '</b>' + alerta +
          '<div style="font-size:11px;color:#9ca3af;margin-top:3px">Último ingreso: ' + san(t.ultimaFecha) + '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
          (t.EN_ALMACEN  ? '<span class="est-almacen">'   + t.EN_ALMACEN  + ' en almacén</span>'  : '') +
          (t.EN_ENSAMBLE ? '<span class="est-ensamble">'  + t.EN_ENSAMBLE + ' en ensamble</span>' : '') +
          (t.FALTANTE    ? '<span class="est-faltante">'  + t.FALTANTE   + ' faltante(s)</span>'  : '') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function abrirDetalleCustodiaTrafo(idTrafo) {
  document.getElementById('modalCustTitulo').textContent = 'Accesorios — Trafo ' + idTrafo;
  document.getElementById('modalCustContenido').innerHTML =
    '<div style="color:#9ca3af;text-align:center;padding:20px">Cargando...</div>';
  document.getElementById('modalDetalleCustodia').style.display = 'flex';
  google.script.run
    .withSuccessHandler(function(r) {
      renderDetalleTrafo(r, idTrafo, document.getElementById('modalCustContenido'));
    })
    .withFailureHandler(function(e) {
      document.getElementById('modalCustContenido').innerHTML =
        '<div style="color:#dc2626">Error: ' + san(e.message) + '</div>';
    })
    .obtenerAccesoriosPorTrafo(idTrafo);
}

// =====================================================================
// VOCABULARIO INTELIGENTE DE ACCESORIOS — aprende con el uso
// =====================================================================

var _vocabAccesorios = [];
var _vocabCargado    = false;

// ── Vocabulario base pre-cargado ──────────────────────────────────────
var VOCAB_BASE_ACCESORIOS = [
  // Aisladores y bushings
  'Aislador AT', 'Aislador BT', 'Aislador de neutro',
  'Bushing AT', 'Bushing BT', 'Bushing neutro',
  'Pasatapas AT', 'Pasatapas BT',
  // Indicadores y sensores
  'Indicador de nivel de aceite', 'Indicador de temperatura de aceite',
  'Indicador de temperatura de devanado', 'Termometro bimetálico',
  'Rele Buchholz', 'Detector de gases', 'Rele de temperatura',
  // Valvulas
  'Valvula de drenaje', 'Valvula de llenado', 'Valvula de muestreo',
  'Valvula de sobrepresion', 'Valvula de vaciado rapido',
  // Conservador y respiracion
  'Conservador de aceite', 'Respirador de silica gel',
  'Membrana del conservador', 'Filtro de aire',
  // Cambiadores de taps
  'Cambiador de taps DETC', 'Cambiador de taps OLTC',
  'Motor del OLTC', 'Mecanismo del cambiador de taps',
  // Sistemas de enfriamiento
  'Radiador', 'Ventilador de enfriamiento', 'Bomba de aceite',
  'Aletas de enfriamiento',
  // Conexiones y terminales
  'Caja de bornes AT', 'Caja de bornes BT', 'Terminales de conexion',
  'Perno de puesta a tierra', 'Conector de neutro',
  // Mecanicos
  'Ruedas', 'Plataforma de ruedas', 'Orejas de izaje',
  'Tapa de registro', 'Tapa de inspeccion', 'Junta de expansion',
  'Placa de caracteristicas', 'Placa de fabricacion',
  // Control
  'Panel de control', 'Caja de control', 'Caja de mando',
  'Protector de sobrepresion', 'Protector de sobrecorriente',
  // Otros
  'Soporte de radiadores', 'Marco del transformador'
];

// ── Carga vocab desde IDB + base ─────────────────────────────────────
async function cargarVocabAccesorios() {
  if (_vocabCargado) return;
  var aprendidos = [];
  try {
    var raw = await idb.get('vocab_accesorios');
    if (raw) aprendidos = JSON.parse(raw);
  } catch(e) {}

  // Unión sin duplicados, base primero
  var todos = VOCAB_BASE_ACCESORIOS.concat(aprendidos.filter(function(a) {
    return VOCAB_BASE_ACCESORIOS.indexOf(a) === -1;
  }));
  _vocabAccesorios = todos;
  _vocabCargado    = true;
}

// ── Aprender nuevo término ────────────────────────────────────────────
async function aprenderAccesorio(termino) {
  if (!termino || termino.trim().length < 3) return;
  var t = termino.trim();

  // Ya está en el vocab actual
  if (_vocabAccesorios.some(function(v) {
    return v.toLowerCase() === t.toLowerCase();
  })) return;

  _vocabAccesorios.push(t);
  _vocabCargado = true;

  // Persistir solo los aprendidos (no la base, para no duplicar)
  try {
    var aprendidos = _vocabAccesorios.filter(function(v) {
      return VOCAB_BASE_ACCESORIOS.indexOf(v) === -1;
    });
    await idb.set('vocab_accesorios', JSON.stringify(aprendidos));
  } catch(e) {}
}

// ── Filtrar y mostrar sugerencias ─────────────────────────────────────
function filtrarVocabAccesorios(query) {
  var box = document.getElementById('piezaDescSug');
  if (!box) return;

  if (!query || query.trim().length < 2) {
    box.style.display = 'none';
    return;
  }

  // Asegurar vocab cargado
  if (!_vocabCargado) {
    cargarVocabAccesorios().then(function() {
      filtrarVocabAccesorios(query);
    });
    return;
  }

  var qNorm = query.trim().toLowerCase();
  var resultados = _vocabAccesorios.filter(function(v) {
    return v.toLowerCase().indexOf(qNorm) !== -1;
  }).slice(0, 10); // máximo 10 sugerencias

  if (!resultados.length) {
    box.style.display = 'none';
    return;
  }

  box.innerHTML = resultados.map(function(v, i) {
    var highlighted = v.replace(
      new RegExp('(' + qNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi'),
      '<b style="color:#7c3aed">$1</b>'
    );
    return '<div data-val="' + san(v) + '" data-idx="' + i + '" ' +
      'style="padding:10px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid #f3f4f6;background:white;" ' +
      'onmousedown="seleccionarVocabAccesorio(\'' + v.replace(/'/g, "\\'") + '\')" ' +
      'onmouseover="this.style.background=\'#f5f3ff\'" ' +
      'onmouseout="this.style.background=\'white\'">' +
      highlighted +
    '</div>';
  }).join('');

  box.style.display = 'block';
}

function seleccionarVocabAccesorio(val) {
  var inp = document.getElementById('piezaDesc');
  var box = document.getElementById('piezaDescSug');
  if (inp) inp.value = val;
  if (box) box.style.display = 'none';
}

function navegarVocabAccesorios(e) {
  var box = document.getElementById('piezaDescSug');
  if (!box || box.style.display === 'none') return;
  var items = box.querySelectorAll('div[data-val]');
  if (!items.length) return;

  var actual = box.querySelector('div[data-focus="1"]');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (actual) { actual.removeAttribute('data-focus'); actual.style.background = 'white'; actual = actual.nextElementSibling || items[0]; }
    else { actual = items[0]; }
    actual.setAttribute('data-focus', '1'); actual.style.background = '#f5f3ff';

  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (actual) { actual.removeAttribute('data-focus'); actual.style.background = 'white'; actual = actual.previousElementSibling || items[items.length - 1]; }
    else { actual = items[items.length - 1]; }
    actual.setAttribute('data-focus', '1'); actual.style.background = '#f5f3ff';

  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (actual) seleccionarVocabAccesorio(actual.dataset.val);

  } else if (e.key === 'Escape') {
    box.style.display = 'none';
  } else if (e.key === 'Tab') {
    // Si hay una sola sugerencia, seleccionarla al tabular
    if (items.length === 1) {
      e.preventDefault();
      seleccionarVocabAccesorio(items[0].dataset.val);
    } else {
      box.style.display = 'none';
    }
  }
}

// ── Cerrar sugerencias al hacer click fuera ───────────────────────────
document.addEventListener('click', function(e) {
  var box = document.getElementById('piezaDescSug');
  var inp = document.getElementById('piezaDesc');
  if (box && inp && !box.contains(e.target) && e.target !== inp) {
    box.style.display = 'none';
  }
});

// ── Inicializar vocab al arrancar ─────────────────────────────────────
cargarVocabAccesorios();
// =====================================================================
// CENTRO DE ALERTAS — persistencia in-app
// =====================================================================

var _alertas         = [];
var _alertasNoLeidas = 0;
var _prevLowStock    = [];

function agregarAlerta(icono, titulo, msg, tipo) {
  var hora = new Date().toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' });
  _alertas.unshift({ id: Date.now(), icono: icono, titulo: titulo, msg: msg, tipo: tipo || 'info', hora: hora, leida: false });
  if (_alertas.length > 60) _alertas = _alertas.slice(0, 60);
  _alertasNoLeidas++;
  _actualizarBadge();
  _renderNotifPanel();
}

function _actualizarBadge() {
  var n      = _alertasNoLeidas;
  var badge  = document.getElementById('notifBadgeCount');
  var fab    = document.getElementById('fabNotif');
  var fabBdg = document.getElementById('fabBadge');
  var bell   = document.getElementById('btnNotifBell');

  if (badge) { badge.textContent = n > 9 ? '9+' : n; badge.style.display = n > 0 ? 'block' : 'none'; }
  if (fab)   { n > 0 ? fab.classList.add('visible') : fab.classList.remove('visible'); }
  if (fabBdg){ fabBdg.textContent = n > 9 ? '9+' : n; fabBdg.style.display = n > 0 ? 'block' : 'none'; }
  if (bell && n > 0) { bell.classList.add('bell-ring'); setTimeout(function(){ bell.classList.remove('bell-ring'); }, 600); }
}

function toggleNotifPanel() {
  var panel   = document.getElementById('notifPanel');
  var overlay = document.getElementById('notifOverlay');
  if (!panel) return;

  if (panel.classList.contains('open')) {
    panel.classList.remove('open');
    overlay.classList.remove('open');
  } else {
    _alertas.forEach(function(a) { a.leida = true; });
    _alertasNoLeidas = 0;
    _actualizarBadge();
    _renderNotifPanel();
    panel.classList.add('open');
    overlay.classList.add('open');
  }
}

function limpiarAlertas() {
  _alertas = [];
  _alertasNoLeidas = 0;
  _actualizarBadge();
  _renderNotifPanel();
}

function _renderNotifPanel() {
  // ── Sección 1: Stock bajo ACTUAL (siempre en tiempo real) ────────
  var bajos = (DATA.insumosData || []).filter(function(i) {
    return !i.eliminado && parseFloat(i.stock) <= parseFloat(i.min) && parseFloat(i.min) > 0;
  }).sort(function(a, b) { return parseFloat(a.stock) - parseFloat(b.stock); });

  var banner    = document.getElementById('stockAlertaBanner');
  var bannerTxt = document.getElementById('stockAlertaTexto');
  var stockSec  = document.getElementById('notifStockBajo');

  if (banner && bannerTxt) {
    if (bajos.length > 0) {
      banner.style.display = 'block';
      bannerTxt.innerHTML  = '⚠️ <b>' + bajos.length + ' insumo(s) con stock bajo o agotado</b> — toca para ver el detalle';
    } else {
      banner.style.display = 'none';
    }
  }

  if (stockSec) {
    if (bajos.length === 0) {
      stockSec.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:#16a34a;background:#f0fdf4;border-bottom:1px solid #bbf7d0;display:flex;gap:8px;align-items:center">✅ Todos los insumos están sobre el mínimo</div>';
    } else {
      stockSec.innerHTML =
        '<div style="padding:10px 16px;background:#fee2e2;font-size:12px;font-weight:700;color:#991b1b;border-bottom:1px solid #fca5a5;letter-spacing:.5px">⚠️ STOCK BAJO — ' + bajos.length + ' INSUMO(S)</div>' +
        bajos.map(function(i) {
          var pct      = i.min > 0 ? Math.round((parseFloat(i.stock) / parseFloat(i.min)) * 100) : 0;
          var clr      = pct <= 0 ? '#dc2626' : pct < 50 ? '#d97706' : '#ca8a04';
          var bgRow    = pct <= 0 ? '#fff1f2' : '#fffbeb';
          var etiqueta = parseFloat(i.stock) <= 0 ? 'AGOTADO' : 'BAJO';
          var etqBg    = parseFloat(i.stock) <= 0 ? '#fee2e2' : '#fef9c3';
          var etqCl    = parseFloat(i.stock) <= 0 ? '#991b1b' : '#854d0e';
          return '<div style="padding:10px 16px;border-bottom:1px solid #fee2e2;background:' + bgRow + ';display:flex;justify-content:space-between;align-items:center;gap:8px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="font-weight:600;font-size:13px;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + san(i.nombre) + '</div>' +
              '<div style="font-size:11px;color:#9ca3af;margin-top:2px">Mínimo: ' + i.min + ' ' + san(i.unidad) + '</div>' +
            '</div>' +
            '<div style="text-align:right;flex-shrink:0">' +
              '<span style="background:' + etqBg + ';color:' + etqCl + ';padding:1px 6px;border-radius:6px;font-size:9px;font-weight:700;display:block;margin-bottom:3px">' + etiqueta + '</span>' +
              '<span style="font-weight:800;font-size:16px;color:' + clr + '">' + parseFloat(i.stock) + '</span>' +
              '<span style="font-size:10px;color:#9ca3af;margin-left:2px">' + san(i.unidad) + '</span>' +
            '</div>' +
          '</div>';
        }).join('');
    }
  }

  // ── Sección 2: Historial de alertas del día ──────────────────────
  var histSec  = document.getElementById('notifHistorial');
  var subtitle = document.getElementById('notifSubtitle');
  if (subtitle) subtitle.textContent = _alertas.length + ' alerta(s) en esta sesión';
  if (!histSec) return;

  if (_alertas.length === 0) {
    histSec.innerHTML = '<div style="padding:30px;text-align:center;color:#9ca3af;font-size:13px">Sin alertas recientes en esta sesión</div>';
    return;
  }
  histSec.innerHTML =
    '<div style="padding:8px 16px;font-size:11px;font-weight:700;color:#6b7280;background:#f9fafb;border-bottom:1px solid #e5e7eb;letter-spacing:.5px">HISTORIAL DE ESTA SESIÓN</div>' +
    _alertas.map(function(a) {
      return '<div class="notif-item' + (a.leida ? '' : ' unread') + '">' +
        '<div style="font-size:22px;flex-shrink:0">' + (a.icono || '🔔') + '</div>' +
        '<div style="flex:1">' +
          '<div class="notif-item-title">' + san(a.titulo) + '</div>' +
          '<div class="notif-item-msg">'   + san(a.msg)    + '</div>' +
          '<div class="notif-item-time">'  + a.hora        + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
}
