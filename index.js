
// Taro server. Deploy this one file TWICE on Render with a different MODE:
//   MODE=api     -> SQL endpoints. Holds the database secrets. Never runs user code.
//   MODE=runner  -> runs user Node.js code. Must have NO database secrets.
// (MODE=dev runs both in one process for local testing only. Never use it in production.)

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Pool, Client } = require('pg');
const { createRemoteJWKSet, jwtVerify } = require('jose');

const MODE = process.env.MODE || 'api';
const PORT = process.env.PORT || 3000;
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT || 'movement-player';
const ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://taro.page.gd').split(',').map(s => s.trim());

const app = express();
app.set('trust proxy', 1); // Render terminates TLS
app.use(cors({ origin: (o, cb) => cb(null, !o || ORIGINS.includes(o)), methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));
app.use(express.json({ limit: '2mb' }));
if (process.env.SERVE_PUBLIC === '1') app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.json({ ok: true, mode: MODE }));

// ---- Firebase login check (public keys only, no service account needed) ----
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
async function needLogin(req, res, next) {
    try {
        const h = req.headers.authorization || '';
        if (!h.startsWith('Bearer ')) return res.status(401).json({ error: 'Log in first.' });
        const { payload } = await jwtVerify(h.slice(7), JWKS, { issuer: `https://securetoken.google.com/${FIREBASE_PROJECT}`, audience: FIREBASE_PROJECT });
        req.uid = payload.sub;
        next();
    } catch (e) {
        res.status(401).json({ error: 'Your login expired. Refresh the page and try again.' });
    }
}

// ---- tiny per-user rate limiter ----
const hits = new Map();
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
const limit = (max, ms) => (req, res, next) => {
    const k = req.path + ':' + req.uid, now = Date.now(), a = (hits.get(k) || []).filter(t => now - t < ms);
    if (a.length >= max) return res.status(429).json({ error: 'Too many requests. Wait a moment.' });
    a.push(now); hits.set(k, a); next();
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res) => fn(req, res).catch(e => {
    if (e.status) return res.status(e.status).json({ error: e.message });
    if (e.code && /^[0-9A-Z]{5}$/.test(e.code) && e.severity) return res.status(400).json({ error: e.message }); // SQL error from Postgres
    console.error(e); res.status(500).json({ error: 'Server error. Try again.' });
});

/* ====================================================================== */
/*  SQL (MODE=api): one Postgres schema + one LOGIN role per Taro user      */
/* ====================================================================== */
function startApi() {
    const REF = process.env.SUPABASE_REF || 'heoweopzgscysmiinbji';
    if (!process.env.SUPABASE_PASSWORD) console.warn('SUPABASE_PASSWORD is not set.');
    const SECRET = process.env.SQL_ROLE_SECRET || process.env.SUPABASE_PASSWORD || '';
    if (!process.env.SQL_ROLE_SECRET) console.warn('SQL_ROLE_SECRET is not set. Set a long random value (it derives each user\'s database password).');

    const ADMIN_USER = process.env.SUPABASE_DB_USER || 'postgres';
    const SFX = ADMIN_USER.includes('.') ? '.' + ADMIN_USER.split('.').slice(1).join('.') : ''; // Session pooler usernames look like role.<ref>
    const conn = {
        host: process.env.SUPABASE_DB_HOST || `db.${REF}.supabase.co`,
        port: Number(process.env.SUPABASE_DB_PORT || 5432),
        database: 'postgres',
        ssl: { rejectUnauthorized: false }
    };
    const admin = new Pool({ ...conn, user: ADMIN_USER, password: process.env.SUPABASE_PASSWORD, max: 4 });
    admin.on('error', e => console.error('pg pool:', e.message));

    const MAX_MB = Number(process.env.SQL_MAX_MB || 20), MAX_BYTES = MAX_MB * 1024 * 1024;
    const MAX_ROWS = Number(process.env.SQL_MAX_ROWS || 500), IDLE_DAYS = Number(process.env.SQL_IDLE_DAYS || 30);

    const h = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 20);
    const names = uid => ({ role: 'tu_' + h(uid), schema: 'ts_' + h(uid) });
    const rolePass = uid => crypto.createHmac('sha256', SECRET).update(uid).digest('hex');
    const safe = n => /^t[us]_[0-9a-f]{20}$/.test(n);

    const making = new Map();
    function ensureUser(uid) {
        if (making.has(uid)) return making.get(uid);
        const p = (async () => {
            const { role, schema } = names(uid);
            const ex = await admin.query('select 1 from pg_roles where rolname = $1', [role]);
            if (!ex.rowCount) {
                try { await admin.query(`create role "${role}" login password '${rolePass(uid)}' connection limit 3 nosuperuser nocreatedb nocreaterole`); }
                catch (e) { if (e.code !== '42710') throw e; } // already exists (race)
            }
            await admin.query(`create schema if not exists "${schema}"`);
            await admin.query(`grant all on schema "${schema}" to "${role}"`);
            await admin.query(`alter role "${role}" set search_path = "${schema}"`);
            await admin.query(
                `insert into taro_sql_users (uid, schema_name, role_name, last_used) values ($1, $2, $3, now())
                 on conflict (uid) do update set last_used = now()`, [uid, schema, role]);
            return { role, schema };
        })().finally(() => making.delete(uid));
        making.set(uid, p);
        return p;
    }

    async function schemaBytes(schema) {
        const r = await admin.query(
            `select coalesce(sum(pg_total_relation_size(c.oid)), 0)::bigint as b from pg_class c
             join pg_namespace n on n.oid = c.relnamespace where n.nspname = $1 and c.relkind in ('r', 'm')`, [schema]);
        return Number(r.rows[0].b);
    }

    async function runAs(uid, sql) {
        const { role, schema } = await ensureUser(uid);
        const over = (await schemaBytes(schema)) > MAX_BYTES;
        if (over && !sql.split(';').every(s => !s.trim() || /^\s*(select|drop|delete|truncate)\b/i.test(s)))
            throw fail(413, `Storage limit reached (${MAX_MB} MB). Free space with DROP, DELETE or TRUNCATE.`);
        // The user connects as THEIR OWN role (no SET ROLE), so they cannot switch to anyone else.
        const c = new Client({ ...conn, user: role + SFX, password: rolePass(uid), statement_timeout: 5000, connectionTimeoutMillis: 8000 });
        c.on('error', () => { });
        await c.connect();
        let timer;
        try {
            const pid = (await c.query('select pg_backend_pid() as pid')).rows[0].pid;
            // statement_timeout can be overridden by the user's SQL, so we also kill the session from outside.
            timer = setTimeout(() => admin.query('select pg_terminate_backend($1)', [pid]).catch(() => { }), 6500);
            const r = await c.query({ text: sql, rowMode: 'array' });
            return (Array.isArray(r) ? r : [r]).map(x => ({
                command: x.command, rowCount: x.rowCount,
                fields: (x.fields || []).map(f => f.name), rows: (x.rows || []).slice(0, MAX_ROWS)
            }));
        } catch (e) {
            if (/terminat|connection/i.test(e.message) && !e.severity) throw fail(408, 'The query took too long and was stopped.');
            throw e;
        } finally { clearTimeout(timer); c.end().catch(() => { }); }
    }

    const sqlText = req => {
        const s = req.body && req.body.sql;
        if (typeof s !== 'string' || !s.trim()) throw fail(400, 'Write some SQL first.');
        if (s.length > 100000) throw fail(413, 'That SQL file is too large.');
        return s;
    };
    app.post('/sql/run', needLogin, limit(30, 60000), wrap(async (req, res) => {
        res.json({ results: await runAs(req.uid, sqlText(req)) });
    }));
    app.post('/sql/schema', needLogin, limit(30, 60000), wrap(async (req, res) => {
        const { schema } = await ensureUser(req.uid);
        const r = await admin.query(`select table_name, column_name, data_type from information_schema.columns where table_schema = $1 order by table_name, ordinal_position`, [schema]);
        res.json({ columns: r.rows });
    }));
    app.post('/sql/reset', needLogin, limit(5, 60000), wrap(async (req, res) => {
        const { role, schema } = await ensureUser(req.uid);
        await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where usename = $1', [role + SFX]).catch(() => { });
        await admin.query(`drop schema if exists "${schema}" cascade`);
        await admin.query(`create schema "${schema}"`);
        await admin.query(`grant all on schema "${schema}" to "${role}"`);
        res.json({ ok: true });
    }));

    async function cleanup() { // delete databases of users who have not used SQL for a while
        try {
            const { rows } = await admin.query(`select uid, schema_name, role_name from taro_sql_users where last_used < now() - ($1 || ' days')::interval`, [String(IDLE_DAYS)]);
            for (const r of rows) {
                if (!safe(r.schema_name) || !safe(r.role_name)) continue;
                try {
                    await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where usename = $1', [r.role_name + SFX]).catch(() => { });
                    await admin.query(`drop schema if exists "${r.schema_name}" cascade`);
                    await admin.query(`drop owned by "${r.role_name}"`);
                    await admin.query(`drop role if exists "${r.role_name}"`);
                    await admin.query('delete from taro_sql_users where uid = $1', [r.uid]);
                } catch (e) { console.error('cleanup user failed:', e.message); }
            }
            if (rows.length) console.log(`Cleanup removed ${rows.length} idle SQL user(s).`);
        } catch (e) { console.error('Cleanup failed:', e.message); }
    }

    admin.query(`create table if not exists taro_sql_users (
            uid text primary key, schema_name text not null, role_name text not null, last_used timestamptz not null default now())`)
        .then(() => admin.query('alter table taro_sql_users enable row level security')) // no public API access
        .then(() => { cleanup(); setInterval(cleanup, 6 * 60 * 60 * 1000).unref(); })
        .catch(e => console.error('SQL init failed:', e.message));
}

/* ====================================================================== */
/*  Node runner (MODE=runner): runs user code in a throwaway folder         */
/* ====================================================================== */
function startRunner() {
    // The runner must never hold database secrets: user code could try to read them.
    const bad = Object.keys(process.env).filter(k => /SUPABASE|SQL_ROLE|SERVICE_KEY|PASSWORD/i.test(k));
    if (MODE === 'runner' && bad.length) { console.error('Refusing to start: remove these env vars from the runner service:', bad.join(', ')); process.exit(1); }

    const RUN_MS = Number(process.env.RUN_TIMEOUT_MS || 8000), MAX_RUN = Number(process.env.MAX_CONCURRENT || 2);
    // Node 22+ permission model: blocks child processes, workers, and reading files outside the job folder.
    const PERM = process.allowedNodeEnvironmentFlags.has('--permission') ? '--permission'
        : process.allowedNodeEnvironmentFlags.has('--experimental-permission') ? '--experimental-permission' : null;
    if (!PERM && process.env.ALLOW_UNSANDBOXED !== '1') { console.error('Node 22 or newer is required for the sandbox flag. Refusing to start.'); process.exit(1); }
    let running = 0;
    const cut = s => String(s || '').slice(0, 64 * 1024);

    app.post('/run', needLogin, limit(12, 60000), wrap(async (req, res) => {
        const { entry, files } = req.body || {};
        if (!Array.isArray(files) || !files.length || files.length > 100) throw fail(400, 'Send 1 to 100 files.');
        let total = 0;
        for (const f of files) {
            if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') throw fail(400, 'Bad file.');
            if (!/^[\w\-.]+(\/[\w\-.]+)*$/.test(f.path) || f.path.includes('..')) throw fail(400, 'Bad file name: ' + f.path);
            if ((total += f.content.length) > 2 * 1024 * 1024) throw fail(413, 'Project is too large to run.');
        }
        if (typeof entry !== 'string' || !/\.(c|m)?js$/.test(entry) || !files.some(f => f.path === entry)) throw fail(400, 'Choose a .js file to launch.');
        if (running >= MAX_RUN) throw fail(429, 'The runner is busy. Try again in a few seconds.');
        running++;
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'run-'));
        try {
            for (const f of files) {
                const p = path.join(dir, f.path);
                if (!p.startsWith(dir + path.sep)) throw fail(400, 'Bad file path.');
                await fs.promises.mkdir(path.dirname(p), { recursive: true });
                await fs.promises.writeFile(p, f.content);
            }
            const args = ['--max-old-space-size=96', ...(PERM ? [PERM, `--allow-fs-read=${dir}`, `--allow-fs-write=${dir}`] : []), entry];
            const out = await new Promise(resolve => execFile(process.execPath, args,
                { cwd: dir, env: { PATH: process.env.PATH, HOME: dir, NODE_ENV: 'production' }, timeout: RUN_MS, maxBuffer: 256 * 1024, killSignal: 'SIGKILL' },
                (err, stdout, stderr) => resolve({ stdout: cut(stdout), stderr: cut(stderr), code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, timedOut: !!(err && err.killed) })));
            res.json(out);
        } finally {
            running--;
            fs.promises.rm(dir, { recursive: true, force: true }).catch(() => { });
        }
    }));
}

if (MODE === 'api' || MODE === 'dev') startApi();
if (MODE === 'runner' || MODE === 'dev') startRunner();
if (!['api', 'runner', 'dev'].includes(MODE)) { console.error('Set MODE to api or runner.'); process.exit(1); }
if (MODE === 'dev') console.warn('MODE=dev runs user code next to the database secrets. For local testing only.');

app.listen(PORT, () => console.log(`Taro server (${MODE}) listening on ${PORT}`));
