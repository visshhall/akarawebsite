ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_email_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS marketing_whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS abandoned_cart_reminder_sent_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS care_email_sent_at TIMESTAMPTZ;
