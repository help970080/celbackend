// routes/analyticsRoutes.js
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/authMiddleware');
const pool = require('../config/database');

// ==========================================
// 1. INICIAR SESIÓN (Catálogo Público)
// ==========================================
router.post('/session/start', async (req, res) => {
  try {
    const {
      sessionId, // UUID generado en frontend
      tiendaId,
      userAgent,
      deviceType, // 'mobile', 'tablet', 'desktop'
      screenWidth,
      screenHeight,
      ipAddress
    } = req.body;

    // Verificar si ya existe sesión
    const existingSession = await pool.query(
      'SELECT id FROM catalog_sessions WHERE session_id = $1',
      [sessionId]
    );

    if (existingSession.rows.length > 0) {
      return res.json({ 
        success: true, 
        message: 'Sesión ya existe',
        sessionId 
      });
    }

    // Crear nueva sesión
    const result = await pool.query(`
      INSERT INTO catalog_sessions (
        session_id, tienda_id, user_agent, device_type,
        screen_width, screen_height, ip_address
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [sessionId, tiendaId, userAgent, deviceType, screenWidth, screenHeight, ipAddress]);

    res.json({
      success: true,
      message: 'Sesión iniciada',
      session: result.rows[0]
    });

  } catch (error) {
    console.error('Error al iniciar sesión:', error);
    res.status(500).json({ 
      message: 'Error al iniciar sesión',
      error: error.message 
    });
  }
});

// ==========================================
// 2. CERRAR SESIÓN
// ==========================================
router.post('/session/end', async (req, res) => {
  try {
    const { sessionId, productsViewed, searchesMade, whatsappClicks } = req.body;

    await pool.query(
      'SELECT close_session($1, $2, $3, $4)',
      [sessionId, productsViewed || 0, searchesMade || 0, whatsappClicks || 0]
    );

    res.json({ success: true, message: 'Sesión cerrada' });

  } catch (error) {
    console.error('Error al cerrar sesión:', error);
    res.status(500).json({ 
      message: 'Error al cerrar sesión',
      error: error.message 
    });
  }
});

// ==========================================
// 3. REGISTRAR VISTA DE PRODUCTO
// ==========================================
router.post('/product/view', async (req, res) => {
  try {
    const {
      sessionId,
      productId,
      tiendaId,
      viewSource, // 'list', 'search', 'featured'
      timeSpent
    } = req.body;

    await pool.query(`
      INSERT INTO product_views (
        session_id, product_id, tienda_id, view_source, time_spent_seconds
      ) VALUES ($1, $2, $3, $4, $5)
    `, [sessionId, productId, tiendaId, viewSource, timeSpent || 0]);

    res.json({ success: true });

  } catch (error) {
    console.error('Error al registrar vista:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 4. REGISTRAR BÚSQUEDA
// ==========================================
router.post('/search', async (req, res) => {
  try {
    const {
      sessionId,
      tiendaId,
      searchTerm,
      resultsCount,
      categoryFilter,
      priceMin,
      priceMax,
      sortBy
    } = req.body;

    await pool.query(`
      INSERT INTO catalog_searches (
        session_id, tienda_id, search_term, results_count,
        category_filter, price_min, price_max, sort_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [sessionId, tiendaId, searchTerm, resultsCount, categoryFilter, priceMin, priceMax, sortBy]);

    res.json({ success: true });

  } catch (error) {
    console.error('Error al registrar búsqueda:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 5. REGISTRAR CLICK EN WHATSAPP
// ==========================================
router.post('/whatsapp/click', async (req, res) => {
  try {
    const {
      sessionId,
      productId,
      tiendaId,
      productName,
      productPrice
    } = req.body;

    await pool.query(`
      INSERT INTO whatsapp_clicks (
        session_id, product_id, tienda_id, product_name, product_price
      ) VALUES ($1, $2, $3, $4, $5)
    `, [sessionId, productId, tiendaId, productName, productPrice]);

    res.json({ success: true });

  } catch (error) {
    console.error('Error al registrar click WhatsApp:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 6. REGISTRAR EVENTO PERSONALIZADO
// ==========================================
router.post('/event', async (req, res) => {
  try {
    const { sessionId, tiendaId, eventType, eventData } = req.body;

    await pool.query(`
      INSERT INTO catalog_events (session_id, tienda_id, event_type, event_data)
      VALUES ($1, $2, $3, $4)
    `, [sessionId, tiendaId, eventType, JSON.stringify(eventData)]);

    res.json({ success: true });

  } catch (error) {
    console.error('Error al registrar evento:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 7. DASHBOARD - ESTADÍSTICAS GENERALES
// ==========================================
router.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, tiendaId } = req.query;
    const userTiendaId = req.user.role === 'super_admin' ? tiendaId : req.user.tiendaId;

    // Estadísticas generales
    const statsQuery = `
      SELECT 
        COUNT(DISTINCT session_id) as total_sessions,
        AVG(duration_seconds) as avg_duration,
        SUM(page_views) as total_page_views,
        SUM(products_viewed) as total_products_viewed,
        SUM(searches_made) as total_searches,
        SUM(whatsapp_clicks) as total_whatsapp_clicks,
        ROUND(
          SUM(whatsapp_clicks)::numeric / NULLIF(COUNT(DISTINCT session_id), 0) * 100,
          2
        ) as conversion_rate
      FROM catalog_sessions
      WHERE 
        ($1::INTEGER IS NULL OR tienda_id = $1)
        AND ($2::DATE IS NULL OR session_start >= $2)
        AND ($3::DATE IS NULL OR session_start <= $3)
    `;

    const stats = await pool.query(statsQuery, [userTiendaId, startDate, endDate]);

    // Dispositivos
    const devicesQuery = `
      SELECT 
        device_type,
        COUNT(*) as count
      FROM catalog_sessions
      WHERE 
        ($1::INTEGER IS NULL OR tienda_id = $1)
        AND ($2::DATE IS NULL OR session_start >= $2)
        AND ($3::DATE IS NULL OR session_start <= $3)
      GROUP BY device_type
    `;

    const devices = await pool.query(devicesQuery, [userTiendaId, startDate, endDate]);

    // Productos más vistos
    const topProductsQuery = `
      SELECT 
        p.id,
        p.nombre,
        p.marca,
        p.precio,
        COUNT(pv.id) as views,
        SUM(CASE WHEN pv.clicked_whatsapp THEN 1 ELSE 0 END) as whatsapp_clicks
      FROM product_views pv
      JOIN products p ON pv.product_id = p.id
      WHERE 
        ($1::INTEGER IS NULL OR pv.tienda_id = $1)
        AND ($2::DATE IS NULL OR pv.viewed_at >= $2)
        AND ($3::DATE IS NULL OR pv.viewed_at <= $3)
      GROUP BY p.id, p.nombre, p.marca, p.precio
      ORDER BY views DESC
      LIMIT 10
    `;

    const topProducts = await pool.query(topProductsQuery, [userTiendaId, startDate, endDate]);

    // Búsquedas populares
    const topSearchesQuery = `
      SELECT 
        search_term,
        COUNT(*) as count,
        AVG(results_count) as avg_results
      FROM catalog_searches
      WHERE 
        ($1::INTEGER IS NULL OR tienda_id = $1)
        AND ($2::DATE IS NULL OR searched_at >= $2)
        AND ($3::DATE IS NULL OR searched_at <= $3)
      GROUP BY search_term
      ORDER BY count DESC
      LIMIT 10
    `;

    const topSearches = await pool.query(topSearchesQuery, [userTiendaId, startDate, endDate]);

    res.json({
      success: true,
      stats: stats.rows[0],
      devices: devices.rows,
      topProducts: topProducts.rows,
      topSearches: topSearches.rows
    });

  } catch (error) {
    console.error('Error al obtener dashboard:', error);
    res.status(500).json({ 
      message: 'Error al obtener dashboard',
      error: error.message 
    });
  }
});

// ==========================================
// 8. ESTADÍSTICAS POR DÍA (GRÁFICA)
// ==========================================
router.get('/daily-stats', authenticateToken, async (req, res) => {
  try {
    const { days = 30, tiendaId } = req.query;
    const userTiendaId = req.user.role === 'super_admin' ? tiendaId : req.user.tiendaId;

    const query = `
      SELECT * FROM daily_stats
      WHERE 
        ($1::INTEGER IS NULL OR tienda_id = $1)
        AND date >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
      ORDER BY date ASC
    `;

    const result = await pool.query(query, [userTiendaId]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Error al obtener estadísticas diarias:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 9. TASA DE CONVERSIÓN POR HORA
// ==========================================
router.get('/hourly-conversion', authenticateToken, async (req, res) => {
  try {
    const { tiendaId } = req.query;
    const userTiendaId = req.user.role === 'super_admin' ? tiendaId : req.user.tiendaId;

    const result = await pool.query(`
      SELECT * FROM hourly_conversion
      WHERE ($1::INTEGER IS NULL OR tienda_id = $1)
      ORDER BY hour_of_day
    `, [userTiendaId]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Error al obtener conversión por hora:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 10. EXPORTAR DATOS A CSV
// ==========================================
router.get('/export/sessions', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, tiendaId } = req.query;
    const userTiendaId = req.user.role === 'super_admin' ? tiendaId : req.user.tiendaId;

    const result = await pool.query(`
      SELECT 
        cs.session_id,
        cs.device_type,
        cs.session_start,
        cs.session_end,
        cs.duration_seconds,
        cs.page_views,
        cs.products_viewed,
        cs.searches_made,
        cs.whatsapp_clicks,
        st.nombre as tienda
      FROM catalog_sessions cs
      LEFT JOIN stores st ON cs.tienda_id = st.id
      WHERE 
        ($1::INTEGER IS NULL OR cs.tienda_id = $1)
        AND ($2::DATE IS NULL OR cs.session_start >= $2)
        AND ($3::DATE IS NULL OR cs.session_start <= $3)
      ORDER BY cs.session_start DESC
    `, [userTiendaId, startDate, endDate]);

    res.json({
      success: true,
      data: result.rows
    });

  } catch (error) {
    console.error('Error al exportar:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;