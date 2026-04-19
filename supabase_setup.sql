-- DIVE-FLOW Supabase Schema Setup (Final Solid Version)
-- ------------------------------------------------------------

-- 1. Create Tables (If Not Exists)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT auth.uid(),
    user_id UUID REFERENCES auth.users(id),
    name TEXT,
    cert TEXT,
    association TEXT,
    insurance TEXT,
    photo TEXT,
    cert_photo TEXT,
    special_certs JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS dives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    date TIMESTAMP WITH TIME ZONE,
    location TEXT,
    depth DECIMAL,
    duration INTEGER,
    temp DECIMAL,
    lat DECIMAL,
    lng DECIMAL,
    gas TEXT,
    pressure_start INTEGER,
    pressure_end INTEGER,
    mood TEXT,
    stress_pre INTEGER,
    stress_post INTEGER,
    flow INTEGER,
    visibility TEXT,
    has_current BOOLEAN,
    species JSONB DEFAULT '[]'::jsonb,
    custom_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS gear (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    name TEXT,
    category TEXT,
    purchase_date DATE,
    price DECIMAL,
    service_limit INTEGER,
    last_service_dive INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS buddies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id),
    name TEXT,
    cert TEXT,
    dives INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id),
    active_modules TEXT[],
    field_visibility JSONB,
    custom_field_configs JSONB
);

-- 2. Migration Checks (Columns)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dives' AND column_name='user_id') THEN
        ALTER TABLE dives ADD COLUMN user_id UUID REFERENCES auth.users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='dives' AND column_name='species') THEN
        ALTER TABLE dives ADD COLUMN species JSONB DEFAULT '[]'::jsonb;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='user_id') THEN
        ALTER TABLE profiles ADD COLUMN user_id UUID REFERENCES auth.users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gear' AND column_name='user_id') THEN
        ALTER TABLE gear ADD COLUMN user_id UUID REFERENCES auth.users(id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='buddies' AND column_name='user_id') THEN
        ALTER TABLE buddies ADD COLUMN user_id UUID REFERENCES auth.users(id);
    END IF;
END $$;

-- 3. Security (RLS)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Users can manage their own profile') THEN
        ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can manage their own profile" ON profiles FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'dives' AND policyname = 'Users can manage their own dives') THEN
        ALTER TABLE dives ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can manage their own dives" ON dives FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'gear' AND policyname = 'Users can manage their own gear') THEN
        ALTER TABLE gear ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can manage their own gear" ON gear FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'buddies' AND policyname = 'Users can manage their own buddies') THEN
        ALTER TABLE buddies ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can manage their own buddies" ON buddies FOR ALL USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'settings' AND policyname = 'Users can manage their own settings') THEN
        ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can manage their own settings" ON settings FOR ALL USING (auth.uid() = user_id);
    END IF;
END $$;
