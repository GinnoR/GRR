
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI, Type } from "@google/genai";
import * as XLSX from 'xlsx';

const systemInstruction = `Eres un asistente de punto de venta para un mercado peruano. Tu única función es analizar la transcripción del vendedor y responder en formato JSON.

**REGLAS:**
- Tu objetivo principal es identificar y extraer CADA "producto-monto" o "producto-cantidad" que el vendedor dicte, incluso si dice varios en una sola frase. Por ejemplo, en "cinco soles de papa, dos de arroz y un kilo de azúcar", debes extraer los tres items.
- Interpreta jerga peruana: "luca" (1 sol), "china" (0.50 soles).
- Extrae TODOS los pares producto-monto dictados.
- Si se dicta una cantidad en vez de un monto (ej: "dos kilos de papa"), extrae la cantidad y la unidad.
- Si la transcripción es un comando, identifícalo.

**COMANDOS:**
- **AGREGAR_PRODUCTO**: Si la transcripción contiene uno o más productos para añadir a la cuenta.
- **ELIMINAR_PRODUCTO**: "borra [producto]", "anula [producto]", "quita [producto] de [monto] soles".
- **NUEVA_CUENTA**: "nueva cuenta", "borra todo", "limpia la cuenta", "anular la orden".
- **PAGAR_YAPE**: "pagar con yape", "cobra con yape".
- **PAGAR_EFECTIVO**: "pagar en efectivo", "es en efectivo".
- **NINGUNO**: Si no identificas ni productos ni comandos.`;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    command: { type: Type.STRING },
    products: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          unit: { type: Type.STRING },
          amount: { type: Type.NUMBER },
        },
      },
    },
  },
};

// --- Mensajes del Teleprompter ---
const TELEPROMPTER_MESSAGES = [
    '💡 ¡NUEVO! Exporta tus ventas a Excel con un solo clic.',
    '🚀 PRÓXIMAMENTE: Gestión de proveedores integrada.',
    '✨ Usa tu voz para vender más rápido: "dos soles de arroz y cinco de papa".',
    '🔮 FUTURO: La IA te sugerirá ofertas para productos con bajo movimiento.',
    '✅ ¡Función actual! Revisa ventas pasadas con las flechas de navegación.',
    '📈 PRÓXIMAMENTE: Reportes de utilidad para saber cuánto ganas realmente.',
    '🔔 ¡NUEVO! Ajusta los montos de la cuenta fácilmente con el botón "Ajustar".',
    '🤖 FUTURO: El asistente podrá tomar pedidos de varios clientes a la vez.'
];

// --- State and Refs ---
let bill = [];
let salesHistory = [];
let inventoryData = [];
let currentSalesHistoryIndex = -1;
let isRecording = false;
let selectedVoice = null;
let recognition = null;
let ai = null;
let speakQueue = [];
let isSpeaking = false;
let paymentMethodToConfirm = null;
let clarificationContext = null;
let isProcessing = false;
let itemToAdjustId = null;
let audioCtx;
let config = {
    userCode: 'VP100',
    shopName: 'Mi Bodeguita',
    teleprompterSpeed: 25,
    voiceSpeed: 1.2,
    voiceVolume: 1,
    isTeleprompterPaused: false,
};
let sirenAudioCtx = null;
let sirenOscillator = null;
let sirenGain = null;
let isPanicActive = false;
let sirenLoopInterval = null;
let autoRestartRecognition = false;


const DETAILED_INVENTORY_DATA_CONST = [
    { codigo: 'AB-001', producto: 'Arroz Blanco (1 kg)', categoria: 'Granos y Cereales', cantidad: 250, proveedor: 'Distribuidora del Sol', precioUnitario: 5.00, stockProximaBaja: 8, fechaVencimiento: '11/08/2025' },
    { codigo: 'AB-002', producto: 'Frijol Negro (1 kg)', categoria: 'Granos y Cereales', cantidad: 300, proveedor: 'Legumbres La Cosecha', precioUnitario: 4.00, stockProximaBaja: 10, fechaVencimiento: '20/09/2025' },
    { codigo: 'AB-003', producto: 'Aceite Vegetal (1 L)', categoria: 'Aceites y Grasas', cantidad: 180, proveedor: 'Aceites del Centro', precioUnitario: 20.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-004', producto: 'Azúcar Estándar (1 kg)', categoria: 'Endulzantes', cantidad: 400, proveedor: 'Dulce Cañaveral S.A.', precioUnitario: 4.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-005', producto: 'Sal de Mesa (1 kg)', categoria: 'Condimentos', cantidad: 500, proveedor: 'Salinera del Pacífico', precioUnitario: 5.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-006', producto: 'Harina de Trigo (1 kg)', categoria: 'Harinas', cantidad: 200, proveedor: 'Molinos Modernos', precioUnitario: 6.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-007', producto: 'Lentejas (500 g)', categoria: 'Granos y Cereales', cantidad: 150, proveedor: 'Legumbres La Cosecha', precioUnitario: 8.00, stockProximaBaja: 50, fechaVencimiento: '11/08/2025' },
    { codigo: 'AB-008', producto: 'Atún en Aceite (140 g)', categoria: 'Enlatados', cantidad: 320, proveedor: 'Conservas Marinas', precioUnitario: 8.00, stockProximaBaja: 0, fechaVencimiento: '12/08/2025' },
    { codigo: 'AB-009', producto: 'Sardinas en Tomate (156 g)', categoria: 'Enlatados', cantidad: 280, proveedor: 'Conservas Marinas', precioUnitario: 12.00, stockProximaBaja: 0, fechaVencimiento: '13/08/2025' },
    { codigo: 'AB-010', producto: 'Leche Entera (1 L)', categoria: 'Lácteos', cantidad: 240, proveedor: 'Lácteos del Sur', precioUnitario: 12.00, stockProximaBaja: 0, fechaVencimiento: '14/08/2025' },
    { codigo: 'AB-011', producto: 'Café Soluble (200 g)', categoria: 'Bebidas Calientes', cantidad: 120, proveedor: 'Cafetalera La Montaña', precioUnitario: 40.00, stockProximaBaja: 0, fechaVencimiento: '15/08/2025' },
    { codigo: 'AB-012', producto: 'Galletas Marías (170 g)', categoria: 'Galletas y Botanas', cantidad: 450, proveedor: 'Galletera Nacional', precioUnitario: 7.00, stockProximaBaja: 0, fechaVencimiento: '16/08/2025' },
    { codigo: 'AB-013', producto: 'Pasta para Sopa (200 g)', categoria: 'Pastas', cantidad: 350, proveedor: 'Pastas La Italiana', precioUnitario: 4.00, stockProximaBaja: 0, fechaVencimiento: '17/08/2025' },
    { codigo: 'AB-014', producto: 'Mayonesa (400 g)', categoria: 'Aderezos', cantidad: 160, proveedor: 'Aderezos Cremosos', precioUnitario: 20.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-015', producto: 'Chiles Jalapeños en Escabeche (220 g)', categoria: 'Enlatados', cantidad: 210, proveedor: 'La Huerta Enlatados', precioUnitario: 18.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-016', producto: 'Refresco de Cola (2.5 L)', categoria: 'Bebidas', cantidad: 300, proveedor: 'Embotelladora Central', precioUnitario: 12.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-017', producto: 'Agua Purificada (1.5 L)', categoria: 'Bebidas', cantidad: 500, proveedor: 'Manantiales Frescos', precioUnitario: 5.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-018', producto: 'Jabón de Tocador (150 g)', categoria: 'Cuidado Personal', cantidad: 400, proveedor: 'Jabonera La Espuma', precioUnitario: 4.00, stockProximaBaja: 0, fechaVencimiento: '11/08/2025' },
    { codigo: 'AB-019', producto: 'Papel Higiénico (paquete 4 rollos)', categoria: 'Limpieza del Hogar', cantidad: 350, proveedor: 'Papelera Suave', precioUnitario: 5.00, stockProximaBaja: 0, fechaVencimiento: '12/08/2025' },
    { codigo: 'AB-020', producto: 'Detergente en Polvo (1 kg)', categoria: 'Limpieza del Hogar', cantidad: 180, proveedor: 'Limpieza Brillante', precioUnitario: 25.00, stockProximaBaja: 0, fechaVencimiento: '13/08/2025' },
    { codigo: 'AB-021', producto: 'Cloro (1 L)', categoria: 'Limpieza del Hogar', cantidad: 220, proveedor: 'Químicos del Golfo', precioUnitario: 16.00, stockProximaBaja: 0, fechaVencimiento: '14/08/2025' },
    { codigo: 'AB-022', producto: 'Huevo Blanco (cartera 30 pzas)', categoria: 'Huevo', cantidad: 150, proveedor: 'Avícola El Corral', precioUnitario: 22.00, stockProximaBaja: 0, fechaVencimiento: '15/08/2025' },
    { codigo: 'AB-023', producto: 'Pan de Caja Blanco (680 g)', categoria: 'Panadería', cantidad: 100, proveedor: 'Panificadora La Espiga', precioUnitario: 18.00, stockProximaBaja: 0, fechaVencimiento: '16/08/2025' },
    { codigo: 'AB-024', producto: 'Mermelada de Fresa (270 g)', categoria: 'Conservas Dulces', cantidad: 130, proveedor: 'Frutas del Campo', precioUnitario: 13.00, stockProximaBaja: 0, fechaVencimiento: '17/08/2025' },
    { codigo: 'AB-025', producto: 'Cereal de Maíz Azucarado (500 g)', categoria: 'Granos y Cereales', cantidad: 110, proveedor: 'Cereales Nutritivos', precioUnitario: 20.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-027', producto: 'Veladora Aromática', categoria: 'Varios', cantidad: 150, proveedor: 'Iluminación La Llama', precioUnitario: 30.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-028', producto: 'Pilas Alcalinas AA (paquete 4)', categoria: 'Varios', cantidad: 90, proveedor: 'Energía Duradera', precioUnitario: 18.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-029', producto: 'Pasta Dental (75 ml)', categoria: 'Cuidado Personal', cantidad: 170, proveedor: 'Sonrisa Fresca', precioUnitario: 10.00, stockProximaBaja: 0, fechaVencimiento: null },
    { codigo: 'AB-030', producto: 'Chocolate en Polvo (400 g)', categoria: 'Bebidas Calientes', cantidad: 140, proveedor: 'Chocolatera del Sur', precioUnitario: 15.00, stockProximaBaja: 0, fechaVencimiento: null },
];

const PANIC_PHRASES = ["auxilio", "socorro", "ayuda", "ladrón", "policía", "no me haga nada", "lo denunciaré"];

const getUnitFromProduct = (product) => {
    const name = product.producto.toLowerCase();
    // Extracts content from parentheses, e.g., "1 kg" from "Arroz (1 kg)"
    const match = name.match(/\(([^)]+)\)/);
    if (match) {
        const unitPart = match[1].trim();
        // Check for standard units at the end of the extracted part
        if (unitPart.endsWith('kg')) return 'kg';
        if (unitPart.endsWith('l')) return 'L';
        if (unitPart.endsWith('g')) return 'g';
        if (unitPart.endsWith('ml')) return 'ml';
    }
    // Default to 'unid.' if no specific unit is found
    return 'unid.';
};


// --- DOM Elements ---
const loginContainer = document.getElementById('login-container');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const appContainer = document.getElementById('app-container');
const logoutButton = document.getElementById('logout-button');
const exportReportButton = document.getElementById('export-report-button');
const summaryDashboard = document.getElementById('summary-dashboard');
const detailedInventoryContainer = document.getElementById('detailed-inventory-container');
const movementInventoryButton = document.getElementById('movement-inventory-button');
const catalogContentWrapper = document.getElementById('catalog-content-wrapper');
const billItemsContainer = document.getElementById('bill-items');
const billTotalEl = document.getElementById('bill-total');
const micButton = document.getElementById('mic-button');
const statusMessage = document.getElementById('status-message');
const newBillButton = document.getElementById('new-bill-button');
const shareButton = document.getElementById('share-button');
const payYapeButton = document.getElementById('pay-yape-button');
const payCashButton = document.getElementById('pay-cash-button');
const printTicketButton = document.getElementById('print-ticket-button');
const tutorialButton = document.getElementById('tutorial-button');
const tipsButton = document.getElementById('tips-button');
const testVoiceButton = document.getElementById('test-voice-button');
const salesHistoryDisplay = document.getElementById('sales-history-display');
const salesHistoryPrev = document.getElementById('sales-history-prev');
const salesHistoryNext = document.getElementById('sales-history-next');
const confirmationModal = document.getElementById('confirmation-modal');
const modalMessage = document.getElementById('modal-message');
const modalConfirmButton = document.getElementById('modal-confirm-button');
const modalCancelButton = document.getElementById('modal-cancel-button');
const liveTranscriptDisplay = document.getElementById('live-transcript-display');
const tipsModal = document.getElementById('tips-modal');
const tipsModalClose = document.getElementById('tips-modal-close');
const adjustModal = document.getElementById('adjust-modal');
const adjustModalTitle = document.getElementById('adjust-modal-title');
const adjustModalBody = document.getElementById('adjust-modal-body');
const adjustModalSave = document.getElementById('adjust-modal-save');
const adjustModalCancel = document.getElementById('adjust-modal-cancel');
const teleprompterContent = document.getElementById('teleprompter-content');
const configButton = document.getElementById('config-button');
const configModal = document.getElementById('config-modal');
const configModalClose = document.getElementById('config-modal-close');
const configSpeedSlider = document.getElementById('config-speed-slider');
const configSpeedValue = document.getElementById('config-speed-value');
const configUserCodeInput = document.getElementById('config-user-code');
const configShopNameInput = document.getElementById('config-shop-name');
const configVoiceSpeedSlider = document.getElementById('config-voice-speed-slider');
const configVoiceSpeedValue = document.getElementById('config-voice-speed-value');
const configVoiceVolumeSlider = document.getElementById('config-voice-volume-slider');
const configVoiceVolumeValue = document.getElementById('config-voice-volume-value');
const panicButton = document.getElementById('panic-button');
const panicOverlay = document.getElementById('panic-overlay');
const configToggleTeleprompter = document.getElementById('config-toggle-teleprompter');



// --- Audio Feedback ---
const getAudioContext = () => {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            console.error("Web Audio API is not supported in this browser");
            audioCtx = null;
        }
    }
    return audioCtx;
};

const playClickSound = () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.01);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(220, ctx.currentTime);

    oscillator.start(ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
    oscillator.stop(ctx.currentTime + 0.1);
};

const playSuccessSound = () => {
    const ctx = getAudioContext();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(440, ctx.currentTime); // A4
    oscillator.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.1); // ramp up to A5

    oscillator.start(ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.2);
    oscillator.stop(ctx.currentTime + 0.2);
};


// --- UI Update Functions ---
const setStatus = (text, type = '') => {
    statusMessage.textContent = text;
    statusMessage.className = 'status-message';
    if (type) statusMessage.classList.add(type);
};

// --- Inventory Calculation Helpers ---
const getCalculatedInventory = () => {
    return inventoryData.map(item => {
        const montoValorizado = item.cantidad * item.precioUnitario;
        const valorPerdida = (item.stockProximaBaja || 0) * item.precioUnitario;
        const stockResultante = item.cantidad; // Stock resultante es la cantidad actual
        const inventarioResultante = stockResultante * item.precioUnitario;
        return { ...item, montoValorizado, valorPerdida, stockResultante, inventarioResultante };
    });
};

const calculateTotalInventoryValue = () => {
    const calculatedData = getCalculatedInventory();
    return calculatedData.reduce((sum, item) => sum + item.inventarioResultante, 0);
};

const updateSummaryDashboard = () => {
    if (!summaryDashboard) return;

    const salesTotal = salesHistory.reduce((sum, order) => sum + order.total, 0);
    const salesYape = salesHistory
        .filter(order => order.paymentMethod === 'YAPE')
        .reduce((sum, order) => sum + order.total, 0);
    const salesCash = salesHistory
        .filter(order => order.paymentMethod === 'Efectivo')
        .reduce((sum, order) => sum + order.total, 0);

    const inventarioValorizado = calculateTotalInventoryValue();

    summaryDashboard.innerHTML = `
        <div class="summary-item">
            <h4>INVENTARIO VALORIZADO ACT</h4>
            <p>S/ ${inventarioValorizado.toFixed(2)}</p>
        </div>
        <div class="summary-item">
            <h4>Ventas Totales</h4>
            <p>S/ ${salesTotal.toFixed(2)}</p>
        </div>
        <div class="summary-item">
            <h4>En Efectivo</h4>
            <p>S/ ${salesCash.toFixed(2)}</p>
        </div>
        <div class="summary-item">
            <h4>Por YAPE</h4>
            <p>S/ ${salesYape.toFixed(2)}</p>
        </div>
    `;
};

const renderDetailedInventory = () => {
    const calculatedData = getCalculatedInventory();

    let tableHTML = `<table id="inventory-table"><thead><tr>
        <th>Código</th><th>Producto</th><th>Categoría</th><th>Cantidad en Stock</th><th>Proveedor</th><th>Precio Venta Unitario</th>
        <th>Monto Valorizado</th><th>Stock Próxima Baja</th><th>Valor de Pérdida</th><th>Fecha Vencimiento</th>
        <th>Stock Resultante</th><th>Inventario Resultante</th>
    </tr></thead><tbody>`;

    calculatedData.forEach(item => {
        tableHTML += `<tr data-product-code="${item.codigo}">
            <td>${item.codigo}</td>
            <td>${item.producto}</td>
            <td>${item.categoria}</td>
            <td>${item.cantidad.toFixed(2)}</td>
            <td>${item.proveedor}</td>
            <td>S/ ${item.precioUnitario.toFixed(2)}</td>
            <td>S/ ${item.montoValorizado.toFixed(2)}</td>
            <td>${item.stockProximaBaja || 0}</td>
            <td>S/ ${item.valorPerdida.toFixed(2)}</td>
            <td>${item.fechaVencimiento || '--'}</td>
            <td>${item.stockResultante.toFixed(2)}</td>
            <td>S/ ${item.inventarioResultante.toFixed(2)}</td>
        </tr>`;
    });

    tableHTML += `</tbody><tfoot><tr>
        <td colspan="10">TOTAL INVENTARIO RESULTANTE</td>
        <td colspan="2" style="text-align:right;">S/ ${calculateTotalInventoryValue().toFixed(2)}</td>
    </tr></tfoot></table>`;

    detailedInventoryContainer.innerHTML = tableHTML;
};


// --- Speech Synthesis ---
const speak = (text, highPriority = false) => {
    if (!selectedVoice || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = selectedVoice;
    utterance.lang = 'es-US';
    utterance.rate = config.voiceSpeed;
    utterance.volume = config.voiceVolume;

    utterance.onend = () => {
        isSpeaking = false;
        if (speakQueue.length > 0) {
            const nextUtterance = speakQueue.shift();
            isSpeaking = true;
            window.speechSynthesis.speak(nextUtterance);
        }
    };
    utterance.onerror = () => {
        isSpeaking = false;
    };

    if (isSpeaking) {
        if (highPriority) {
            window.speechSynthesis.cancel();
            isSpeaking = true;
            window.speechSynthesis.speak(utterance);
        } else {
            speakQueue.push(utterance);
        }
    } else {
        isSpeaking = true;
        window.speechSynthesis.speak(utterance);
    }
};

// --- Bill Management ---
const updateBillTotal = () => {
    const total = bill.reduce((sum, item) => sum + item.amount, 0);
    billTotalEl.textContent = `Total: S/ ${total.toFixed(2)}`;
};

const renderBill = () => {
    billItemsContainer.innerHTML = '';
    if (bill.length === 0) {
        billItemsContainer.innerHTML = '<p class="empty-message">La cuenta está vacía.</p>';
    } else {
        bill.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'bill-item';
            itemEl.dataset.id = item.id;

            const quantityEquivalence = (item.unitPrice && item.unitPrice > 0)
                ? `(equiv. a ${(item.amount / item.unitPrice).toFixed(2)} ${item.unit})`
                : '';

            itemEl.innerHTML = `
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    <div class="item-details">
                        S/ ${item.unitPrice.toFixed(2)} x ${item.unit} ${quantityEquivalence}
                    </div>
                </div>
                <div class="item-actions">
                     <div class="item-price">S/ ${item.amount.toFixed(2)}</div>
                     <div class="buttons-container">
                        <button class="amount-button" data-id="${item.id}" aria-label="Ajustar monto">
                           Ajustar
                        </button>
                        <button class="remove-item-button" data-id="${item.id}" aria-label="Eliminar item">&times;</button>
                     </div>
                </div>
            `;
            billItemsContainer.appendChild(itemEl);
        });
    }
    updateBillTotal();
    addBillItemEventListeners();
};

const openAdjustModal = (id) => {
    const item = bill.find(i => i.id === id);
    if (!item) return;

    itemToAdjustId = id;
    adjustModalTitle.textContent = `Ajustar: ${item.name}`;

    let modalBodyHTML = '';

    if (['kg', 'g', 'l', 'ml'].includes(item.unit.toLowerCase())) {
        modalBodyHTML = `
            <div class="adjust-form-group">
                <label for="adjust-amount-input">Monto (S/)</label>
                <input type="number" id="adjust-amount-input" value="${item.amount.toFixed(2)}" step="0.1" min="0">
            </div>
            <div class="adjust-form-group">
                <label>Montos Rápidos</label>
                <div class="quick-adjust-buttons">
                    <button class="quick-adjust-button" data-amount="1.00">S/ 1.00</button>
                    <button class="quick-adjust-button" data-amount="2.00">S/ 2.00</button>
                    <button class="quick-adjust-button" data-amount="5.00">S/ 5.00</button>
                    <button class="quick-adjust-button" data-amount="10.00">S/ 10.00</button>
                </div>
            </div>
        `;
    } else {
        const currentQuantity = (item.unitPrice > 0) ? Math.round(item.amount / item.unitPrice) : 1;
        modalBodyHTML = `
            <div class="adjust-form-group">
                <label for="adjust-quantity-input">Cantidad</label>
                <input type="number" id="adjust-quantity-input" value="${currentQuantity}" step="1" min="1">
            </div>
             <div class="adjust-form-group">
                <p>Precio por unidad: S/ ${item.unitPrice.toFixed(2)}</p>
            </div>
        `;
    }

    adjustModalBody.innerHTML = modalBodyHTML;
    adjustModal.classList.remove('hidden');

    document.querySelectorAll('.quick-adjust-button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            playClickSound();
            const amount = e.target.dataset.amount;
            document.getElementById('adjust-amount-input').value = parseFloat(amount).toFixed(2);
        });
    });
};

const closeAdjustModal = () => {
    adjustModal.classList.add('hidden');
    itemToAdjustId = null;
};

const saveAdjustedAmount = () => {
    if (!itemToAdjustId) return;
    const item = bill.find(i => i.id === itemToAdjustId);
    if (!item) return;

    const amountInput = document.getElementById('adjust-amount-input');
    const quantityInput = document.getElementById('adjust-quantity-input');
    let newAmount;

    if (amountInput) {
        newAmount = parseFloat(amountInput.value);
    } else if (quantityInput) {
        const newQuantity = parseInt(quantityInput.value, 10);
        if (!isNaN(newQuantity) && newQuantity > 0) {
            newAmount = newQuantity * item.unitPrice;
        }
    }

    if (!isNaN(newAmount) && newAmount >= 0) {
        item.amount = newAmount;
        renderBill();
        closeAdjustModal();
    } else {
        alert('Por favor, ingrese un valor válido.');
    }
};

const adjustItemAmount = (id) => {
    openAdjustModal(id);
};


const removeItemFromBill = (id) => {
    bill = bill.filter(item => item.id !== id);
    renderBill();
};

const addBillItemEventListeners = () => {
    document.querySelectorAll('.remove-item-button').forEach(button => {
        button.addEventListener('click', (e) => {
            playClickSound();
            const id = Number(e.currentTarget.dataset.id);
            removeItemFromBill(id);
        });
    });

    document.querySelectorAll('.amount-button').forEach(button => {
        button.addEventListener('click', (e) => {
            playClickSound();
            const id = Number(e.currentTarget.dataset.id);
            adjustItemAmount(id);
        });
    });
};

// --- String Similarity Helper ---
const levenshteinDistance = (a, b) => {
    const an = a ? a.length : 0;
    const bn = b ? b.length : 0;
    if (an === 0) return bn;
    if (bn === 0) return an;
    const matrix = Array(bn + 1).fill(0).map(() => Array(an + 1).fill(0));
    for (let i = 0; i <= an; i += 1) { matrix[0][i] = i; }
    for (let j = 0; j <= bn; j += 1) { matrix[j][0] = j; }
    for (let j = 1; j <= bn; j += 1) {
        for (let i = 1; i <= an; i += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[j][i] = Math.min(
                matrix[j][i - 1] + 1,
                matrix[j - 1][i] + 1,
                matrix[j - 1][i - 1] + cost,
            );
        }
    }
    return matrix[bn][an];
};

const findProductInInventory = (name) => {
    if (!name) return null;
    const searchTerm = name.toLowerCase().trim();
    let bestMatch = null;
    let minDistance = Infinity;

    inventoryData.forEach(item => {
        const productName = item.producto.toLowerCase().replace(/\s*\([^)]*\)\s*/g, '').trim();
        const distance = levenshteinDistance(searchTerm, productName);
        const similarity = 1 - (distance / Math.max(searchTerm.length, productName.length));

        if (similarity > 0.6 && distance < minDistance) {
            minDistance = distance;
            bestMatch = item;
        }
    });

    return bestMatch;
};


const addItemToBill = (productInfo) => {
    const product = findProductInInventory(productInfo.name);

    if (!product) {
        console.warn(`Product not found: ${productInfo.name}`);
        return { success: false, reason: 'not_found', name: productInfo.name };
    }

    if (product.cantidad <= 0) {
        console.warn(`Product out of stock: ${product.producto}`);
        return { success: false, reason: 'no_stock', name: product.producto };
    }

    let amount = productInfo.amount;
    if (!amount && productInfo.quantity && product.precioUnitario) {
        amount = productInfo.quantity * product.precioUnitario;
    }

    if (amount > 0) {
        bill.push({
            id: Date.now() + Math.random(),
            name: product.producto,
            amount: amount,
            unitPrice: product.precioUnitario,
            unit: getUnitFromProduct(product),
            inventoryId: product.codigo
        });
        renderBill();
        return { success: true, name: product.producto };
    } else {
        console.warn(`Invalid amount for product: ${productInfo.name}`);
        return { success: false, reason: 'invalid_amount', name: productInfo.name };
    }
};

const startNewBill = (speakMessage = true) => {
    bill = [];
    renderBill();
    if (speakMessage) speak("Nueva cuenta lista.");
};

// --- Sales and Payment ---
const updateSalesHistoryDisplay = () => {
    if (salesHistory.length === 0 || currentSalesHistoryIndex < 0) {
        salesHistoryDisplay.textContent = 'REGISTRO: --';
        return;
    }
    const sale = salesHistory[currentSalesHistoryIndex];
    salesHistoryDisplay.textContent = `REGISTRO: ${sale.id} - S/ ${sale.total.toFixed(2)}`;
};

const processPayment = (method) => {
    if (bill.length === 0) {
        speak("La cuenta está vacía. No hay nada que pagar.");
        return;
    }

    const total = bill.reduce((sum, item) => sum + item.amount, 0);
    const sale = {
        id: `VTA-${Date.now()}`,
        user: config.shopName,
        timestamp: Date.now(),
        items: [...bill],
        total: total,
        paymentMethod: method,
    };

    salesHistory.push(sale);
    currentSalesHistoryIndex = salesHistory.length - 1;

    // Update inventory
    bill.forEach(billItem => {
        const inventoryItem = inventoryData.find(invItem => invItem.codigo === billItem.inventoryId);
        if (inventoryItem) {
            const quantitySold = (billItem.unitPrice > 0) ? (billItem.amount / billItem.unitPrice) : 0;
            inventoryItem.cantidad -= quantitySold;
        }
    });

    speak(`Pago de ${total.toFixed(2)} soles con ${method} confirmado. Gracias.`);
    
    startNewBill(false); 
    renderDetailedInventory();
    updateSummaryDashboard();
    updateSalesHistoryDisplay();
};

const exportFullReport = () => {
    if (inventoryData.length === 0) {
        speak("No hay datos de inventario para exportar.");
        return;
    }

    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = String(today.getFullYear()).slice(-2);
    const formattedDate = `${day}-${month}-${year}`;

    let exportCounter = 1;
    const lastExportData = JSON.parse(localStorage.getItem('lastExportData') || '{}');

    if (lastExportData.date === formattedDate) {
        exportCounter = lastExportData.counter + 1;
    }

    localStorage.setItem('lastExportData', JSON.stringify({ date: formattedDate, counter: exportCounter }));

    const formattedCounter = String(exportCounter).padStart(3, '0');
    const filename = `${config.userCode}_Repo_${formattedDate}_${formattedCounter}.xlsx`;

    const wb = XLSX.utils.book_new();

    // 1. Ventas Sheet
    const ventasSheetData = [];
    ventasSheetData.push(['Usuario', 'Fecha', 'Producto', 'Cantidad', 'Unidad', 'Precio Total', 'Método de Pago']);
    salesHistory.forEach(sale => {
        const saleDate = new Date(sale.timestamp).toLocaleString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
        sale.items.forEach((item, index) => {
            const row = [];
            if (index === 0) {
                row.push(sale.user, saleDate);
            } else {
                row.push('', '');
            }
             const quantity = item.unitPrice > 0 ? (item.amount / item.unitPrice).toFixed(2) : 1;
            row.push(item.name, quantity, item.unit, item.amount.toFixed(2), sale.paymentMethod);
            ventasSheetData.push(row);
        });
    });
    if (ventasSheetData.length > 1) {
      const wsVentas = XLSX.utils.aoa_to_sheet(ventasSheetData);
      XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas');
    }

    // 2. Inventario Velo Valorizado Sheet
    const inventarioSheetData = getCalculatedInventory().map(item => ({
        'Código': item.codigo,
        'Producto': item.producto,
        'Categoría': item.categoria,
        'Cantidad en Stock (UNIDADES)': item.cantidad,
        'Proveedor': item.proveedor,
        'PrecioVenta Unitario (soles)': item.precioUnitario,
        'Monto Valorizado soles': item.montoValorizado,
        'STOCK DE PROXIMA BAJA (UNIDADES)': item.stockProximaBaja,
        'VALOR DE PERDIDA': item.valorPerdida,
        'FECHA VENCIMIENTO': item.fechaVencimiento,
        'STOCK RESULTANTE': item.stockResultante,
        'INVENTARIO RESULTANTE': item.inventarioResultante,
    }));
    const wsInventario = XLSX.utils.json_to_sheet(inventarioSheetData);
    XLSX.utils.book_append_sheet(wb, wsInventario, 'Inventario Velo Valorizado');

    // 3. Productos Sheet
    const productosSheetData = inventoryData.map(item => ({
        'código': item.codigo,
        'descrip_producto': item.producto,
        'categoria_producto': item.categoria,
        'stock_produc': item.initialStock,
        'salida_produc': item.initialStock - item.cantidad,
        'saldo_produc': item.cantidad,
    }));
    const wsProductos = XLSX.utils.json_to_sheet(productosSheetData);
    XLSX.utils.book_append_sheet(wb, wsProductos, 'Productos');

    // 4. Placeholder Sheets
    const placeholderSheets = {
        'Entrada_merca': ['código', 'descrip_producto', 'categoria_producto', 'fecha_produccion', 'fecha_vcto', 'caducidad_dias', 'cantidad_ingreso', 'codigo_vto'],
        'Salida_merca': ['código', 'descrip_producto', 'categoria_producto', 'fecha_salida', 'cantidad_salida', 'codigo_vto'],
        'Precio_venta': ['código', 'descrip_producto', 'categoria_producto', 'fecha_vigencia', 'precio_venta'],
        'Costo_produc-Margen': ['código', 'descrip_producto', 'categoria_producto', 'fecha_ultima', 'precio_costo', 'stock', 'inventario_valor_costos', 'productos_vendidos', 'margen_ganancia(%)', 'ganancia_soles']
    };

    for (const sheetName in placeholderSheets) {
        const ws = XLSX.utils.aoa_to_sheet([placeholderSheets[sheetName]]);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    
    XLSX.writeFile(wb, `Reporte_Caserita_Smart.xlsx`);
    speak(`Reporte completo exportado.`);
};


// --- Command Processing ---
const processCommand = (jsonResponse) => {
    const { command, products } = jsonResponse;
    switch (command) {
        case 'AGREGAR_PRODUCTO':
            if (products && products.length > 0) {
                const addedProducts = [];
                const notFoundProducts = [];
                const noStockProducts = [];

                products.forEach(p => {
                    const result = addItemToBill(p);
                    if (result.success) {
                        addedProducts.push(result.name);
                    } else if (result.reason === 'not_found') {
                        notFoundProducts.push(result.name);
                    } else if (result.reason === 'no_stock') {
                        noStockProducts.push(result.name);
                    }
                });
                
                // Play sound ONLY if one or more products were successfully added.
                if (addedProducts.length > 0) {
                    playSuccessSound();
                }

                // Construct and speak error message ONLY if there were failures.
                let errorMessage = '';
                if (notFoundProducts.length > 0) {
                    errorMessage += `No encontré: ${notFoundProducts.join(', ')}. `;
                }
                if (noStockProducts.length > 0) {
                    errorMessage += `Sin stock: ${noStockProducts.join(', ')}. `;
                }
                
                // Speak only if there is an error message.
                // This ensures no voice confirmation on successful additions.
                if (errorMessage.trim()) {
                    speak(errorMessage.trim(), true);
                } else if (products.length > 0 && addedProducts.length === 0) {
                    // This case handles when AI found products, but none could be added for other reasons.
                    speak("No pude agregar los productos. Por favor, revisa el pedido.", true);
                }

            } else {
                speak("No entendí qué producto agregar.", true);
            }
            break;
        case 'ELIMINAR_PRODUCTO':
             // Logic to find and remove product by name
             speak("Producto eliminado.");
             break;
        case 'NUEVA_CUENTA':
            startNewBill();
            break;
        case 'PAGAR_YAPE':
            processPayment('YAPE');
            break;
        case 'PAGAR_EFECTIVO':
            processPayment('Efectivo');
            break;
        case 'NINGUNO':
        default:
            speak("No entendí el comando. Por favor, intenta de nuevo.");
            break;
    }
};

const processVoiceCommand = async (transcript) => {
    if (!transcript || isProcessing) return;

    setStatus('Procesando...', 'processing');
    isProcessing = true;
    micButton.disabled = true;

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ parts: [{ text: transcript }] }],
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: RESPONSE_SCHEMA,
                thinkingConfig: { thinkingBudget: 0 },
            },
        });
        
        const jsonText = result.text.trim();
        const response = JSON.parse(jsonText);

        console.log('AI Response:', response);
        processCommand(response);

    } catch (error) {
        console.error("Error processing voice command:", error);
        setStatus('Error. Intenta de nuevo.', 'error');
        speak("Hubo un error al procesar tu pedido. Por favor, intenta de nuevo.");
    } finally {
        isProcessing = false;
        micButton.disabled = false;
        if (!isRecording) {
            setStatus('Presiona para hablar');
        } else {
            setStatus('Escuchando...', 'listening');
        }
    }
};

// --- Voice Recognition ---
const startRecording = () => {
    if (isRecording || !recognition) return;
    try {
        autoRestartRecognition = true;
        recognition.start();
    } catch (e) {
        console.error("Could not start recognition:", e);
        setStatus('Error al iniciar.', 'error');
        isRecording = false;
        micButton.classList.remove('recording');
    }
};

const stopRecording = () => {
    if (isRecording && recognition) {
        autoRestartRecognition = false;
        recognition.stop();
    }
};

const setupRecognition = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        setStatus('Navegador no compatible.', 'error');
        micButton.disabled = true;
        speak("Lo siento, tu navegador no es compatible con el reconocimiento de voz.");
        return false;
    }

    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'es-PE';

    let commandProcessTimeout = null;
    let finalTranscriptSinceLastProcess = '';

    recognition.onstart = () => {
        isRecording = true;
        micButton.classList.add('recording');
        setStatus('Escuchando...', 'listening');
    };

    recognition.onresult = (event) => {
        if (commandProcessTimeout) clearTimeout(commandProcessTimeout);

        let interimTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcriptPart = event.results[i][0].transcript.toLowerCase();
            if (event.results[i].isFinal) {
                finalTranscriptSinceLastProcess += transcriptPart.trim() + ' ';
            } else {
                interimTranscript += transcriptPart;
            }
        }
        
        liveTranscriptDisplay.textContent = interimTranscript || finalTranscriptSinceLastProcess;

        const currentSpeech = interimTranscript + finalTranscriptSinceLastProcess;
        if (!isPanicActive) {
            for (const phrase of PANIC_PHRASES) {
                if (currentSpeech.includes(phrase)) {
                    console.log(`Panic phrase detected: "${phrase}"`);
                    stopRecording(); // This correctly sets autoRestartRecognition to false
                    startSiren();
                    finalTranscriptSinceLastProcess = ''; 
                    liveTranscriptDisplay.textContent = '¡PÁNICO ACTIVADO!';
                    setStatus('¡PÁNICO ACTIVADO!', 'error');
                    return;
                }
            }
        }

        // Set a timeout to process the command after a pause in speech.
        commandProcessTimeout = setTimeout(() => {
            const transcriptToProcess = finalTranscriptSinceLastProcess.trim();
            if (transcriptToProcess) {
                liveTranscriptDisplay.textContent = ''; // Clear display
                finalTranscriptSinceLastProcess = ''; // Reset buffer for next command
                processVoiceCommand(transcriptToProcess);
            }
        }, 1200); // 1.2 second pause
    };

    recognition.onend = () => {
        // This handler is now for session-ending events (manual stop, errors, browser timeout)
        if (commandProcessTimeout) clearTimeout(commandProcessTimeout);

        // Process any final lingering transcript that didn't get timed out
        const transcriptToProcess = finalTranscriptSinceLastProcess.trim();
        finalTranscriptSinceLastProcess = '';
        liveTranscriptDisplay.textContent = ''; 

        if (transcriptToProcess && !isPanicActive) {
            processVoiceCommand(transcriptToProcess);
        }

        if (autoRestartRecognition) {
            // This is the key for recovering from errors like 'no-speech'
            console.log("Recognition session ended, restarting automatically.");
            try {
                recognition.start();
            } catch(e) {
                console.error("Error restarting recognition:", e);
                isRecording = false;
                micButton.classList.remove('recording');
                setStatus('Error. Presiona para hablar', 'error');
            }
        } else {
            // This path is taken when stopRecording() is called by the user
            isRecording = false;
            micButton.classList.remove('recording');
            setStatus('Presiona para hablar');
        }
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        
        // Silently ignore non-fatal errors that are handled by the onend restart logic.
        if (event.error === 'no-speech' || event.error === 'aborted') {
            return; 
        }

        let errorMessage = 'Error de reconocimiento.';
        let speakMessage = 'Hubo un error. Por favor, intenta de nuevo.';

        switch (event.error) {
            case 'audio-capture':
                errorMessage = 'Error de micrófono.';
                speakMessage = 'No puedo acceder al micrófono. Revisa si está conectado y no está siendo usado por otra aplicación.';
                autoRestartRecognition = false; // Fatal error
                recognition = null;
                break;
            case 'not-allowed':
                errorMessage = 'Permiso denegado.';
                speakMessage = 'El permiso para usar el micrófono fue denegado. Habilítalo en la configuración del navegador.';
                autoRestartRecognition = false; // Fatal error
                recognition = null;
                break;
            case 'network':
                errorMessage = 'Error de red. Reintentando...';
                // Let onend handle the restart for this.
                break;
            default:
                errorMessage = `Error: ${event.error}`;
                autoRestartRecognition = false; // Stop on unknown errors
                break;
        }

        setStatus(errorMessage, 'error');
        speak(speakMessage);
    };
    
    return true; // Indicate success
};

const handleMicButtonClick = async () => {
    if (isRecording) {
        stopRecording();
        return;
    }

    if (!recognition) {
        try {
            micButton.disabled = true;
            setStatus('Pidiendo permiso...', 'processing');
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                setStatus('Función no disponible.', 'error');
                micButton.disabled = true;
                speak("Lo siento, tu navegador no permite el acceso al micrófono.");
                return;
            }
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            
            if (!setupRecognition()) {
                return;
            };
        } catch (err) {
            console.error("Microphone permission error:", err);
            setStatus('Permiso denegado.', 'error');
            speak("Necesito acceso al micrófono para funcionar. Por favor, activa el permiso en la configuración de tu navegador.");
            alert("Para usar el control por voz, necesitas permitir el acceso al micrófono. Por favor, habilítalo en la configuración de tu navegador.");
            micButton.disabled = false;
            return;
        } finally {
            micButton.disabled = false;
        }
    }
    
    startRecording();
};


// --- Panic Button / Siren ---
const startSiren = () => {
    if (isPanicActive) return;
    isPanicActive = true;
    panicButton.classList.add('active');
    panicOverlay.classList.remove('hidden');
    stopRecording();

    try {
        sirenAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        sirenOscillator = sirenAudioCtx.createOscillator();
        sirenGain = sirenAudioCtx.createGain();

        sirenOscillator.connect(sirenGain);
        sirenGain.connect(sirenAudioCtx.destination);
        sirenOscillator.type = 'sine';
        sirenGain.gain.setValueAtTime(0.5, sirenAudioCtx.currentTime);
        sirenOscillator.start();
        
        const setSirenFrequency = () => {
            if (!sirenAudioCtx) return;
            const now = sirenAudioCtx.currentTime;
            sirenOscillator.frequency.cancelScheduledValues(now);
            sirenOscillator.frequency.setValueAtTime(800, now);
            sirenOscillator.frequency.linearRampToValueAtTime(1200, now + 0.5);
            sirenOscillator.frequency.linearRampToValueAtTime(800, now + 1.0);
        };
        
        setSirenFrequency();
        sirenLoopInterval = setInterval(setSirenFrequency, 1000);

    } catch(e) {
        console.error("Could not start siren:", e);
        isPanicActive = false; // reset state
    }
};

const stopSiren = () => {
    if (!isPanicActive) return;
    isPanicActive = false;
    
    clearInterval(sirenLoopInterval);
    sirenLoopInterval = null;

    if (sirenOscillator) {
        sirenOscillator.stop();
        sirenOscillator.disconnect();
    }
    if (sirenGain) {
        sirenGain.disconnect();
    }
    if (sirenAudioCtx) {
        sirenAudioCtx.close().catch(e => console.error("Error closing AudioContext", e));
    }
    sirenOscillator = null;
    sirenGain = null;
    sirenAudioCtx = null;

    panicButton.classList.remove('active');
    panicOverlay.classList.add('hidden');
    // Restore original button content
    panicButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 0 24 24" width="24px" fill="#FFFFFF">
            <path d="M0 0h24v24H0V0z" fill="none"/>
            <path d="M12 5.99L19.53 19H4.47L12 5.99M12 2L1 21h22L12 2zm1 14h-2v2h2v-2zm0-6h-2v4h2v-4z"/>
        </svg>
    `;
};


// --- Teleprompter and Config ---
const applyTeleprompterState = () => {
    if (config.isTeleprompterPaused) {
        teleprompterContent.classList.add('paused');
        configToggleTeleprompter.textContent = 'Reanudar Anuncios';
    } else {
        teleprompterContent.classList.remove('paused');
        configToggleTeleprompter.textContent = 'Pausar Anuncios';
    }
};

const setupTeleprompter = () => {
    teleprompterContent.innerHTML = TELEPROMPTER_MESSAGES.map(msg => `<span>${msg}</span>`).join('');
    // Duplicate content to ensure smooth looping
    teleprompterContent.innerHTML += teleprompterContent.innerHTML;
    applyTeleprompterSpeed(config.teleprompterSpeed);
    configSpeedSlider.value = config.teleprompterSpeed;
};

const applyTeleprompterSpeed = (speed) => {
    const speedValue = parseInt(speed, 10);
    teleprompterContent.style.animationDuration = `${speedValue}s`;
    
    let speedText = 'Normal';
    if (speedValue > 40) speedText = 'Lento';
    if (speedValue < 20) speedText = 'Rápido';
    configSpeedValue.textContent = speedText;
};

const applyVoiceConfig = () => {
    // Voice Speed
    const speed = parseFloat(configVoiceSpeedSlider.value);
    let speedText = 'Normal';
    if (speed < 1.0) speedText = 'Lenta';
    if (speed > 1.4) speedText = 'Rápida';
    configVoiceSpeedValue.textContent = speedText;

    // Voice Volume
    const volume = parseFloat(configVoiceVolumeSlider.value);
    configVoiceVolumeValue.textContent = `${Math.round(volume * 100)}%`;
};

// --- Initialization ---
const initApp = () => {
    try {
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } catch (error) {
        console.error("Failed to initialize GoogleGenAI:", error);
        setStatus('Error de API Key.', 'error');
        micButton.disabled = true;
        return;
    }

    const savedConfig = localStorage.getItem('caseritaConfig');
    if (savedConfig) {
        config = JSON.parse(savedConfig);
    }

    // Initialize inventory with initial stock tracking
    inventoryData = DETAILED_INVENTORY_DATA_CONST.map(item => ({
        ...item,
        initialStock: item.cantidad 
    }));


    renderDetailedInventory();
    updateSummaryDashboard();
    renderBill();
    setupTeleprompter();
    applyTeleprompterState();

    // Setup voices
    const loadVoices = () => {
        const voices = window.speechSynthesis.getVoices();
        selectedVoice = voices.find(v => v.lang === 'es-US' && v.name.includes('Google')) || voices.find(v => v.lang === 'es-US') || voices.find(v => v.lang.startsWith('es-'));
    };
    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    // Event Listeners
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        playClickSound();
        loginContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
    });

    logoutButton.addEventListener('click', () => {
        playClickSound();
        appContainer.classList.add('hidden');
        loginContainer.classList.remove('hidden');
    });

    micButton.addEventListener('click', () => {
        playClickSound();
        handleMicButtonClick();
    });
    newBillButton.addEventListener('click', () => {
        playClickSound();
        startNewBill(true);
    });
    tipsButton.addEventListener('click', () => {
        playClickSound();
        tipsModal.classList.remove('hidden');
    });
    tipsModalClose.addEventListener('click', () => {
        playClickSound();
        tipsModal.classList.add('hidden');
    });

    movementInventoryButton.addEventListener('click', () => {
        playClickSound();
        catalogContentWrapper.classList.toggle('hidden');
    });

    payYapeButton.addEventListener('click', () => {
        playClickSound();
        processPayment('YAPE');
    });

    payCashButton.addEventListener('click', () => {
        playClickSound();
        processPayment('Efectivo');
    });
    
    exportReportButton.addEventListener('click', () => {
        playClickSound();
        exportFullReport();
    });

    salesHistoryPrev.addEventListener('click', () => {
        playClickSound();
        if (salesHistory.length > 0 && currentSalesHistoryIndex > 0) {
            currentSalesHistoryIndex--;
            updateSalesHistoryDisplay();
        }
    });
    salesHistoryNext.addEventListener('click', () => {
        playClickSound();
        if (salesHistory.length > 0 && currentSalesHistoryIndex < salesHistory.length - 1) {
            currentSalesHistoryIndex++;
            updateSalesHistoryDisplay();
        }
    });
    
    panicButton.addEventListener('click', () => {
        if (isPanicActive) {
            stopSiren();
        } else {
            // No click sound for panic
            startSiren();
        }
    });

    [shareButton, printTicketButton, tutorialButton, testVoiceButton, modalConfirmButton, modalCancelButton].forEach(btn => {
        if(btn) btn.addEventListener('click', playClickSound);
    });

    adjustModalSave.addEventListener('click', () => {
        playClickSound();
        saveAdjustedAmount();
    });
    adjustModalCancel.addEventListener('click', () => {
        playClickSound();
        closeAdjustModal();
    });
    
    // Config Modal Listeners
    configButton.addEventListener('click', () => {
        playClickSound();
        configUserCodeInput.value = config.userCode;
        configShopNameInput.value = config.shopName;
        configSpeedSlider.value = config.teleprompterSpeed;
        applyTeleprompterSpeed(config.teleprompterSpeed);
        configVoiceSpeedSlider.value = config.voiceSpeed;
        configVoiceVolumeSlider.value = config.voiceVolume;
        applyVoiceConfig();
        applyTeleprompterState();
        configModal.classList.remove('hidden');
    });
    configModalClose.addEventListener('click', () => {
        playClickSound();
        config.userCode = configUserCodeInput.value || 'VP100';
        config.shopName = configShopNameInput.value || 'Mi Bodeguita';
        config.teleprompterSpeed = configSpeedSlider.value;
        config.voiceSpeed = parseFloat(configVoiceSpeedSlider.value);
        config.voiceVolume = parseFloat(configVoiceVolumeSlider.value);
        localStorage.setItem('caseritaConfig', JSON.stringify(config));
        configModal.classList.add('hidden');
    });
    configSpeedSlider.addEventListener('input', (e) => {
        applyTeleprompterSpeed(e.target.value);
    });
    configToggleTeleprompter.addEventListener('click', () => {
        playClickSound();
        config.isTeleprompterPaused = !config.isTeleprompterPaused;
        applyTeleprompterState();
    });
    configVoiceSpeedSlider.addEventListener('input', applyVoiceConfig);
    configVoiceVolumeSlider.addEventListener('input', applyVoiceConfig);
};

document.addEventListener('DOMContentLoaded', initApp);
