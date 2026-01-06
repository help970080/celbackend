// services/backupService.js - Backup automático a Cloudinary
const cloudinary = require('cloudinary').v2;
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');

/**
 * Crear backup de la base de datos usando Sequelize
 */
async function createDatabaseBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `celexpress-backup-${timestamp}.json`;
    const filePath = path.join('/tmp', fileName);

    try {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error('DATABASE_URL no está configurada');
        }

        console.log(`🔄 Iniciando backup de base de datos...`);
        console.log(`   Archivo: ${fileName}`);

        // Conectar a la base de datos
        const sequelize = new Sequelize(databaseUrl, {
            dialect: 'postgres',
            protocol: 'postgres',
            dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
            logging: false
        });

        // Obtener lista de tablas
        const [tables] = await sequelize.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE'
            ORDER BY table_name;
        `);

        console.log(`   📋 Tablas encontradas: ${tables.length}`);

        // Exportar cada tabla
        const backupData = {
            metadata: {
                createdAt: new Date().toISOString(),
                database: 'celexpress',
                tables: tables.length
            },
            tables: {}
        };

        for (const table of tables) {
            const tableName = table.table_name;
            try {
                const [rows] = await sequelize.query(`SELECT * FROM "${tableName}"`);
                backupData.tables[tableName] = {
                    count: rows.length,
                    data: rows
                };
                console.log(`   ✅ ${tableName}: ${rows.length} registros`);
            } catch (e) {
                console.log(`   ⚠️ ${tableName}: Error - ${e.message}`);
                backupData.tables[tableName] = { count: 0, data: [], error: e.message };
            }
        }

        // Cerrar conexión
        await sequelize.close();

        // Guardar archivo JSON
        fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));

        const stats = fs.statSync(filePath);
        console.log(`✅ Backup creado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        return { success: true, filePath, fileName };
    } catch (error) {
        console.error('❌ Error creando backup:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Subir archivo a Cloudinary
 */
async function uploadToCloudinary(filePath, fileName) {
    try {
        console.log('📤 Subiendo backup a Cloudinary...');
        
        const result = await cloudinary.uploader.upload(filePath, {
            resource_type: 'raw',
            public_id: `backups/${fileName.replace('.json', '')}`,
            folder: 'celexpress-backups',
            overwrite: true
        });

        console.log(`✅ Backup subido a Cloudinary`);
        console.log(`   URL: ${result.secure_url}`);

        return {
            success: true,
            fileId: result.public_id,
            fileName: fileName,
            link: result.secure_url,
            size: result.bytes
        };
    } catch (error) {
        console.error('❌ Error subiendo a Cloudinary:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Ejecutar backup completo (crear + subir a Cloudinary)
 */
async function executeFullBackup() {
    console.log('\n========================================');
    console.log('🗄️  BACKUP AUTOMÁTICO - CelExpress');
    console.log(`   Fecha: ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
    console.log('========================================\n');

    try {
        // Paso 1: Crear backup local
        const backupResult = await createDatabaseBackup();
        if (!backupResult.success) {
            throw new Error(backupResult.error);
        }

        // Paso 2: Subir a Cloudinary
        const uploadResult = await uploadToCloudinary(backupResult.filePath, backupResult.fileName);
        if (!uploadResult.success) {
            throw new Error(uploadResult.error);
        }

        // Paso 3: Eliminar archivo temporal
        fs.unlinkSync(backupResult.filePath);
        console.log('🗑️  Archivo temporal eliminado');

        console.log('\n✅ BACKUP COMPLETADO EXITOSAMENTE\n');

        return {
            success: true,
            fileName: backupResult.fileName,
            cloudinaryUrl: uploadResult.link,
            size: uploadResult.size,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('\n❌ BACKUP FALLÓ:', error.message, '\n');
        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Listar backups en Cloudinary
 */
async function listBackups() {
    try {
        const result = await cloudinary.api.resources({
            type: 'upload',
            resource_type: 'raw',
            prefix: 'celexpress-backups/backups/',
            max_results: 30
        });

        const backups = result.resources.map(file => ({
            id: file.public_id,
            name: file.public_id.split('/').pop() + '.json',
            createdAt: file.created_at,
            size: file.bytes ? `${(file.bytes / 1024 / 1024).toFixed(2)} MB` : 'N/A',
            link: file.secure_url
        }));

        // Ordenar por fecha descendente
        backups.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        return {
            success: true,
            backups
        };
    } catch (error) {
        console.error('Error listando backups:', error.message);
        return { success: false, error: error.message, backups: [] };
    }
}

module.exports = {
    executeFullBackup,
    createDatabaseBackup,
    uploadToCloudinary,
    listBackups
};