// routes/clientDocumentsRoutes.js - SUBIDA DE DOCUMENTOS Y VERIFICACIÓN

const express = require('express');
const router = express.Router();
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const authorizeRoles = require('../middleware/roleMiddleware');
const applyStoreFilter = require('../middleware/storeFilterMiddleware');

// Configurar multer para memoria (subimos directo a Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB máximo
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Solo se permiten imágenes'), false);
        }
    }
});

let Client, AuditLog;

const initClientDocumentsRoutes = (models) => {
    Client = models.Client;
    AuditLog = models.AuditLog;

    // ⭐ CONFIGURAR CLOUDINARY AQUÍ DENTRO
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET
    });

    console.log('☁️ Cloudinary configurado:', process.env.CLOUDINARY_CLOUD_NAME ? 'OK' : 'FALTAN VARIABLES');

    // Subir documento específico
    router.post('/:clientId/documents/:docType',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        upload.single('image'),
        async (req, res) => {
            const { clientId, docType } = req.params;
            
            const validDocTypes = ['ineFrente', 'ineReverso', 'selfie', 'fotoEntrega', 'fotoEquipo'];
            if (!validDocTypes.includes(docType)) {
                return res.status(400).json({ message: `Tipo de documento inválido. Usar: ${validDocTypes.join(', ')}` });
            }

            if (!req.file) {
                return res.status(400).json({ message: 'No se recibió ninguna imagen' });
            }

            try {
                // Verificar que el cliente existe y pertenece a la tienda
                const client = await Client.findOne({
                    where: {
                        id: clientId,
                        ...req.storeFilter
                    }
                });

                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado o no pertenece a tu tienda' });
                }

                // Subir a Cloudinary
                const uploadResult = await new Promise((resolve, reject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {
                            folder: `celexpress/clients/${clientId}`,
                            public_id: `${docType}_${Date.now()}`,
                            resource_type: 'image',
                            transformation: [
                                { width: 1200, height: 1200, crop: 'limit' },
                                { quality: 'auto' }
                            ]
                        },
                        (error, result) => {
                            if (error) reject(error);
                            else resolve(result);
                        }
                    );
                    uploadStream.end(req.file.buffer);
                });

                // Mapear docType a campo de BD
                const fieldMap = {
                    'ineFrente': 'ineFrente',
                    'ineReverso': 'ineReverso',
                    'selfie': 'selfie',
                    'fotoEntrega': 'fotoEntrega',
                    'fotoEquipo': 'fotoEquipo'
                };

                // Actualizar cliente con la URL
                await client.update({
                    [fieldMap[docType]]: uploadResult.secure_url
                });

                // Auditoría
                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'SUBIÓ DOCUMENTO',
                        details: `Documento: ${docType} para Cliente ID: ${clientId}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) {
                    console.error('Error en auditoría:', auditError);
                }

                res.json({
                    message: 'Documento subido exitosamente',
                    docType,
                    url: uploadResult.secure_url
                });

            } catch (error) {
                console.error('Error al subir documento:', error);
                res.status(500).json({ message: 'Error al subir documento', error: error.message });
            }
        }
    );

    // Obtener documentos de un cliente
    router.get('/:clientId/documents',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin', 'collector_agent']),
        applyStoreFilter,
        async (req, res) => {
            const { clientId } = req.params;

            try {
                const client = await Client.findOne({
                    where: {
                        id: clientId,
                        ...req.storeFilter
                    },
                    attributes: [
                        'id', 'name', 'lastName',
                        'ineFrente', 'ineReverso', 'selfie', 
                        'fotoEntrega', 'fotoEquipo',
                        'verificacionFacial', 'verificadoEl', 'estadoVerificacion'
                    ]
                });

                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado' });
                }

                res.json({
                    clientId: client.id,
                    clientName: `${client.name} ${client.lastName}`,
                    documents: {
                        ineFrente: client.ineFrente,
                        ineReverso: client.ineReverso,
                        selfie: client.selfie,
                        fotoEntrega: client.fotoEntrega,
                        fotoEquipo: client.fotoEquipo
                    },
                    verification: {
                        score: client.verificacionFacial,
                        verifiedAt: client.verificadoEl,
                        status: client.estadoVerificacion
                    }
                });

            } catch (error) {
                console.error('Error al obtener documentos:', error);
                res.status(500).json({ message: 'Error al obtener documentos' });
            }
        }
    );

    // Guardar resultado de verificación facial
    router.post('/:clientId/verification',
        authorizeRoles(['super_admin', 'regular_admin', 'sales_admin']),
        applyStoreFilter,
        async (req, res) => {
            const { clientId } = req.params;
            const { score } = req.body;

            if (typeof score !== 'number' || score < 0 || score > 100) {
                return res.status(400).json({ message: 'Score debe ser un número entre 0 y 100' });
            }

            try {
                const client = await Client.findOne({
                    where: {
                        id: clientId,
                        ...req.storeFilter
                    }
                });

                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado' });
                }

                // Determinar estado basado en score
                let status = 'pendiente';
                if (score >= 70) {
                    status = 'verificado';
                } else if (score >= 50) {
                    status = 'revision';
                } else {
                    status = 'rechazado';
                }

                await client.update({
                    verificacionFacial: score,
                    verificadoEl: new Date(),
                    estadoVerificacion: status
                });

                // Auditoría
                try {
                    await AuditLog.create({
                        userId: req.user.userId,
                        username: req.user.username,
                        action: 'VERIFICACIÓN FACIAL',
                        details: `Cliente ID: ${clientId} - Score: ${score.toFixed(1)}% - Estado: ${status}`,
                        tiendaId: req.user.tiendaId
                    });
                } catch (auditError) {
                    console.error('Error en auditoría:', auditError);
                }

                res.json({
                    message: 'Verificación guardada',
                    score,
                    status,
                    verifiedAt: new Date()
                });

            } catch (error) {
                console.error('Error al guardar verificación:', error);
                res.status(500).json({ message: 'Error al guardar verificación' });
            }
        }
    );

    // Eliminar documento específico
    router.delete('/:clientId/documents/:docType',
        authorizeRoles(['super_admin']),
        applyStoreFilter,
        async (req, res) => {
            const { clientId, docType } = req.params;

            const validDocTypes = ['ineFrente', 'ineReverso', 'selfie', 'fotoEntrega', 'fotoEquipo'];
            if (!validDocTypes.includes(docType)) {
                return res.status(400).json({ message: 'Tipo de documento inválido' });
            }

            try {
                const client = await Client.findOne({
                    where: {
                        id: clientId,
                        ...req.storeFilter
                    }
                });

                if (!client) {
                    return res.status(404).json({ message: 'Cliente no encontrado' });
                }

                await client.update({
                    [docType]: null
                });

                res.json({ message: 'Documento eliminado' });

            } catch (error) {
                console.error('Error al eliminar documento:', error);
                res.status(500).json({ message: 'Error al eliminar documento' });
            }
        }
    );

    return router;
};

module.exports = initClientDocumentsRoutes;