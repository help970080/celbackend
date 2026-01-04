// services/twilioCallService.js - Servicio de llamadas automáticas a clientes
const twilio = require('twilio');

const TWILIO_SID = process.env.TWILIO_SID;
const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE;
const WHATSAPP_CONTACTO = process.env.WHATSAPP_CONTACTO || '55 6672 1121';
const BACKEND_URL = process.env.BACKEND_URL || 'https://celbackend.onrender.com';

const client = twilio(TWILIO_SID, TWILIO_TOKEN);

/**
 * Genera el mensaje TTS según el tipo de recordatorio
 */
function generarMensaje(tipo, nombre, monto) {
    const nombreLimpio = nombre.split(' ')[0]; // Solo primer nombre
    const montoFormateado = parseFloat(monto).toLocaleString('es-MX');
    
    if (tipo === 'preventivo') {
        // 1 día antes del vencimiento
        return `
            <Response>
                <Say voice="alice" language="es-MX">
                    Hola ${nombreLimpio}, le llamamos de CelExpress. 
                    Le recordamos que mañana vence su pago de ${montoFormateado} pesos. 
                    Para evitar el bloqueo de su equipo, realice su pago a tiempo. 
                    Si tiene dudas, comuníquese por WhatsApp al ${WHATSAPP_CONTACTO}. 
                    Gracias por su preferencia.
                </Say>
            </Response>
        `;
    } else {
        // Día del vencimiento
        return `
            <Response>
                <Say voice="alice" language="es-MX">
                    Hola ${nombreLimpio}, le llamamos de CelExpress. 
                    Hoy vence su pago de ${montoFormateado} pesos. 
                    Si no realiza su pago, su equipo será bloqueado mañana. 
                    Comuníquese por WhatsApp al ${WHATSAPP_CONTACTO}. 
                    Gracias.
                </Say>
            </Response>
        `;
    }
}

/**
 * Realiza una llamada a un cliente
 */
async function realizarLlamada(telefono, nombre, monto, tipo, saleId, clientId) {
    try {
        // Limpiar y formatear número
        let numeroLimpio = telefono.replace(/\D/g, '');
        
        // Agregar código de país si no lo tiene
        if (numeroLimpio.length === 10) {
            numeroLimpio = '52' + numeroLimpio;
        }
        if (!numeroLimpio.startsWith('+')) {
            numeroLimpio = '+' + numeroLimpio;
        }

        // Validar que sea número mexicano válido
        if (numeroLimpio.length < 12 || numeroLimpio.length > 14) {
            throw new Error(`Número inválido: ${telefono}`);
        }

        const twiml = generarMensaje(tipo, nombre, monto);
        
        const call = await client.calls.create({
            twiml: twiml,
            to: numeroLimpio,
            from: TWILIO_PHONE,
            statusCallback: `${BACKEND_URL}/api/llamadas/webhook`,
            statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
            statusCallbackMethod: 'POST',
            timeout: 30,
            machineDetection: 'Enable'
        });

        return {
            success: true,
            callSid: call.sid,
            status: call.status,
            to: numeroLimpio,
            tipo,
            saleId,
            clientId
        };

    } catch (error) {
        console.error('Error al realizar llamada:', error);
        return {
            success: false,
            error: error.message,
            to: telefono,
            tipo,
            saleId,
            clientId
        };
    }
}

/**
 * Verifica si está dentro del horario permitido (9 AM - 6 PM)
 */
function dentroDeHorario() {
    const ahora = new Date();
    const horasMexico = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const hora = horasMexico.getHours();
    
    return hora >= 9 && hora < 18;
}

/**
 * Obtiene la próxima ventana de llamadas
 */
function proximaVentanaLlamadas() {
    const ahora = new Date();
    const horasMexico = new Date(ahora.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const hora = horasMexico.getHours();
    
    if (hora < 9) {
        return `Hoy a las 9:00 AM`;
    } else if (hora >= 18) {
        return `Mañana a las 9:00 AM`;
    } else {
        return `Ahora (dentro de horario)`;
    }
}

module.exports = {
    realizarLlamada,
    generarMensaje,
    dentroDeHorario,
    proximaVentanaLlamadas,
    WHATSAPP_CONTACTO
};