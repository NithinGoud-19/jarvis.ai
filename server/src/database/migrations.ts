/**
 * 📘 LESSON: Migrations
 * A database has a "schema" (its tables and columns). Over time we will add more
 * tables (tasks, emails, jobs...). A MIGRATION is one numbered step that changes the
 * schema. Rules:
 *   1. Never edit an old migration after it has run — add a NEW one instead.
 *   2. Each migration runs only once. We remember which ran in the "schema_migrations" table.
 * This way your database and your friend's database always end up the same.
 *
 * 📘 LESSON: Tables, columns, keys
 *   - TABLE       = like an Excel sheet (conversations, messages, memories)
 *   - COLUMN      = one field (title, content, created_at)
 *   - PRIMARY KEY = unique id for each row
 *   - FOREIGN KEY = a link to a row in another table
 *       messages.conversation_id → conversations.id
 *       "ON DELETE CASCADE" = delete a conversation → its messages are deleted too
 */
export const migrations: { id: number; name: string; sql: string }[] = [
  {
    id: 1,
    name: "create conversations, messages, memories",
    sql: `
      CREATE TABLE conversations (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role             TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
        content          TEXT    NOT NULL,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      -- An INDEX makes "find all messages of conversation X" fast (like a book's index)
      CREATE INDEX idx_messages_conversation ON messages(conversation_id);

      CREATE TABLE memories (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        content     TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // 📘 Notice: we did NOT edit migration 1. New table = new migration.
    id: 2,
    name: "create tool_logs",
    sql: `
      CREATE TABLE tool_logs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id  INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
        tool_name        TEXT    NOT NULL,
        args             TEXT    NOT NULL,
        ok               INTEGER NOT NULL,
        output           TEXT    NOT NULL,
        created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    // 📘 LESSON: UNIQUE constraints + seed data
    // - companies: whose career pages JARVIS checks. Each one uses an "ATS" (hiring platform)
    //   that publishes live jobs as free public JSON. "slug" = the company's id on that platform.
    //   Workday also needs the server number (wd_instance, e.g. "wd12") and site name (wd_site).
    // - jobs: every job JARVIS has found. UNIQUE(company_id, external_id) means the database
    //   itself REFUSES to store the same job twice — a safety net even if our code has a bug.
    // - The INSERTs at the end are "seed data": a starter list of companies hiring in
    //   Hyderabad (checked live on 10 Nov 2026). Add more any time from the Jobs page.
    id: 3,
    name: "create companies and jobs (job search)",
    sql: `
      CREATE TABLE companies (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL,
        ats          TEXT    NOT NULL CHECK (ats IN ('greenhouse','lever','ashby','smartrecruiters','workday')),
        slug         TEXT    NOT NULL,
        wd_instance  TEXT,
        wd_site      TEXT,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (ats, slug)
      );

      CREATE TABLE jobs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id     INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        external_id    TEXT    NOT NULL,
        title          TEXT    NOT NULL,
        location       TEXT    NOT NULL,
        url            TEXT    NOT NULL,
        posted_at      TEXT,
        status         TEXT    NOT NULL DEFAULT 'new'
                       CHECK (status IN ('new','saved','applied','interview','offer','rejected','ignored')),
        first_seen_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        last_seen_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE (company_id, external_id)
      );
      CREATE INDEX idx_jobs_status ON jobs(status);

      INSERT INTO companies (name, ats, slug, wd_instance, wd_site) VALUES
        ('HighRadius',            'greenhouse',      'highradius',         NULL, NULL),
        ('Zenoti',                'greenhouse',      'zenoti',             NULL, NULL),
        ('Zeta Global',           'greenhouse',      'zetaglobal',         NULL, NULL),
        ('Zscaler',               'greenhouse',      'zscaler',            NULL, NULL),
        ('Coinbase',              'greenhouse',      'coinbase',           NULL, NULL),
        ('Commvault',             'greenhouse',      'commvault',          NULL, NULL),
        ('New Relic',             'greenhouse',      'newrelic',           NULL, NULL),
        ('Sigmoid',               'greenhouse',      'sigmoid',            NULL, NULL),
        ('Paytm',                 'lever',           'paytm',              NULL, NULL),
        ('Zeta',                  'lever',           'zeta',               NULL, NULL),
        ('Outreach',              'lever',           'outreach',           NULL, NULL),
        ('CRED',                  'lever',           'cred',               NULL, NULL),
        ('Notion',                'ashby',           'notion',             NULL, NULL),
        ('ServiceNow',            'smartrecruiters', 'ServiceNow',         NULL, NULL),
        ('Experian',              'smartrecruiters', 'Experian',           NULL, NULL),
        ('Freshworks',            'smartrecruiters', 'Freshworks',         NULL, NULL),
        ('Salesforce',            'workday',         'salesforce',         'wd12', 'External_Career_Site'),
        ('Amgen',                 'workday',         'amgen',              'wd1',  'Careers'),
        ('State Street',          'workday',         'statestreet',        'wd1',  'Global'),
        ('Novartis',              'workday',         'novartis',           'wd3',  'Novartis_Careers'),
        ('NVIDIA',                'workday',         'nvidia',             'wd5',  'NVIDIAExternalCareerSite'),
        ('Micron',                'workday',         'micron',             'wd1',  'External'),
        ('Thermo Fisher',         'workday',         'thermofisher',       'wd5',  'ThermoFisherCareers'),
        ('Mastercard',            'workday',         'mastercard',         'wd1',  'CorporateCareers'),
        ('Synchrony',             'workday',         'synchronyfinancial', 'wd5',  'careers'),
        ('Broadridge',            'workday',         'broadridge',         'wd5',  'Careers'),
        ('Warner Bros. Discovery','workday',         'warnerbros',         'wd5',  'global');
    `,
  },
  {
    // 📘 ALTER TABLE adds columns to an existing table WITHOUT losing its rows.
    // (SQLite allows only one column per ALTER statement.)
    // - description:   the job's full text (plain text, HTML removed)
    // - match_score:   0–100, how well the job fits YOUR profile (no AI, instant)
    // - match_details: JSON with the skills you have / are missing, years asked, reasons
    // - ai_review:     JSON written by the AI when you ask for a deep review of one job
    id: 4,
    name: "job descriptions + match scores",
    sql: `
      ALTER TABLE jobs ADD COLUMN description    TEXT;
      ALTER TABLE jobs ADD COLUMN match_score    INTEGER;
      ALTER TABLE jobs ADD COLUMN match_details  TEXT;
      ALTER TABLE jobs ADD COLUMN ai_review      TEXT;
      ALTER TABLE jobs ADD COLUMN ai_reviewed_at TEXT;
      CREATE INDEX idx_jobs_score ON jobs(match_score);
    `,
  },
  {
    // 📘 The "answer bank": your answers to application questions JARVIS didn't know.
    // question_key = the question simplified (lowercase, no punctuation, company name → "{company}"),
    // so "Have you worked at New Relic?" and "Have you worked at Zeta?" share ONE saved answer.
    // UNIQUE(question_key) → saving the same question again UPDATES it (upsert), never duplicates.
    id: 5,
    name: "saved application answers",
    sql: `
      CREATE TABLE saved_answers (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        question_key TEXT NOT NULL UNIQUE,
        question     TEXT NOT NULL,
        answer       TEXT NOT NULL,
        uses         INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
];
