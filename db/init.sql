CREATE TABLE IF NOT EXISTS orders (
  id          VARCHAR(36)   PRIMARY KEY,
  user_id     VARCHAR(255)  NOT NULL,
  status      VARCHAR(50)   NOT NULL DEFAULT 'created',
  amount      NUMERIC(12,2) NOT NULL,
  currency    VARCHAR(10)   NOT NULL DEFAULT 'USD',
  items       JSONB         NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id          VARCHAR(36)   PRIMARY KEY,
  order_id    VARCHAR(36)   NOT NULL,
  status      VARCHAR(50)   NOT NULL DEFAULT 'pending',
  amount      NUMERIC(12,2) NOT NULL,
  currency    VARCHAR(10)   NOT NULL DEFAULT 'USD',
  method      VARCHAR(50)   NOT NULL DEFAULT 'credit_card',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_log (
  id          VARCHAR(36)   PRIMARY KEY,
  topic       VARCHAR(255)  NOT NULL,
  key         VARCHAR(255),
  event_type  VARCHAR(255)  NOT NULL,
  payload     JSONB         NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kafka_consumer_offsets (
  consumer_group   VARCHAR(255) NOT NULL,
  topic            VARCHAR(255) NOT NULL,
  partition        INTEGER      NOT NULL,
  committed_offset BIGINT       NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (consumer_group, topic, partition)
);

CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_user_id    ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_event_log_topic   ON event_log (topic);
CREATE INDEX IF NOT EXISTS idx_event_log_created ON event_log (created_at DESC);
