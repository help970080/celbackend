// services/backupService.js - Backup automático a Google Drive
const { google } = require('googleapis');
const { Sequelize } = require('sequelize');
const fs = require('fs');
const path = require('path');

// Configuración de Google Drive
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '1gAXqEu3BDH8QoCDT2wrdIyC0gytioSQP';

// Credenciales de la cuenta de servicio
function getGoogleCredentials() {
    let privateKey = process.env.GOOGLE_PRIVATE_KEY || "";
    
    if (privateKey) {
        privateKey = privateKey.replace(/\\n/g, '\n');
        
        if (!privateKey.includes('-----BEGIN')) {
            privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----\n`;
        }
    }
    
    return {
        type: "service_account",
        project_id: "celexpress-backups",
        private_key_id: "2e268bc8b2e3d34c2862e82ff4b49e5cb1105bec",
        private_key: privateKey,
        client_email: "celexpress-backup@celexpress-backups.iam.gserviceaccount.com",
        client_id: "104872331655676559796",
        auth_uri: "https://accounts.google.com/o/oauth2/auth",
        token_uri: "https://oauth2.googleapis.com/token"
    };
}

/**
 * Autenticar con Google Drive
 */
async function getGoogleDriveAuth() {
    const credentials = getGoogleCredentials();
    
    if (!credentials.private_key) {
        throw new Error('GOOGLE_PRIVATE_KEY no está configurada en las variables de entorno');
    }
    
    const auth = new google.auth.GoogleAuth({
        credentials: credentials,
        scopes: ['https://www.googleapis.com/auth/drive.file']
    });
    return auth;
}

/**
 * Subir archivo a Google Drive
 */
async function uploadToGoogleDrive(filePath, fileName) {
    try {
        console.log('📤 Iniciando subida a Google Drive...');
        console.log(`   Carpeta destino: ${GOOGLE_DRIVE_FOLDER_ID}`);
        
        const auth = await getGoogleDriveAuth();
        const drive = google.drive({ version: 'v3', auth });

        // Primero verificar que tenemos acceso a la carpeta
        try {
            const folder = await drive.files.get({
                fileId: GOOGLE_DRIVE_FOLDER_ID,
                fields: 'id, name'
            });
            console.log(`   ✅ Carpeta accesible: ${folder.data.name}`);
        } catch (folderError) {
            console.error('   ❌ No se puede acceder a la carpeta:', folderError.message);
            throw new Error(`No se puede acceder a la carpeta de Drive: ${folderError.message}`);
        }

        // Leer el contenido del archivo
        const fileContent = fs.readFileSync(filePath, 'utf8');
        console.log(`   Tamaño del archivo: ${(fileContent.length / 1024).toFixed(2)} KB`);
        
        // Crear el archivo
        const response = await drive.files.create({
            requestBody: {
                name: fileName,
                parents: [GOOGLE_DRIVE_FOLDER_ID]
            },
            media: {
                mimeType: 'application/json',
                body: fileContent
            },
            fields: 'id, name'
        });

        console.log(`✅ Backup subido a Google Drive: ${response.data.name}`);
        
        const fileLink = `https://drive.google.com/file/d/${response.data.id}/view`;
        console.log(`   Link: ${fileLink}`);

        return {
            success: true,
            fileId: response.data.id,
            fileName: response.data.name,
            link: fileLink
        };
    } catch (error) {
        console.error('❌ Error subiendo a Google Drive:', error.message);
        if (error.errors) {
            error.errors.forEach(e => console.error('   -', e.message, e.reason));
        }
        return { success: false, error: error.message };
    }
}

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
            fields: 'files(id, name, createdTime, size, webViewLink)',
            orderBy: 'createdTime desc',
            pageSize: 30,
            supportsAllDrives: true
        });

        return {
            success: true,
            backups: response.data.files.map(file => ({
                id: file.id,
                name: file.name,
                createdAt: file.createdTime,
                size: file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(2)} MB` : 'N/A',
                link: file.webViewLink
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