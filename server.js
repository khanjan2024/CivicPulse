require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3001;

if (!process.env.DATABASE_URL) {
  console.error('\n======================================================');
  console.error('ERROR: DATABASE_URL environment variable is not defined!');
  console.error('Please create a .env file locally, or configure');
  console.error('DATABASE_URL in your cloud deployment dashboard.');
  console.error('See .env.example for details.');
  console.error('======================================================\n');
  process.exit(1);
}

// Setup PostgreSQL client pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

// Setup Supabase Client for Storage uploads
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
let supabase = null;
if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

// Multer memory storage (upload directly to Supabase storage bucket)
const upload = multer({ storage: multer.memoryStorage() });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('layout', 'layout');

app.use(expressLayouts);
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'civicpulse-secret',
    resave: false,
    saveUninitialized: false,
  })
);

function initDb() {
  pool.query(
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('citizen', 'authority')),
      authority_code TEXT,
      authority_state TEXT,
      authority_district TEXT
    )`,
    (err) => {
      if (err) {
        console.error('Error creating users table:', err);
      } else {
        pool.query(
          `CREATE TABLE IF NOT EXISTS reports (
            id SERIAL PRIMARY KEY,
            reporter_id INTEGER REFERENCES users(id),
            state TEXT NOT NULL,
            district TEXT NOT NULL,
            post_office TEXT NOT NULL,
            pincode TEXT NOT NULL,
            civic_type TEXT NOT NULL,
            description TEXT,
            image_path TEXT,
            status TEXT NOT NULL CHECK(status IN ('unsolved', 'pending', 'resolved')) DEFAULT 'unsolved',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )`,
          (err) => {
            if (err) {
              console.error('Error creating reports table:', err);
            }
          }
        );
      }
    }
  );
}

initDb();

function requireAuth(role) {
  return (req, res, next) => {
    if (!req.session.user) {
      return res.redirect('/login');
    }
    if (role && req.session.user.role !== role) {
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

app.get('/', (req, res) => {
  res.render('index', { user: req.session.user });
});

app.get('/signup', (req, res) => {
  res.render('signup', { error: null });
});

app.post('/signup', async (req, res) => {
  const {
    email,
    password,
    role,
    authority_code,
    authority_state,
    authority_district,
  } = req.body;
  if (!email || !password || !role) {
    return res.render('signup', { error: 'Please fill all required fields.' });
  }

  if (role === 'authority') {
    if (!authority_code || !authority_state || !authority_district) {
      return res.render('signup', {
        error: 'Authority code, state and district are required for authority signup.',
      });
    }
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    pool.query(
      'INSERT INTO users (email, password_hash, role, authority_code, authority_state, authority_district) VALUES ($1, $2, $3, $4, $5, $6)',
      [
        email,
        passwordHash,
        role,
        role === 'authority' ? authority_code : null,
        role === 'authority' ? authority_state : null,
        role === 'authority' ? authority_district : null
      ],
      (err) => {
        if (err) {
          let message = 'Could not create account.';
          if (err.code === '23505' || (err.message && err.message.includes('unique'))) {
            message = 'Email already registered.';
          }
          return res.render('signup', { error: message });
        }
        return res.redirect('/login');
      }
    );
  } catch (e) {
    return res.render('signup', { error: 'Unexpected error. Please try again.' });
  }
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { email, password, role, authority_code, authority_state, authority_district } = req.body;
  if (!email || !password || !role) {
    return res.render('login', { error: 'Please fill all required fields.' });
  }

  const query =
    role === 'authority'
      ? 'SELECT * FROM users WHERE email = $1 AND role = $2 AND authority_code = $3 AND authority_state = $4 AND authority_district = $5'
      : 'SELECT * FROM users WHERE email = $1 AND role = $2';
  const params =
    role === 'authority'
      ? [email, role, authority_code || null, authority_state || null, authority_district || null]
      : [email, role];

  pool.query(query, params, async (err, result) => {
    const user = result && result.rows ? result.rows[0] : null;
    if (err || !user) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.render('login', { error: 'Invalid credentials.' });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      authority_state: user.authority_state,
      authority_district: user.authority_district,
    };

    if (user.role === 'authority') {
      return res.redirect('/authority/dashboard');
    }
    return res.redirect('/citizen/dashboard');
  });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/citizen/dashboard', requireAuth('citizen'), (req, res) => {
  pool.query(
    'SELECT * FROM reports WHERE reporter_id = $1 ORDER BY created_at DESC',
    [req.session.user.id],
    (err, result) => {
      const reports = result ? result.rows : [];
      res.render('citizen_dashboard', { user: req.session.user, reports });
    }
  );
});

app.get('/report/new', requireAuth('citizen'), (req, res) => {
  const civicTypes = ['Garbage', 'Road Damage', 'Water Logging', 'Street Light', 'Other'];
  res.render('new_report', { user: req.session.user, civicTypes, error: null });
});

app.post(
  '/report/new',
  requireAuth('citizen'),
  upload.single('image'),
  async (req, res) => {
    const {
      state,
      district,
      post_office,
      pincode,
      civic_type,
      description,
    } = req.body;

    if (!state || !district || !post_office || !pincode || !civic_type) {
      const civicTypes = ['Garbage', 'Road Damage', 'Water Logging', 'Street Light', 'Other'];
      return res.render('new_report', {
        user: req.session.user,
        civicTypes,
        error: 'Please fill all required fields.',
      });
    }

    let imagePath = null;
    if (req.file) {
      if (supabase) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(req.file.originalname) || '.jpg';
        const filename = `${uniqueSuffix}${ext}`;

        try {
          const { data, error } = await supabase.storage
            .from('reports')
            .upload(filename, req.file.buffer, {
              contentType: req.file.mimetype,
              upsert: false
            });

          if (error) {
            console.error('Supabase upload error:', error);
          } else {
            const { data: { publicUrl } } = supabase.storage
              .from('reports')
              .getPublicUrl(filename);
            imagePath = publicUrl;
          }
        } catch (uploadErr) {
          console.error('Error uploading to Supabase Storage:', uploadErr);
        }
      } else {
        console.warn('Supabase storage is not configured. Saving reports without image.');
      }
    }

    pool.query(
      `INSERT INTO reports
      (reporter_id, state, district, post_office, pincode, civic_type, description, image_path, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unsolved')`,
      [
        req.session.user.id,
        state,
        district,
        post_office,
        pincode,
        civic_type,
        description || '',
        imagePath
      ],
      (err) => {
        if (err) {
          console.error('Error inserting report:', err);
          const civicTypes = ['Garbage', 'Road Damage', 'Water Logging', 'Street Light', 'Other'];
          return res.render('new_report', {
            user: req.session.user,
            civicTypes,
            error: 'Could not save report. Please try again.',
          });
        }
        return res.redirect('/citizen/dashboard');
      }
    );
  }
);

app.get('/authority/dashboard', requireAuth('authority'), (req, res) => {
  const { authority_state, authority_district } = req.session.user;
  pool.query(
    'SELECT id, state, district, post_office, pincode, civic_type, description, image_path, status, created_at, updated_at FROM reports WHERE state = $1 AND district = $2 ORDER BY created_at DESC',
    [authority_state, authority_district],
    (err, result) => {
      const reports = result ? result.rows : [];
      res.render('authority_dashboard', { user: req.session.user, reports });
    }
  );
});

app.post('/authority/report/:id/status', requireAuth('authority'), (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const { authority_state, authority_district } = req.session.user;
  const allowed = ['unsolved', 'pending', 'resolved'];
  if (!allowed.includes(status)) {
    return res.redirect('/authority/dashboard');
  }

  pool.query(
    'UPDATE reports SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND state = $3 AND district = $4',
    [status, id, authority_state, authority_district],
    (err) => {
      if (err) {
        console.error('Error updating status:', err);
      }
      return res.redirect('/authority/dashboard');
    }
  );
});

app.listen(PORT, () => {
  console.log(`CivicPulse running on http://localhost:${PORT}`);
});

