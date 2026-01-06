// services/backupService.js - Backup automático a Google Drive
const { google } = require('googleapis');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuración de Google Drive
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1gAXqEu3BDH8QoCDT2wrdIyC0gytioSQP';

// Credenciales de la cuenta de servicio
const GOOGLE_CREDENTIALS = {
    type: "service_account",
    project_id: "celexpress-backups",
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID || "2e268bc8b2e3d34c2862e82ff4b49e5cb1105bec",
    private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, '\n'),
    client_email: "celexpress-backup@celexpress-backups.iam.gserviceaccount.com",
    client_id: "104872331655676559796",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token"
};

/**
 * Autenticar con Google Drive
 */
async function getGoogleDriveAuth() {
    const auth = new google.auth.GoogleAuth({
        credentials: GOOGLE_CREDENTIALS,
        scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    return auth;
}

/**
 * Subir archivo a Google Drive
 */
async function uploadToGoogleDrive(filePath, fileName) {
    try {
        const auth = await getGoogleDriveAuth();
        const drive = google.drive({ version: 'v3', auth });

        const fileMetadata = {
            name: fileName,
            parents: [GOOGLE_DRIVE_FOLDER_ID]
        };

        const media = {
            mimeType: 'application/sql',
            body: fs.createReadStream(filePath)
        };

        const response = await drive.files.create({
            requestBody: fileMetadata,
            media: media,
            fields: 'id, name, webViewLink'
        });

        console.log(`✅ Backup subido a Google Drive: ${response.data.name}`);
        console.log(`   Link: ${response.data.webViewLink}`);

        return {
            success: true,
            fileId: response.data.id,
            fileName: response.data.name,
            link: response.data.webViewLink
        };
    } catch (error) {
        console.error('❌ Error subiendo a Google Drive:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Crear backup de la base de datos
 */
async function createDatabaseBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `celexpress-backup-${timestamp}.sql`;
    const filePath = path.join('/tmp', fileName);

    try {
        // Obtener DATABASE_URL
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
            throw new Error('DATABASE_URL no está configurada');
        }

        console.log(`🔄 Iniciando backup de base de datos...`);
        console.log(`   Archivo: ${fileName}`);

        // Ejecutar pg_dump
        const command = `pg_dump "${databaseUrl}" -f "${filePath}"`;
        await execPromise(command);

        // Verificar que el archivo existe
        if (!fs.existsSync(filePath)) {
            throw new Error('El archivo de backup no se creó');
        }

        const stats = fs.statSync(filePath);
        console.log(`✅ Backup creado: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

        return { success: true, filePath, fileName };
    } catch (error) {
        console.error('❌ Error creando backup:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Ejecutar backup completo (crear + subir a Drive)
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

        // Paso 2: Subir a Google Drive
        const uploadResult = await uploadToGoogleDrive(backupResult.filePath, backupResult.fileName);
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
            driveLink: uploadResult.link,
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
 * Listar backups en Google Drive
 */
async function listBackups() {
    try {
        const auth = await getGoogleDriveAuth();
        const drive = google.drive({ version: 'v3', auth });

        const response = await drive.files.list({
            q: `'${GOOGLE_DRIVE_FOLDER_ID}' in parents and trashed = false`,
            fields: 'files(id, name, createdTime, size)',
            orderBy: 'createdTime desc',
            pageSize: 30
        });

        return {
            success: true,
            backups: response.data.files.map(file => ({
                id: file.id,
                name: file.name,
                createdAt: file.createdTime,
                size: file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(2)} MB` : 'N/A'
            }))
        };
    } catch (error) {
        console.error('Error listando backups:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    executeFullBackup,
    createDatabaseBackup,
    uploadToGoogleDrive,
    listBackups
};
