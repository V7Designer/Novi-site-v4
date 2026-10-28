const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Chave do login do admin. Defina SECRET_KEY nas variáveis de ambiente do Render.
// Sem ela, uma chave aleatória é criada a cada reinício (o admin precisa logar de novo).
const SECRET_KEY = process.env.SECRET_KEY || crypto.randomBytes(32).toString('hex');
if (!process.env.SECRET_KEY) {
    console.warn('⚠️  SECRET_KEY não definida: usando chave aleatória temporária.');
}

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cors());
// Envio de imagens do admin (base64) precisa de um limite maior que o das outras rotas
app.use('/api/admin/imagens', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Conexão com PostgreSQL (usando a variável do Render). Em banco local, sem SSL.
const dbUrl = process.env.DATABASE_URL || '';
const dbLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl) || /host=\/|%2F/.test(dbUrl);
const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbLocal ? false : { rejectUnauthorized: false }
});

function fail(res, err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
}

// ========== CONFIGURAÇÕES DO SITE ==========
const CONFIG_DEFAULTS = {
    whatsapp: '5583988655944',
    email: 'vini-dev@zohomail.com',
    instagram: 'vini.wdev',
    discord: 'anonymbtw',
    hero_food_title: 'Receba pedidos direto no WhatsApp. Sem comissão de aplicativo.',
    hero_food_lead: 'Sites para restaurantes com cardápio digital, carrinho e um painel para você mesmo atualizar.',
    hero_design_title: 'Artes que chamam atenção no feed.',
    hero_design_lead: 'Capas de música, banners de loja, logos e posts feitos para o seu projeto.',
    about_p1: 'Sou Vinícius Tavares, desenvolvedor fullstack e designer. Faço sites para restaurantes que querem vender direto pelo WhatsApp e artes para músicos, lojas e criadores que querem se destacar.',
    about_p2: 'Cada trabalho é feito sob medida, e você fala direto comigo pelo WhatsApp, sem agência no meio.',
    sobre_foto: '',
    youtube: '',
    tiktok: '',
    behance: '',
    preco_essencial: '1497',
    preco_delivery: '2497',
    preco_premium: '3497',
    oferta_essencial: '',
    oferta_delivery: '',
    oferta_premium: '',
    oferta_planos_ate: ''
};

// Imagem aceita: enviada pelo painel, da pasta do site, ou um link http(s)
function checkImage(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (v.length > 500) throw 'Endereço da imagem muito longo';
    if (/^\/api\/imagens\/\d+$/.test(v) || /^\/img\/[\w.\-]+$/.test(v)) return v;
    if (/^https?:\/\/\S+$/i.test(v)) return v;
    throw 'Imagem inválida: envie um arquivo ou use um link que comece com https://';
}
function checkLink(v) {
    v = String(v || '').trim();
    if (!v) return '';
    if (v.length > 500 || !/^https?:\/\/\S+$/i.test(v)) throw 'Link inválido: ele precisa começar com https://';
    return v;
}
function text(max, label) {
    return v => { v = String(v).trim(); if (v.length > max) throw `${label}: no máximo ${max} caracteres`; return v; };
}

const CONFIG_RULES = {
    whatsapp: v => {
        const d = String(v).replace(/\D/g, '');
        if (d.length < 10 || d.length > 15) throw 'WhatsApp inválido: use o número com DDI e DDD, por exemplo 5583999999999';
        return d;
    },
    email: v => {
        v = String(v).trim();
        if (v.length > 160 || !/^\S+@\S+\.\S+$/.test(v)) throw 'E-mail inválido';
        return v;
    },
    instagram: v => {
        const h = String(v).trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[\/?#].*$/, '');
        if (!/^[A-Za-z0-9._]{1,30}$/.test(h)) throw 'Instagram inválido: use só o nome de usuário, por exemplo vini.wdev';
        return h;
    },
    discord: v => {
        const h = String(v).trim().replace(/^@/, '');
        if (!/^[\w.]{2,40}$/.test(h)) throw 'Discord inválido: use só o nome de usuário, sem espaços';
        return h;
    },
    hero_food_title: text(140, 'Título dos restaurantes'),
    hero_food_lead: text(300, 'Texto dos restaurantes'),
    hero_design_title: text(140, 'Título do design'),
    hero_design_lead: text(300, 'Texto do design'),
    about_p1: text(600, 'Sobre mim, primeiro parágrafo'),
    about_p2: text(400, 'Sobre mim, segundo parágrafo'),
    sobre_foto: v => checkImage(v),
    youtube: v => checkLink(v),
    tiktok: v => checkLink(v),
    behance: v => checkLink(v),
    preco_essencial: v => priceRule(v),
    preco_delivery: v => priceRule(v),
    preco_premium: v => priceRule(v),
    oferta_essencial: v => priceRule(v),
    oferta_delivery: v => priceRule(v),
    oferta_premium: v => priceRule(v),
    oferta_planos_ate: v => {
        const d = new Date(v);
        if (isNaN(d)) throw 'Data da oferta inválida.';
        return d.toISOString();
    }
};
function priceRule(v) {
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    if (!n || n < 1 || n > 1000000) throw 'Preço inválido: use um número inteiro em reais';
    return String(n);
}

// 5583988655944 -> (83) 98865-5944 ; números de fora do Brasil ficam com +DDI
function formatPhone(d) {
    if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
        const ddd = d.slice(2, 4), rest = d.slice(4);
        return rest.length === 9 ? `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}` : `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    return '+' + d;
}

async function getRawConfig() {
    const { rows } = await pool.query('SELECT chave, valor FROM configuracoes');
    const cfg = Object.assign({}, CONFIG_DEFAULTS);
    rows.forEach(r => { if (r.chave in CONFIG_DEFAULTS) cfg[r.chave] = r.valor; });
    return cfg;
}

async function getConfig() {
    const cfg = await getRawConfig();
    // Oferta dos planos com validade: depois da data, ela sai do ar sozinha
    if (cfg.oferta_planos_ate && new Date(cfg.oferta_planos_ate) < new Date()) {
        cfg.oferta_essencial = cfg.oferta_delivery = cfg.oferta_premium = '';
    }
    cfg.whatsapp_exibicao = formatPhone(cfg.whatsapp);
    return cfg;
}

// Criar tabelas e inserir dados iniciais
async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                email TEXT NOT NULL,
                telefone TEXT,
                mensagem TEXT NOT NULL,
                status TEXT DEFAULT 'pendente',
                data TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS promocoes (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                descricao TEXT,
                preco_original TEXT,
                preco_promocional TEXT,
                bonus TEXT,
                data_validade TIMESTAMP,
                ativo INTEGER DEFAULT 1,
                cor_destaque TEXT DEFAULT '#ff3366',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS projetos (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                descricao TEXT NOT NULL,
                link TEXT,
                imagem TEXT,
                categoria TEXT DEFAULT 'restaurante',
                destaque INTEGER DEFAULT 0,
                ordem INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS configuracoes (
                chave TEXT PRIMARY KEY,
                valor TEXT NOT NULL
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS imagens (
                id SERIAL PRIMARY KEY,
                mime TEXT NOT NULL,
                dados BYTEA NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS trabalhos (
                id SERIAL PRIMARY KEY,
                titulo TEXT NOT NULL,
                tipo TEXT,
                imagem TEXT NOT NULL,
                largura INTEGER DEFAULT 1200,
                altura INTEGER DEFAULT 800,
                ordem INTEGER DEFAULT 0,
                ativo INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Preço e oferta de cada trabalho (também atualiza bancos que já existiam)
        await pool.query(`ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS preco INTEGER`);
        await pool.query(`ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS preco_oferta INTEGER`);
        await pool.query(`ALTER TABLE trabalhos ADD COLUMN IF NOT EXISTS oferta_ate TIMESTAMPTZ`);

        // Senha do admin vem da variável de ambiente ADMIN_PASSWORD (nunca fica no código).
        // Se ela estiver definida, cria o admin ou troca a senha dele a cada inicialização.
        const admin = await pool.query("SELECT * FROM admin WHERE username = 'admin'");
        if (process.env.ADMIN_PASSWORD) {
            const hashedPassword = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
            if (admin.rows.length === 0) {
                await pool.query("INSERT INTO admin (username, password) VALUES ($1, $2)", ['admin', hashedPassword]);
                console.log('✅ Admin criado');
            } else {
                await pool.query("UPDATE admin SET password = $1 WHERE username = 'admin'", [hashedPassword]);
                console.log('🔑 Senha do admin atualizada a partir de ADMIN_PASSWORD');
            }
        } else if (admin.rows.length === 0) {
            console.warn('⚠️  Nenhum admin existe. Defina ADMIN_PASSWORD e reinicie para criar o acesso.');
        }

        // Sites de restaurante iniciais
        const projetos = await pool.query("SELECT 1 FROM projetos LIMIT 1");
        if (projetos.rows.length === 0) {
            const projetosList = [
                ['O Barretão', 'Churrascaria com sistema de delivery e fidelidade', 'https://barretao-restaurante.onrender.com', 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=300', 1, 1],
                ['Ancoreta', 'Restaurante com frutos do mar e vista privilegiada', 'https://ancora-restaurante.onrender.com', 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=300', 1, 2],
                ['Tiowei', 'Comida japonesa com sistema de reservas', 'https://tiowei-restaurante.onrender.com', 'https://images.unsplash.com/photo-1617196035154-1e7e6e28b0db?w=300', 0, 3],
                ['Leone', 'Culinária italiana com cardápio digital', 'https://leone-restaurante.onrender.com', 'https://images.unsplash.com/photo-1603360946369-dc9bb6258143?w=300', 0, 4],
                ['D\'Melo Bolos', 'Confeitaria artesanal com pedidos online', 'https://dmelo-bolos.onrender.com', 'https://images.unsplash.com/photo-1586985289688-ca3cf47d3e6e?w=300', 0, 5]
            ];
            for (const p of projetosList) {
                await pool.query(`INSERT INTO projetos (nome, descricao, link, imagem, destaque, ordem) VALUES ($1, $2, $3, $4, $5, $6)`, p);
            }
            console.log('✅ Projetos padrão inseridos');
        }

        // Trabalhos de design iniciais (as imagens vêm da pasta public/img)
        const trabalhos = await pool.query("SELECT 1 FROM trabalhos LIMIT 1");
        if (trabalhos.rows.length === 0) {
            const lista = [
                ['GTA V', 'Wallpaper de jogo', '/img/gta-v.webp', 1280, 720],
                ['Moon Hosting', 'Logo e avatar de Natal', '/img/moon-hosting.webp', 900, 900],
                ['021 Richard', 'Arte de divulgação de música', '/img/021-richard.webp', 1050, 1300],
                ['LEOD Store', 'Banner para loja de Discord', '/img/leod-store.webp', 1020, 265],
                ['God of War', 'Wallpaper de jogo', '/img/god-of-war.webp', 1280, 720],
                ['Os Astros do GBRX', 'Arte para rede social', '/img/astros-gbrx.webp', 900, 900]
            ];
            for (let i = 0; i < lista.length; i++) {
                await pool.query(`INSERT INTO trabalhos (titulo, tipo, imagem, largura, altura, ordem) VALUES ($1, $2, $3, $4, $5, $6)`, [...lista[i], i + 1]);
            }
            console.log('✅ Trabalhos de design iniciais inseridos');
        }

        // Preços iniciais dos 6 trabalhos de exemplo. Roda uma única vez: depois, o que você
        // mudar (ou apagar) no painel nunca é sobrescrito.
        const jaMigrou = await pool.query("SELECT 1 FROM configuracoes WHERE chave = 'migr_precos_v1'");
        if (jaMigrou.rows.length === 0) {
            const iniciais = [['GTA V', 40], ['God of War', 40], ['LEOD Store', 50], ['021 Richard', 60], ['Os Astros do GBRX', 35], ['Moon Hosting', 80]];
            for (const [titulo, preco] of iniciais) {
                await pool.query('UPDATE trabalhos SET preco = $2 WHERE titulo = $1 AND preco IS NULL', [titulo, preco]);
            }
            await pool.query("INSERT INTO configuracoes (chave, valor) VALUES ('migr_precos_v1', '1') ON CONFLICT (chave) DO NOTHING");
            console.log('💰 Preços iniciais dos trabalhos definidos');
        }

        console.log('📁 Banco PostgreSQL conectado com sucesso!');
    } catch (err) {
        console.error('Erro ao inicializar banco:', err);
    }
}

initDatabase();

// ========== ROTAS PÚBLICAS ==========
app.get('/api/config', async (req, res) => {
    try { res.json(await getConfig()); }
    catch (err) { fail(res, err); }
});

app.get('/api/promocao/ativa', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM promocoes WHERE ativo = 1 AND data_validade > NOW() ORDER BY created_at DESC LIMIT 1`);
        res.json(result.rows[0] || null);
    } catch (err) { fail(res, err); }
});

app.post('/api/contato', async (req, res) => {
    const { nome, email, telefone, mensagem } = req.body || {};
    if (!nome || !email || !mensagem) {
        return res.status(400).json({ error: 'Campos obrigatórios' });
    }
    if ([nome, email, telefone || '', mensagem].some(v => typeof v !== 'string') ||
        nome.length > 120 || email.length > 160 || (telefone || '').length > 30 || mensagem.length > 2000) {
        return res.status(400).json({ error: 'Dados inválidos' });
    }
    try {
        const result = await pool.query(
            `INSERT INTO leads (nome, email, telefone, mensagem, status) VALUES ($1, $2, $3, $4, 'pendente') RETURNING id`,
            [nome, email, telefone || null, mensagem]
        );
        res.json({ id: result.rows[0].id, message: 'Mensagem enviada!' });
    } catch (err) { fail(res, err); }
});

app.get('/api/projetos', async (req, res) => {
    try {
        const result = await pool.query(`SELECT * FROM projetos ORDER BY destaque DESC, ordem ASC, id DESC`);
        res.json(result.rows);
    } catch (err) { fail(res, err); }
});

app.get('/api/trabalhos', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, titulo, tipo, imagem, largura, altura, preco,
                   CASE WHEN preco_oferta IS NOT NULL AND (oferta_ate IS NULL OR oferta_ate > NOW()) THEN preco_oferta END AS preco_oferta,
                   CASE WHEN preco_oferta IS NOT NULL AND (oferta_ate IS NULL OR oferta_ate > NOW()) THEN oferta_ate END AS oferta_ate
            FROM trabalhos WHERE ativo = 1 ORDER BY ordem ASC, id ASC`);
        res.json(result.rows);
    } catch (err) { fail(res, err); }
});

app.get('/api/imagens/:id', async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(404).end();
    try {
        const r = await pool.query('SELECT mime, dados FROM imagens WHERE id = $1', [id]);
        if (!r.rows.length) return res.status(404).end();
        res.set({
            'Content-Type': r.rows[0].mime,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff'
        });
        res.send(r.rows[0].dados);
    } catch (err) { fail(res, err); }
});

// ========== ROTAS ADMIN ==========
function verifyToken(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'Token não fornecido' });
    jwt.verify(String(token).split(' ')[1], SECRET_KEY, (err, decoded) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = decoded;
        next();
    });
}

// Limite de tentativas de login por IP: 10 a cada 15 minutos
const loginTries = new Map();
function loginLimiter(req, res, next) {
    const now = Date.now();
    const rec = loginTries.get(req.ip);
    if (rec && rec.reset > now && rec.count >= 10) {
        return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    }
    next();
}
function registerLoginFail(ip) {
    const now = Date.now();
    const rec = loginTries.get(ip);
    if (!rec || rec.reset <= now) loginTries.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
    else rec.count++;
}

app.post('/api/admin/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Informe usuário e senha' });
    }
    try {
        const user = await pool.query("SELECT * FROM admin WHERE username = $1", [username]);
        if (user.rows.length === 0 || !bcrypt.compareSync(password, user.rows[0].password)) {
            registerLoginFail(req.ip);
            return res.status(401).json({ error: 'Usuário ou senha inválidos' });
        }
        loginTries.delete(req.ip);
        const token = jwt.sign({ id: user.rows[0].id, username: user.rows[0].username }, SECRET_KEY, { expiresIn: '24h' });
        res.json({ token });
    } catch (err) { fail(res, err); }
});

// Configurações do site (contatos, redes, textos, preços)
app.get('/api/admin/config', verifyToken, async (req, res) => {
    try { res.json({ config: await getConfig(), padrao: CONFIG_DEFAULTS }); }
    catch (err) { fail(res, err); }
});

app.put('/api/admin/config', verifyToken, async (req, res) => {
    const body = req.body || {};
    const clean = {};
    try {
        for (const key of Object.keys(body)) {
            if (!(key in CONFIG_RULES)) continue;
            const raw = body[key];
            if (typeof raw !== 'string' && typeof raw !== 'number') throw 'Valor inválido em ' + key;
            const value = String(raw).trim();
            // Campo vazio volta ao texto padrão (a foto do Sobre mim vazia remove a foto)
            clean[key] = value === '' ? null : CONFIG_RULES[key](value);
        }
    } catch (msg) {
        return res.status(400).json({ error: typeof msg === 'string' ? msg : 'Dados inválidos' });
    }
    try {
        const merged = await getRawConfig();
        for (const [k, v] of Object.entries(clean)) merged[k] = v === null ? CONFIG_DEFAULTS[k] : v;
        for (const [id, nome] of [['essencial', 'Essencial'], ['delivery', 'Delivery Pro'], ['premium', 'Premium']]) {
            const o = parseInt(merged['oferta_' + id], 10) || 0, n = parseInt(merged['preco_' + id], 10);
            if (o && o >= n) return res.status(400).json({ error: `Plano ${nome}: o preço em oferta precisa ser menor que o preço normal (R$ ${n}).` });
        }
        for (const [key, value] of Object.entries(clean)) {
            if (value === null || (key === 'sobre_foto' && value === '')) {
                await pool.query('DELETE FROM configuracoes WHERE chave = $1', [key]);
            } else {
                await pool.query(
                    `INSERT INTO configuracoes (chave, valor) VALUES ($1, $2)
                     ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor`, [key, value]);
            }
        }
        res.json({ config: await getConfig(), message: 'Configurações salvas!' });
    } catch (err) { fail(res, err); }
});

// Envio de imagens (guardadas no banco, para não sumirem quando o Render reinicia)
const MAX_IMG = 5 * 1024 * 1024;
function sniffMime(buf) {
    if (buf.length > 12 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
    if (buf.length > 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (buf.length > 6 && buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
    return null;
}
app.post('/api/admin/imagens', verifyToken, async (req, res) => {
    const m = /^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]+)$/.exec((req.body && req.body.dataUrl) || '');
    if (!m) return res.status(400).json({ error: 'Envie uma imagem PNG, JPG, WebP ou GIF.' });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_IMG) return res.status(413).json({ error: 'Imagem muito grande (máximo 5 MB).' });
    const mime = sniffMime(buf);
    if (!mime) return res.status(400).json({ error: 'O arquivo não parece ser uma imagem válida.' });
    try {
        const r = await pool.query('INSERT INTO imagens (mime, dados) VALUES ($1, $2) RETURNING id', [mime, buf]);
        res.json({ id: r.rows[0].id, url: '/api/imagens/' + r.rows[0].id, bytes: buf.length });
    } catch (err) { fail(res, err); }
});

// CRUD Trabalhos de design
function intIn(v, def, min, max) {
    const n = parseInt(v, 10);
    if (isNaN(n)) return def;
    return Math.max(min, Math.min(max, n));
}
function priceOrNull(v, label) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    const n = parseInt(String(v).replace(/\D/g, ''), 10);
    if (!n || n < 1 || n > 100000) throw `${label} inválido: use um número inteiro em reais.`;
    return n;
}
function trabalhoFields(b) {
    const titulo = String(b.titulo || '').trim();
    if (!titulo || titulo.length > 80) throw 'Dê um título ao trabalho (até 80 caracteres).';
    const tipo = String(b.tipo || '').trim();
    if (tipo.length > 80) throw 'O tipo pode ter no máximo 80 caracteres.';
    const imagem = checkImage(b.imagem);
    if (!imagem) throw 'Envie a imagem do trabalho.';
    const preco = priceOrNull(b.preco, 'Preço');
    const preco_oferta = priceOrNull(b.preco_oferta, 'Preço em oferta');
    if (preco_oferta !== null) {
        if (preco === null) throw 'Para colocar em oferta, defina primeiro o preço normal.';
        if (preco_oferta >= preco) throw 'O preço em oferta precisa ser menor que o preço normal.';
    }
    let oferta_ate = null;
    if (b.oferta_ate) {
        const d = new Date(b.oferta_ate);
        if (isNaN(d)) throw 'Data da oferta inválida.';
        oferta_ate = d.toISOString();
    }
    if (preco_oferta === null) oferta_ate = null;
    return {
        titulo, tipo, imagem, preco, preco_oferta, oferta_ate,
        largura: intIn(b.largura, 1200, 1, 10000),
        altura: intIn(b.altura, 800, 1, 10000),
        ordem: intIn(b.ordem, 0, -100000, 100000),
        ativo: b.ativo === 0 || b.ativo === false || b.ativo === '0' ? 0 : 1
    };
}

// Oferta em todos os trabalhos que têm preço: desconto em % com data de fim opcional
app.post('/api/admin/trabalhos/oferta', verifyToken, async (req, res) => {
    const pct = parseInt((req.body || {}).percentual, 10);
    if (!pct || pct < 1 || pct > 90) return res.status(400).json({ error: 'Use um desconto entre 1% e 90%.' });
    let ate = null;
    if ((req.body || {}).ate) {
        const d = new Date(req.body.ate);
        if (isNaN(d)) return res.status(400).json({ error: 'Data da oferta inválida.' });
        if (d < new Date()) return res.status(400).json({ error: 'A data de fim da oferta já passou.' });
        ate = d.toISOString();
    }
    try {
        const r = await pool.query(
            `UPDATE trabalhos SET preco_oferta = GREATEST(1, ROUND(preco * (100 - $1::int) / 100.0)::int), oferta_ate = $2::timestamptz
             WHERE preco IS NOT NULL AND preco > 1`, [pct, ate]);
        res.json({ atualizados: r.rowCount, message: `Oferta de ${pct}% aplicada em ${r.rowCount} trabalho(s).` });
    } catch (err) { fail(res, err); }
});

app.delete('/api/admin/trabalhos/oferta', verifyToken, async (req, res) => {
    try {
        const r = await pool.query('UPDATE trabalhos SET preco_oferta = NULL, oferta_ate = NULL WHERE preco_oferta IS NOT NULL');
        res.json({ atualizados: r.rowCount, message: 'Ofertas dos trabalhos removidas.' });
    } catch (err) { fail(res, err); }
});

app.get('/api/admin/trabalhos', verifyToken, async (req, res) => {
    try {
        res.json((await pool.query(`SELECT *, (preco_oferta IS NOT NULL AND (oferta_ate IS NULL OR oferta_ate > NOW())) AS oferta_ativa
                                    FROM trabalhos ORDER BY ordem ASC, id ASC`)).rows);
    }
    catch (err) { fail(res, err); }
});

app.post('/api/admin/trabalhos', verifyToken, async (req, res) => {
    let f;
    try { f = trabalhoFields(req.body || {}); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
    try {
        if (!(req.body && req.body.ordem !== undefined && req.body.ordem !== '')) {
            const max = await pool.query('SELECT COALESCE(MAX(ordem), 0) AS m FROM trabalhos');
            f.ordem = parseInt(max.rows[0].m, 10) + 1;
        }
        const r = await pool.query(
            `INSERT INTO trabalhos (titulo, tipo, imagem, largura, altura, ordem, ativo, preco, preco_oferta, oferta_ate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [f.titulo, f.tipo, f.imagem, f.largura, f.altura, f.ordem, f.ativo, f.preco, f.preco_oferta, f.oferta_ate]);
        res.json({ id: r.rows[0].id, message: 'Trabalho adicionado!' });
    } catch (err) { fail(res, err); }
});

app.put('/api/admin/trabalhos/:id', verifyToken, async (req, res) => {
    try {
        const atual = await pool.query('SELECT preco, preco_oferta, oferta_ate FROM trabalhos WHERE id = $1', [req.params.id]);
        if (!atual.rows.length) return res.status(404).json({ error: 'Trabalho não encontrado.' });
        // Campos de preço que não vierem na requisição continuam como estão
        const dados = Object.assign({}, atual.rows[0], req.body || {});
        let f;
        try { f = trabalhoFields(dados); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
        await pool.query(
            `UPDATE trabalhos SET titulo=$1, tipo=$2, imagem=$3, largura=$4, altura=$5, ordem=$6, ativo=$7, preco=$8, preco_oferta=$9, oferta_ate=$10 WHERE id=$11`,
            [f.titulo, f.tipo, f.imagem, f.largura, f.altura, f.ordem, f.ativo, f.preco, f.preco_oferta, f.oferta_ate, req.params.id]);
        res.json({ message: 'Trabalho atualizado!' });
    } catch (err) { fail(res, err); }
});

app.delete('/api/admin/trabalhos/:id', verifyToken, async (req, res) => {
    try { await pool.query('DELETE FROM trabalhos WHERE id = $1', [req.params.id]); res.json({ message: 'Trabalho excluído!' }); }
    catch (err) { fail(res, err); }
});

// CRUD Sites de restaurante (tabela projetos)
function projetoFields(b) {
    const nome = String(b.nome || '').trim();
    const descricao = String(b.descricao || '').trim();
    if (!nome || nome.length > 80) throw 'Dê um nome ao site (até 80 caracteres).';
    if (!descricao || descricao.length > 300) throw 'Escreva uma descrição de até 300 caracteres.';
    return {
        nome, descricao,
        link: checkLink(b.link) || null,
        imagem: checkImage(b.imagem) || null,
        destaque: b.destaque ? 1 : 0,
        ordem: intIn(b.ordem, 0, -100000, 100000)
    };
}

app.get('/api/admin/projetos', verifyToken, async (req, res) => {
    try { res.json((await pool.query("SELECT * FROM projetos ORDER BY ordem ASC, id DESC")).rows); }
    catch (err) { fail(res, err); }
});

app.post('/api/admin/projetos', verifyToken, async (req, res) => {
    let f;
    try { f = projetoFields(req.body || {}); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
    try {
        const r = await pool.query(
            `INSERT INTO projetos (nome, descricao, link, imagem, categoria, destaque, ordem) VALUES ($1,$2,$3,$4,'restaurante',$5,$6) RETURNING id`,
            [f.nome, f.descricao, f.link, f.imagem, f.destaque, f.ordem]);
        res.json({ id: r.rows[0].id, message: 'Site adicionado!' });
    } catch (err) { fail(res, err); }
});

app.put('/api/admin/projetos/:id', verifyToken, async (req, res) => {
    let f;
    try { f = projetoFields(req.body || {}); } catch (msg) { return res.status(400).json({ error: String(msg) }); }
    try {
        await pool.query(
            `UPDATE projetos SET nome=$1, descricao=$2, link=$3, imagem=$4, destaque=$5, ordem=$6 WHERE id=$7`,
            [f.nome, f.descricao, f.link, f.imagem, f.destaque, f.ordem, req.params.id]);
        res.json({ message: 'Site atualizado!' });
    } catch (err) { fail(res, err); }
});

app.delete('/api/admin/projetos/:id', verifyToken, async (req, res) => {
    try { await pool.query("DELETE FROM projetos WHERE id = $1", [req.params.id]); res.json({ message: 'Site excluído!' }); }
    catch (err) { fail(res, err); }
});

// CRUD Promoções
app.get('/api/admin/promocoes', verifyToken, async (req, res) => {
    try { res.json((await pool.query("SELECT * FROM promocoes ORDER BY created_at DESC")).rows); }
    catch (err) { fail(res, err); }
});

app.post('/api/admin/promocoes', verifyToken, async (req, res) => {
    const { titulo, descricao, preco_original, preco_promocional, bonus, data_validade, cor_destaque } = req.body || {};
    if (!titulo || !String(titulo).trim()) return res.status(400).json({ error: 'Dê um título à promoção.' });
    if (!data_validade || isNaN(new Date(data_validade))) return res.status(400).json({ error: 'Informe até quando a promoção vale.' });
    const cor = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(cor_destaque || '') ? cor_destaque : '#ff3366';
    try {
        const result = await pool.query(
            `INSERT INTO promocoes (titulo, descricao, preco_original, preco_promocional, bonus, data_validade, cor_destaque, ativo) VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id`,
            [String(titulo).slice(0, 120), descricao || null, preco_original || null, preco_promocional || null, bonus || null, data_validade, cor]
        );
        res.json({ id: result.rows[0].id, message: 'Promoção criada!' });
    } catch (err) { fail(res, err); }
});

app.put('/api/admin/promocoes/:id', verifyToken, async (req, res) => {
    const ativo = req.body && req.body.ativo ? 1 : 0;
    try { await pool.query("UPDATE promocoes SET ativo = $1 WHERE id = $2", [ativo, req.params.id]); res.json({ message: 'Status atualizado!' }); }
    catch (err) { fail(res, err); }
});

app.delete('/api/admin/promocoes/:id', verifyToken, async (req, res) => {
    try { await pool.query("DELETE FROM promocoes WHERE id = $1", [req.params.id]); res.json({ message: 'Promoção excluída!' }); }
    catch (err) { fail(res, err); }
});

// Mensagens recebidas (formulário do site)
app.get('/api/admin/leads', verifyToken, async (req, res) => {
    try { res.json((await pool.query("SELECT * FROM leads ORDER BY data DESC")).rows); }
    catch (err) { fail(res, err); }
});

app.delete('/api/admin/leads/:id', verifyToken, async (req, res) => {
    try { await pool.query("DELETE FROM leads WHERE id = $1", [req.params.id]); res.json({ message: 'Mensagem excluída!' }); }
    catch (err) { fail(res, err); }
});

app.put('/api/admin/leads/:id/finalizar', verifyToken, async (req, res) => {
    try { await pool.query("UPDATE leads SET status = 'finalizado' WHERE id = $1", [req.params.id]); res.json({ message: 'Mensagem finalizada!' }); }
    catch (err) { fail(res, err); }
});

app.get('/api/admin/stats', verifyToken, async (req, res) => {
    try {
        const one = async (sql) => parseInt((await pool.query(sql)).rows[0].total, 10);
        res.json({
            totalLeads: await one("SELECT COUNT(*) AS total FROM leads"),
            pendentes: await one("SELECT COUNT(*) AS total FROM leads WHERE status = 'pendente'"),
            finalizados: await one("SELECT COUNT(*) AS total FROM leads WHERE status = 'finalizado'"),
            projetosTotal: await one("SELECT COUNT(*) AS total FROM projetos"),
            trabalhosTotal: await one("SELECT COUNT(*) AS total FROM trabalhos")
        });
    } catch (err) { fail(res, err); }
});

app.listen(PORT, () => {
    console.log(`🚀 Site rodando na porta ${PORT}`);
    console.log(`📱 Acesse: http://localhost:${PORT}`);
    console.log(`🔐 Admin: http://localhost:${PORT}/admin.html`);
});
